/**
 * Sealing the brushes a displacement opened.
 *
 * A displacement does not seal, and the reason is stronger than the usual warning says: a
 * brush that carries one contributes **no volume at all** to the BSP hull. vbsp emits the
 * displaced surface separately and drops the brush from the solid set, so the inside of a
 * displaced floor is void -- which is why a leak trace runs *through* a brush that looks
 * solid in Hammer. A displacement is a surface, and a surface is not a wall.
 *
 * This was measured, not recalled. A sealed room compiles clean; the same room with
 * `write_displacement` on the floor leaks, and the leak point sits inside the floor brush.
 * Replacing the generated `dispinfo` with a block lifted verbatim out of a Hammer-written
 * fixture leaks the same way, so the grid, its winding, `startposition` and
 * `triangle_tags` are all exonerated. Adding a plain brush over the same volume seals it.
 *
 * So the repair is the one a mapper performs by hand and Hammer++ calls a sealing brush:
 * duplicate the brush, drop the `dispinfo`, and paint it with a tool material. The copy is
 * an ordinary solid, so the hull is closed again and the terrain is drawn over it.
 *
 * Two consequences are stated here rather than discovered later:
 *
 * - The duplicate's faces are coplanar with the original's. It is textured `TOOLS/TOOLSNODRAW`
 *   so it is not drawn; the original keeps its visible materials.
 * - The seal's flat face sits on the original plane. Terrain sculpted *below* that plane
 *   will meet the seal before it meets the visual surface, so the edge of a terrain must
 *   stay on the plane -- which is how terrain joins a wall or a floor in every Source map.
 */
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { maxId } from "./edit.js";
import { findSolids } from "./select.js";
import { checkVmfSolids } from "./solid.js";
import type { SolidCheck, SolidSide, Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";

export class VmfSealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfSealError";
  }
}

/** Tool texture a seal carries by default: never drawn, always solid. */
export const SEAL_MATERIAL = "TOOLS/TOOLSNODRAW";

export interface SealOptions {
  /** Only seal the solids carrying a displacement on these Hammer ids. */
  solidIds?: number[];
  /** Material for the duplicate. Defaults to `TOOLS/TOOLSNODRAW`. */
  material?: string;
}

export interface SealResult {
  text: string;
  sealed: Array<{
    /** Hammer id of the brush that carries the displacement. */
    solidId: number;
    /** Hammer id of the duplicate that seals it. */
    sealId: number;
    faces: number;
  }>;
  skipped: Array<{ solidId: number; reason: string }>;
  warnings: string[];
  unchanged: boolean;
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));
const vec = (v: Vec3): string => `${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`;
const n3 = (n: number): number => Math.round(n * 100) / 100;

/**
 * A solid's identity by shape: every side's plane, sorted.
 *
 * Two brushes are the same volume exactly when their plane sets are. Ids, materials and
 * texture axes are excluded on purpose: a seal is the same shape with a different skin,
 * and that is what makes a second run recognisable as already done.
 */
function shapeKey(solid: SolidCheck): string | null {
  const parts: string[] = [];
  for (const side of solid.sides) {
    if (!side.plane) return null;
    parts.push(
      `${n3(side.plane.normal[0])},${n3(side.plane.normal[1])},${n3(side.plane.normal[2])}|${n3(side.plane.dist)}`,
    );
  }
  return parts.sort().join(";");
}

/** The text of one `solid` that duplicates `check` with a tool material and no dispinfo. */
function sealText(
  check: SolidCheck,
  nextId: number,
  material: string,
): { text: string; solidId: number; nextId: number; faces: number } {
  let id = nextId;
  const solidId = id++;
  const sides: string[] = [];

  for (const side of check.sides) {
    if (!side.points) {
      throw new VmfSealError(
        `solid ${check.id} has a side that states no plane, so a duplicate of it would not ` +
          `be the same volume`,
      );
    }
    const axes = (axis: SolidSide["uaxis"]): string =>
      axis ? `[${vec(axis.axis)} ${fmt(axis.offset)}] ${fmt(axis.scale)}` : "[1 0 0 0] 0.25";

    sides.push(
      `\t\tside\n\t\t{\n` +
        `\t\t\t"id" "${id++}"\n` +
        `\t\t\t"plane" "(${vec(side.points[0])}) (${vec(side.points[1])}) (${vec(side.points[2])})"\n` +
        `\t\t\t"material" "${material}"\n` +
        `\t\t\t"uaxis" "${axes(side.uaxis)}"\n` +
        `\t\t\t"vaxis" "${axes(side.vaxis)}"\n` +
        `\t\t\t"rotation" "0"\n` +
        `\t\t\t"lightmapscale" "${side.lightmapScale ?? 16}"\n` +
        `\t\t\t"smoothing_groups" "0"\n` +
        `\t\t}\n`,
    );
  }

  return {
    text:
      `\tsolid\n\t{\n\t\t"id" "${solidId}"\n` +
      sides.join("") +
      `\t\teditor\n\t\t{\n` +
      `\t\t\t"color" "0 255 0"\n` +
      `\t\t\t"visgroupshown" "1"\n` +
      `\t\t\t"visgroupautoshown" "1"\n` +
      `\t\t}\n\t}\n`,
    solidId,
    nextId: id,
    faces: sides.length,
  };
}

/**
 * Adds a solid duplicate of every brush that carries a displacement.
 *
 * Only brushes owned by `world` are sealed. A displacement inside `func_detail` or any
 * other brush entity never contributed to the hull in the first place -- that is what a
 * detail brush is -- so a world copy of it would be new, coincident geometry rather than a
 * repair.
 */
export function sealDisplacements(source: string, options: SealOptions = {}): SealResult {
  const material = options.material?.trim() || SEAL_MATERIAL;
  const report = checkVmfSolids("(memory)", source);
  const wanted = new Set(options.solidIds);
  const warnings: string[] = [];
  const skipped: SealResult["skipped"] = [];

  const displaced = report.solids.filter((solid) =>
    solid.sides.some((side) => side.hasDisplacement),
  );

  if (options.solidIds && options.solidIds.length === 0) {
    throw new VmfSealError("solidIds is empty, which names no brush");
  }

  // Every shape already present without a displacement. A second run finds its own work
  // here, and a brush a mapper sealed by hand is respected rather than duplicated.
  const plainShapes = new Set<string>();
  for (const solid of report.solids) {
    if (solid.sides.some((side) => side.hasDisplacement)) continue;
    const key = shapeKey(solid);
    if (key) plainShapes.add(`${solid.owner}\u0000${key}`);
  }

  const nodes = parse(source);
  const roots = nodes.filter((n): n is KvBlock => n.kind === "block");
  const world = roots.find((b) => b.name === "world");
  if (!world) throw new VmfSealError("this file has no `world` block to add a seal to");
  const hidden = new Set(findSolids(roots).filter((solid) => solid.hidden).map((solid) => solid.id));

  let nextId = maxId(nodes) + 1;
  const body: string[] = [];
  const sealed: SealResult["sealed"] = [];

  for (const solid of displaced) {
    if (solid.id === null) {
      warnings.push("a displaced brush has no id, so it cannot be named or sealed");
      continue;
    }
    if (wanted.size > 0 && !wanted.has(solid.id)) continue;
    if (solid.owner !== "world") {
      skipped.push({
        solidId: solid.id,
        reason: `it belongs to ${solid.owner}; a detail brush never sealed the hull`,
      });
      continue;
    }
    if (hidden.has(solid.id)) {
      skipped.push({
        solidId: solid.id,
        reason: "it sits inside a hidden block; unhide it so the seal can land beside it",
      });
      continue;
    }
    const key = shapeKey(solid);
    if (key && plainShapes.has(`world\u0000${key}`)) {
      skipped.push({ solidId: solid.id, reason: "a brush of the same shape already seals it" });
      continue;
    }

    const built = sealText(solid, nextId, material);
    body.push(built.text);
    nextId = built.nextId;
    sealed.push({ solidId: solid.id, sealId: built.solidId, faces: built.faces });
  }

  if (options.solidIds) {
    const known = new Set(displaced.map((solid) => solid.id));
    for (const id of options.solidIds) {
      if (!known.has(id)) {
        warnings.push(`solid ${id} carries no displacement, so there is nothing to seal`);
      }
    }
  }

  if (sealed.length === 0) {
    return {
      text: source,
      sealed: [],
      skipped,
      warnings:
        warnings.length > 0
          ? warnings
          : ["no displaced world brush needed sealing"],
      unchanged: true,
    };
  }

  const text =
    source.slice(0, world.bodyEnd) + body.join("") + source.slice(world.bodyEnd);
  return { text, sealed, skipped, warnings, unchanged: text === source };
}

/** What the seal has to satisfy, checked by reading the result back. */
export function checkSeal(original: string, sealedText: string): string[] {
  const problems: string[] = [];
  const before = checkVmfSolids("(memory)", original);
  const after = checkVmfSolids("(memory)", sealedText);

  const byId = new Map(after.solids.filter((s) => s.id !== null).map((s) => [s.id!, s]));
  for (const old of before.solids) {
    if (old.id === null) continue;
    const now = byId.get(old.id);
    if (!now || Math.abs(now.volume - old.volume) > 1e-3) {
      problems.push(`solid ${old.id} changed shape while a displacement was being sealed`);
    }
  }
  return problems;
}
