/**
 * The convex hull of a point cloud, as the faces a VMF brush needs.
 *
 * `write_vmf_solid` already knows how to turn face loops into sides; what it does not have
 * is points -> faces. Hammer's merge tool is exactly that operation: if the selected
 * brushes together form a convex volume, their corners are the hull and one brush can
 * replace them.
 *
 * The implementation is the supporting-plane test rather than an incremental hull: a brush
 * has tens of corners, not millions, and the O(n^3) triple loop is short enough to read.
 * A plane is a hull face when every point is on one side of it; coplanar triples are
 * deduplicated and their loops are ordered by the same `orderedLoop` the rest of the
 * writer uses.
 */
import { orderedLoop } from "./solid.js";
import type { Plane, Vec3 } from "./solid.js";

export class HullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HullError";
  }
}

const EPS = 0.01;
const MAX_POINTS = 240;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function unique(points: readonly Vec3[]): Vec3[] {
  const seen = new Set<string>();
  const out: Vec3[] = [];
  for (const p of points) {
    if (p.some((v) => !Number.isFinite(v))) continue;
    const key = p.map((v) => Math.round(v / 0.0001)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([p[0], p[1], p[2]]);
  }
  return out;
}

export interface Hull {
  faces: Vec3[][];
  planes: Plane[];
  volume: number;
}

/** The convex hull's faces, outward-wound. Throws when the points do not enclose a volume. */
export function convexHull(points: readonly Vec3[]): Hull {
  const cloud = unique(points);
  if (cloud.length < 4) {
    throw new HullError(`a hull needs at least four non-coplanar corners, and ${cloud.length} were given`);
  }
  if (cloud.length > MAX_POINTS) {
    throw new HullError(
      `${cloud.length} distinct corners is past the ${MAX_POINTS} this merge will scan; ` +
        `merge fewer brushes at a time`,
    );
  }

  const planes: Plane[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < cloud.length - 2; i++) {
    for (let j = i + 1; j < cloud.length - 1; j++) {
      for (let k = j + 1; k < cloud.length; k++) {
        const a = cloud[i]!;
        const b = cloud[j]!;
        const c = cloud[k]!;
        const n = cross(sub(b, a), sub(c, a));
        const length = Math.hypot(n[0], n[1], n[2]);
        if (length < 1e-9) continue;
        let normal: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
        let dist = dot(normal, a);

        let below = true;
        let above = true;
        for (const p of cloud) {
          const d = dot(normal, p) - dist;
          if (d > EPS) below = false;
          if (d < -EPS) above = false;
          if (!below && !above) break;
        }
        if (!below && !above) continue;
        if (above && !below) {
          normal = [-normal[0], -normal[1], -normal[2]];
          dist = -dist;
        }

        const key = [...normal.map((v) => Math.round(v / 0.0001)), Math.round(dist / 0.0001)].join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        planes.push({ normal, dist });
      }
    }
  }

  if (planes.length < 4) {
    throw new HullError(
      `the corners are coplanar or form a line: ${planes.length} supporting plane(s) is not a brush`,
    );
  }

  const faces: Vec3[][] = [];
  for (const plane of planes) {
    const onPlane = cloud.filter((p) => Math.abs(dot(plane.normal, p) - plane.dist) <= EPS * 2);
    if (onPlane.length < 3) continue;
    // Points in the middle of an edge are on the supporting plane but are not corners.
    // Keeping them makes the first three points of the loop collinear and the brush writer
    // refuses the face, so the loop is reduced to its corners.
    const loop = orderedLoop(onPlane, plane.normal);
    let cleaned = loop;
    let changed = true;
    while (changed && cleaned.length > 3) {
      changed = false;
      for (let i = 0; i < cleaned.length; i++) {
        const prev = cleaned[(i + cleaned.length - 1) % cleaned.length]!;
        const here = cleaned[i]!;
        const next = cleaned[(i + 1) % cleaned.length]!;
        const bend = cross(sub(here, prev), sub(next, here));
        if (Math.hypot(bend[0], bend[1], bend[2]) < 1e-6) {
          cleaned = [...cleaned.slice(0, i), ...cleaned.slice(i + 1)];
          changed = true;
          break;
        }
      }
    }
    if (cleaned.length >= 3) faces.push(cleaned);
  }
  if (faces.length < 4) {
    throw new HullError(`the hull produced ${faces.length} face(s), which is not a brush`);
  }

  let volume = 0;
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i++) {
      const a = face[0]!;
      const b = face[i]!;
      const c = face[i + 1]!;
      volume += dot(a, cross(b, c)) / 6;
    }
  }
  return { faces, planes, volume: Math.abs(volume) };
}
