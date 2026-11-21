/**
 * The baked ambient cube in `LEAF_AMBIENT_LIGHTING` (lump 56, or HDR 55).
 *
 * The world's faces carry their light in lightmaps; a model carries none, so the engine
 * lights it from a six-sided ambient cube sampled at the visleaf it stands in. Without this,
 * props can only be given one flat light and they read as stickers on a photograph: a chair
 * in a dark corner is as bright as one under a window.
 *
 * ## Layout, measured rather than remembered
 *
 * `LEAF_AMBIENT_INDEX` (52/51) has one 4-byte entry per leaf: `sampleCount` and
 * `firstSample`. The lighting lump has `sum(sampleCount)` records. In L4D2 those records are
 * **28 bytes** â€” six `ColorRGBExp32` faces plus `x, y, z, pad` â€” where the HL2 format is 388
 * bytes (six 4Ã—4 faces). The stride is derived from the two lumps, so a map from either
 * family is read with the layout it actually has.
 *
 * `ColorRGBExp32` is `r, g, b, exponent`; the linear colour is `rgb * 2^exponent`. L4D2's LDR
 * ambient lump on `c1m1_hotel` is all zero and the HDR one is populated, which is why the
 * HDR lump is preferred when the map has one.
 */
import { readAt, readHeader } from "./header.js";

export type Rgb = [number, number, number];
/** A direction, accepts a readonly Vec3. */
export type Normal = readonly [number, number, number];

export interface AmbientSample {
  position: [number, number, number];
  /** Linear RGB per cube face: +X, -X, +Y, -Y, +Z, -Z. */
  cube: Rgb[];
}

export interface AmbientLighting {
  readonly leafCount: number;
  readonly sampleCount: number;
  /** Record size found in the file, for the report. */
  readonly stride: number;
  /** The ambient cube at a world point, or null when the point is outside the tree. */
  sample(point: [number, number, number], normal: Normal): Rgb | null;
  /** The ambient cube of a known leaf; cheap enough to call per triangle. */
  sampleLeaf(leaf: number, normal: Normal): Rgb | null;
  /** The leaf index a point falls in, or -1. */
  leafAt(point: [number, number, number]): number;
}

const FACE_NORMALS: Rgb[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Linear to sRGB, so an ambient cube can modulate an sRGB texture. */
function linearToSrgb(value: number): number {
  const v = Math.max(0, value);
  const srgb = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(1, srgb));
}

/**
 * One cube face as display RGB.
 *
 * The bytes are `ColorRGBExp32` mantissas; the exponent is the HDR scale. This renderer's
 * world lightmaps also use the mantissa as display RGB (a full HDR tone map is a separate
 * job), and using the raw linear value here made every prop black beside walls that were
 * drawn from the same data. The mantissa keeps props the same brightness as the room.
 */
function colorRgbExp32(bytes: Buffer, offset: number): Rgb {
  return [bytes[offset]! / 255, bytes[offset + 1]! / 255, bytes[offset + 2]! / 255];
}

interface Plane {
  normal: Normal;
  dist: number;
}

interface Node {
  plane: number;
  children: [number, number];
}

interface Leaf {
  mins: [number, number, number];
  maxs: [number, number, number];
}

function readPlanes(path: string): Plane[] {
  const header = readHeader(path);
  const lump = header.lumps[1];
  if (!lump || lump.length === 0) return [];
  const bytes = readAt(path, lump.offset, lump.length);
  const planes: Plane[] = [];
  for (let at = 0; at + 20 <= bytes.length; at += 20) {
    planes.push({
      normal: [bytes.readFloatLE(at), bytes.readFloatLE(at + 4), bytes.readFloatLE(at + 8)],
      dist: bytes.readFloatLE(at + 12),
    });
  }
  return planes;
}

function readNodes(path: string): Node[] {
  const header = readHeader(path);
  const lump = header.lumps[5];
  if (!lump || lump.length === 0) return [];
  const bytes = readAt(path, lump.offset, lump.length);
  const nodes: Node[] = [];
  for (let at = 0; at + 32 <= bytes.length; at += 32) {
    nodes.push({
      plane: bytes.readInt32LE(at),
      children: [bytes.readInt32LE(at + 4), bytes.readInt32LE(at + 8)],
    });
  }
  return nodes;
}

function readLeaves(path: string): Leaf[] {
  const header = readHeader(path);
  const lump = header.lumps[10];
  if (!lump || lump.length === 0) return [];
  const bytes = readAt(path, lump.offset, lump.length);
  const leaves: Leaf[] = [];
  for (let at = 0; at + 32 <= bytes.length; at += 32) {
    leaves.push({
      mins: [bytes.readInt16LE(at + 8), bytes.readInt16LE(at + 10), bytes.readInt16LE(at + 12)],
      maxs: [bytes.readInt16LE(at + 14), bytes.readInt16LE(at + 16), bytes.readInt16LE(at + 18)],
    });
  }
  return leaves;
}

/**
 * Reads the ambient lightgrid, preferring the HDR lump when the map has one.
 *
 * Returns null when the map has no ambient lumps at all, so the renderer can say "no
 * lightgrid" rather than silently applying black.
 */
export function readAmbientLighting(path: string): AmbientLighting | null {
  const header = readHeader(path);
  const hdrIndex = header.lumps[55]?.length ? 55 : null;
  const ldrIndex = header.lumps[56]?.length ? 56 : null;
  const lightingIndex = hdrIndex ?? ldrIndex;
  const indexIndex = hdrIndex ? 51 : 52;
  if (lightingIndex === null) return null;
  const indexLump = header.lumps[indexIndex];
  const lightingLump = header.lumps[lightingIndex];
  if (!indexLump || !lightingLump || indexLump.length === 0 || lightingLump.length === 0) return null;

  const indexBytes = readAt(path, indexLump.offset, indexLump.length);
  const lightingBytes = readAt(path, lightingLump.offset, lightingLump.length);
  const leafCount = Math.floor(indexBytes.length / 4);
  if (leafCount === 0) return null;

  const counts = new Uint16Array(leafCount);
  const firsts = new Uint16Array(leafCount);
  let total = 0;
  let maxFirst = 0;
  for (let i = 0; i < leafCount; i += 1) {
    counts[i] = indexBytes.readUInt16LE(i * 4);
    firsts[i] = indexBytes.readUInt16LE(i * 4 + 2);
    total += counts[i]!;
    maxFirst = Math.max(maxFirst, firsts[i]! + counts[i]!);
  }
  if (total === 0) return null;
  const stride = lightingBytes.length / total;
  if (!Number.isInteger(stride) || (stride !== 28 && stride !== 388)) {
    // A stride this reader does not know is refused rather than read as if it were 28.
    return null;
  }
  const positionOffset = stride === 28 ? 24 : 384;

  const planes = readPlanes(path);
  const nodes = readNodes(path);
  const leaves = readLeaves(path);

  const leafAt = (point: [number, number, number]): number => {
    let child = 0;
    for (let guard = 0; guard < 4096; guard += 1) {
      if (child < 0) return -1 - child;
      const node = nodes[child];
      if (!node) return -1;
      const plane = planes[node.plane];
      if (!plane) return -1;
      const side =
        plane.normal[0] * point[0] +
          plane.normal[1] * point[1] +
          plane.normal[2] * point[2] -
          plane.dist >=
        0
          ? 0
          : 1;
      child = node.children[side]!;
    }
    return -1;
  };

  /**
   * The cube of one leaf toward a normal. `point` only selects among a leaf's samples and is
   * omitted for the per-triangle path, where the leaf's single sample is the answer.
   */
  const cubeForLeaf = (
    leaf: number,
    normal: Normal,
    point: [number, number, number] | null,
  ): Rgb | null => {
    if (leaf < 0 || leaf >= leafCount) return null;
    const count = counts[leaf]!;
    if (count === 0) return null;

    let sampleIndex = firsts[leaf]!;
    if (point && count > 1 && leaf < leaves.length) {
      const box = leaves[leaf]!;
      let best = Infinity;
      for (let i = 0; i < count; i += 1) {
        const at = (firsts[leaf]! + i) * stride;
        const x = lightingBytes[at + positionOffset]! / 255;
        const y = lightingBytes[at + positionOffset + 1]! / 255;
        const z = lightingBytes[at + positionOffset + 2]! / 255;
        const px = box.mins[0] + (box.maxs[0] - box.mins[0]) * x;
        const py = box.mins[1] + (box.maxs[1] - box.mins[1]) * y;
        const pz = box.mins[2] + (box.maxs[2] - box.mins[2]) * z;
        const distance =
          (px - point[0]) ** 2 + (py - point[1]) ** 2 + (pz - point[2]) ** 2;
        if (distance < best) {
          best = distance;
          sampleIndex = firsts[leaf]! + i;
        }
      }
    }

    const base = sampleIndex * stride;
    const faceCount = stride === 28 ? 1 : 16;
    const weights = FACE_NORMALS.map((face) => {
      const dot =
        face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2];
      return Math.max(0, dot);
    });
    let sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 1e-6) {
      weights.fill(1);
      sum = weights.length;
    }
    const out: Rgb = [0, 0, 0];
    for (let face = 0; face < 6; face += 1) {
      const weight = weights[face]! / sum;
      if (weight <= 0) continue;
      // HL2's 388-byte cube has 4Ã—4 samples per face; average the face and weight it once.
      let faceR = 0;
      let faceG = 0;
      let faceB = 0;
      for (let texel = 0; texel < faceCount; texel += 1) {
        const at = base + (face * faceCount + texel) * 4;
        if (at + 4 > lightingBytes.length) break;
        const colour = colorRgbExp32(lightingBytes, at);
        faceR += colour[0];
        faceG += colour[1];
        faceB += colour[2];
      }
      out[0] += (faceR / faceCount) * weight;
      out[1] += (faceG / faceCount) * weight;
      out[2] += (faceB / faceCount) * weight;
    }
    return [Math.min(1, out[0]), Math.min(1, out[1]), Math.min(1, out[2])];
  };

  return {
    leafCount,
    sampleCount: total,
    stride,
    leafAt,
    sampleLeaf: (leaf, normal) => cubeForLeaf(leaf, normal, null),
    sample: (point, normal) => cubeForLeaf(leafAt(point), normal, point),
  };
}

