/**
 * Applying a cordon the way Hammer does before it compiles.
 *
 * A cordon is a box and an on/off flag in the `.vmf`, and its whole purpose is to make a
 * test compile cheap: anything outside the box is not handed to vbsp. Hammer performs that
 * filtering while it builds the compile copy. This toolkit used to write the `cordons`
 * block and then pass the whole file to the compiler, so an active cordon changed nothing
 * and a "one-room test" compiled the city.
 *
 * The rule is deliberately the simple one Hammer uses, not a clip:
 *
 * - a brush is kept when its bounds **intersect** the box; a brush that straddles the edge
 *   is compiled whole, because clipping geometry at compile time would change the map;
 * - a point entity is kept when its origin is inside the box;
 * - a brush entity is kept when at least one of its brushes is kept;
 * - an entity with no origin and no brush cannot be placed, so it is kept and reported.
 *
 * Multiple active cordons are a union, which is how Hammer treats them.
 */
import { children, get, parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { parseVec } from "./displacement.js";
import { readOrganisation } from "./organise.js";
import { lineRange } from "./select.js";
import { checkVmfSolids } from "./solid.js";
import type { Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";

export interface CordonBox {
  mins: Vec3;
  maxs: Vec3;
}

export interface CordonFilterResult {
  text: string;
  /** Whether the map's cordon flag is on, even if nothing was excluded. */
  active: boolean;
  /** True when an active cordon with at least one box was applied. */
  applied: boolean;
  boxes: CordonBox[];
  removedSolids: number;
  removedEntities: number;
  warnings: string[];
  unchanged: boolean;
}

export interface CordonOptions {
  /** Compile the whole map even when a cordon is on. */
  ignore?: boolean;
}

const intersects = (a: { mins: Vec3; maxs: Vec3 }, b: CordonBox): boolean =>
  [0, 1, 2].every((axis) => a.mins[axis]! <= b.maxs[axis]! && a.maxs[axis]! >= b.mins[axis]!);

const contains = (point: Vec3, box: CordonBox): boolean =>
  [0, 1, 2].every((axis) => point[axis]! >= box.mins[axis]! && point[axis]! <= box.maxs[axis]!);

/** Removes every object outside an active cordon, leaving the cordon block itself. */
export function applyCordon(source: string, options: CordonOptions = {}): CordonFilterResult {
  const organisation = readOrganisation(source);
  const warnings: string[] = [];

  if (options.ignore) {
    return {
      text: source,
      active: organisation.cordonsActive,
      applied: false,
      boxes: [],
      removedSolids: 0,
      removedEntities: 0,
      warnings: organisation.cordonsActive
        ? ["the cordon is on, but ignoreCordon asked for the whole map to be compiled"]
        : [],
      unchanged: true,
    };
  }
  if (!organisation.cordonsActive) {
    return {
      text: source,
      active: organisation.cordonsActive,
      applied: false,
      boxes: [],
      removedSolids: 0,
      removedEntities: 0,
      warnings,
      unchanged: true,
    };
  }

  const boxes = organisation.cordons
    .filter((cordon) => cordon.active)
    .filter((cordon) => [0, 1, 2].every((axis) => cordon.maxs[axis]! > cordon.mins[axis]!))
    .map((cordon) => ({ mins: cordon.mins, maxs: cordon.maxs }));

  if (boxes.length === 0) {
    warnings.push(
      "the cordon is switched on but no active box has a volume, so nothing was excluded",
    );
    return {
      text: source,
      active: true,
      applied: false,
      boxes,
      removedSolids: 0,
      removedEntities: 0,
      warnings,
      unchanged: true,
    };
  }

  const report = checkVmfSolids("(memory)", source);
  const bounds = new Map<number, { mins: Vec3; maxs: Vec3 }>();
  for (const solid of report.solids) {
    if (solid.id !== null) bounds.set(solid.id, { mins: solid.mins, maxs: solid.maxs });
  }

  const roots = parse(source).filter((node): node is KvBlock => node.kind === "block");
  const splices: Array<{ start: number; end: number; text: string }> = [];
  let removedSolids = 0;
  let removedEntities = 0;

  /** Every `solid` in a block or in its `hidden` child, as the reader sees them. */
  const solidsIn = (block: KvBlock): KvBlock[] => [
    ...children(block, "solid"),
    ...children(block, "hidden").flatMap((hidden) => children(hidden, "solid")),
  ];

  const keepSolid = (block: KvBlock): boolean => {
    const raw = get(block, "id");
    const id = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
    if (id === null) {
      warnings.push("a brush has no id, so it cannot be placed against the cordon; it was kept");
      return true;
    }
    const box = bounds.get(id);
    if (!box) {
      warnings.push(`solid ${id} could not be measured; it was kept`);
      return true;
    }
    return boxes.some((cordon) => intersects(box, cordon));
  };

  for (const root of roots) {
    if (root.name === "world") {
      for (const solid of solidsIn(root)) {
        if (keepSolid(solid)) continue;
        splices.push({ ...lineRange(source, solid), text: "" });
        removedSolids += 1;
      }
      continue;
    }
    if (root.name !== "entity") continue;

    const solids = solidsIn(root);
    if (solids.length > 0) {
      const kept = solids.filter(keepSolid);
      if (kept.length === 0) {
        splices.push({ ...lineRange(source, root), text: "" });
        removedSolids += solids.length;
        removedEntities += 1;
        continue;
      }
      for (const solid of solids) {
        if (kept.includes(solid)) continue;
        splices.push({ ...lineRange(source, solid), text: "" });
        removedSolids += 1;
      }
      continue;
    }

    const origin = parseVec(get(root, "origin"));
    if (!origin) {
      warnings.push(
        `entity ${get(root, "classname") ?? "without a classname"} has no origin; it was kept`,
      );
      continue;
    }
    if (boxes.some((cordon) => contains(origin, cordon))) continue;
    splices.push({ ...lineRange(source, root), text: "" });
    removedEntities += 1;
  }

  if (splices.length === 0) {
    return {
      text: source,
      active: true,
      applied: false,
      boxes,
      removedSolids: 0,
      removedEntities: 0,
      warnings: warnings.length > 0 ? warnings : ["nothing lay outside the cordon"],
      unchanged: true,
    };
  }

  const text = applySplices(source, splices);
  return {
    text,
    active: true,
    applied: true,
    boxes,
    removedSolids,
    removedEntities,
    warnings,
    unchanged: text === source,
  };
}
