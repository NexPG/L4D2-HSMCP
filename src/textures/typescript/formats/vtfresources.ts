/**
 * VTF 7.3+ resources that are data, not pixels: the particle spritesheet and Strata's
 * hotspot rectangles.
 *
 * The reader in this project is `srctools.vtf`, and it stays the reader. Its `VTF.save()`
 * cannot be used for these edits: it decodes and re-encodes every mip through `Image`, so a
 * one-rectangle change would rewrite the whole image and DXT data could come back different.
 * What is written here is the resource directory and the resource block, byte-for-byte, and
 * everything the image occupies is left alone.
 *
 * Layout from Valve's `vtf.h`; the two payload formats are the structures `srctools.vtf`
 * parses (`SheetSequence` and `HotspotRect`), not a new interpretation of them.
 */

/** `ResourceID.LOW_RES`: the thumbnail block. Its data has no size prefix. */
export const VTF_RESOURCE_LOW_RES = 0x01;
/** `ResourceID.HIGH_RES`: the image block. Its data has no size prefix. */
export const VTF_RESOURCE_HIGH_RES = 0x30;
/** `ResourceID.PARTICLE_SHEET`: particle spritesheet sequences. */
export const VTF_RESOURCE_PARTICLE_SHEET = 0x10;
/** `ResourceID.STRATA_HOTSPOT`: Strata's `+` hotspot rectangles. */
export const VTF_RESOURCE_HOTSPOT = 0x2b;

/**
 * Offset of the resource count, measured from the file start.
 *
 * The table is not at a fixed 80: the fixed header is 7.4's 63 bytes plus a two-byte depth,
 * then `3xI8x` writes the count at 68 and the first entry at 80. `headerSize` is the one
 * authoritative end of the table.
 */
const RESOURCE_COUNT_OFFSET = 68;
/** Offset of the first 8-byte resource entry. */
const RESOURCE_ENTRIES_OFFSET = 80;
/** Size of one `<3sBI>` resource entry. */
const RESOURCE_ENTRY_SIZE = 8;
/** The inline flag: the entry's four-byte value is the data, not an offset. */
const RESOURCE_INLINE = 0x02;

export interface VtfResourceEntry {
  /** The three ID bytes as a little-endian number: `0x10` for the particle sheet. */
  id: number;
  idBytes: Buffer;
  flags: number;
  /** The entry's raw four-byte value: an offset, or an inline integer. */
  value: number;
  /** Byte offset of the 8-byte entry in the file. */
  entryOffset: number;
  /** Where the size-prefixed block lives, or null for an inline integer. */
  dataOffset: number | null;
  dataSize: number | null;
  /** The block's payload, without its size prefix. Null for an inline integer. */
  data: Buffer | null;
}

export interface VtfResourceTable {
  version: string;
  headerSize: number;
  count: number;
  entries: VtfResourceEntry[];
}

/**
 * Parses the resource directory of a 7.3+ VTF.
 *
 * LOW_RES and HIGH_RES are ordinary entries here: they are needed to move every offset when
 * the table grows. `srctools` treats them specially only because it decodes images.
 */
export function readVtfResourceTable(bytes: Buffer): VtfResourceTable {
  if (bytes.length < RESOURCE_ENTRIES_OFFSET || bytes.toString("latin1", 0, 4) !== "VTF\0") {
    throw new Error("not a VTF: the signature or the header is missing");
  }
  const major = bytes.readUInt32LE(4);
  const minor = bytes.readUInt32LE(8);
  if (major !== 7 || minor < 3) {
    throw new Error(
      `VTF ${major}.${minor} has no resource directory; these resources exist from 7.3`,
    );
  }
  const headerSize = bytes.readUInt32LE(12);
  if (headerSize > bytes.length) {
    throw new Error(`the header claims ${headerSize} bytes in a ${bytes.length}-byte file`);
  }
  const count = bytes.readUInt32LE(RESOURCE_COUNT_OFFSET);
  if (RESOURCE_ENTRIES_OFFSET + count * RESOURCE_ENTRY_SIZE > headerSize) {
    throw new Error(
      `${count} resource entries do not fit between offset ${RESOURCE_ENTRIES_OFFSET} ` +
        `and the header's ${headerSize} bytes`,
    );
  }
  const entries: VtfResourceEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = RESOURCE_ENTRIES_OFFSET + index * RESOURCE_ENTRY_SIZE;
    const idBytes = Buffer.from(bytes.subarray(entryOffset, entryOffset + 3));
    const id = idBytes[0]! | (idBytes[1]! << 8) | (idBytes[2]! << 16);
    const flags = bytes.readUInt8(entryOffset + 3);
    const value = bytes.readUInt32LE(entryOffset + 4);
    if ((flags & RESOURCE_INLINE) !== 0) {
      entries.push({
        id,
        idBytes,
        flags,
        value,
        entryOffset,
        dataOffset: null,
        dataSize: null,
        data: null,
      });
      continue;
    }
    if (value >= bytes.length) {
      throw new Error(`resource ${idBytes.toString("hex")} points past the end of the file`);
    }
    // The image blocks omit the size word: their length is implied by the header's format,
    // dimensions and mip count, and decoding that is the image reader's job, not this one's.
    if (id === VTF_RESOURCE_LOW_RES || id === VTF_RESOURCE_HIGH_RES) {
      entries.push({
        id,
        idBytes,
        flags,
        value,
        entryOffset,
        dataOffset: value,
        dataSize: null,
        data: null,
      });
      continue;
    }
    if (value + 4 > bytes.length) {
      throw new Error(`resource ${idBytes.toString("hex")} has no size word`);
    }
    const dataSize = bytes.readUInt32LE(value);
    if (value + 4 + dataSize > bytes.length) {
      throw new Error(
        `resource ${idBytes.toString("hex")} claims ${dataSize} bytes past the end of the file`,
      );
    }
    entries.push({
      id,
      idBytes,
      flags,
      value,
      entryOffset,
      dataOffset: value,
      dataSize,
      data: Buffer.from(bytes.subarray(value + 4, value + 4 + dataSize)),
    });
  }
  return { version: `${major}.${minor}`, headerSize, count, entries };
}

/** The payload of one resource, or null when the file does not carry it. */
export function readVtfResourcePayload(bytes: Buffer, id: number): Buffer | null {
  const table = readVtfResourceTable(bytes);
  return table.entries.find((entry) => entry.id === id)?.data ?? null;
}

/**
 * Replaces or appends one resource and returns the whole file.
 *
 * A new resource is inserted in ID order, because the directory is sorted; every external
 * offset then moves by the entry's eight bytes. The payload block is always appended at the
 * old end of the file. That leaves the image region untouched, including a block that an
 * edited resource used to occupy: it becomes unreferenced bytes, which is the price of not
 * re-encoding the image.
 */
export function writeVtfResource(bytes: Buffer, id: number, payload: Buffer): Buffer {
  const table = readVtfResourceTable(bytes);
  const existing = table.entries.find((entry) => entry.id === id);
  if (existing && (existing.flags & RESOURCE_INLINE) !== 0) {
    throw new Error(
      `resource ${existing.idBytes.toString("hex")} is stored inline; ` +
        `this writer only replaces size-prefixed blocks`,
    );
  }

  let out: Buffer;
  let entryOffset: number;
  if (existing) {
    entryOffset = existing.entryOffset;
    out = Buffer.from(bytes);
  } else {
    const insertAt = table.entries.findIndex((entry) => entry.id > id);
    const index = insertAt === -1 ? table.entries.length : insertAt;
    const at = RESOURCE_ENTRIES_OFFSET + index * RESOURCE_ENTRY_SIZE;
    const entry = Buffer.alloc(RESOURCE_ENTRY_SIZE);
    entry.writeUIntLE(id, 0, 3);
    const shifted = Buffer.concat([bytes.subarray(0, at), entry, bytes.subarray(at)]);
    // The new entry has its own position; the old ones after it moved by eight bytes.
    for (const current of table.entries) {
      if (current.dataOffset === null) continue;
      const movedEntry = current.entryOffset + (current.entryOffset >= at ? RESOURCE_ENTRY_SIZE : 0);
      shifted.writeUInt32LE(current.dataOffset + RESOURCE_ENTRY_SIZE, movedEntry + 4);
    }
    shifted.writeUInt32LE(table.count + 1, RESOURCE_COUNT_OFFSET);
    shifted.writeUInt32LE(table.headerSize + RESOURCE_ENTRY_SIZE, 12);
    out = shifted;
    entryOffset = at;
  }

  // The block starts where the old file ended, after any table insertion.
  const blockOffset = out.length;
  out.writeUInt8(0, entryOffset + 3);
  out.writeUInt32LE(blockOffset >>> 0, entryOffset + 4);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  return Buffer.concat([out, size, payload]);
}

/** One particle-sheet frame: four corners, each `[left, top, right, bottom]`. */
export type VtfSheetFrameCoords = [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
];

export interface VtfSheetFrame {
  duration: number;
  coords: VtfSheetFrameCoords;
}

export interface VtfSheetSequence {
  sequence: number;
  clamp: boolean;
  duration: number;
  frames: VtfSheetFrame[];
}

/**
 * Builds a `ResourceID.PARTICLE_SHEET` payload.
 *
 * Version 1 stores all four texture coordinates per frame; version 0 repeats one. Both are
 * what `SheetSequence.from_resource` accepts, and the sequence number is the engine's own
 * animation index, not the array position.
 */
export function buildVtfParticleSheet(
  sequences: readonly VtfSheetSequence[],
  version: 0 | 1 = 1,
): Buffer {
  if (sequences.length === 0) throw new Error("a particle sheet needs at least one sequence");
  if (sequences.length > 64) throw new Error("a particle sheet holds at most 64 sequences");
  const seen = new Set<number>();
  for (const sequence of sequences) {
    if (!Number.isInteger(sequence.sequence) || sequence.sequence < 0 || sequence.sequence > 63) {
      throw new Error(`sequence number ${sequence.sequence} is outside 0..63`);
    }
    if (seen.has(sequence.sequence)) {
      throw new Error(`sequence ${sequence.sequence} is listed twice`);
    }
    seen.add(sequence.sequence);
    if (sequence.frames.length === 0) {
      throw new Error(`sequence ${sequence.sequence} has no frames`);
    }
    if (!Number.isFinite(sequence.duration) || sequence.duration < 0) {
      throw new Error(`sequence ${sequence.sequence} duration must be a non-negative number`);
    }
  }

  const sorted = [...sequences].sort((a, b) => a.sequence - b.sequence);
  const parts: Buffer[] = [];
  const u32 = (value: number): void => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value >>> 0);
    parts.push(buffer);
  };
  const f32 = (value: number): void => {
    const buffer = Buffer.alloc(4);
    buffer.writeFloatLE(value);
    parts.push(buffer);
  };
  u32(version);
  u32(sorted.length);
  for (const sequence of sorted) {
    u32(sequence.sequence);
    parts.push(Buffer.alloc(3));
    parts.push(Buffer.from([sequence.clamp ? 1 : 0]));
    u32(sequence.frames.length);
    f32(sequence.duration);
    for (const frame of sequence.frames) {
      if (!Number.isFinite(frame.duration) || frame.duration < 0) {
        throw new Error(
          `sequence ${sequence.sequence} has a frame with a negative or non-finite duration`,
        );
      }
      f32(frame.duration);
      const count = version === 1 ? 4 : 1;
      for (let corner = 0; corner < count; corner += 1) {
        const coords = frame.coords[corner]!;
        for (const value of coords) f32(value);
      }
    }
  }
  return Buffer.concat(parts);
}

/** Reads the version byte of an existing particle-sheet payload, or null when absent. */
export function particleSheetVersion(payload: Buffer | null): 0 | 1 | null {
  if (payload === null || payload.length < 4) return null;
  const version = payload.readUInt32LE(0);
  return version === 0 || version === 1 ? version : null;
}

export interface VtfHotspotRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  randomRotation: boolean;
  randomReflection: boolean;
  alternate: boolean;
}

/**
 * Builds a `ResourceID.STRATA_HOTSPOT` payload.
 *
 * The header is version 1, an implementation flags byte and the rectangle count; each
 * rectangle is a flags byte and four little-endian `uint16` pixel coordinates.
 */
export function buildVtfHotspot(rects: readonly VtfHotspotRect[], flags = 0): Buffer {
  if (rects.length === 0) throw new Error("a hotspot resource needs at least one rectangle");
  if (rects.length > 65535) throw new Error("a hotspot resource holds at most 65535 rectangles");
  if (!Number.isInteger(flags) || flags < 0 || flags > 255) {
    throw new Error(`hotspot flags must be a byte, got ${flags}`);
  }
  const parts: Buffer[] = [];
  const head = Buffer.alloc(4);
  head.writeUInt8(1, 0);
  head.writeUInt8(flags, 1);
  head.writeUInt16LE(rects.length, 2);
  parts.push(head);
  for (const rect of rects) {
    const flagsByte =
      (rect.randomRotation ? 0x1 : 0) |
      (rect.randomReflection ? 0x2 : 0) |
      (rect.alternate ? 0x4 : 0);
    const entry = Buffer.alloc(9);
    entry.writeUInt8(flagsByte, 0);
    for (const [index, value] of [rect.minX, rect.minY, rect.maxX, rect.maxY].entries()) {
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error(`hotspot coordinate ${value} is not a 16-bit unsigned integer`);
      }
      entry.writeUInt16LE(value, 1 + index * 2);
    }
    parts.push(entry);
  }
  return Buffer.concat(parts);
}

/** The implementation flags byte of an existing hotspot payload, or 0 when absent. */
export function hotspotFlags(payload: Buffer | null): number {
  if (payload === null || payload.length < 4 || payload.readUInt8(0) !== 1) return 0;
  return payload.readUInt8(1);
}
