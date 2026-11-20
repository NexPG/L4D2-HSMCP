/**
 * Planning a 3D skybox: the arithmetic, before any bytes are written.
 *
 * A 3D skybox is a scaled copy of the map's geometry, enclosed in a sealed room, with one
 * `sky_camera` at the point the map origin maps to. Hammer leaves every one of those
 * decisions to the mapper; this file turns them into a plan a writer can check:
 *
 * - where the room goes, chosen so it cannot overlap the playable map;
 * - how big the inner volume must be to hold both the copy and the camera;
 * - the six brushes that enclose it, mitred so no two overlap;
 * - the matrix that scales the copy about the map origin and moves it into place.
 *
 * Two mistakes are easy to make here and are refused rather than clamped:
 *
 * **The camera is not the centre of the copy.** It is wherever the map origin lands after
 * scaling, and a map that sits far from the world origin puts that point outside its own
 * bounding box. The room therefore has to contain the *union* of the scaled geometry and
 * the camera, not the geometry alone.
 *
 * **A skybox room that overlaps the playable map is worse than no skybox.** It is invisible
 * from outside and its walls cut the map. The plan refuses an explicit origin that lands
 * there, and the automatic placement only ever puts the room outside the map's own bounds.
 */
import { WORLD_BOUND } from "./solid.js";
import type { Vec3 } from "./solid.js";
import type { SolidSpec } from "./build.js";

export class VmfSkyboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfSkyboxError";
  }
}

export interface Bounds {
  mins: Vec3;
  maxs: Vec3;
}

export interface SkyboxPlanOptions {
  /** Where the map origin lands in the skybox. Absent means: place the room automatically. */
  origin?: Vec3;
  /** How much smaller the copy is. Hammer's own default is 16. */
  scale?: number;
  /** Skybox units between the copy (or camera) and the room's inner wall. */
  margin?: number;
  /** Thickness of the room's walls, floor and ceiling, in skybox units. */
  wallThickness?: number;
  /** Gap between the playable map and the room when the origin is chosen automatically. */
  gap?: number;
}

export interface SkyboxPlan {
  origin: Vec3;
  scale: number;
  /** Inner volume of the sealed room. */
  roomMins: Vec3;
  roomMaxs: Vec3;
  /** Outer volume, walls included. */
  outerMins: Vec3;
  outerMaxs: Vec3;
  /** Bounds of the scaled copy, in skybox space. */
  copyMins: Vec3;
  copyMaxs: Vec3;
  /** The six brushes that enclose the room: floor, ceiling and four walls. */
  roomSolids: SolidSpec[];
  /** Scale about the map origin, then move it to `origin`. */
  matrix: [number, number, number, number, number, number, number, number, number, number, number, number];
}

const min3 = (a: Vec3, b: Vec3): Vec3 => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
const max3 = (a: Vec3, b: Vec3): Vec3 => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

const SAFETY = 16;
const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function validate(value: number, name: string, min: number): number {
  if (!Number.isFinite(value) || value < min) {
    throw new VmfSkyboxError(`${name} must be at least ${min}, not ${value}`);
  }
  return value;
}

/** The six boxes of a hollow room, mitred so they share faces rather than overlap. */
function roomSolids(innerMins: Vec3, innerMaxs: Vec3, thickness: number): SolidSpec[] {
  const outerMins = sub(innerMins, [thickness, thickness, thickness]);
  const outerMaxs = add(innerMaxs, [thickness, thickness, thickness]);
  const [x0, y0, z0] = outerMins;
  const [x1, y1, z1] = outerMaxs;
  const [ix0, iy0, iz0] = innerMins;
  const [ix1, iy1, iz1] = innerMaxs;

  const box = (mins: Vec3, maxs: Vec3): SolidSpec => ({ shape: "box", mins, maxs });
  return [
    box([x0, y0, z0], [x1, y1, iz0]), // floor
    box([x0, y0, iz1], [x1, y1, z1]), // ceiling
    box([x0, y0, iz0], [ix0, y1, iz1]), // -x wall
    box([ix1, y0, iz0], [x1, y1, iz1]), // +x wall
    box([ix0, y0, iz0], [ix1, iy0, iz1]), // -y wall
    box([ix0, iy1, iz0], [ix1, y1, iz1]), // +y wall
  ];
}

/**
 * Works out where the skybox goes and what encloses it.
 *
 * `geometry` is the bounding box of the brushes being copied; `map` is the whole playable
 * map, which the room must not touch.
 */
export function planSkybox(
  geometry: Bounds,
  map: Bounds,
  options: SkyboxPlanOptions = {},
): SkyboxPlan {
  const scale = options.scale ?? 16;
  const margin = validate(options.margin ?? 32, "margin", 1);
  const thickness = validate(options.wallThickness ?? 16, "wallThickness", 1);
  const gap = validate(options.gap ?? 1024, "gap", 0);

  if (!Number.isInteger(scale) || scale < 2 || scale > 64) {
    throw new VmfSkyboxError(`scale must be a whole number from 2 to 64, not ${scale}`);
  }
  for (const axis of [0, 1, 2] as const) {
    if (geometry.maxs[axis] <= geometry.mins[axis]) {
      throw new VmfSkyboxError("the selection has no volume, so there is nothing to copy");
    }
  }

  const factor = 1 / scale;
  const copyMins = mul(geometry.mins, factor);
  const copyMaxs = mul(geometry.maxs, factor);

  // The camera sits at the scaled map origin, which can be outside the copy's own box. The
  // room has to hold both, so the offsets are the union of the copy and the point (0,0,0)
  // in skybox space.
  const offsetMins = min3(copyMins, [0, 0, 0]);
  const offsetMaxs = max3(copyMaxs, [0, 0, 0]);
  const roomSize = sub(offsetMaxs, offsetMins);
  for (const axis of [0, 1, 2] as const) {
    if (roomSize[axis] + 2 * margin < 16) {
      throw new VmfSkyboxError(
        "the skybox room would be under 16 units across: increase margin or copy a larger " +
          "selection",
      );
    }
  }

  let origin: Vec3 | null = options.origin ? ([...options.origin] as Vec3) : null;
  const mapCentre: Vec3 = [
    (map.mins[0] + map.maxs[0]) / 2,
    (map.mins[1] + map.maxs[1]) / 2,
    (map.mins[2] + map.maxs[2]) / 2,
  ];

  if (!origin) {
    for (const gapTry of [gap, Math.max(256, gap / 2), 256]) {
      for (const dir of DIRECTIONS) {
        const candidate = [...mapCentre] as [number, number, number];
        for (const axis of [0, 1, 2] as const) {
          if (dir[axis] > 0) {
            candidate[axis] =
              map.maxs[axis] + gapTry + thickness + margin - offsetMins[axis];
          } else if (dir[axis] < 0) {
            candidate[axis] =
              map.mins[axis] - gapTry - thickness - margin - offsetMaxs[axis];
          } else {
            candidate[axis] = mapCentre[axis] - (offsetMins[axis] + offsetMaxs[axis]) / 2;
          }
        }
        const inner = {
          mins: add(candidate as unknown as Vec3, sub(offsetMins, [margin, margin, margin])),
          maxs: add(candidate as unknown as Vec3, add(offsetMaxs, [margin, margin, margin])),
        };
        const outerMins = sub(inner.mins, [thickness, thickness, thickness]);
        const outerMaxs = add(inner.maxs, [thickness, thickness, thickness]);
        if (
          outerMins.every((v) => v >= -WORLD_BOUND + SAFETY) &&
          outerMaxs.every((v) => v <= WORLD_BOUND - SAFETY) &&
          !overlaps(inner, { mins: map.mins, maxs: map.maxs })
        ) {
          origin = candidate as unknown as Vec3;
          break;
        }
      }
      if (origin) break;
    }
    if (!origin) {
      throw new VmfSkyboxError(
        "no free space in the world for a skybox room. The map already reaches the world " +
          "bounds; pass an explicit origin in a void area, or copy a smaller selection.",
      );
    }
  }

  const roomMins = add(origin, sub(offsetMins, [margin, margin, margin]));
  const roomMaxs = add(origin, add(offsetMaxs, [margin, margin, margin]));
  const outerMins = sub(roomMins, [thickness, thickness, thickness]);
  const outerMaxs = add(roomMaxs, [thickness, thickness, thickness]);

  if (!outerMins.every((v) => v >= -WORLD_BOUND + SAFETY) || !outerMaxs.every((v) => v <= WORLD_BOUND - SAFETY)) {
    throw new VmfSkyboxError(
      "the skybox room would reach outside the world bounds (+/-16384). Move the origin " +
        "inward or copy a smaller selection.",
    );
  }
  if (overlaps({ mins: roomMins, maxs: roomMaxs }, { mins: map.mins, maxs: map.maxs })) {
    throw new VmfSkyboxError(
      "the skybox room would overlap the playable map. Its walls would cut the map and be " +
        "invisible from the outside; choose an origin outside the map's bounds.",
    );
  }
  if (!containsPoint({ mins: roomMins, maxs: roomMaxs }, origin)) {
    throw new VmfSkyboxError(
      "the sky_camera would sit outside its own sealed room, and vbsp would report a leak " +
        "from it",
    );
  }

  return {
    origin,
    scale,
    roomMins,
    roomMaxs,
    outerMins,
    outerMaxs,
    copyMins,
    copyMaxs,
    roomSolids: roomSolids(roomMins, roomMaxs, thickness),
    matrix: [
      factor, 0, 0, origin[0],
      0, factor, 0, origin[1],
      0, 0, factor, origin[2],
    ],
  };
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return [0, 1, 2].every(
    (axis) => a.mins[axis]! < b.maxs[axis]! && a.maxs[axis]! > b.mins[axis]!,
  );
}

function containsPoint(bounds: Bounds, p: Vec3): boolean {
  return [0, 1, 2].every(
    (axis) => p[axis]! >= bounds.mins[axis]! && p[axis]! <= bounds.maxs[axis]!,
  );
}

/** Whether a brush's bounds lie inside the room's inner volume. */
export function insideRoom(room: Bounds, brush: Bounds, slack = 0.01): boolean {
  return [0, 1, 2].every(
    (axis) =>
      brush.mins[axis]! >= room.mins[axis]! - slack &&
      brush.maxs[axis]! <= room.maxs[axis]! + slack,
  );
}

/**
 * Whether a point is inside a brush, by the planes that define it.
 *
 * A `sky_camera` inside any solid is a hard error in vbsp ("Entity sky_camera in solid
 * volume") rather than a cosmetic one, so the builder checks this before writing. Bounds
 * would be enough for a box and wrong for everything else; the half-spaces are exact for
 * the convex brushes a `.vmf` can hold.
 */
export function pointInsideSolid(
  solid: { sides: ReadonlyArray<{ plane: { normal: Vec3; dist: number } | null }> },
  point: Vec3,
  epsilon = 0.01,
): boolean {
  if (solid.sides.length === 0) return false;
  for (const side of solid.sides) {
    if (!side.plane) return false;
    const { normal, dist } = side.plane;
    if (normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] > dist + epsilon) {
      return false;
    }
  }
  return true;
}
