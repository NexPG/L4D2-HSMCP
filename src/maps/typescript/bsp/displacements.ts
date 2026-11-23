/**
 * Displacements in a compiled L4D2 BSP.
 *
 * L4D2 uses the Source 2013 lump order: `DISPINFO` is lump **26** (176 bytes per
 * `ddispinfo_t`) and `DISP_VERTS` is lump **33** (20 bytes per `ddispvert_t`). This
 * repository used to name lump 22 DISPINFO and lump 26 DISP_VERTS, which read an empty
 * PORTALS lump as "no terrain" on a map full of it. srctools' `BSP_LUMPS` is the oracle for
 * the indices; the record sizes are `sizeof(ddispinfo_t)` and `sizeof(ddispvert_t)`.
 *
 * The parser reads the surface start, power and vertex range. It does not rebuild the
 * interpolated grid: that needs the face's corners and the `.vbsp` displacement builder, and
 * would be a second implementation of vbsp. Count, power and bbox answer the mapper's
 * question ("is there terrain here?") without pretending to be a renderer.
 */
import { readAt, readHeader } from "./header.js";

export const LUMP_DISPINFO = 26;
export const LUMP_DISP_VERTS = 33;
const DISPINFO_BYTES = 176;
const DISPVERT_BYTES = 20;

type Vec3 = [number, number, number];

export interface BspDisplacement {
  index: number;
  /** `ddispinfo_t.startPosition`: one corner of the displaced surface. */
  start: Vec3;
  /** 0-4; the grid is `(1 << power) + 1` vertices per side. */
  power: number;
  /** Vertices per side, `(1 << power) + 1`. */
  size: number;
  /** First `DISP_VERTS` record this displacement owns. */
  dispVertStart: number;
  /** `ddispinfo_t.m_iMapFace`, the face this displacement came from. */
  mapFace: number | null;
}

export interface BspDisplacements {
  path: string;
  count: number;
  /** Power value -> number of displacements. */
  powerCounts: Record<string, number>;
  /** Records in `DISP_VERTS` (lump 33). */
  dispVertRecords: number;
  /** Sum of `size * size`; may exceed the records because corners are shared. */
  expectedVertices: number;
  /** Bounds of the surface corner positions, not of every interpolated vertex. */
  bbox: { mins: Vec3; maxs: Vec3 } | null;
  displacements: BspDisplacement[];
  truncated: boolean;
  note: string;
}

function vec(data: Buffer, at: number): Vec3 {
  return [
    data.readFloatLE(at),
    data.readFloatLE(at + 4),
    data.readFloatLE(at + 8),
  ];
}

/** Reads and summarizes the displacements of a compiled map. */
export function readDisplacements(path: string, limit = 200): BspDisplacements {
  const header = readHeader(path);
  const info = header.lumps[LUMP_DISPINFO];
  if (!info || info.length === 0) {
    return {
      path,
      count: 0,
      powerCounts: {},
      dispVertRecords: 0,
      expectedVertices: 0,
      bbox: null,
      displacements: [],
      truncated: false,
      note:
        "No DISPINFO records: this map has no displacements. A flat map is allowed to " +
        "report 0; do not read this as a reader failure unless the map is known terrain.",
    };
  }
  if (info.length % DISPINFO_BYTES !== 0) {
    throw new Error(
      `${path}: DISPINFO (lump ${LUMP_DISPINFO}) is ${info.length} bytes, not a ` +
        `multiple of ${DISPINFO_BYTES}`,
    );
  }
  const count = info.length / DISPINFO_BYTES;
  const verts = header.lumps[LUMP_DISP_VERTS];
  const dispVertRecords =
    verts && verts.length % DISPVERT_BYTES === 0 ? verts.length / DISPVERT_BYTES : 0;

  const bytes = readAt(path, info.offset, info.length);
  const powerCounts: Record<string, number> = {};
  const displacements: BspDisplacement[] = [];
  let expectedVertices = 0;
  let mins: Vec3 | null = null;
  let maxs: Vec3 | null = null;
  for (let index = 0; index < count; index += 1) {
    const at = index * DISPINFO_BYTES;
    const start = vec(bytes, at);
    const power = bytes.readInt32LE(at + 20);
    const dispVertStart = bytes.readInt32LE(at + 12);
    const mapFace = bytes.readUInt16LE(at + 36);
    const size = power >= 0 && power <= 4 ? (1 << power) + 1 : 0;
    expectedVertices += size * size;
    const key = String(power);
    powerCounts[key] = (powerCounts[key] ?? 0) + 1;
    if (index < limit) {
      displacements.push({ index, start, power, size, dispVertStart, mapFace });
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const value = start[axis]!;
      if (mins === null) mins = [...start] as Vec3;
      if (maxs === null) maxs = [...start] as Vec3;
      if (value < mins[axis]!) mins[axis] = value;
      if (value > maxs[axis]!) maxs[axis] = value;
    }
  }

  return {
    path,
    count,
    powerCounts,
    dispVertRecords,
    expectedVertices,
    bbox: mins && maxs ? { mins, maxs } : null,
    displacements,
    truncated: count > displacements.length,
    note:
      count === 0
        ? "No DISPINFO records: this map has no displacements. A flat map is allowed to " +
          "report 0; do not read this as a reader failure unless the map is known terrain."
        : `DISPINFO is lump ${LUMP_DISPINFO} and DISP_VERTS is lump ${LUMP_DISP_VERTS}; ` +
          `lump 22 is PORTALS. bbox is the surface corners, not every interpolated vertex.`,
  };
}
