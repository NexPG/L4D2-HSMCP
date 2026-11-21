/**
 * The compiled static-prop list: what vbsp baked out of every `prop_static`.
 *
 * A static prop is not an entity at runtime. vbsp removes the entity and writes a record into
 * the `sprp` game lump: the model, its origin and angles, a skin, a tint and a scale. A
 * renderer that reads only `FACES` therefore draws a map with every crate, door, car and
 * street lamp missing, and it will not say so unless it knows to look here.
 *
 * ## Where the records are
 *
 * The game lump (`LUMP_GAME_LUMP`, 35) is a small directory: a count, then 16-byte entries
 * of `id[4], flags u16, version u16, fileofs i32, filelen i32`. **L4D2 writes `fileofs` as
 * an absolute file offset**, where the Source SDK writes it relative to the game lump; both
 * are accepted below, because reading the wrong one either lands inside the lump (detected)
 * or outside the file (also detected).
 *
 * ## Why the stride is measured, not assumed
 *
 * The record grew over the engine's life: 56 bytes in HL2, 72 in L4D2 (version 9), 80 in
 * later CS:GO. The layout below reads the fields every version shares and checks the
 * measured stride before trusting it. L4D2 is fixed at 72 and that is what the tests pin.
 */
import { BspFormatError, readAt, readHeader } from "./header.js";

export const LUMP_GAME_LUMP = 35;
const LMP_ID_STATIC_PROPS = "sprp";

export interface StaticProp {
  /** Engine path, e.g. `models/props_junk/wood_crate001a.mdl`. */
  model: string;
  origin: [number, number, number];
  /** Source `QAngle`: pitch, yaw, roll, in degrees. */
  angles: [number, number, number];
  /** Per-axis scale; L4D2's version 9 stores no scale, so this is 1. */
  scale: [number, number, number];
  skin: number;
  /** Per-instance tint, 0..255; white when the record has no tint field. */
  tint: [number, number, number];
  solidity: number;
  flags: number;
  /** The `info_lighting` anchor when `HAS_LIGHTING_ORIGIN` is set. */
  lightingOrigin: [number, number, number];
}

export interface StaticPropList {
  /** Every model the lump's dictionary names, in index order. */
  models: string[];
  props: StaticProp[];
  /** Game-lump version the records were read with, for the report. */
  version: number;
  /** Bytes per record, measured from the lump rather than assumed. */
  stride: number;
}

interface GameLumpEntry {
  id: string;
  version: number;
  offset: number;
  length: number;
}

function gameLumpEntries(path: string): GameLumpEntry[] {
  const header = readHeader(path);
  const lump = header.lumps[LUMP_GAME_LUMP];
  if (!lump || lump.length < 4) return [];
  const bytes = readAt(path, lump.offset, lump.length);
  const count = bytes.readInt32LE(0);
  if (count <= 0 || count > 1024) return [];
  const entries: GameLumpEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = 4 + i * 16;
    if (base + 16 > bytes.length) break;
    const fileofs = bytes.readInt32LE(base + 8);
    const filelen = bytes.readInt32LE(base + 12);
    // L4D2 stores absolute offsets; the SDK stores lump-relative ones. Inside the lump, the
    // two are unambiguous: an offset below the lump start and inside its extent is relative.
    const absolute =
      fileofs >= lump.offset && fileofs + filelen <= header.fileSize
        ? fileofs
        : lump.offset + fileofs;
    entries.push({
      // The id is an `int` made from four chars; little-endian memory stores it reversed,
      // so `sprp` appears as `prps` in the file. Flip it back to the name vbsp means.
      id: bytes.subarray(base, base + 4).toString("latin1").split("").reverse().join(""),
      version: bytes.readUInt16LE(base + 6),
      offset: absolute,
      length: filelen,
    });
  }
  return entries;
}

function stringAt(bytes: Buffer, offset: number, limit: number): string {
  const end = bytes.indexOf(0, offset);
  const stop = end < 0 || end > limit ? limit : end;
  return bytes.subarray(offset, stop).toString("latin1").replace(/\\/g, "/");
}

/**
 * Reads the static-prop game lump.
 *
 * Returns an empty list rather than throwing when a map has no `sprp` lump; a map compiled
 * without props is a legal map, not a broken file. A malformed record, however, is an
 * error: a stride that does not divide evenly means the offset arithmetic is wrong, and
 * guessing past it would draw props in invented places.
 */
export function readStaticProps(path: string): StaticPropList {
  const entries = gameLumpEntries(path);
  const entry = entries.find((candidate) => candidate.id === LMP_ID_STATIC_PROPS);
  if (!entry) return { models: [], props: [], version: 0, stride: 0 };
  if (entry.length < 4) return { models: [], props: [], version: entry.version, stride: 0 };

  const bytes = readAt(path, entry.offset, entry.length);
  let at = 0;
  const modelCount = bytes.readInt32LE(at);
  at += 4;
  if (modelCount < 0 || modelCount > 100_000) {
    throw new BspFormatError(`${path}: sprp model dictionary count ${modelCount} is not sane`);
  }
  const models: string[] = [];
  for (let i = 0; i < modelCount; i += 1) {
    if (at + 128 > bytes.length) {
      throw new BspFormatError(`${path}: sprp model dictionary is truncated`);
    }
    models.push(stringAt(bytes, at, at + 128));
    at += 128;
  }

  if (at + 4 > bytes.length) return { models, props: [], version: entry.version, stride: 0 };
  const leafCount = bytes.readInt32LE(at);
  at += 4;
  // L4D2 (version 9) stores two-byte leaf indices. Later Strata versions use four; the
  // record count check below fails honestly instead of drawing nonsense.
  at += leafCount * 2;
  if (at + 4 > bytes.length) {
    throw new BspFormatError(`${path}: sprp visleaf table overruns the lump`);
  }
  const propCount = bytes.readInt32LE(at);
  at += 4;
  if (propCount < 0) {
    throw new BspFormatError(`${path}: sprp prop count ${propCount} is negative`);
  }
  if (propCount === 0) return { models, props: [], version: entry.version, stride: 0 };

  const remaining = bytes.length - at;
  const stride = remaining / propCount;
  if (!Number.isInteger(stride) || stride < 56) {
    throw new BspFormatError(
      `${path}: sprp has ${propCount} props in ${remaining} bytes, which is not a ${stride}-byte record`,
    );
  }

  const props: StaticProp[] = [];
  const hasTint = entry.version >= 7 || stride >= 68;
  const hasScale = entry.version >= 11 && stride >= 76;
  for (let i = 0; i < propCount; i += 1) {
    const base = at + i * stride;
    const modelIndex = bytes.readUInt16LE(base + 24);
    const model = models[modelIndex];
    if (model === undefined) continue;
    const tint: [number, number, number] = hasTint
      ? [bytes[base + 64]!, bytes[base + 65]!, bytes[base + 66]!]
      : [255, 255, 255];
    const scale = hasScale ? bytes.readFloatLE(base + 72) : 1;
    props.push({
      model,
      origin: [
        bytes.readFloatLE(base),
        bytes.readFloatLE(base + 4),
        bytes.readFloatLE(base + 8),
      ],
      angles: [
        bytes.readFloatLE(base + 12),
        bytes.readFloatLE(base + 16),
        bytes.readFloatLE(base + 20),
      ],
      scale: [scale, scale, scale],
      skin: bytes.readInt32LE(base + 32),
      tint,
      solidity: bytes[base + 30]!,
      flags: bytes[base + 31]!,
      lightingOrigin: [
        bytes.readFloatLE(base + 44),
        bytes.readFloatLE(base + 48),
        bytes.readFloatLE(base + 52),
      ],
    });
  }
  return { models, props, version: entry.version, stride };
}
