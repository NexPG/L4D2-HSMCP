/**
 * Hammer's "Move Objects" tool: put brushes on the floor or ceiling under them.
 *
 * The map is traced as it is, without compiling. The selected brushes are removed from the
 * scene first -- otherwise every ray would hit the object it is trying to move -- and each
 * object is then translated by the distance to the first surface along its centre line.
 *
 * With `alignToNormal` the object is also turned so its up axis follows the surface. The
 * rotation happens about the contact point, so the corner that touched the floor stays
 * there while the rest of the brush settles onto the slope. A vertical surface is not a
 * floor and is refused rather than rotated onto its side.
 */
import { buildScene } from "../space/scene.js";
import { DIST_EPSILON, traceRay } from "../space/trace.js";
import { deleteSolids } from "./modify.js";
import { checkVmfSolids } from "./solid.js";
import type { Vec3 } from "./solid.js";
import { compose, rotation, translation } from "./transform.js";
import { transformSolids } from "./modify.js";

export class VmfSnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfSnapError";
  }
}

export interface MoveToSurfaceOptions {
  direction: "down" | "up";
  maxDistance?: number;
  alignToNormal?: boolean;
}

export interface MovedObject {
  id: number;
  delta: Vec3;
  hit: Vec3;
  normal: Vec3 | null;
  rotated: boolean;
}

export interface SnapResult {
  text: string;
  moved: MovedObject[];
  warnings: string[];
  unchanged: boolean;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

function unit(v: Vec3): Vec3 {
  const l = len(v);
  if (l < 1e-9) return [0, 0, 1];
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function moveToSurface(
  source: string,
  solidIds: readonly number[],
  options: MoveToSurfaceOptions,
): SnapResult {
  const ids = [...new Set(solidIds)];
  if (ids.length === 0) throw new VmfSnapError("no brush ids were given");
  const maxDistance = options.maxDistance ?? 1024;
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    throw new VmfSnapError("maxDistance must be a positive number");
  }
  const before = checkVmfSolids("(memory)", source);
  const byId = new Map(before.solids.filter((s) => s.id !== null).map((s) => [s.id!, s]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new VmfSnapError(`no solid with id ${missing.join(", ")} in this map`);

  // Remove the movers from the scene. A ray that starts inside the brush it is moving is
  // the one mistake this tool cannot recover from.
  const without = deleteSolids(source, { ids }).text;
  const scene = buildScene("(memory)", without);
  const warnings: string[] = [];
  const moved: MovedObject[] = [];
  let text = source;

  for (const id of ids) {
    const solid = byId.get(id)!;
    if (solid.vertices.length < 3) {
      warnings.push(`solid ${id} has no readable corners, so it was not moved`);
      continue;
    }
    const centreX = (solid.mins[0] + solid.maxs[0]) / 2;
    const centreY = (solid.mins[1] + solid.maxs[1]) / 2;
    const down = options.direction === "down";
    const start: Vec3 = down
      ? [centreX, centreY, solid.mins[2] + 0.01]
      : [centreX, centreY, solid.maxs[2] - 0.01];
    const end: Vec3 = down
      ? [centreX, centreY, solid.mins[2] - maxDistance]
      : [centreX, centreY, solid.maxs[2] + maxDistance];
    const hit = traceRay(scene, start, end);
    if (!hit.hit) {
      warnings.push(
        `solid ${id} found no ${down ? "floor" : "ceiling"} within ${maxDistance} units`,
      );
      continue;
    }

    const deltaZ = down
      ? hit.point[2] - DIST_EPSILON - solid.mins[2]
      : hit.point[2] + DIST_EPSILON - solid.maxs[2];
    const surfaceZ = down ? hit.point[2] - DIST_EPSILON : hit.point[2] + DIST_EPSILON;
    const normal = hit.normal ? unit(hit.normal) : null;
    const pivot: Vec3 = [centreX, centreY, down ? solid.mins[2] : solid.maxs[2]];
    let rotated = false;
    let matrix = translation([0, 0, deltaZ]);
    if (options.alignToNormal && normal) {
      const up: Vec3 = down ? normal : [-normal[0], -normal[1], -normal[2]];
      if (up[2] < 0.5) {
        warnings.push(
          `solid ${id} met a surface too vertical to stand on; it was moved without turning`,
        );
      } else {
        const axis = cross([0, 0, 1], up);
        const angle = (Math.acos(Math.max(-1, Math.min(1, dot([0, 0, 1], up)))) * 180) / Math.PI;
        if (len(axis) > 1e-9 && angle > 1e-6) {
          const spin = rotation(unit(axis), angle, pivot);
          matrix = compose(
            translation([hit.point[0] - pivot[0], hit.point[1] - pivot[1], surfaceZ - pivot[2]]),
            spin,
          );
          rotated = true;
        }
      }
    }

    const result = transformSolids(text, { ids: [id] }, matrix, { textureLock: true });
    text = result.text;
    warnings.push(...result.warnings);
    moved.push({
      id,
      delta: [0, 0, deltaZ],
      hit: hit.point,
      normal,
      rotated,
    });
  }

  const after = checkVmfSolids("(memory)", text);
  if (after.solidCount !== before.solidCount) {
    throw new VmfSnapError(
      `refusing to write: ${before.solidCount} solids in, ${after.solidCount} out; moving must not add or remove one`,
    );
  }
  if (moved.length === 0) {
    return { text: source, moved: [], warnings, unchanged: true };
  }
  return { text, moved, warnings, unchanged: text === source };
}
