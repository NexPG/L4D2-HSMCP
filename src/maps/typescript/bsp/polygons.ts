/**
 * BSP face polygons: the vertices the compiled map actually draws.
 *
 * `read_bsp_faces` reports material, plane, area and lightmap footprint; it does not rebuild
 * the loop. A renderer needs the loop, and it lives across four lumps: FACES says firstedge
 * and numedges, SURFEDGES signs an EDGES entry, EDGES names two VERTEXES, PLANES gives the
 * face normal. This is the one place that joins them.
 */
import { BspFormatError, readAt, readHeader, requireLump } from "./header.js";
import type { BspLump } from "./header.js";
import { readBspFaces } from "./faces.js";
import type { Vec3 } from "../vmf/solid.js";

const LUMP_PLANES = 1;
const LUMP_VERTEXES = 3;
const LUMP_FACES = 7;
const LUMP_EDGES = 12;
const LUMP_SURFEDGES = 13;
const LUMP_FACES_HDR = 58;

const PLANE_BYTES = 20;
const VERTEX_BYTES = 12;
const EDGE_BYTES = 4;
const SURFEDGE_BYTES = 4;
const FACE_BYTES = 56;

export interface BspPolygon {
  index: number;
  material: string;
  flags: number;
  normal: Vec3;
  dist: number;
  points: Vec3[];
}

export interface BspPolygons {
  faces: BspPolygon[];
  mins: Vec3;
  maxs: Vec3;
  faceCount: number;
}

function guard(path: string, index: number, structBytes: number): BspLump {
  const lump = requireLump(readHeader(path), index);
  if (lump.compressed) {
    throw new BspFormatError(
      `${path}: lump ${index} is LZMA-compressed; the polygon reader does not decode it`,
    );
  }
  if (lump.length % structBytes !== 0) {
    throw new BspFormatError(
      `${path}: lump ${index} is ${lump.length} bytes, not a multiple of ${structBytes}`,
    );
  }
  return lump;
}

/** Reads every face loop; `hdr` selects the FACES_HDR table for an HDR-only map. */
export function readBspPolygons(path: string, hdr = false): BspPolygons {
  const header = readHeader(path);
  const facesLump = guard(path, hdr ? LUMP_FACES_HDR : LUMP_FACES, FACE_BYTES);
  const planesLump = guard(path, LUMP_PLANES, PLANE_BYTES);
  const verticesLump = guard(path, LUMP_VERTEXES, VERTEX_BYTES);
  const edgesLump = guard(path, LUMP_EDGES, EDGE_BYTES);
  const surfedgesLump = guard(path, LUMP_SURFEDGES, SURFEDGE_BYTES);

  const planesRaw = readAt(path, planesLump.offset, planesLump.length);
  const planes = new DataView(planesRaw.buffer, planesRaw.byteOffset, planesRaw.byteLength);
  const verticesRaw = readAt(path, verticesLump.offset, verticesLump.length);
  const vertices = new DataView(
    verticesRaw.buffer,
    verticesRaw.byteOffset,
    verticesRaw.byteLength,
  );
  const edgesRaw = readAt(path, edgesLump.offset, edgesLump.length);
  const edges = new DataView(edgesRaw.buffer, edgesRaw.byteOffset, edgesRaw.byteLength);
  const surfedgesRaw = readAt(path, surfedgesLump.offset, surfedgesLump.length);
  const surfedges = new DataView(
    surfedgesRaw.buffer,
    surfedgesRaw.byteOffset,
    surfedgesRaw.byteLength,
  );
  const facesRaw = readAt(path, facesLump.offset, facesLump.length);
  const faces = new DataView(facesRaw.buffer, facesRaw.byteOffset, facesRaw.byteLength);

  const planeCount = planesLump.length / PLANE_BYTES;
  const vertexCount = verticesLump.length / VERTEX_BYTES;
  const edgeCount = edgesLump.length / EDGE_BYTES;
  const surfedgeCount = surfedgesLump.length / SURFEDGE_BYTES;
  const faceCount = facesLump.length / FACE_BYTES;

  const materialReport = readBspFaces(path, { limit: 1_000_000 });
  const out: BspPolygon[] = [];
  const mins: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxs: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let index = 0; index < faceCount; index += 1) {
    const at = index * FACE_BYTES;
    const planenum = faces.getUint16(at, true);
    const firstedge = faces.getInt32(at + 4, true);
    const numedges = faces.getInt16(at + 8, true);
    if (numedges < 3 || firstedge < 0 || firstedge + numedges > surfedgeCount) continue;
    if (planenum >= planeCount) continue;
    const planeAt = planenum * PLANE_BYTES;
    const normal: Vec3 = [
      planes.getFloat32(planeAt, true),
      planes.getFloat32(planeAt + 4, true),
      planes.getFloat32(planeAt + 8, true),
    ];
    const dist = planes.getFloat32(planeAt + 12, true);
    const points: Vec3[] = [];
    let valid = true;
    for (let edgeIndex = firstedge; edgeIndex < firstedge + numedges; edgeIndex += 1) {
      const surfedge = surfedges.getInt32(edgeIndex * SURFEDGE_BYTES, true);
      const edge = Math.abs(surfedge);
      if (edge >= edgeCount) {
        valid = false;
        break;
      }
      const vertex = surfedge >= 0
        ? edges.getUint16(edge * EDGE_BYTES, true)
        : edges.getUint16(edge * EDGE_BYTES + 2, true);
      if (vertex >= vertexCount) {
        valid = false;
        break;
      }
      const point: Vec3 = [
        vertices.getFloat32(vertex * VERTEX_BYTES, true),
        vertices.getFloat32(vertex * VERTEX_BYTES + 4, true),
        vertices.getFloat32(vertex * VERTEX_BYTES + 8, true),
      ];
      points.push(point);
      for (let axis = 0; axis < 3; axis += 1) {
        if (point[axis]! < mins[axis]!) mins[axis] = point[axis]!;
        if (point[axis]! > maxs[axis]!) maxs[axis] = point[axis]!;
      }
    }
    if (!valid || points.length < 3) continue;
    const surface = materialReport.faces[index];
    out.push({
      index,
      material: surface?.material ?? "",
      flags: surface?.flags ?? 0,
      normal,
      dist,
      points,
    });
  }

  if (out.length === 0) {
    throw new BspFormatError(`${path}: no face loops could be reconstructed`);
  }
  return { faces: out, mins, maxs, faceCount };
}
