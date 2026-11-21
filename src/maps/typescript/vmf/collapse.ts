/**
 * Collapse `func_instance` entities into the map that uses them.
 *
 * This is the inverse of `create_instance_from_selection`: it reads each instance file,
 * expands its own instances, maps ids into the target, rotates/translates the geometry and
 * entities, and applies Hammer's name fixup (`prefix`, `postfix` or `none`). The output is
 * an ordinary VMF with no instances left, the form vbsp sees after expansion.
 *
 * The reference implementation is srctools' `instancing.py`; this is a narrower
 * reimplementation for the VMF subset this project writes. It does not consult an FGD, so it
 * transforms the keyvalues it knows are positions or angles (`origin`, `angles`, `angle`) and
 * applies name fixup to target names, parent/filter names and output targets. Other
 * class-specific vector keyvalues are left untouched and reported once.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { children, get, parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { insertPrefab } from "./prefab.js";
import { findSolids, lineRange } from "./select.js";
import { applySplices } from "./splice.js";
import { applyPoint, compose, rotation, translation } from "./transform.js";
import { transformSolids } from "./modify.js";
import type { Mat34 } from "./transform.js";
import type { Vec3 } from "./solid.js";

export class VmfCollapseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfCollapseError";
  }
}

export interface CollapseOptions {
  /** Directory the game declares for instances (`gameinfo.txt:InstancePath`). */
  instancePath?: string | null;
  /** Maximum instance depth; a loop hits this rather than recursing forever. */
  maxDepth?: number;
}

export interface CollapseResult {
  text: string;
  collapsed: number;
  files: string[];
  warnings: string[];
}

interface CollapseState {
  collapsed: number;
  files: string[];
  warnings: string[];
  autoNames: number;
  maxDepth: number;
  instancePath: string | null;
  classnames: Set<string>;
}

type FixupStyle = "prefix" | "postfix" | "none";

const NAME_KEYS = new Set([
  "targetname",
  "target",
  "parentname",
  "filtername",
  "master",
  "damagefilter",
  "sequencetarget",
]);

const fmt = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));

function parseVec(text: string | undefined, fallback: Vec3): Vec3 {
  const values = (text ?? "").trim().split(/\s+/).map(Number);
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return fallback;
  return [values[0]!, values[1]!, values[2]!];
}

function parseStyle(raw: string | undefined): FixupStyle {
  switch ((raw ?? "0").trim()) {
    case "1":
      return "postfix";
    case "2":
      return "none";
    case "0":
    default:
      return "prefix";
  }
}

function fixupName(value: string, instanceName: string, style: FixupStyle): string {
  if (!value || value.startsWith("!") || value.startsWith("@")) return value;
  if (style === "none") return value;
  if (style === "postfix") return `${value}-${instanceName}`;
  return `${instanceName}-${value}`;
}

/** `QAngle` is (pitch, yaw, roll); the matrix order is Rz * Ry * Rx. */
function qangleMatrix(pitch: number, yaw: number, roll: number): Mat34 {
  return compose(
    rotation([0, 0, 1], yaw, [0, 0, 0]),
    compose(rotation([0, 1, 0], roll, [0, 0, 0]), rotation([1, 0, 0], pitch, [0, 0, 0])),
  );
}

function linear(matrix: Mat34): Mat34 {
  return [matrix[0]!, matrix[1]!, matrix[2]!, 0, matrix[4]!, matrix[5]!, matrix[6]!, 0, matrix[8]!, matrix[9]!, matrix[10]!, 0];
}

function matrixAngles(matrix: Mat34): Vec3 {
  const clamp = (value: number): number => Math.max(-1, Math.min(1, value));
  const pitch = (Math.asin(clamp(-matrix[8]!)) * 180) / Math.PI;
  const yaw = (Math.atan2(matrix[4]!, matrix[0]!) * 180) / Math.PI;
  const roll = (Math.atan2(matrix[9]!, matrix[10]!) * 180) / Math.PI;
  return [Number(pitch.toFixed(6)), Number(yaw.toFixed(6)), Number(roll.toFixed(6))];
}

function instanceMatrix(origin: Vec3, angles: Vec3): Mat34 {
  return compose(translation(origin), qangleMatrix(angles[0], angles[1], angles[2]));
}

function collectClassnames(roots: readonly KvBlock[], into: Set<string>): void {
  for (const root of roots) {
    if (root.name === "entity") {
      const classname = get(root, "classname");
      if (classname) into.add(classname.toLowerCase());
    }
    collectClassnames(
      root.entries.filter((entry): entry is KvBlock => entry.kind === "block"),
      into,
    );
  }
}

function resolveInstanceFile(file: string, currentPath: string, state: CollapseState): string {
  const candidates: string[] = [];
  if (isAbsolute(file)) candidates.push(file);
  else {
    candidates.push(resolve(dirname(currentPath), file));
    if (state.instancePath) candidates.push(resolve(state.instancePath, file));
  }
  for (const candidate of candidates) {
    const normal = normalize(candidate);
    if (existsSync(normal)) return normal;
  }
  throw new VmfCollapseError(
    `instance file not found: ${file} (looked in ${candidates.join(", ")})`,
  );
}

/** Applies replacement variables and removes the instance-only helper entities. */
function prepareInstanceText(
  text: string,
  instance: KvBlock,
  state: CollapseState,
): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const replacements = new Map<string, string>();
  for (const entry of instance.entries) {
    if (entry.kind !== "pair" || !/^replace\d+$/i.test(entry.key)) continue;
    const match = /^(\$\S+)\s+([\s\S]*)$/.exec(entry.value.trim());
    if (match) replacements.set(match[1]!, match[2]!);
  }

  const roots = parse(text).filter((node): node is KvBlock => node.kind === "block");
  const remove: Array<{ start: number; end: number; text: string }> = [];
  let sawProxy = false;
  let sawParams = false;
  for (const root of roots) {
    if (root.name !== "entity") continue;
    const classname = (get(root, "classname") ?? "").toLowerCase();
    if (classname === "func_instance_io_proxy") {
      sawProxy = true;
      remove.push({ ...lineRange(text, root), text: "" });
    } else if (classname === "func_instance_parms") {
      sawParams = true;
      for (const entry of root.entries) {
        if (entry.kind !== "pair" || !/^parm\d+$/i.test(entry.key)) continue;
        const parts = entry.value.trim().split(/\s+/);
        if (parts.length >= 2 && parts[0]!.startsWith("$") && !replacements.has(parts[0]!)) {
          replacements.set(parts[0]!, parts.slice(2).join(" "));
        }
      }
      remove.push({ ...lineRange(text, root), text: "" });
    }
  }
  if (sawProxy) {
    warnings.push(
      "a func_instance_io_proxy was removed; its instance inputs/outputs are not remapped",
    );
  }
  if (sawParams) void sawParams;
  let prepared = applySplices(text, remove);
  for (const [variable, value] of replacements) prepared = prepared.split(variable).join(value);
  return { text: prepared, warnings };
}

function fixupEntityText(
  text: string,
  instanceName: string,
  style: FixupStyle,
  classnames: ReadonlySet<string>,
): string {
  return text.replace(/"([^"\r\n]+)"(\s+)"([^"]*)"/g, (whole, key: string, space: string, value: string) => {
    const lower = key.toLowerCase();
    if (NAME_KEYS.has(lower)) {
      return `"${key}"${space}"${fixupName(value, instanceName, style)}"`;
    }
    if (lower.startsWith("on") && value.includes(",")) {
      const parts = value.split(",");
      const target = parts[0] ?? "";
      if (!classnames.has(target.toLowerCase())) {
        parts[0] = fixupName(target, instanceName, style);
      }
      return `"${key}"${space}"${parts.join(",")}"`;
    }
    return whole;
  });
}

function transformEntityText(text: string, matrix: Mat34, state: CollapseState): string {
  let next = text.replace(/"origin"(\s+)"([^"]*)"/i, (_whole, space: string, value: string) => {
    const point = applyPoint(matrix, parseVec(value, [0, 0, 0]));
    return `"origin"${space}"${point.map(fmt).join(" ")}"`;
  });
  const linearMatrix = linear(matrix);
  next = next.replace(/"angles"(\s+)"([^"]*)"/i, (_whole, space: string, value: string) => {
    const angles = parseVec(value, [0, 0, 0]);
    const rotated = compose(linearMatrix, qangleMatrix(angles[0], angles[1], angles[2]));
    return `"angles"${space}"${matrixAngles(rotated).map(fmt).join(" ")}"`;
  });
  next = next.replace(/"angle"(\s+)"([^"]*)"/i, (_whole, space: string, value: string) => {
    const yaw = Number(value);
    if (!Number.isFinite(yaw)) return _whole;
    const rotated = compose(linearMatrix, qangleMatrix(0, yaw, 0));
    const angles = matrixAngles(rotated);
    if (Math.abs(angles[0]) > 0.001 || Math.abs(angles[2]) > 0.001) {
      state.warnings.push(
        `entity angle ${value} became a full orientation under a pitched/rolled instance`,
      );
      return `"angles"${space}"${angles.map(fmt).join(" ")}"`;
    }
    return `"angle"${space}"${fmt(angles[1])}"`;
  });
  return next;
}

function collapseText(
  text: string,
  sourcePath: string,
  state: CollapseState,
  depth: number,
  stack: readonly string[],
): string {
  let current = text;
  let guard = 0;
  for (;;) {
    if (guard++ > 100_000) throw new VmfCollapseError("instance expansion did not converge");
    const roots = parse(current).filter((node): node is KvBlock => node.kind === "block");
    const instance = roots.find(
      (block) =>
        block.name === "entity" &&
        (get(block, "classname") ?? "").toLowerCase() === "func_instance",
    );
    if (!instance) return current;
    if (depth > state.maxDepth) {
      throw new VmfCollapseError(
        `instances nest more than ${state.maxDepth} levels; this is usually a loop`,
      );
    }
    const file = get(instance, "file");
    if (!file) throw new VmfCollapseError("a func_instance has no `file`");
    const instancePath = resolveInstanceFile(file, sourcePath, state);
    if (stack.includes(instancePath)) {
      throw new VmfCollapseError(`instance loop: ${[...stack, instancePath].join(" -> ")}`);
    }
    const rawName = get(instance, "targetname")?.trim() ?? "";
    const instanceName = rawName || `InstanceAuto${++state.autoNames}`;
    const style = parseStyle(get(instance, "fixup_style"));
    const origin = parseVec(get(instance, "origin"), [0, 0, 0]);
    const angles = parseVec(get(instance, "angles"), [0, 0, 0]);
    if ((get(instance, "propagate_fixup") ?? "0") === "1") {
      state.warnings.push(
        `instance ${instanceName}: propagate_fixup is not implemented; nested names use their own fixup`,
      );
    }
    if (instance.entries.some((entry) => entry.kind === "block" && entry.name === "connections")) {
      state.warnings.push(
        `instance ${instanceName}: its own outputs were dropped; func_instance output proxies are not reconstructed`,
      );
    }
    if (rawName) {
      const targeted = roots.some(
        (root) =>
          root.name === "entity" &&
          root.entries.some(
            (entry) =>
              entry.kind === "block" &&
              entry.name === "connections" &&
              entry.entries.some(
                (output) =>
                  output.kind === "pair" &&
                  output.key.toLowerCase().startsWith("on") &&
                  output.value.split(",")[0]?.trim() === rawName,
              ),
          ),
      );
      if (targeted) {
        state.warnings.push(
          `an output targets the instance name ${rawName}; after collapse that target no longer exists`,
        );
      }
    }

    const raw = readFileSync(instancePath, "utf8");
    const nested = collapseText(raw, instancePath, state, depth + 1, [...stack, instancePath]);
    const prepared = prepareInstanceText(nested, instance, state);
    state.warnings.push(...prepared.warnings);
    const without = applySplices(current, [{ ...lineRange(current, instance), text: "" }]);
    const preparedRoots = parse(prepared.text).filter(
      (node): node is KvBlock => node.kind === "block",
    );
    const preparedEntities = preparedRoots.filter((block) => block.name === "entity");
    const preparedSolids = findSolids(preparedRoots);
    if (prepared.text.trim() === "" || (preparedEntities.length === 0 && preparedSolids.length === 0)) {
      current = without;
      state.collapsed += 1;
      state.files.push(instancePath);
      continue;
    }

    const beforeEntities = new Set(
      parse(without)
        .filter((node): node is KvBlock => node.kind === "block" && node.name === "entity")
        .map((block) => get(block, "id"))
        .filter((id): id is string => id !== undefined),
    );
    const inserted = insertPrefab(without, prepared.text, [0, 0, 0]);
    state.warnings.push(...inserted.warnings);
    const matrix = instanceMatrix(origin, angles);
    const classnames = new Set(state.classnames);
    collectClassnames(parse(prepared.text).filter((node): node is KvBlock => node.kind === "block"), classnames);
    let next = inserted.text;
    if (inserted.newSolidIds.length > 0) {
      const moved = transformSolidsWrapper(next, inserted.newSolidIds, matrix, state);
      next = moved;
    }
    const afterRoots = parse(next).filter((node): node is KvBlock => node.kind === "block");
    const newEntities = afterRoots.filter(
      (block) =>
        block.name === "entity" &&
        (() => {
          const id = get(block, "id");
          return id !== undefined && !beforeEntities.has(id);
        })(),
    );
    const splices = newEntities.map((block) => {
      const body = next.slice(block.start, block.end);
      const transformed = transformEntityText(body, matrix, state);
      const fixed = fixupEntityText(transformed, instanceName, style, classnames);
      return { ...lineRange(next, block), text: fixed };
    });
    current = applySplices(next, splices);
    state.collapsed += 1;
    state.files.push(instancePath);
  }
}

function transformSolidsWrapper(
  text: string,
  ids: readonly number[],
  matrix: Mat34,
  state: CollapseState,
): string {
  const moved = transformSolids(text, { ids: [...ids] }, matrix, { textureLock: true });
  state.warnings.push(...moved.warnings);
  return moved.text;
}

export function collapseInstances(
  text: string,
  sourcePath: string,
  options: CollapseOptions = {},
): CollapseResult {
  const roots = parse(text).filter((node): node is KvBlock => node.kind === "block");
  const classnames = new Set<string>();
  collectClassnames(roots, classnames);
  const state: CollapseState = {
    collapsed: 0,
    files: [],
    warnings: [],
    autoNames: 0,
    maxDepth: options.maxDepth ?? 20,
    instancePath: options.instancePath ? resolve(options.instancePath) : null,
    classnames,
  };
  const output = collapseText(text, sourcePath, state, 0, []);
  return {
    text: output,
    collapsed: state.collapsed,
    files: [...new Set(state.files)],
    warnings: state.warnings,
  };
}
