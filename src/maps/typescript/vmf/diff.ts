/**
 * A semantic diff of two `.vmf` files.
 *
 * A textual diff of a map is unreadable: ids, texture axes and key order change for reasons
 * that do not matter, and a brush that moved one unit produces a page. This compares what a
 * mapper means by "changed": a brush appeared, disappeared, moved, changed material or gained
 * a displacement; an entity appeared, disappeared or changed a keyvalue; worldspawn changed.
 *
 * Solids and entities are matched by Hammer's own `id`, which is the only identifier that
 * survives an edit that adds or removes something. A tool that regenerates ids (a clone, a
 * prefab paste) will therefore read as "all removed and all added"; that is honest, because
 * the ids really are different, and the alternative -- matching by shape -- would pair two
 * brushes a mapper considers distinct.
 */
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { readEntities } from "./edit.js";
import { checkVmfSolids } from "./solid.js";
import type { SolidCheck, Vec3 } from "./solid.js";

export interface DiffValue {
  before: string | null;
  after: string | null;
}

export interface SolidDiff {
  id: number | null;
  fields: string[];
  volumeBefore: number;
  volumeAfter: number;
}

export interface EntityDiff {
  id: number | null;
  classname: string;
  targetname: string | null;
  fields: string[];
}

export interface VmfDiff {
  solids: {
    added: Array<{ id: number | null; volume: number; mins: Vec3; maxs: Vec3 }>;
    removed: Array<{ id: number | null; volume: number; mins: Vec3; maxs: Vec3 }>;
    changed: SolidDiff[];
  };
  entities: {
    added: Array<{ id: number | null; classname: string; targetname: string | null }>;
    removed: Array<{ id: number | null; classname: string; targetname: string | null }>;
    changed: EntityDiff[];
  };
  worldspawn: Array<{ key: string; before: string | null; after: string | null }>;
  counts: {
    solidsBefore: number;
    solidsAfter: number;
    entitiesBefore: number;
    entitiesAfter: number;
  };
  unchanged: boolean;
  warnings: string[];
}

const sameNumber = (a: number, b: number, tolerance = 1e-3): boolean =>
  Math.abs(a - b) <= tolerance;

const sameVec = (a: Vec3, b: Vec3, tolerance = 0.01): boolean =>
  a.every((value, axis) => sameNumber(value, b[axis]!, tolerance));

const keyOf = (id: number | null, index: number): string =>
  id !== null ? `id:${id}` : `index:${index}`;

function materialsOf(solid: SolidCheck): string {
  return solid.sides
    .map((side) => side.material.toLowerCase())
    .sort()
    .join("\u0000");
}

function displacementsOf(solid: SolidCheck): number {
  return solid.sides.filter((side) => side.hasDisplacement).length;
}

/** The keyvalues of an entity, excluding `id`, plus its flattened outputs. */
function entityFields(block: KvBlock): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of block.entries) {
    if (entry.kind === "pair") {
      if (entry.key.toLowerCase() !== "id") out.set(`"${entry.key.toLowerCase()}"`, entry.value);
      continue;
    }
    if (entry.name !== "connections") continue;
    for (const connection of entry.entries) {
      if (connection.kind === "pair") {
        out.set(`output:${connection.key.toLowerCase()}`, connection.value);
      }
    }
  }
  return out;
}

function worldOf(text: string): Map<string, string> {
  const { nodes } = readEntities(text);
  const world = nodes.find((node): node is KvBlock => node.kind === "block" && node.name === "world");
  const out = new Map<string, string>();
  if (!world) return out;
  for (const entry of world.entries) {
    if (entry.kind === "pair" && entry.key.toLowerCase() !== "id" && entry.key.toLowerCase() !== "classname") {
      out.set(entry.key.toLowerCase(), entry.value);
    }
  }
  return out;
}

export function diffVmf(beforeText: string, afterText: string): VmfDiff {
  const before = checkVmfSolids("(before)", beforeText);
  const after = checkVmfSolids("(after)", afterText);
  const warnings: string[] = [];

  const beforeSolids = new Map<string, SolidCheck>();
  before.solids.forEach((solid, index) => beforeSolids.set(keyOf(solid.id, index), solid));
  const afterSolids = new Map<string, SolidCheck>();
  after.solids.forEach((solid, index) => afterSolids.set(keyOf(solid.id, index), solid));

  const solids: VmfDiff["solids"] = { added: [], removed: [], changed: [] };
  for (const [key, solid] of afterSolids) {
    const old = beforeSolids.get(key);
    if (!old) {
      solids.added.push({ id: solid.id, volume: solid.volume, mins: solid.mins, maxs: solid.maxs });
      continue;
    }
    const fields: string[] = [];
    if (!sameNumber(old.volume, solid.volume)) fields.push("volume");
    if (!sameVec(old.mins, solid.mins)) fields.push("bounds");
    if (!sameVec(old.maxs, solid.maxs)) fields.push("bounds");
    if (materialsOf(old) !== materialsOf(solid)) fields.push("materials");
    if (displacementsOf(old) !== displacementsOf(solid)) fields.push("displacements");
    if (fields.length > 0) {
      solids.changed.push({
        id: solid.id,
        fields: [...new Set(fields)],
        volumeBefore: old.volume,
        volumeAfter: solid.volume,
      });
    }
  }
  for (const [key, solid] of beforeSolids) {
    if (afterSolids.has(key)) continue;
    solids.removed.push({ id: solid.id, volume: solid.volume, mins: solid.mins, maxs: solid.maxs });
  }

  const beforeEntities = readEntities(beforeText).entities;
  const afterEntities = readEntities(afterText).entities;
  const beforeByKey = new Map<string, (typeof beforeEntities)[number]>();
  beforeEntities.forEach((entity, index) => beforeByKey.set(keyOf(entity.id, index), entity));
  const afterByKey = new Map<string, (typeof afterEntities)[number]>();
  afterEntities.forEach((entity, index) => afterByKey.set(keyOf(entity.id, index), entity));

  const entities: VmfDiff["entities"] = { added: [], removed: [], changed: [] };
  for (const [key, entity] of afterByKey) {
    const old = beforeByKey.get(key);
    if (!old) {
      entities.added.push({ id: entity.id, classname: entity.classname, targetname: entity.targetname });
      continue;
    }
    const oldFields = entityFields(old.block);
    const newFields = entityFields(entity.block);
    const fields: string[] = [];
    for (const [field, value] of newFields) {
      if (oldFields.get(field) !== value) fields.push(field);
    }
    for (const field of oldFields.keys()) {
      if (!newFields.has(field)) fields.push(field);
    }
    if (fields.length > 0) {
      entities.changed.push({
        id: entity.id,
        classname: entity.classname,
        targetname: entity.targetname,
        fields,
      });
    }
  }
  for (const [key, entity] of beforeByKey) {
    if (afterByKey.has(key)) continue;
    entities.removed.push({ id: entity.id, classname: entity.classname, targetname: entity.targetname });
  }

  const beforeWorld = worldOf(beforeText);
  const afterWorld = worldOf(afterText);
  const worldspawn: VmfDiff["worldspawn"] = [];
  for (const key of new Set([...beforeWorld.keys(), ...afterWorld.keys()])) {
    const beforeValue = beforeWorld.get(key) ?? null;
    const afterValue = afterWorld.get(key) ?? null;
    if (beforeValue !== afterValue) worldspawn.push({ key, before: beforeValue, after: afterValue });
  }

  for (const solid of [...solids.added, ...solids.removed]) {
    if (solid.id === null) {
      warnings.push("a brush has no id, so it was matched by position in the file");
    }
  }
  for (const entity of [...entities.added, ...entities.removed]) {
    if (entity.id === null) {
      warnings.push("an entity has no id, so it was matched by position in the file");
    }
  }

  const unchanged =
    solids.added.length === 0 &&
    solids.removed.length === 0 &&
    solids.changed.length === 0 &&
    entities.added.length === 0 &&
    entities.removed.length === 0 &&
    entities.changed.length === 0 &&
    worldspawn.length === 0;

  return {
    solids,
    entities,
    worldspawn,
    counts: {
      solidsBefore: before.solidCount,
      solidsAfter: after.solidCount,
      entitiesBefore: beforeEntities.length,
      entitiesAfter: afterEntities.length,
    },
    unchanged,
    warnings,
  };
}
