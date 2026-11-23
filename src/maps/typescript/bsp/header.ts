import { closeSync, openSync, readSync, statSync } from "node:fs";

/**
 * `VBSP` header: ident[4] + version + lump_t[64] + mapRevision.
 *
 * `lump_t` is normally `{ int fileofs; int filelen; int version; char fourCC[4] }`, 16
 * bytes. **Left 4 Dead 2 stores the same fields in a different order**: version first,
 * then fileofs, then filelen. Read the normal way, every L4D2 map yields offsets of 0 and
 * record counts that look plausible and are wrong. Detected below, never assumed from the
 * version number alone: Portal 2 and CS:GO are also version 21 and use the normal order.
 */
export const HEADER_BYTES = 4 + 4 + 64 * 16 + 4; // 1036
export const LUMP_COUNT = 64;
/** Byte offset of mapRevision, in both layouts. */
export const MAP_REVISION_OFFSET = 4 + 4 + 64 * 16; // 1032

/** How this file orders the fields of `lump_t`. */
export type LumpLayout = "standard" | "l4d2";

/** Lump index for the entity list -- plain KeyValues text, NUL-terminated. */
export const LUMP_ENTITIES = 0;
/** Brush models. Model 0 is the world, and its bounding box is the map's real extent. */
export const LUMP_MODELS = 14;
/** The embedded ZIP: a map's custom assets. */
export const LUMP_PAKFILE = 40;

/**
 * Lump names, from `LUMP_*` in `src/public/bspfile.h` of source-sdk-2013, read 11/08/2026.
 *
 * Read from the header rather than remembered, because the HDR family is easy to get wrong
 * and wrong in a way that reads as right. Index 56 is **not** `LIGHTING_HDR` -- it is
 * `LEAF_AMBIENT_LIGHTING`, which is present in LDR maps too. Labelling it as HDR makes
 * every LDR map look HDR-compiled, and an audit of a map's lighting then concludes the
 * opposite of the truth with nothing to flag it. That mislabel shipped here and was caught
 * on three real maps.
 *
 * The five HDR-family lumps and their two indexes are all named, so that a caller reading
 * a lump directory can tell "this map has no HDR data" from "this tool does not know that
 * lump".
 *
 * `geometry.ts` derives its own names from this table. Two hand-maintained lists is what
 * let the two disagree in the first place, one of them silently.
 */
export const LUMP_NAMES: Readonly<Record<number, string>> = {
  0: "ENTITIES",
  1: "PLANES",
  2: "TEXDATA",
  3: "VERTEXES",
  4: "VISIBILITY",
  5: "NODES",
  6: "TEXINFO",
  7: "FACES",
  8: "LIGHTING",
  9: "OCCLUSION",
  10: "LEAFS",
  11: "FACEIDS",
  12: "EDGES",
  13: "SURFEDGES",
  14: "MODELS",
  15: "WORLDLIGHTS",
  16: "LEAFFACES",
  17: "LEAFBRUSHES",
  18: "BRUSHES",
  19: "BRUSHSIDES",
  20: "AREAS",
  21: "AREAPORTALS",
  22: "PORTALS",
  23: "CLUSTERS",
  24: "PORTALVERTS",
  25: "CLUSTERPORTALS",
  26: "DISPINFO",
  27: "ORIGINALFACES",
  28: "PHYSDISP",
  29: "PHYSCOLLIDE",
  30: "VERTNORMALS",
  31: "VERTNORMALINDICES",
  32: "DISP_LIGHTMAP_ALPHAS",
  33: "DISP_VERTS",
  34: "DISP_LIGHTMAP_SAMPLE_POSITIONS",
  35: "GAME_LUMP",
  36: "LEAFWATERDATA",
  37: "PRIMITIVES",
  38: "PRIMVERTS",
  39: "PRIMINDICES",
  40: "PAKFILE",
  41: "CLIPPORTALVERTS",
  42: "CUBEMAPS",
  43: "TEXDATA_STRING_DATA",
  44: "TEXDATA_STRING_TABLE",
  45: "OVERLAYS",
  46: "LEAFMINDISTTOWATER",
  47: "FACE_MACRO_TEXTURE_INFO",
  48: "DISP_TRIS",
  49: "PROP_BLOB",
  50: "WATEROVERLAYS",
  51: "LEAF_AMBIENT_INDEX_HDR",
  52: "LEAF_AMBIENT_INDEX",
  53: "LIGHTING_HDR",
  54: "WORLDLIGHTS_HDR",
  55: "LEAF_AMBIENT_LIGHTING_HDR",
  56: "LEAF_AMBIENT_LIGHTING",
  57: "XZIPPAKFILE",
  58: "FACES_HDR",
  59: "MAP_FLAGS",
  60: "OVERLAY_FADES",
};

/**
 * The lumps vrad writes only when it produced HDR lighting.
 *
 * All three empty means the map is LDR-only. Deliberately not index 56: it carries
 * per-visleaf ambient lighting and is present either way, which is exactly the trap this
 * constant exists to keep callers out of.
 */
export const HDR_LUMPS = [53, 54, 58] as const;

/** First four bytes of an individually compressed lump. */
export const LZMA_MAGIC = "LZMA";

export interface BspLump {
  index: number;
  name: string | undefined;
  offset: number;
  /** Bytes occupied in the file. For a compressed lump this is the COMPRESSED size. */
  length: number;
  version: number;
  fourCC: number;
  /**
   * Whether this lump is individually LZMA-compressed, read from its first four bytes.
   *
   * Source allows any lump to be compressed on its own. When it is, `length` counts
   * compressed bytes, so dividing it by a record size yields a plausible, wrong count --
   * and only sometimes an obviously wrong one, since a compressed length lands on a
   * multiple of the record size roughly one time in `bytes`.
   */
  compressed: boolean;
  /**
   * Uncompressed size a compressed lump DECLARES in its fourCC field. Null otherwise.
   *
   * Declared, not verified: checking it would mean decompressing, and nothing here does.
   * Reported so a caller can size the real data, never used to compute a record count.
   */
  declaredUncompressedBytes: number | null;
}

export interface BspHeader {
  path: string;
  ident: string;
  version: number;
  /** Which field order the lump directory used. L4D2 is the odd one. */
  layout: LumpLayout;
  mapRevision: number;
  fileSize: number;
  lumps: BspLump[];
}

export class BspFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BspFormatError";
  }
}

/** Reads exactly `length` bytes at `offset`, without mapping the file. */
export function readAt(path: string, offset: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    const got = readSync(fd, buf, 0, length, offset);
    if (got < length) return buf.subarray(0, got);
    return buf;
  } finally {
    closeSync(fd);
  }
}

/**
 * Reads a BSP header.
 *
 * Only the first 1036 bytes are touched, plus four bytes at the start of each non-empty
 * lump to see whether it is compressed. This matters more than it looks: the project's
 * own map is 1.13 GB, and a `readFileSync` inside an MCP server dies with the stdio
 * transport open, which the agent sees as a hang rather than an error.
 */
export function readHeader(path: string): BspHeader {
  const size = statSync(path).size;
  if (size < HEADER_BYTES) {
    throw new BspFormatError(`${path}: too small to be a BSP (${size} bytes)`);
  }

  const buf = readAt(path, 0, HEADER_BYTES);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  const ident = buf.subarray(0, 4).toString("ascii");
  if (ident !== "VBSP") {
    throw new BspFormatError(`${path}: not a VBSP file (ident ${JSON.stringify(ident)})`);
  }

  const version = view.getInt32(4, true);
  // 19 = HL2/EP1, 20 = Source 2007 onwards and Garry's Mod, 21 = L4D2/Portal 2 era.
  if (version < 19 || version > 21) {
    throw new BspFormatError(`${path}: unsupported BSP version ${version} (expected 19-21)`);
  }

  /**
   * The 64 descriptors, read in whichever order this file uses.
   *
   * A descriptor is sane when its version is a small number (lump versions are 0, 1, 2)
   * and its extent lies inside the file. L4D2's swapped order fails the first check when
   * read as standard -- the version slot holds an offset of hundreds of thousands -- and
   * the standard order fails it when read as L4D2 in the same way.
   */
  const descriptor = (i: number): { a: number; b: number; c: number; four: number } => {
    const at = 8 + i * 16;
    return {
      a: view.getInt32(at, true),
      b: view.getInt32(at + 4, true),
      c: view.getInt32(at + 8, true),
      four: view.getInt32(at + 12, true),
    };
  };
  const parseAs = (
    layout: LumpLayout,
    i: number,
  ): { offset: number; length: number; version: number; four: number } => {
    const { a, b, c, four } = descriptor(i);
    return layout === "l4d2"
      ? { version: a, offset: b, length: c, four }
      : { offset: a, length: b, version: c, four };
  };
  const sane = (layout: LumpLayout): boolean => {
    for (let i = 0; i < LUMP_COUNT; i++) {
      const { offset, length, version } = parseAs(layout, i);
      if (offset < 0 || length < 0 || version < 0 || version > 1024) return false;
      if (length === 0) continue;
      if (offset < HEADER_BYTES - 4 || offset + length > size) return false;
    }
    return true;
  };

  const standardSane = sane("standard");
  const l4d2Sane = sane("l4d2");
  if (!standardSane && !l4d2Sane) {
    throw new BspFormatError(
      `${path}: the lump directory fits neither field order; the file may be truncated`,
    );
  }
  // Left 4 Dead 2 is the only Source game known to put `version` first. Portal 2 and
  // CS:GO are also version 21 and use the standard order, so this is decided by what the
  // bytes say, not by the version number.
  const layout: LumpLayout = l4d2Sane && !standardSane ? "l4d2" : "standard";

  const lumps: BspLump[] = [];
  for (let i = 0; i < LUMP_COUNT; i++) {
    const { offset, length, four, version } = parseAs(layout, i);

    // Four bytes per non-empty lump. A compressed lump starts with the ASCII magic
    // "LZMA", and its fourCC carries the uncompressed size instead of a codec tag.
    const compressed =
      length >= 4 &&
      offset > 0 &&
      offset + 4 <= size &&
      readAt(path, offset, 4).toString("ascii") === LZMA_MAGIC;

    lumps.push({
      index: i,
      name: LUMP_NAMES[i],
      offset,
      length,
      version,
      fourCC: four,
      compressed,
      declaredUncompressedBytes: compressed ? four : null,
    });
  }

  return {
    path,
    ident,
    version,
    layout,
    mapRevision: view.getInt32(MAP_REVISION_OFFSET, true),
    fileSize: size,
    lumps,
  };
}

/**
 * Writes a lump's offset and length into the header, in the field order this file uses.
 *
 * The writer needs this because L4D2 swaps the descriptor fields: patching a "standard"
 * header on an L4D2 map writes the length where the offset belongs, and the map then reads
 * from the wrong place with no error. `readHeader` decides the layout; this applies it.
 */
export function setLumpDescriptor(
  bytes: Buffer,
  index: number,
  layout: LumpLayout,
  offset: number,
  length: number,
): void {
  const at = 8 + index * 16;
  if (at + 16 > bytes.length) {
    throw new BspFormatError(`cannot write lump ${index}: the header is only ${bytes.length} bytes`);
  }
  if (layout === "l4d2") {
    bytes.writeInt32LE(offset, at + 4);
    bytes.writeInt32LE(length, at + 8);
  } else {
    bytes.writeInt32LE(offset, at);
    bytes.writeInt32LE(length, at + 4);
  }
}

/** The lump descriptor for `index`, or throws when it is empty. */
export function requireLump(header: BspHeader, index: number): BspLump {
  const lump = header.lumps[index];
  if (!lump) throw new BspFormatError(`${header.path}: no lump ${index}`);
  if (lump.length <= 0) throw new BspFormatError(`${header.path}: lump ${index} is empty`);
  if (lump.offset + lump.length > header.fileSize) {
    throw new BspFormatError(
      `${header.path}: lump ${index} runs past end of file ` +
        `(${lump.offset}+${lump.length} > ${header.fileSize})`,
    );
  }
  return lump;
}
