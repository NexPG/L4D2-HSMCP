/**
 * Reading a compiled map's faces: what vbsp actually made of a side.
 *
 * `read_vmf_surfaces` reads the source; this reads the result. They answer different
 * questions and the difference is the point. A `.vmf` says `"lightmapscale" "32"` and
 * `"smoothing_groups" "4096"`; the BSP says how many luxels the face got and which bitmask
 * vrad will read. A writer can be wrong in a way only the compiler exposes -- a scale that
 * pushed a face over the per-axis cap, a smoothing mask with the wrong shift -- and neither
 * is visible in the source after the fact.
 *
 * The chain is the same one `readMaterials` walks, with the face attached:
 *
 *   `dface.texinfo` -> `texinfo.texdata` -> `dtexdata.nameStringTableID`
 *   -> `TEXDATA_STRING_TABLE[id]` -> a NUL-terminated name in `TEXDATA_STRING_DATA`
 *
 * `dface_t` is 56 bytes for the BSP version this server reads, and its `smoothingGroups`
 * field sits at byte 52, after the two `short`s that were appended in later Source
 * versions. Reading it at the old offset returns a plausible small number, which is the
 * kind of wrong a check like this exists to catch.
 */
import { BspFormatError, readAt, readHeader, requireLump } from "./header.js";
import type { BspHeader, BspLump } from "./header.js";
import { readMaterials } from "./materials.js";

const LUMP_FACES = 7;
const LUMP_TEXINFO = 6;

/** `dface_t`: 56 bytes, unchanged since the Source 2007 BSP version this server reads. */
const FACE_BYTES = 56;
/** `texinfo_t`: two 4-float vectors, flags, texdata. */
const TEXINFO_BYTES = 72;

export type Vec4 = [number, number, number, number];

export interface FaceSurface {
  index: number;
  /** Resolved texture name as the `.vmf` would store it, lower case. */
  material: string;
  texinfo: number;
  plane: number;
  side: number;
  /** The bitmask vrad reads. One bit per Hammer group: group 13 is 4096. */
  smoothingGroups: number;
  /** Face polygon area in Hammer units^2, as vbsp computed it. */
  area: number;
  /** `-1` before vrad has written lightmap samples. */
  lightofs: number;
  /** `m_LightmapTextureSizeInLuxels`, which is the texture size minus one on each axis. */
  sizeLuxels: [number, number];
  /** `(sizeX + 1) * (sizeY + 1)`, the conventional luxel count. */
  luxels: number;
  /** `SURF_*` bits from the texinfo. */
  flags: number;
  /** The two texture vectors, in texels per unit plus offset. */
  textureVecs: [Vec4, Vec4];
}

export interface FacesReport {
  header: BspHeader;
  faceCount: number;
  /** Every face of the map, before the optional filter. */
  faces: FaceSurface[];
  /** How many faces each material covers, across the whole map. */
  materials: Array<{ name: string; faces: number }>;
  /** Faces the filter kept out of `faces`. */
  filtered: number;
  truncated: boolean;
}

export interface FaceFilter {
  /** Substring, case-insensitive, as the `.vmf` stores the material. */
  material?: string;
  /** Exact bitmask. Use `1 << (group - 1)` for one Hammer group. */
  smoothingGroups?: number;
  /** Maximum faces to return. Default 200. */
  limit?: number;
}

function guardLump(header: BspHeader, index: number, structBytes: number): BspLump {
  const lump = requireLump(header, index);
  if (lump.compressed) {
    throw new BspFormatError(
      `${header.path}: lump ${index} (${lump.name ?? index}) is individually LZMA-compressed; ` +
        `refusing rather than decoding compressed bytes as records. It declares ` +
        `${lump.declaredUncompressedBytes} uncompressed bytes, not verified here.`,
    );
  }
  if (lump.length % structBytes !== 0) {
    throw new BspFormatError(
      `${header.path}: lump ${index} (${lump.name ?? index}) is ${lump.length} bytes, not a ` +
        `multiple of the expected ${structBytes}-byte record; the layout differs in this ` +
        `BSP version`,
    );
  }
  return lump;
}

/**
 * Reads every face with its material, smoothing mask, lightmap footprint and texture
 * vectors.
 *
 * The four lumps are read by offset, never the whole file: on a 1 GB map this is a few
 * megabytes at most, and the pakfile is not touched.
 */
export function readBspFaces(path: string, filter: FaceFilter = {}): FacesReport {
  const header = readHeader(path);
  const facesLump = guardLump(header, LUMP_FACES, FACE_BYTES);
  const texinfoLump = guardLump(header, LUMP_TEXINFO, TEXINFO_BYTES);

  // The material table is already decoded once, with its string table; reusing it keeps one
  // reader for one format rather than a second copy that can disagree about a bad offset.
  const materialReport = readMaterials(path);
  const nameByTexdata = new Map<number, string>();
  for (const material of materialReport.materials) {
    for (const texdata of material.texdataIndices) nameByTexdata.set(texdata, material.name);
  }

  const texinfoRaw = readAt(path, texinfoLump.offset, texinfoLump.length);
  const texinfoView = new DataView(texinfoRaw.buffer, texinfoRaw.byteOffset, texinfoRaw.byteLength);
  const texinfoCount = texinfoLump.length / TEXINFO_BYTES;

  interface TexinfoEntry {
    texdata: number;
    flags: number;
    vecs: [Vec4, Vec4];
  }
  const texinfos: TexinfoEntry[] = [];
  for (let i = 0; i < texinfoCount; i += 1) {
    const at = i * TEXINFO_BYTES;
    const vec = (offset: number): Vec4 => [
      texinfoView.getFloat32(at + offset, true),
      texinfoView.getFloat32(at + offset + 4, true),
      texinfoView.getFloat32(at + offset + 8, true),
      texinfoView.getFloat32(at + offset + 12, true),
    ];
    texinfos.push({
      texdata: texinfoView.getInt32(at + 68, true),
      flags: texinfoView.getInt32(at + 64, true),
      vecs: [vec(0), vec(16)],
    });
  }

  const facesRaw = readAt(path, facesLump.offset, facesLump.length);
  const facesView = new DataView(facesRaw.buffer, facesRaw.byteOffset, facesRaw.byteLength);
  const faceCount = facesLump.length / FACE_BYTES;

  const wantedMaterial = filter.material?.trim().toLowerCase();
  const wantedSmoothing = filter.smoothingGroups;
  const limit = filter.limit ?? 200;
  const counts = new Map<string, number>();
  const all: FaceSurface[] = [];

  for (let i = 0; i < faceCount; i += 1) {
    const at = i * FACE_BYTES;
    const texinfoIndex = facesView.getInt16(at + 10, true);
    const texinfo = texinfoIndex >= 0 && texinfoIndex < texinfos.length ? texinfos[texinfoIndex] : null;
    const material = texinfo
      ? (nameByTexdata.get(texinfo.texdata) ?? `(texdata ${texinfo.texdata})`)
      : `(texinfo ${texinfoIndex})`;
    counts.set(material, (counts.get(material) ?? 0) + 1);

    const sizeLuxels: [number, number] = [
      facesView.getInt32(at + 36, true),
      facesView.getInt32(at + 40, true),
    ];
    const face: FaceSurface = {
      index: i,
      material,
      texinfo: texinfoIndex,
      plane: facesView.getUint16(at, true),
      side: facesView.getUint8(at + 2),
      smoothingGroups: facesView.getUint32(at + 52, true),
      area: facesView.getFloat32(at + 24, true),
      lightofs: facesView.getInt32(at + 20, true),
      sizeLuxels,
      luxels:
        sizeLuxels[0] >= 0 && sizeLuxels[1] >= 0
          ? (sizeLuxels[0] + 1) * (sizeLuxels[1] + 1)
          : 0,
      flags: texinfo?.flags ?? 0,
      textureVecs: texinfo?.vecs ?? [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    };
    all.push(face);
  }

  const kept = all.filter((face) => {
    if (wantedMaterial && !face.material.toLowerCase().includes(wantedMaterial)) return false;
    if (wantedSmoothing !== undefined && face.smoothingGroups !== wantedSmoothing) return false;
    return true;
  });

  return {
    header,
    faceCount,
    faces: kept.slice(0, limit),
    materials: [...counts.entries()]
      .map(([name, faces]) => ({ name, faces }))
      .sort((a, b) => b.faces - a.faces || a.name.localeCompare(b.name)),
    filtered: all.length - kept.length,
    truncated: kept.length > limit,
  };
}
