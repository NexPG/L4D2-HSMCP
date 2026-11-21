/**
 * Hammer++'s "Create Instance from Selection": turn selected brushes into a standing
 * instance file and leave a `func_instance` where they were.
 *
 * The new file is an ordinary VMF, not a fragment. The selection is shifted so the chosen
 * origin becomes 0,0,0; the target keeps a `func_instance` at that origin. A brush entity
 * is taken whole -- selecting one of its brushes selects the entity -- because a partial
 * entity in the instance would leave the rest of it behind with outputs pointing at nothing.
 */
import { dirname, relative } from "node:path";
import { applyVmfOps } from "./edit.js";
import { insertPrefab } from "./prefab.js";
import { findSolids, lineRange } from "./select.js";
import { emptyVmf } from "./skeleton.js";
import { checkVmfSolids } from "./solid.js";
import type { Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";
import { get, parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";

export class VmfInstanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfInstanceError";
  }
}

export interface ExtractInstanceOptions {
  /** `func_instance` `file` value, relative to the target map. */
  file: string;
  /** Where the instance origin lands. Default: centre of the selection. */
  origin?: Vec3;
  angles?: string;
  fixupStyle?: "none" | "prefix" | "postfix";
}

export interface ExtractInstanceResult {
  targetText: string;
  instanceText: string;
  origin: Vec3;
  file: string;
  removedSolids: number;
  removedEntities: number;
  instanceSolids: number;
  instanceEntities: number;
  warnings: string[];
}

// `func_instance.fixup_style` is 0 = prefix, 1 = postfix, 2 = none (base.fgd).
const FIXUP = { prefix: "0", postfix: "1", none: "2" } as const;

export function extractInstance(
  target: string,
  solidIds: readonly number[],
  options: ExtractInstanceOptions,
): ExtractInstanceResult {
  const ids = [...new Set(solidIds)];
  if (ids.length === 0) throw new VmfInstanceError("no brush ids were given");
  const roots = parse(target).filter((n): n is KvBlock => n.kind === "block");
  const found = findSolids(roots).filter((f) => ids.includes(f.id));
  if (found.length !== ids.length) {
    const missing = ids.filter((id) => !found.some((f) => f.id === id));
    throw new VmfInstanceError(`no solid with id ${missing.join(", ")} in this map`);
  }
  if (found.some((f) => f.hidden)) {
    throw new VmfInstanceError("a hidden brush cannot become an instance; unhide it first");
  }

  const check = checkVmfSolids("(memory)", target);
  const byId = new Map(check.solids.filter((s) => s.id !== null).map((s) => [s.id!, s]));
  const selected = found.map((f) => byId.get(f.id)!);

  const owners = new Map<KvBlock, number[]>();
  for (const f of found) {
    const list = owners.get(f.ownerBlock) ?? [];
    list.push(f.id);
    owners.set(f.ownerBlock, list);
  }
  const warnings: string[] = [];
  const entityOwners: KvBlock[] = [];
  const worldIds: number[] = [];
  for (const [block, memberIds] of owners) {
    if (block.name === "world") {
      worldIds.push(...memberIds);
      continue;
    }
    const every = findSolids([block]).map((f) => f.id);
    if (memberIds.length !== every.length) {
      throw new VmfInstanceError(
        `the selection includes ${memberIds.length} of ${every.length} brushes in ` +
          `${get(block, "classname") ?? "a brush entity"}; select the whole entity or none of it`,
      );
    }
    entityOwners.push(block);
    warnings.push(
      `the whole ${get(block, "classname") ?? "brush entity"} was taken into the instance`,
    );
  }

  const mins: Vec3 = [
    Math.min(...selected.map((s) => s.mins[0])),
    Math.min(...selected.map((s) => s.mins[1])),
    Math.min(...selected.map((s) => s.mins[2])),
  ];
  const maxs: Vec3 = [
    Math.max(...selected.map((s) => s.maxs[0])),
    Math.max(...selected.map((s) => s.maxs[1])),
    Math.max(...selected.map((s) => s.maxs[2])),
  ];
  const origin: Vec3 = options.origin ?? [
    (mins[0] + maxs[0]) / 2,
    (mins[1] + maxs[1]) / 2,
    (mins[2] + maxs[2]) / 2,
  ];

  const solidText = found
    .filter((f) => worldIds.includes(f.id))
    .map((f) => {
      const { start, end } = lineRange(target, f.block);
      return target.slice(start, end);
    })
    .join("");
  const entityText = entityOwners
    .map((block) => {
      const { start, end } = lineRange(target, block);
      return target.slice(start, end);
    })
    .join("");
  const fragment =
    `versioninfo\n{\n\t"editorversion" "400"\n}\n` +
    `world\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n${solidText}}\n${entityText}`;

  const instanceBase = emptyVmf();
  const inserted = insertPrefab(instanceBase, fragment, [
    -origin[0],
    -origin[1],
    -origin[2],
  ]);
  warnings.push(...inserted.warnings);
  const instanceText = inserted.text;
  const instanceCheck = checkVmfSolids("(memory)", instanceText);
  if (instanceCheck.solidCount !== found.length) {
    throw new VmfInstanceError(
      `refusing to write: the instance has ${instanceCheck.solidCount} solids for ` +
        `${found.length} selected`,
    );
  }
  if (instanceCheck.solids.some((s) => !s.valid)) {
    throw new VmfInstanceError("refusing to write: the instance contains an invalid brush");
  }

  const splices: Splice[] = [];
  for (const f of found.filter((x) => worldIds.includes(x.id))) {
    splices.push({ ...lineRange(target, f.block), text: "" });
  }
  for (const block of entityOwners) {
    splices.push({ ...lineRange(target, block), text: "" });
  }
  const removed = applySplices(target, splices);
  const keyvalues: Record<string, string> = {
    classname: "func_instance",
    file: options.file.replace(/\\/g, "/"),
    origin: origin.map((v) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6))))).join(" "),
    angles: options.angles ?? "0 0 0",
    fixup_style: FIXUP[options.fixupStyle ?? "prefix"],
  };
  const added = applyVmfOps(removed, [{ op: "add", keyvalues }]);

  const beforeEntities = roots.filter((b) => b.name === "entity").length;
  const afterRoots = parse(added.text).filter((n): n is KvBlock => n.kind === "block");
  const afterEntities = afterRoots.filter((b) => b.name === "entity").length;
  if (afterEntities !== beforeEntities - entityOwners.length + 1) {
    throw new VmfInstanceError(
      `refusing to write: entity count went from ${beforeEntities} to ${afterEntities}`,
    );
  }
  const after = checkVmfSolids("(memory)", added.text);
  if (after.solidCount !== check.solidCount - found.length) {
    throw new VmfInstanceError(
      `refusing to write: solid count went from ${check.solidCount} to ${after.solidCount}, ` +
        `and ${found.length} were moved into the instance`,
    );
  }

  return {
    targetText: added.text,
    instanceText,
    origin,
    file: keyvalues["file"]!,
    removedSolids: found.length,
    removedEntities: entityOwners.length,
    instanceSolids: inserted.solids,
    instanceEntities: inserted.entities,
    warnings,
  };
}

/** The `file` value a target can use for an instance written at `out`. */
export function instanceFileKey(target: string, out: string): string {
  return relative(dirname(target), out).replace(/\\/g, "/");
}
