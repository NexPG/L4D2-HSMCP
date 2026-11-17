/**
 * Hammer's merge tool: several convex brushes become the one convex brush around them.
 *
 * It is only correct when the union is already convex. That is checked by volume rather
 * than assumed: the hull must have the same volume as the selected brushes together, or
 * the operation would either cut away overlap or fill a hollow. Once that holds, the hull
 * faces are matched back to the original sides by plane so material, texture axes,
 * lightmap scale and smoothing groups survive.
 */
import { children, get, parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { insertSolids } from "./build.js";
import { setSidePair } from "./face.js";
import { convexHull } from "./hull.js";
import { deleteSolids } from "./modify.js";
import { findSolids } from "./select.js";
import { checkVmfSolids, parsePlanePoints, planeFromPoints } from "./solid.js";
import type { Plane, Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";

export class VmfMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfMergeError";
  }
}

export interface MergeResult {
  text: string;
  mergedId: number;
  sourceIds: number[];
  volume: number;
  facesCopied: number;
  warnings: string[];
  unchanged: boolean;
}

const normalKey = (v: Vec3): string => {
  const n: [number, number, number] = [v[0], v[1], v[2]];
  const first = n.find((x) => Math.abs(x) > 1e-9) ?? 0;
  if (first < 0) {
    n[0] = -n[0];
    n[1] = -n[1];
    n[2] = -n[2];
  }
  return n.map((x) => Math.round(x / 0.001)).join(",");
};
const planeKey = (p: Plane): string => {
  const first = p.normal.find((x) => Math.abs(x) > 1e-9) ?? 0;
  const sign = first < 0 ? -1 : 1;
  return `${normalKey(p.normal)}|${Math.round((p.dist * sign) / 0.001)}`;
};

interface RawFace {
  material: string | null;
  uaxis: string | null;
  vaxis: string | null;
  rotation: string | null;
  lightmapscale: string | null;
  smoothing_groups: string | null;
}

function rawFaces(solid: KvBlock): Map<string, RawFace> {
  const out = new Map<string, RawFace>();
  for (const side of children(solid, "side")) {
    const text = get(side, "plane");
    if (!text) continue;
    const points = parsePlanePoints(text);
    if (!points) continue;
    const plane = planeFromPoints(...points);
    if (!plane) continue;
    out.set(planeKey(plane), {
      material: get(side, "material") ?? null,
      uaxis: get(side, "uaxis") ?? null,
      vaxis: get(side, "vaxis") ?? null,
      rotation: get(side, "rotation") ?? null,
      lightmapscale: get(side, "lightmapscale") ?? null,
      smoothing_groups: get(side, "smoothing_groups") ?? null,
    });
  }
  return out;
}

export function mergeSolids(source: string, solidIds: readonly number[]): MergeResult {
  const ids = [...new Set(solidIds)];
  if (ids.length < 2) throw new VmfMergeError("merge needs at least two brush ids");
  const nodes = parse(source).filter((n): n is KvBlock => n.kind === "block");
  const found = findSolids(nodes).filter((f) => ids.includes(f.id));
  if (found.length !== ids.length) {
    const missing = ids.filter((id) => !found.some((f) => f.id === id));
    throw new VmfMergeError(`no solid with id ${missing.join(", ")} in this map`);
  }
  if (found.some((f) => f.hidden)) {
    throw new VmfMergeError("a hidden brush cannot be merged; unhide it first");
  }
  const owner = found[0]!.ownerBlock;
  if (found.some((f) => f.ownerBlock !== owner)) {
    throw new VmfMergeError(
      "the selected brushes belong to different entities; merge within the world or one brush entity",
    );
  }

  const check = checkVmfSolids("(memory)", source);
  const byId = new Map(check.solids.filter((s) => s.id !== null).map((s) => [s.id!, s]));
  const selected = ids.map((id) => byId.get(id));
  if (selected.some((s) => !s)) throw new VmfMergeError("a selected brush could not be read");
  const brushes = selected as NonNullable<(typeof selected)[number]>[];
  if (brushes.some((s) => s.sides.some((side) => side.hasDisplacement))) {
    throw new VmfMergeError(
      "a selected brush carries a displacement; its grid cannot be merged into another brush",
    );
  }

  const points: Vec3[] = [];
  const faceTable = new Map<string, RawFace>();
  for (const f of found) {
    const solid = byId.get(f.id)!;
    points.push(...solid.vertices);
    for (const [key, face] of rawFaces(f.block)) {
      if (!faceTable.has(key)) faceTable.set(key, face);
    }
  }

  const hull = convexHull(points);
  const volumeBefore = brushes.reduce((sum, s) => sum + s.volume, 0);
  const tolerance = Math.max(0.5, volumeBefore * 0.001);
  if (Math.abs(hull.volume - volumeBefore) > tolerance) {
    throw new VmfMergeError(
      `the selected brushes do not form one convex volume: their hull is ${hull.volume.toFixed(2)} ` +
        `units^3 against ${volumeBefore.toFixed(2)} selected. A non-convex selection or an ` +
        `overlap would change the map's shape, so nothing was written.`,
    );
  }

  const materialCount = new Map<string, number>();
  for (const s of brushes) {
    for (const side of s.sides) {
      materialCount.set(side.material, (materialCount.get(side.material) ?? 0) + 1);
    }
  }
  const commonMaterial =
    [...materialCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "TOOLS/TOOLSNODRAW";
  const materialByNormal = new Map<string, string>();
  for (const [key, face] of faceTable) {
    if (face.material) materialByNormal.set(key.split("|")[0]!, face.material);
  }

  const entityRaw = owner.name === "entity" ? get(owner, "id") : undefined;
  const entityId = entityRaw !== undefined && /^\d+$/.test(entityRaw) ? Number(entityRaw) : undefined;
  if (owner.name === "entity" && entityId === undefined) {
    throw new VmfMergeError("the brush entity has no numeric id, so the merged brush has nowhere to go");
  }

  const inserted = insertSolids(
    source,
    [{ shape: "convex", faces: hull.faces }],
    {
      material: commonMaterial,
      materialForFace: (face) => materialByNormal.get(normalKey(face.normal)),
      ...(entityId !== undefined ? { entityId } : {}),
    },
  );
  const mergedId = inserted.solidIds[0]!;

  // Put the original face data back. The hull's planes are the original faces that make
  // the outside of the union; a face with no match is a new plane and keeps the defaults.
  const builtRoots = parse(inserted.text).filter((n): n is KvBlock => n.kind === "block");
  const built = findSolids(builtRoots).find((f) => f.id === mergedId);
  if (!built) throw new VmfMergeError(`the merged brush ${mergedId} could not be read back`);
  const splices: Splice[] = [];
  let facesCopied = 0;
  for (const side of children(built.block, "side")) {
    const text = get(side, "plane");
    if (!text) continue;
    const pts = parsePlanePoints(text);
    if (!pts) continue;
    const plane = planeFromPoints(...pts);
    if (!plane) continue;
    const original = faceTable.get(planeKey(plane));
    if (!original) continue;
    facesCopied += 1;
    for (const key of ["material", "uaxis", "vaxis", "rotation", "lightmapscale", "smoothing_groups"] as const) {
      const value = original[key];
      if (value === null) continue;
      setSidePair(inserted.text, side, key, value, splices);
    }
  }
  let text = splices.length > 0 ? applySplices(inserted.text, splices) : inserted.text;

  const removed = deleteSolids(text, { ids });
  text = removed.text;
  const after = checkVmfSolids("(memory)", text);
  if (after.solidCount !== check.solidCount - ids.length + 1) {
    throw new VmfMergeError(
      `refusing to write: ${check.solidCount} solids in, ${ids.length} merged, ` +
        `${after.solidCount} out`,
    );
  }
  const merged = after.solids.find((s) => s.id === mergedId);
  if (!merged || !merged.valid) {
    throw new VmfMergeError(
      `refusing to write: the merged brush is not a valid solid: ` +
        (merged?.findings ?? []).map((f) => f.message).join(" | "),
    );
  }
  if (Math.abs(merged.volume - volumeBefore) > tolerance) {
    throw new VmfMergeError(
      `refusing to write: the merged volume is ${merged.volume.toFixed(2)}, not ` +
        `${volumeBefore.toFixed(2)}`,
    );
  }

  return {
    text,
    mergedId,
    sourceIds: ids,
    volume: merged.volume,
    facesCopied,
    warnings:
      facesCopied < hull.faces.length
        ? [
            `${hull.faces.length - facesCopied} hull face(s) had no original side to copy; ` +
              `they carry the common material and default texture axes`,
          ]
        : [],
    unchanged: text === source,
  };
}
