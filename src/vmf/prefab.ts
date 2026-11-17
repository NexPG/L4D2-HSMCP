/**
 * Inserting a Hammer prefab: a saved `.vmf` fragment pasted into a map.
 *
 * A prefab is not an instance. `func_instance` keeps a live link to another file; a prefab
 * is a one-time paste. The fragment is a `.vmf`, so it can carry world brushes, point
 * entities and brush entities. This inserts the world solids and root entities, remaps
 * every id, and moves the whole fragment by an offset. The move is a translation only;
 * brush-entity geometry and any rotation are not applied, and the result says so.
 */
import { parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { maxId } from "./edit.js";
import { transformSolids } from "./modify.js";
import { findSolids, lineRange } from "./select.js";
import { checkVmfSolids } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";
import { translation } from "./transform.js";
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

function moveOrigin(body: string, move: Vec3): string {
  return body.replace(/"origin"(\s+)"([^"]+)"/i, (_m, space: string, value: string) => {
    const n = value.trim().split(/\s+/).map(Number);
    if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) return _m;
    return `"origin"${space}"${n.map((v, i) => v + move[i]!).join(" ")}"`;
  });
}

export function insertPrefab(
  target: string,
  prefab: string,
  move: Vec3 = [0, 0, 0],
): PrefabResult {
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
  if (move.some((v) => v !== 0) && allSolids.length > worldSolids.length) {
    warnings.push(
      "the prefab contains brush-entity solids; the move is applied to world solids and " +
        "entity origins, not to geometry inside a brush entity",
    );
  }

  let nextId = maxId(targetNodes) + 1;
  const solidSplices: Splice[] = [];
  const newSolidIds: number[] = [];
  for (const solid of worldSolids) {
    if (solid.hidden) {
      warnings.push(`hidden prefab solid ${solid.id} was inserted visibly`);
    }
    const { start, end } = lineRange(prefab, solid.block);
    const remapped = remap(prefab.slice(start, end), nextId);
    nextId += remapped.count;
    if (remapped.firstId !== null) newSolidIds.push(remapped.firstId);
    solidSplices.push({ start: targetWorld.bodyEnd, end: targetWorld.bodyEnd, text: remapped.text });
  }

  const entitySplices: Splice[] = [];
  for (const [index, entity] of entities.entries()) {
    const { start, end } = lineRange(prefab, entity);
    const remapped = remap(moveOrigin(prefab.slice(start, end), move), nextId);
    nextId += remapped.count;
    const separator = index === 0 && target.length > 0 && !target.endsWith("\n") ? "\n" : "";
    entitySplices.push({
      start: target.length,
      end: target.length,
      text: separator + remapped.text,
    });
  }

  let text = applySplices(target, [...solidSplices, ...entitySplices]);
  if (move.some((v) => v !== 0) && newSolidIds.length > 0) {
    const moved = transformSolids(text, { ids: newSolidIds }, translation(move), {
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
  const newIds = new Set(newSolidIds);
  const broken = after.solids.filter((s) => s.id !== null && newIds.has(s.id) && !s.valid);
  if (broken.length > 0) {
    throw new VmfPrefabError(
      `refusing to write: ${broken.length} prefab brush(es) are not valid solids`,
    );
  }
  if (entities.some((e) => /"classname"\s+"func_instance"/i.test(prefab))) {
    warnings.push("the prefab contains a func_instance; its nested geometry is not expanded here");
  }

  return {
    text,
    solids: allSolids.length,
    entities: entities.length,
    newSolidIds,
    warnings,
    unchanged: text === target,
  };
}
