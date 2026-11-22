/**
 * Inserting a Hammer prefab: a saved `.vmf` fragment pasted into a map.
 *
 * A prefab is not an instance. `func_instance` keeps a live link to another file; a prefab
 * is a one-time paste. The fragment is a `.vmf`, so it can carry world brushes, point
 * entities and brush entities. This inserts every solid and root entity, remaps every id,
 * and transforms the whole fragment: move, and a yaw rotation about a pivot. Brush-entity
 * geometry is transformed with the world, and point entities have their origin and yaw
 * turned with it. Nested `func_instance` geometry is still not expanded; the result says
 * so.
 */
import { get, parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { maxId } from "./edit.js";
import { transformSolids } from "./modify.js";
import { findSolids, lineRange } from "./select.js";
import { checkVmfSolids } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";
import { applyPoint, compose, rotation as rotationMatrix, translation } from "./transform.js";
import type { Mat34 } from "./transform.js";
import type { Vec3 } from "./solid.js";

export class VmfPrefabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfPrefabError";
  }
}

export interface PrefabResult {
  text: string;
  solids: number;
  entities: number;
  newSolidIds: number[];
  warnings: string[];
  unchanged: boolean;
}

function remap(body: string, start: number): { text: string; firstId: number | null; count: number } {
  let next = start;
  let first: number | null = null;
  let count = 0;
  const text = body.replace(/"id"(\s+)"\d+"/g, (_m, space: string) => {
    const id = next;
    next += 1;
    count += 1;
    if (first === null) first = id;
    return `"id"${space}"${id}"`;
  });
  return { text, firstId: first, count };
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : Number(n.toFixed(6)).toString();
}

const normaliseAngle = (degrees: number): number => ((degrees % 360) + 360) % 360;

/** Moves/turns an entity's origin and yaw. Geometry is handled by transformSolids. */
function transformEntity(body: string, matrix: Mat34, yaw: number): string {
  let text = body.replace(/"origin"(\s+)"([^"]+)"/i, (_m, space: string, value: string) => {
    const n = value.trim().split(/\s+/).map(Number);
    if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) return _m;
    const p = applyPoint(matrix, [n[0]!, n[1]!, n[2]!]);
    return `"origin"${space}"${p.map(fmtNum).join(" ")}"`;
  });
  if (yaw !== 0) {
    text = text.replace(/"angles"(\s+)"([^"]+)"/i, (_m, space: string, value: string) => {
      const n = value.trim().split(/\s+/).map(Number);
      if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) return _m;
      return `"angles"${space}"${fmtNum(n[0]!)} ${fmtNum(normaliseAngle(n[1]! + yaw))} ${fmtNum(n[2]!)}"`;
    });
    text = text.replace(/"angle"(\s+)"(-?\d+(?:\.\d+)?)"/i, (_m, space: string, value: string) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return _m;
      return `"angle"${space}"${fmtNum(normaliseAngle(n + yaw))}"`;
    });
  }
  return text;
}

export interface PrefabOptions {
  /** Yaw rotation in degrees, about Z through `pivot`. */
  rotate?: number;
  pivot?: Vec3;
}

export function insertPrefab(
  target: string,
  prefab: string,
  move: Vec3 = [0, 0, 0],
  options: PrefabOptions = {},
): PrefabResult {
  const rotate = options.rotate ?? 0;
  if (!Number.isFinite(rotate)) throw new VmfPrefabError("rotate must be a finite number of degrees");
  const pivot = options.pivot ?? [0, 0, 0];
  if (pivot.length !== 3 || pivot.some((v) => !Number.isFinite(v))) {
    throw new VmfPrefabError("pivot must be three finite numbers");
  }
  if (move.some((v) => !Number.isFinite(v))) {
    throw new VmfPrefabError("move must be three finite numbers");
  }
  const matrix = compose(translation(move), rotationMatrix([0, 0, 1], rotate, pivot));
  const moving = rotate !== 0 || move.some((v) => v !== 0);
  const targetNodes = parse(target);
  const targetRoots = targetNodes.filter((n): n is KvBlock => n.kind === "block");
  const targetWorld = targetRoots.find((b) => b.name === "world");
  if (!targetWorld) throw new VmfPrefabError("the target .vmf has no `world` block");

  const prefabNodes = parse(prefab);
  const prefabRoots = prefabNodes.filter((n): n is KvBlock => n.kind === "block");
  const prefabWorld = prefabRoots.find((b) => b.name === "world");
  if (!prefabWorld) throw new VmfPrefabError("the prefab has no `world` block");

  const warnings: string[] = [];
  const worldSolids = findSolids([prefabWorld]);
  const allSolids = findSolids(prefabRoots);
  const entities = prefabRoots.filter((b) => b.name === "entity");
  if (worldSolids.length === 0 && entities.length === 0) {
    throw new VmfPrefabError("the prefab has no world solids and no entities");
  }

  const firstNewId = maxId(targetNodes) + 1;
  let nextId = firstNewId;
  const solidSplices: Splice[] = [];
  for (const solid of worldSolids) {
    if (solid.hidden) {
      warnings.push(`hidden prefab solid ${solid.id} was inserted visibly`);
    }
    const { start, end } = lineRange(prefab, solid.block);
    const remapped = remap(prefab.slice(start, end), nextId);
    nextId += remapped.count;
    solidSplices.push({ start: targetWorld.bodyEnd, end: targetWorld.bodyEnd, text: remapped.text });
  }

  const entitySplices: Splice[] = [];
  for (const [index, entity] of entities.entries()) {
    const { start, end } = lineRange(prefab, entity);
    if (moving && get(entity, "origin") === undefined && findSolids([entity]).length === 0) {
      warnings.push(
        `prefab entity ${get(entity, "classname") ?? "?"} has no origin and no brushes; ` +
          `there is nothing to move or turn`,
      );
    }
    const remapped = remap(transformEntity(prefab.slice(start, end), matrix, rotate), nextId);
    nextId += remapped.count;
    const separator = index === 0 && target.length > 0 && !target.endsWith("\n") ? "\n" : "";
    entitySplices.push({
      start: target.length,
      end: target.length,
      text: separator + remapped.text,
    });
  }

  let text = applySplices(target, [...solidSplices, ...entitySplices]);
  const insertedSolidIds = findSolids(
    parse(text).filter((n): n is KvBlock => n.kind === "block"),
  )
    .filter((s) => s.id !== null && s.id >= firstNewId)
    .map((s) => s.id!);
  if (moving && insertedSolidIds.length > 0) {
    const moved = transformSolids(text, { ids: insertedSolidIds }, matrix, {
      textureLock: true,
    });
    text = moved.text;
    warnings.push(...moved.warnings);
  }

  const before = checkVmfSolids("(memory)", target);
  const after = checkVmfSolids("(memory)", text);
  const targetEntities = targetRoots.filter((b) => b.name === "entity").length;
  const afterRoots = parse(text).filter((n): n is KvBlock => n.kind === "block");
  const afterEntities = afterRoots.filter((b) => b.name === "entity").length;
  if (afterEntities !== targetEntities + entities.length) {
    throw new VmfPrefabError(
      `refusing to write: ${targetEntities} entities in, ${entities.length} prefab entities, ` +
        `${afterEntities} out`,
    );
  }
  if (after.solidCount !== before.solidCount + allSolids.length) {
    throw new VmfPrefabError(
      `refusing to write: ${before.solidCount} solids in, ${allSolids.length} prefab solids, ` +
        `${after.solidCount} out`,
    );
  }
  const newIds = new Set(insertedSolidIds);
  const broken = after.solids.filter((s) => s.id !== null && newIds.has(s.id) && !s.valid);
  if (broken.length > 0) {
    throw new VmfPrefabError(
      `refusing to write: ${broken.length} prefab brush(es) are not valid solids`,
    );
  }
  if (entities.some(() => /"classname"\s+"func_instance"/i.test(prefab))) {
    warnings.push("the prefab contains a func_instance; its nested geometry is not expanded here");
  }

  return {
    text,
    solids: allSolids.length,
    entities: entities.length,
    newSolidIds: insertedSolidIds,
    warnings,
    unchanged: text === target,
  };
}
