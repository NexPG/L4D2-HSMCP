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
 * Only LOD 0 is read. A preview at one camera does not need the distance LODs, and reading
 * them all would triple the work for a picture that never uses two thirds of it.
 */
export type Vec3 = [number, number, number];

export interface ModelVertex {
  position: Vec3;
  normal: Vec3;
  uv: [number, number];
}

export interface ModelMesh {
  /** Index into `ModelGeometry.materials` before a skin remap. */
  materialIndex: number;
  vertices: ModelVertex[];
  /** Three indices per triangle, into `vertices`. */
  triangles: number[];
}

export interface ModelGeometry {
  name: string;
  hullMin: Vec3;
  hullMax: Vec3;
  /** Bounding radius from the hull centre, for prop-level culling. */
  radius: number;
  /** Model-space material paths, e.g. `models/props_junk/wood_crate001a`. */
  materials: string[];
  /** Skin family → one material index per material. Family 0 is the default skin. */
  skins: number[][];
  meshes: ModelMesh[];
  vertexCount: number;
  triangleCount: number;
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
}

function readVvdHeader(vvd: Buffer, checksum: number): VvdHeader | null {
  if (vvd.length < 64 || vvd.readInt32LE(0) !== IDSV) return null;
  if (vvd.readInt32LE(4) !== 4) return null;
  if (vvd.readInt32LE(8) !== checksum) return null;
  return {
    vertexCount: vvd.readInt32LE(16),
    verticesOffset: vvd.readInt32LE(56),
    tangentsOffset: vvd.readInt32LE(60),
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
    const dir = (materialDirs[i] ?? "").replace(/\\/g, "/");
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

interface MdMesh {
  materialIndex: number;
  /** First vertex in the VVD for this mesh. */
  vertexOffset: number;
  vertexCount: number;
}

interface MdBodyPart {
  modelCount: number;
  /** Meshes of model 0, the model a static prop uses. */
  meshes: MdMesh[];
}

function readBodyParts(mdl: Buffer, header: MdlHeader): MdBodyPart[] {
  const parts: MdBodyPart[] = [];
  for (let i = 0; i < header.bodyPartCount; i += 1) {
    const base = header.bodyPartOffset + i * 16;
    if (base + 16 > mdl.length) break;
    const modelCount = mdl.readInt32LE(base + 4);
    const modelsOffset = mdl.readInt32LE(base + 12);
    if (modelCount <= 0) {
      parts.push({ modelCount, meshes: [] });
      continue;
    }
    const model = base + modelsOffset;
    if (model + 148 > mdl.length) {
      parts.push({ modelCount, meshes: [] });
      continue;
    }
    const meshCount = mdl.readInt32LE(model + 72);
    const meshesOffset = mdl.readInt32LE(model + 76);
    const modelVertexOffset = mdl.readInt32LE(model + 84);
    const meshes: MdMesh[] = [];
    for (let j = 0; j < meshCount; j += 1) {
      const mesh = model + meshesOffset + j * 116;
      if (mesh + 116 > mdl.length) break;
      meshes.push({
        materialIndex: mdl.readInt32LE(mesh),
        vertexCount: mdl.readInt32LE(mesh + 8),
        vertexOffset: modelVertexOffset + mdl.readInt32LE(mesh + 12),
      });
    }
    parts.push({ modelCount, meshes });
  }
  return parts;
}

/** Reads LOD 0 vertices as position/normal/uv, in VVD order. */
function readVvdVertices(vvd: Buffer, header: VvdHeader): ModelVertex[] {
  const vertices: ModelVertex[] = [];
  for (let i = 0; i < header.vertexCount; i += 1) {
    const at = header.verticesOffset + i * 48;
    if (at + 48 > vvd.length) break;
    const position: Vec3 = [vvd.readFloatLE(at + 16), vvd.readFloatLE(at + 20), vvd.readFloatLE(at + 24)];
    const normal: Vec3 = [vvd.readFloatLE(at + 28), vvd.readFloatLE(at + 32), vvd.readFloatLE(at + 36)];
    const uv: [number, number] = [vvd.readFloatLE(at + 40), vvd.readFloatLE(at + 44)];
    if (!isFiniteVec([...position, ...normal, ...uv])) continue;
    vertices.push({ position, normal, uv });
  }
  return vertices;
}

interface VtxMesh {
  /** Triangles as mesh-vertex ids (index into the mesh's VVD range). */
  triangles: number[];
  /** Material replacements for LOD 0, by material id. */
  replacements: Map<number, string>;
}

/**
 * Reads every LOD-0 strip of every mesh and flattens it to triangles.
 *
 * A strip group's indices address its own vertex list, whose entries carry `meshVertexID`
 * into the VVD. Tri-strips alternate their winding, so the second triangle of every pair is
 * emitted reversed; a strip is not a triangle list and treating it as one produces a fan.
 */
function readVtx(vtx: Buffer, header: VtxHeader): {
  meshes: VtxMesh[];
  materialReplacements: Map<number, string>;
} {
  const materialReplacements = new Map<number, string>();
  if (header.materialReplacementOffset > 0 && header.numLods > 0) {
    const list = header.materialReplacementOffset;
    const count = vtx.readInt32LE(list);
    const offset = vtx.readInt32LE(list + 4);
    for (let i = 0; i < count; i += 1) {
      const at = offset + i * 6;
      if (at + 6 > vtx.length) break;
      const materialId = vtx.readInt16LE(at);
      materialReplacements.set(materialId, readName(vtx, at + 6));
    }
  }

  const meshes: VtxMesh[] = [];
  for (let part = 0; part < header.bodyPartCount; part += 1) {
    const partBase = header.bodyPartOffset + part * 8;
    if (partBase + 8 > vtx.length) break;
    const modelCount = vtx.readInt32LE(partBase);
    const modelOffset = vtx.readInt32LE(partBase + 4);
    if (modelCount <= 0) continue;
    const modelBase = partBase + modelOffset;
    if (modelBase + 8 > vtx.length) continue;
    const lodCount = vtx.readInt32LE(modelBase);
    const lodOffset = vtx.readInt32LE(modelBase + 4);
    if (lodCount <= 0) continue;
    const lodBase = modelBase + lodOffset;
    if (lodBase + 12 > vtx.length) continue;
    const meshCount = vtx.readInt32LE(lodBase);
    const meshOffset = vtx.readInt32LE(lodBase + 4);
    for (let meshIndex = 0; meshIndex < meshCount; meshIndex += 1) {
      const meshBase = lodBase + meshOffset + meshIndex * 9;
      if (meshBase + 9 > vtx.length) break;
      const groupCount = vtx.readInt32LE(meshBase);
      const groupOffset = vtx.readInt32LE(meshBase + 4);
      const triangles: number[] = [];
      for (let group = 0; group < groupCount; group += 1) {
        const groupBase = meshBase + groupOffset + group * 33;
        if (groupBase + 33 > vtx.length) break;
        const vertexCount = vtx.readInt32LE(groupBase);
        const vertexOffset = vtx.readInt32LE(groupBase + 4);
        const indexCount = vtx.readInt32LE(groupBase + 8);
        const indexOffset = vtx.readInt32LE(groupBase + 12);
        const stripCount = vtx.readInt32LE(groupBase + 16);
        const stripOffset = vtx.readInt32LE(groupBase + 20);

        // The strip group's own vertex array maps an index to a mesh vertex.
        const meshVertexIds: number[] = [];
        for (let v = 0; v < vertexCount; v += 1) {
          const at = groupBase + vertexOffset + v * 9;
          if (at + 9 > vtx.length) break;
          meshVertexIds.push(vtx.readUInt16LE(at + 4));
        }

        const indices: number[] = [];
        for (let n = 0; n < indexCount; n += 1) {
          const at = groupBase + indexOffset + n * 2;
          if (at + 2 > vtx.length) break;
          indices.push(vtx.readUInt16LE(at));
        }

        for (let strip = 0; strip < stripCount; strip += 1) {
          const stripBase = groupBase + stripOffset + strip * 35;
          if (stripBase + 35 > vtx.length) break;
          const stripIndexCount = vtx.readInt32LE(stripBase);
          const stripIndexOffset = vtx.readInt32LE(stripBase + 4);
          const flags = vtx[stripBase + 26]!;
          // flags bit 0 = triangle list, bit 1 = triangle strip.
          const isTriStrip = (flags & 2) !== 0;
          const from = stripIndexOffset;
          const end = Math.min(indices.length, from + stripIndexCount);
          if (!isTriStrip) {
            for (let n = from; n + 2 < end; n += 3) {
              const a = meshVertexIds[indices[n]!];
              const b = meshVertexIds[indices[n + 1]!];
              const c = meshVertexIds[indices[n + 2]!];
              if (a === undefined || b === undefined || c === undefined) continue;
              triangles.push(a, b, c);
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
            }
          }
        }
      }
      meshes.push({ triangles, replacements: materialReplacements });
    }
  }
  return { meshes, materialReplacements };
}

/**
 * Builds renderable geometry from the three files. Null when any header is wrong or the
 * checksums disagree, so a mismatched `.vvd`/`.vtx` pair is refused rather than drawn as a
 * different model's mesh.
 */
export function parseModelGeometry(mdl: Buffer, vvd: Buffer, vtx: Buffer): ModelGeometry | null {
  const header = readMdlHeader(mdl);
  if (!header) return null;
  const vvdHeader = readVvdHeader(vvd, header.checksum);
  const vtxHeader = readVtxHeader(vtx, header.checksum);
  if (!vvdHeader || !vtxHeader) return null;

  const { materials, skins } = readMaterials(mdl, header);
  const bodyParts = readBodyParts(mdl, header);
  const vvdVertices = readVvdVertices(vvd, vvdHeader);
  const { meshes: vtxMeshes } = readVtx(vtx, vtxHeader);

  const meshes: ModelMesh[] = [];
  // The VTX lists one mesh per model mesh in body-part order; align the two by position,
  // not by name, because the header has no mesh names.
  let meshCursor = 0;
  for (const part of bodyParts) {
    for (const mesh of part.meshes) {
      const vtxMesh = vtxMeshes[meshCursor];
      meshCursor += 1;
      if (!vtxMesh) continue;
      const vertices = vvdVertices.slice(mesh.vertexOffset, mesh.vertexOffset + mesh.vertexCount);
      const triangles = vtxMesh.triangles.filter((index) => index < vertices.length);
      if (triangles.length < 3 || vertices.length === 0) continue;
      meshes.push({ materialIndex: mesh.materialIndex, vertices, triangles });
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
  const triangleCount = meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 3, 0);
  if (meshes.length === 0) return null;
  return {
    name: readName(mdl, 12),
    hullMin: header.hullMin,
    hullMax: header.hullMax,
    radius,
    materials,
    skins,
    meshes,
    vertexCount: vvdVertices.length,
    triangleCount,
  };
}

/** The material a mesh draws with under a skin family; falls back to the mesh's own index. */
export function materialIndexForSkin(geometry: ModelGeometry, materialIndex: number, skin: number): number {
  const family = geometry.skins[skin] ?? geometry.skins[0];
  if (!family) return materialIndex;
  const mapped = family[materialIndex];
  return mapped === undefined ? materialIndex : mapped;
}
