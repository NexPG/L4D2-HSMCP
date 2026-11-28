/**
 * Compiled model geometry: the `.mdl` header, `.vvd` vertices and `.vtx` triangles.
 *
 * A static prop in a map is a `.mdl` path and a transform; the geometry lives in three
 * sibling files. The header names the materials, stages and hull; the VVD holds positions,
 * normals and UVs; the VTX holds the index buffer. Reading all three is what turns a
 * placement record into triangles a renderer can draw.
 *
 * The layouts are from sourcepp's `mdlpp` structs, cross-checked against L4D2 models
 * (`c1_chargerexit/doors_glass_1.mdl`, version 49, one body part, one mesh, 3,187 vertices).
 *
 * ## LODs, and why the vertex order is not raw
 *
 * The VTX stores several LODs with switch distances. A model's `meshVertexID` indexes the
 * **fixed** vertex list for the LOD it belongs to, built from the VVD fixup table, not the
 * raw VVD order. `shelves_metal1` has fixups whose first group covers raw 0..344 and whose
 * second starts at raw 569; fixed index 345 is raw 569. Using the raw order draws connected
 * but wrong triangles, which looks like a mis-shaped prop rather than a bad file. LOD 0 uses
 * every fixup; LOD k uses only fixups with `lodIndex >= k`.
 *
 * ## VTX topology fields
 *
 * L4D2's VTX 7 adds two topology-index fields to each strip group and strip. Other branches
 * with the same MDL version do not. Rather than trust the version, the reader parses both
 * layouts and keeps the one whose offsets, counts and triangle indices are internally
 * consistent. That is the same test a person makes when a model's geometry looks scrambled.
 */
import type { MdlFlex, MdlFlexData } from "./mdlflex.js";
import { readFlexHeader, readMeshFlexes } from "./mdlflex.js";

export type Vec3 = [number, number, number];

export interface ModelVertex {
  position: Vec3;
  normal: Vec3;
  uv: [number, number];
  /** Up to three bone indices from the VVD, in weight order. */
  bones?: [number, number, number];
  /** Matching weights, normalised by the compiler. */
  weights?: [number, number, number];
  /** How many of `bones`/`weights` are valid. */
  boneCount?: number;
}

export interface ModelMesh {
  /** Index into `ModelGeometry.materials` before a skin remap. */
  materialIndex: number;
  /** A VTX material replacement for this LOD, when the list names one. */
  materialOverride?: string;
  vertices: ModelVertex[];
  /** Three indices per triangle, into `vertices`. */
  triangles: number[];
  /** Index of `vertices[0]` in the LOD's fixed VVD vertex list. */
  vertexStart: number;
  /** Flex deltas for this mesh at LOD 0, with absolute vertex indices. */
  flexes?: MdlFlex[];
}

/** One VTX material replacement for a LOD, by base material index. */
export interface ModelMaterialReplacement {
  /** Index into `ModelGeometry.materials`. */
  materialIndex: number;
  /** Replacement material path stored in the VTX. */
  replacement: string;
}

export interface ModelLod {
  /** VTX switch distance; 0 for LOD 0. Negative is a shadow LOD. */
  switchDistance: number;
  meshes: ModelMesh[];
  triangleCount: number;
  /** Any strip group has `FLEXED` or `DELTAFIXED`; the QC option is `facial`. */
  usesFacial: boolean;
  /** VTX material replacements at this LOD. */
  materialReplacements: ModelMaterialReplacement[];
}

/** One alternative of a body part, i.e. one value of its bodygroup. */
export interface ModelBodyPartModel {
  /** Name from the MDL model record, often a `.smd` path. */
  name: string;
  /** Every LOD of this alternative, LOD 0 first; null when the model has no such LOD. */
  lods: Array<ModelLod | null>;
  /** LOD 0 meshes, a convenience alias of `lods[0].meshes`. */
  meshes: ModelMesh[];
  /** LOD 0 triangle count. */
  triangleCount: number;
}

export interface ModelBodyPart {
  name: string;
  /** Mixed-radix base used by `$bodygrouppreset` decoding. */
  base: number;
  /** Alternatives in bodygroup-value order; index 0 is the default. */
  models: ModelBodyPartModel[];
}

export interface ModelBodyGroupPreset {
  name: string;
  value: number;
  mask: number;
  /** The bodypart values the preset selects, in body-part order. */
  parts: Array<{ part: string; index: number }>;
}

export interface ModelGeometry {
  name: string;
  hullMin: Vec3;
  hullMax: Vec3;
  /** Bounding radius from the hull centre, for prop-level culling. */
  radius: number;
  /** Model-space material paths, e.g. `models/props_junk/wood_crate001a`. */
  materials: string[];
  /** Skin family -> one material index per material. Family 0 is the default skin. */
  skins: number[][];
  /** Every LOD, LOD 0 first. */
  lods: ModelLod[];
  /** LOD 0 meshes, for callers that do not choose a LOD (model 0 of each body part). */
  meshes: ModelMesh[];
  /** Every body part and every bodygroup alternative, at LOD 0. */
  bodyParts: ModelBodyPart[];
  /** `$bodygrouppreset` entries; empty when the model has none. */
  presets: ModelBodyGroupPreset[];
  /** The LOD-0 fixed vertex list the VTA basis frame and flex indices refer to. */
  lod0Vertices: ModelVertex[];
  /** Flex descriptors, controllers and rules from the header. */
  flex: MdlFlexData;
  vertexCount: number;
  triangleCount: number;
  /** VVD fixups present; nonzero means the LOD vertex order is a fixed list. */
  fixupCount: number;
  /** Whether the VTX carried the L4D2 topology-index fields. */
  vtxTopology: boolean;
}

const IDST = 0x54534449; // "IDST"
const IDSV = 0x56534449; // "IDSV"

function readName(bytes: Buffer, offset: number, limit = bytes.length): string {
  if (offset < 0 || offset >= limit) return "";
  const end = bytes.indexOf(0, offset);
  return bytes.subarray(offset, end < 0 || end > limit ? limit : end).toString("latin1");
}

function isFiniteVec(values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

interface MdlHeader {
  version: number;
  checksum: number;
  hullMin: Vec3;
  hullMax: Vec3;
  materialCount: number;
  materialOffset: number;
  skinCount: number;
  skinFamilyCount: number;
  skinOffset: number;
  bodyPartCount: number;
  bodyPartOffset: number;
}

function readMdlHeader(mdl: Buffer): MdlHeader | null {
  if (mdl.length < 244 || mdl.readInt32LE(0) !== IDST) return null;
  const version = mdl.readInt32LE(4);
  if (version < 44 || version > 49) return null;
  return {
    version,
    checksum: mdl.readInt32LE(8),
    hullMin: [mdl.readFloatLE(104), mdl.readFloatLE(108), mdl.readFloatLE(112)],
    hullMax: [mdl.readFloatLE(116), mdl.readFloatLE(120), mdl.readFloatLE(124)],
    materialCount: mdl.readInt32LE(204),
    materialOffset: mdl.readInt32LE(208),
    skinCount: mdl.readInt32LE(220),
    skinFamilyCount: mdl.readInt32LE(224),
    skinOffset: mdl.readInt32LE(228),
    bodyPartCount: mdl.readInt32LE(232),
    bodyPartOffset: mdl.readInt32LE(236),
  };
}

interface VvdHeader {
  vertexCount: number;
  verticesOffset: number;
  tangentsOffset: number;
  fixupCount: number;
  fixupsOffset: number;
}

function readVvdHeader(vvd: Buffer, checksum: number): VvdHeader | null {
  if (vvd.length < 64 || vvd.readInt32LE(0) !== IDSV) return null;
  if (vvd.readInt32LE(4) !== 4) return null;
  if (vvd.readInt32LE(8) !== checksum) return null;
  return {
    vertexCount: vvd.readInt32LE(16),
    verticesOffset: vvd.readInt32LE(56),
    tangentsOffset: vvd.readInt32LE(60),
    fixupCount: vvd.readInt32LE(48),
    fixupsOffset: vvd.readInt32LE(52),
  };
}

interface VtxHeader {
  version: number;
  bodyPartCount: number;
  bodyPartOffset: number;
  materialReplacementOffset: number;
  numLods: number;
}

function readVtxHeader(vtx: Buffer, checksum: number): VtxHeader | null {
  if (vtx.length < 36 || vtx.readInt32LE(0) !== 7) return null;
  if (vtx.readInt32LE(16) !== checksum) return null;
  return {
    version: vtx.readInt32LE(0),
    numLods: vtx.readInt32LE(20),
    materialReplacementOffset: vtx.readInt32LE(24),
    bodyPartCount: vtx.readInt32LE(28),
    bodyPartOffset: vtx.readInt32LE(32),
  };
}

/** Every material path the model header names, resolved through the skin table. */
function readMaterials(mdl: Buffer, header: MdlHeader): { materials: string[]; skins: number[][] } {
  // `mstudiomaterialdir_t` is a table of absolute offsets to directory strings; a material
  // name is relative to its directory. A material that already carries a full path (some
  // tools write `models/props_doors/...`) has an empty or absent directory entry.
  const materialDirs: string[] = [];
  const materialDirCount = mdl.readInt32LE(212);
  const materialDirOffset = mdl.readInt32LE(216);
  for (let i = 0; i < materialDirCount; i += 1) {
    const at = materialDirOffset + i * 4;
    if (at + 4 > mdl.length) break;
    const offset = mdl.readInt32LE(at);
    materialDirs.push(offset > 0 && offset < mdl.length ? readName(mdl, offset) : "");
  }

  const materials: string[] = [];
  for (let i = 0; i < header.materialCount; i += 1) {
    const base = header.materialOffset + i * 64;
    if (base + 64 > mdl.length) break;
    const name = readName(mdl, base + mdl.readInt32LE(base)).replace(/\\/g, "/");
    const dir = (materialDirs[i] ?? materialDirs[0] ?? "").replace(/\\/g, "/");
    const joined = dir && !name.startsWith("models/") && !name.startsWith("materials/")
      ? `${dir.replace(/\/?$/, "/")}${name}`
      : name;
    materials.push(joined);
  }
  const skins: number[][] = [];
  for (let family = 0; family < header.skinFamilyCount; family += 1) {
    const row: number[] = [];
    for (let i = 0; i < header.skinCount; i += 1) {
      const at = header.skinOffset + (family * header.skinCount + i) * 2;
      if (at + 2 > mdl.length) break;
      row.push(mdl.readInt16LE(at));
    }
    skins.push(row);
  }
  return { materials, skins };
}

/**
 * The material paths a `.mdl` names, without opening its `.vvd`/`.vtx`.
 *
 * A catalog only needs the header and material table; `parseModelGeometry` would read the
 * vertex data too. This reuses the same `readMdlHeader`/`readMaterials` pair the full reader
 * uses, so a catalog and a geometry read cannot disagree about a material.
 */
export function readModelMaterials(mdl: Buffer): string[] {
  const header = readMdlHeader(mdl);
  if (!header) return [];
  return readMaterials(mdl, header).materials;
}

interface MdMesh {
  materialIndex: number;
  /** Vertex count per LOD. Index 0 is LOD 0. */
  lodVertexCounts: number[];
  flexes: MdlFlex[];
}

interface MdModel {
  name: string;
  meshes: MdMesh[];
}

interface MdBodyPart {
  name: string;
  modelCount: number;
  /** Mixed-radix base for bodygroup presets. */
  base: number;
  models: MdModel[];
}

function readBodyParts(mdl: Buffer, header: MdlHeader): MdBodyPart[] {
  const parts: MdBodyPart[] = [];
  for (let i = 0; i < header.bodyPartCount; i += 1) {
    const base = header.bodyPartOffset + i * 16;
    if (base + 16 > mdl.length) break;
    const name = readName(mdl, base + mdl.readInt32LE(base), base + 16);
    const modelCount = mdl.readInt32LE(base + 4);
    const partBase = mdl.readInt32LE(base + 8);
    const modelsOffset = mdl.readInt32LE(base + 12);
    if (modelCount <= 0 || modelCount > 256) {
      parts.push({ name, modelCount, base: partBase, models: [] });
      continue;
    }
    const models: MdModel[] = [];
    for (let j = 0; j < modelCount; j += 1) {
      const model = base + modelsOffset + j * 148;
      if (model + 148 > mdl.length) break;
      const meshCount = mdl.readInt32LE(model + 72);
      const meshesOffset = mdl.readInt32LE(model + 76);
      const meshes: MdMesh[] = [];
      for (let k = 0; k < meshCount; k += 1) {
        const mesh = model + meshesOffset + k * 116;
        if (mesh + 116 > mdl.length) break;
        const lodVertexCounts: number[] = [];
        for (let lod = 0; lod < 8; lod += 1) {
          const at = mesh + 52 + lod * 4;
          if (at + 4 > mdl.length) break;
          lodVertexCounts.push(mdl.readInt32LE(at));
        }
        meshes.push({
          materialIndex: mdl.readInt32LE(mesh),
          lodVertexCounts,
          flexes: readMeshFlexes(mdl, mesh),
        });
      }
      models.push({
        name: readName(mdl, model, model + 64).replace(/\\/g, "/"),
        meshes,
      });
    }
    parts.push({ name, modelCount, base: partBase, models });
  }
  return parts;
}

/** Reads every VVD vertex once, in raw order. */
function readVvdVertices(vvd: Buffer, header: VvdHeader): ModelVertex[] {
  const vertices: ModelVertex[] = [];
  for (let i = 0; i < header.vertexCount; i += 1) {
    const at = header.verticesOffset + i * 48;
    if (at + 48 > vvd.length) break;
    const position: Vec3 = [vvd.readFloatLE(at + 16), vvd.readFloatLE(at + 20), vvd.readFloatLE(at + 24)];
    const normal: Vec3 = [vvd.readFloatLE(at + 28), vvd.readFloatLE(at + 32), vvd.readFloatLE(at + 36)];
    const uv: [number, number] = [vvd.readFloatLE(at + 40), vvd.readFloatLE(at + 44)];
    if (!isFiniteVec([...position, ...normal, ...uv])) continue;
    const weights: [number, number, number] = [
      vvd.readFloatLE(at),
      vvd.readFloatLE(at + 4),
      vvd.readFloatLE(at + 8),
    ];
    const bones: [number, number, number] = [
      vvd.readInt8(at + 12),
      vvd.readInt8(at + 13),
      vvd.readInt8(at + 14),
    ];
    const boneCount = Math.min(3, Math.max(0, vvd.readInt8(at + 15)));
    vertices.push({ position, normal, uv, bones, weights, boneCount });
  }
  return vertices;
}

/**
 * The fixed vertex list for one LOD.
 *
 * For LOD 0 every fixup applies; for LOD k only fixups with `lodIndex >= k` do. The VTX's
 * `meshVertexID` indexes this list, so using raw VVD order is wrong for any model with
 * fixups. A model without fixups keeps the raw order.
 */
function fixedVerticesForLod(
  vvd: Buffer,
  header: VvdHeader,
  raw: ModelVertex[],
  lodIndex: number,
): ModelVertex[] {
  if (header.fixupCount <= 0) return raw;
  const fixed: ModelVertex[] = [];
  for (let i = 0; i < header.fixupCount; i += 1) {
    const at = header.fixupsOffset + i * 12;
    if (at + 12 > vvd.length) break;
    const fixupLod = vvd.readInt32LE(at);
    const sourceVertexId = vvd.readInt32LE(at + 4);
    const vertexCount = vvd.readInt32LE(at + 8);
    if (fixupLod < lodIndex || sourceVertexId < 0 || vertexCount <= 0) continue;
    for (let j = 0; j < vertexCount; j += 1) {
      const vertex = raw[sourceVertexId + j];
      if (vertex) fixed.push(vertex);
    }
  }
  return fixed.length > 0 ? fixed : raw;
}

interface VtxMesh {
  /** Triangles as mesh-vertex ids (index into the mesh's LOD vertex range). */
  triangles: number[];
}

interface VtxLod {
  switchDistance: number;
  meshes: VtxMesh[];
  /** Material replacements for this LOD, by material id. */
  replacements: Map<number, string>;
  /** A strip group's `FLEXED` (0x1) or `DELTAFIXED` (0x4) flag is set. */
  usesFacial: boolean;
}

interface VtxModel {
  lods: VtxLod[];
}

/** One VTX body part: its alternatives in bodygroup-value order. */
interface VtxPart {
  models: VtxModel[];
}

function readMaterialReplacements(
  vtx: Buffer,
  header: VtxHeader,
  lodIndex: number,
): Map<number, string> {
  const replacements = new Map<number, string>();
  if (header.materialReplacementOffset <= 0) return replacements;
  const listBase = header.materialReplacementOffset + lodIndex * 8;
  if (listBase + 8 > vtx.length) return replacements;
  const count = vtx.readInt32LE(listBase);
  const offset = vtx.readInt32LE(listBase + 4);
  if (count <= 0) return replacements;
  // `replacementindex` is relative to the list record and is often negative: the records are
  // written before the list, so `listBase + offset` is the first one. The name offset is
  // relative to its own record and is negative for the same reason.
  const recordBase = listBase + offset;
  for (let i = 0; i < count; i += 1) {
    const at = recordBase + i * 6;
    if (at < 0 || at + 6 > vtx.length) break;
    const materialId = vtx.readInt16LE(at);
    const nameOffset = vtx.readInt32LE(at + 2);
    const name = readName(vtx, at + nameOffset);
    if (name) replacements.set(materialId, name);
  }
  return replacements;
}

/**
 * Parses VTX triangles for model 0 of each body part, all LODs.
 *
 * `hasTopology` selects the L4D2 strip group/strip layout with the two topology fields. The
 * caller tries the layout the file most likely uses and validates the result.
 */
interface VtxModelLods {
  lods: VtxLod[];
  valid: boolean;
  triangles: number;
}

/** Reads one `vtxModel_t` and every LOD it names. */
function readVtxModelLods(
  vtx: Buffer,
  header: VtxHeader,
  modelBase: number,
  groupHeaderSize: number,
  stripHeaderSize: number,
): VtxModelLods {
  const lodCount = Math.min(8, vtx.readInt32LE(modelBase));
  const lodOffset = vtx.readInt32LE(modelBase + 4);
  if (lodCount <= 0) return { lods: [], valid: true, triangles: 0 };
  const lodBase = modelBase + lodOffset;
  const lods: VtxLod[] = [];
  let triangleTotal = 0;
  let valid = true;

  for (let lodIndex = 0; lodIndex < lodCount; lodIndex += 1) {
    const lodAt = lodBase + lodIndex * 12;
    if (lodAt + 12 > vtx.length) {
      valid = false;
      break;
    }
    const meshCount = vtx.readInt32LE(lodAt);
    const meshOffset = vtx.readInt32LE(lodAt + 4);
    const switchDistance = vtx.readFloatLE(lodAt + 8);
    const replacements = readMaterialReplacements(vtx, header, lodIndex);
    const meshes: VtxMesh[] = [];
    let usesFacial = false;
    for (let meshIndex = 0; meshIndex < meshCount; meshIndex += 1) {
      const meshBase = lodAt + meshOffset + meshIndex * 9;
      if (meshBase + 9 > vtx.length) {
        valid = false;
        break;
      }
      const groupCount = vtx.readInt32LE(meshBase);
      const groupOffset = vtx.readInt32LE(meshBase + 4);
      const triangles: number[] = [];
      for (let group = 0; group < groupCount; group += 1) {
        const groupBase = meshBase + groupOffset + group * groupHeaderSize;
        if (groupBase + groupHeaderSize > vtx.length) {
          valid = false;
          break;
        }
        const vertexCount = vtx.readInt32LE(groupBase);
        const vertexOffset = vtx.readInt32LE(groupBase + 4);
        const indexCount = vtx.readInt32LE(groupBase + 8);
        const indexOffset = vtx.readInt32LE(groupBase + 12);
        const stripCount = vtx.readInt32LE(groupBase + 16);
        const stripOffset = vtx.readInt32LE(groupBase + 20);
        // `vtxStripGroup_t.flags`: FLEXED 0x01, DELTAFIXED 0x04. Either means `facial`.
        const groupFlags = vtx[groupBase + 24] ?? 0;
        if ((groupFlags & 0x05) !== 0) usesFacial = true;
        if (
          vertexCount < 0 ||
          indexCount < 0 ||
          stripCount < 0 ||
          vertexOffset < 0 ||
          indexOffset < 0 ||
          stripOffset < 0 ||
          (vertexCount > 0 && groupBase + vertexOffset + vertexCount * 9 > vtx.length) ||
          (indexCount > 0 && groupBase + indexOffset + indexCount * 2 > vtx.length)
        ) {
          valid = false;
          break;
        }
        if (vertexCount === 0 || indexCount === 0 || stripCount === 0) continue;

        // The strip group's own vertex array maps an index to a mesh vertex.
        const meshVertexIds: number[] = [];
        for (let v = 0; v < vertexCount; v += 1) {
          meshVertexIds.push(vtx.readUInt16LE(groupBase + vertexOffset + v * 9 + 4));
        }
        const indices: number[] = [];
        for (let n = 0; n < indexCount; n += 1) {
          indices.push(vtx.readUInt16LE(groupBase + indexOffset + n * 2));
        }

        for (let strip = 0; strip < stripCount; strip += 1) {
          const stripBase = groupBase + stripOffset + strip * stripHeaderSize;
          if (stripBase + stripHeaderSize > vtx.length) {
            valid = false;
            break;
          }
          const stripIndexCount = vtx.readInt32LE(stripBase);
          const stripIndexOffset = vtx.readInt32LE(stripBase + 4);
          const flags = vtx[stripBase + 18]!;
          if ((flags & 3) === 0 || stripIndexCount < 3) {
            valid = false;
            break;
          }
          const isTriStrip = (flags & 2) !== 0;
          const from = stripIndexOffset;
          const end = Math.min(indices.length, from + stripIndexCount);
          if (from < 0 || from + stripIndexCount > indices.length) {
            valid = false;
            break;
          }
          if (!isTriStrip) {
            for (let n = from; n + 2 < end; n += 3) {
              const a = meshVertexIds[indices[n]!];
              const b = meshVertexIds[indices[n + 1]!];
              const c = meshVertexIds[indices[n + 2]!];
              if (a === undefined || b === undefined || c === undefined) continue;
              triangles.push(a, b, c);
              triangleTotal += 1;
            }
          } else {
            for (let n = from; n + 2 < end; n += 1) {
              const a = meshVertexIds[indices[n]!];
              const b = meshVertexIds[indices[n + 1]!];
              const c = meshVertexIds[indices[n + 2]!];
              if (a === undefined || b === undefined || c === undefined) continue;
              // Alternating winding: odd triangles are the previous pair reversed.
              if ((n - from) % 2 === 1) triangles.push(b, a, c);
              else triangles.push(a, b, c);
              triangleTotal += 1;
            }
          }
        }
        if (!valid) break;
      }
      if (!valid) break;
      meshes.push({ triangles });
    }
    if (!valid) break;
    lods.push({ switchDistance, meshes, replacements, usesFacial });
  }
  return { lods, valid, triangles: triangleTotal };
}

function readVtxModel(
  vtx: Buffer,
  header: VtxHeader,
  hasTopology: boolean,
): { parts: VtxPart[]; valid: boolean; triangles: number } {
  const groupHeaderSize = hasTopology ? 33 : 25;
  const stripHeaderSize = hasTopology ? 35 : 27;
  const parts: VtxPart[] = [];
  let triangleTotal = 0;
  let valid = true;

  for (let part = 0; part < header.bodyPartCount; part += 1) {
    const partBase = header.bodyPartOffset + part * 8;
    if (partBase + 8 > vtx.length) {
      valid = false;
      break;
    }
    const modelCount = vtx.readInt32LE(partBase);
    const modelOffset = vtx.readInt32LE(partBase + 4);
    const partModels: VtxModel[] = [];
    if (modelCount <= 0) {
      parts.push({ models: [] });
      continue;
    }
    for (let modelIndex = 0; modelIndex < modelCount; modelIndex += 1) {
      const modelBase = partBase + modelOffset + modelIndex * 8;
      if (modelBase + 8 > vtx.length) {
        valid = false;
        break;
      }
      const read = readVtxModelLods(
        vtx,
        header,
        modelBase,
        groupHeaderSize,
        stripHeaderSize,
      );
      triangleTotal += read.triangles;
      if (!read.valid) {
        valid = false;
        break;
      }
      partModels.push({ lods: read.lods });
    }
    if (!valid) break;
    parts.push({ models: partModels });
  }

  if (triangleTotal === 0) valid = false;
  return { parts, valid, triangles: triangleTotal };
}

/**
 * Reads the VTX with both possible strip layouts and keeps the consistent one.
 *
 * L4D2 uses the larger layout; reading a file that does not have the extra fields with the
 * larger stride walks into vertex data and produces triangles that still look like a mesh,
 * so the validation is about offsets and index ranges, not about a version number.
 */
function readVtx(vtx: Buffer, header: VtxHeader): {
  parts: VtxPart[];
  topology: boolean;
  triangles: number;
} {
  const withTopology = readVtxModel(vtx, header, true);
  if (withTopology.valid) {
    return { parts: withTopology.parts, topology: true, triangles: withTopology.triangles };
  }
  const withoutTopology = readVtxModel(vtx, header, false);
  if (withoutTopology.valid) {
    return {
      parts: withoutTopology.parts,
      topology: false,
      triangles: withoutTopology.triangles,
    };
  }
  // Neither layout is fully consistent. Prefer the one that produced more triangles; a
  // partially readable model is more useful than an empty one, and the caller still reports
  // the triangle count.
  const chosen = withTopology.triangles >= withoutTopology.triangles ? withTopology : withoutTopology;
  return {
    parts: chosen.parts,
    topology: chosen === withTopology,
    triangles: chosen.triangles,
  };
}

/**
 * Turns one body-part model's MDL mesh records and VTX LOD meshes into renderable meshes.
 *
 * `startCursor` is the position in the fixed VVD vertex list where this model's vertices
 * begin; the returned cursor is where the next model starts. The VTX lists one mesh per MDL
 * mesh in order, and a mesh whose LOD has no vertices still advances the cursor.
 */
function buildModelMeshes(
  fixed: ModelVertex[],
  mdlMeshes: MdMesh[],
  vtxLod: VtxLod | undefined,
  lodIndex: number,
  startCursor: number,
): { meshes: ModelMesh[]; cursor: number } {
  const meshes: ModelMesh[] = [];
  let cursor = startCursor;
  let meshCursor = 0;
  for (const mesh of mdlMeshes) {
    const vtxMesh = vtxLod?.meshes[meshCursor];
    meshCursor += 1;
    const count = mesh.lodVertexCounts[lodIndex] ?? 0;
    if (count <= 0 || !vtxMesh) {
      cursor += Math.max(0, count);
      continue;
    }
    const start = cursor;
    const vertices = fixed.slice(start, start + count);
    cursor += count;
    // Drop whole triangles, never individual corners: filtering one index out of three
    // shifts every later triangle and produces a file the SMD parser rejects at `end`.
    const triangles: number[] = [];
    for (let t = 0; t + 2 < vtxMesh.triangles.length; t += 3) {
      const a = vtxMesh.triangles[t]!;
      const b = vtxMesh.triangles[t + 1]!;
      const c = vtxMesh.triangles[t + 2]!;
      if (a >= vertices.length || b >= vertices.length || c >= vertices.length) continue;
      triangles.push(a, b, c);
    }
    if (triangles.length < 3 || vertices.length === 0) continue;
    const replacement = vtxLod?.replacements.get(mesh.materialIndex);
    const flexes =
      lodIndex === 0 && mesh.flexes.length > 0
        ? mesh.flexes.map((flex) => ({
            ...flex,
            vertices: flex.vertices.map((vertex) => ({
              ...vertex,
              index: vertex.index + start,
            })),
          }))
        : undefined;
    meshes.push({
      materialIndex: mesh.materialIndex,
      ...(replacement ? { materialOverride: replacement } : {}),
      vertices,
      triangles,
      vertexStart: start,
      ...(flexes ? { flexes } : {}),
    });
  }
  return { meshes, cursor };
}

/**
 * Builds renderable geometry from the three files. Null when any header is wrong or the
 * checksums disagree, so a mismatched `.vvd`/`.vtx` pair is refused rather than drawn as a
 * different model's mesh.
 */
/**
 * Decodes the v49 `$bodygrouppreset` table.
 *
 * A preset is a mixed-radix number: the mask says which multi-model parts participate,
 * `base` is the radix, and `value` carries one digit per participating part. Crowbar's
 * `WriteBodyGroupPresetCommand` walks the parts backwards and subtracts `base` from the mask
 * and the value; that is the only published description of the encoding, and it is what this
 * function implements. Records are 12 bytes at header offset 448; the name offset is relative
 * to the record, and the two header fields are at 444 (count) and 448 (offset).
 */
function readBodyGroupPresets(
  mdl: Buffer,
  parts: readonly ModelBodyPart[],
): ModelBodyGroupPreset[] {
  if (mdl.length < 452) return [];
  const count = mdl.readInt32LE(444);
  const offset = mdl.readInt32LE(448);
  if (count <= 0 || count > 1024 || offset <= 0 || offset + 12 > mdl.length) return [];
  const presets: ModelBodyGroupPreset[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = offset + i * 12;
    if (at + 12 > mdl.length) break;
    const nameOffset = mdl.readInt32LE(at);
    const value = mdl.readInt32LE(at + 4);
    const mask = mdl.readInt32LE(at + 8);
    const name = nameOffset > 0 ? readName(mdl, at + nameOffset) : "";
    let accumMask = mask;
    let accumValue = value;
    const selected: Array<{ part: string; index: number }> = [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]!;
      if (part.models.length <= 1 || accumMask < part.base) continue;
      accumMask -= part.base;
      let index = 0;
      while (accumValue >= part.base) {
        index += 1;
        accumValue -= part.base;
      }
      selected.unshift({ part: part.name, index });
    }
    presets.push({ name, value, mask, parts: selected });
  }
  return presets;
}

export function parseModelGeometry(mdl: Buffer, vvd: Buffer, vtx: Buffer): ModelGeometry | null {
  const header = readMdlHeader(mdl);
  if (!header) return null;
  const vvdHeader = readVvdHeader(vvd, header.checksum);
  const vtxHeader = readVtxHeader(vtx, header.checksum);
  if (!vvdHeader || !vtxHeader) return null;

  const { materials, skins } = readMaterials(mdl, header);
  const bodyParts = readBodyParts(mdl, header);
  const rawVertices = readVvdVertices(vvd, vvdHeader);
  const { parts: vtxParts, topology, triangles: vtxTriangles } = readVtx(vtx, vtxHeader);
  if (vtxTriangles === 0) return null;

  const lodCount = Math.max(
    1,
    ...vtxParts.flatMap((part) => part.models.map((model) => model.lods.length)),
  );

  // Build every LOD of every bodygroup alternative in one pass. The fixed VVD list is
  // ordered by body part then by model, which the MDL `vertexindex` byte offsets confirm, so
  // one cursor per LOD walks all alternatives.
  const modelLods: Array<Array<Array<ModelLod | null>>> = bodyParts.map((part) =>
    part.models.map(() => []),
  );
  let lod0Vertices: ModelVertex[] = [];
  for (let lodIndex = 0; lodIndex < lodCount; lodIndex += 1) {
    const fixed = fixedVerticesForLod(vvd, vvdHeader, rawVertices, lodIndex);
    if (lodIndex === 0) lod0Vertices = fixed;
    let vertexCursor = 0;
    for (let partIndex = 0; partIndex < bodyParts.length; partIndex += 1) {
      const part = bodyParts[partIndex]!;
      for (let modelIndex = 0; modelIndex < part.models.length; modelIndex += 1) {
        const model = part.models[modelIndex]!;
        const vtxLod = vtxParts[partIndex]?.models[modelIndex]?.lods[lodIndex];
        const built = buildModelMeshes(fixed, model.meshes, vtxLod, lodIndex, vertexCursor);
        vertexCursor = built.cursor;
        if (!vtxLod) {
          modelLods[partIndex]![modelIndex]!.push(null);
          continue;
        }
        const triangleCount = built.meshes.reduce(
          (sum, mesh) => sum + mesh.triangles.length / 3,
          0,
        );
        modelLods[partIndex]![modelIndex]!.push({
          switchDistance: vtxLod.switchDistance,
          meshes: built.meshes,
          triangleCount,
          usesFacial: vtxLod.usesFacial,
          materialReplacements: [...vtxLod.replacements.entries()].map(
            ([materialIndex, replacement]) => ({ materialIndex, replacement }),
          ),
        });
      }
    }
  }

  // Flatten model 0 of each part into `lods`, which is what the preview and the simple QC
  // path use.
  const lods: ModelLod[] = [];
  for (let lodIndex = 0; lodIndex < lodCount; lodIndex += 1) {
    const meshes: ModelMesh[] = [];
    let switchDistance = 0;
    const lodModels: ModelLod[] = [];
    for (let partIndex = 0; partIndex < bodyParts.length; partIndex += 1) {
      const lod = modelLods[partIndex]?.[0]?.[lodIndex];
      if (!lod) continue;
      switchDistance = lod.switchDistance;
      meshes.push(...lod.meshes);
      lodModels.push(lod);
    }
    if (lodIndex > 0 && meshes.length === 0) continue;
    const replacementByKey = new Map<string, ModelMaterialReplacement>();
    for (const model of lodModels) {
      for (const replacement of model.materialReplacements) {
        replacementByKey.set(
          `${replacement.materialIndex}:${replacement.replacement}`,
          replacement,
        );
      }
    }
    lods.push({
      switchDistance,
      meshes,
      triangleCount: meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 3, 0),
      usesFacial: lodModels.some((model) => model.usesFacial),
      materialReplacements: [...replacementByKey.values()],
    });
  }

  if (lods.length === 0 || lods[0]!.meshes.length === 0) return null;

  const modelBodyParts: ModelBodyPart[] = [];
  for (let partIndex = 0; partIndex < bodyParts.length; partIndex += 1) {
    const part = bodyParts[partIndex]!;
    const models: ModelBodyPartModel[] = [];
    for (let modelIndex = 0; modelIndex < part.models.length; modelIndex += 1) {
      const model = part.models[modelIndex]!;
      const lodList = modelLods[partIndex]?.[modelIndex] ?? [];
      const lod0 = lodList[0] ?? null;
      models.push({
        name: model.name || `model_${modelIndex}`,
        lods: lodList,
        meshes: lod0?.meshes ?? [],
        triangleCount: lod0?.triangleCount ?? 0,
      });
    }
    if (models.length > 0) {
      modelBodyParts.push({
        name: part.name || `bodypart_${partIndex}`,
        base: part.base,
        models,
      });
    }
  }

  const centre: Vec3 = [
    (header.hullMin[0] + header.hullMax[0]) / 2,
    (header.hullMin[1] + header.hullMax[1]) / 2,
    (header.hullMin[2] + header.hullMax[2]) / 2,
  ];
  const radius = Math.max(
    1,
    Math.hypot(
      header.hullMax[0] - centre[0],
      header.hullMax[1] - centre[1],
      header.hullMax[2] - centre[2],
    ),
  );
  return {
    name: readName(mdl, 12),
    hullMin: header.hullMin,
    hullMax: header.hullMax,
    radius,
    materials,
    skins,
    lods,
    meshes: lods[0]!.meshes,
    bodyParts: modelBodyParts,
    presets: readBodyGroupPresets(mdl, modelBodyParts),
    lod0Vertices,
    flex: readFlexHeader(mdl),
    vertexCount: rawVertices.length,
    triangleCount: lods[0]!.triangleCount,
    fixupCount: vvdHeader.fixupCount,
    vtxTopology: topology,
  };
}

/** The material a mesh draws with under a skin family; falls back to the mesh's own index. */
export function materialIndexForSkin(geometry: ModelGeometry, materialIndex: number, skin: number): number {
  const family = geometry.skins[skin] ?? geometry.skins[0];
  if (!family) return materialIndex;
  const mapped = family[materialIndex];
  return mapped === undefined ? materialIndex : mapped;
}
