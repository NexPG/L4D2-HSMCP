/**
 * MDL sequences and the animation data stored inside the `.mdl`.
 *
 * A model's animation is a linked list of per-bone `mstudioanim_t` records: raw constant
 * position/rotation, or three RLE streams for position and three for rotation. The RLE stream
 * is pairs of `valid`/`total` bytes followed by `valid` int16 values; a value covers `total`
 * frames. This reader implements the same extraction the engine does, and writes the result
 * as SMD skeleton frames a person can inspect.
 *
 * External `.ani` blocks (whole clips and frame-by-bone clips) are read through the model's
 * anim-block table. Multi-blend sequences are decoded as their individual animations and
 * assembled by the decompiler into a `$sequence` block. Unsupported clips are reported as
 * skipped rather than emitted with the bind pose pretending to be an animation.
 */
import type { ModelBone } from "./mdlbones.js";
import { quaternionToEuler } from "./mdlbones.js";
import type { Vec3 } from "./mdlmesh.js";

export interface MdlSequence {
  index: number;
  name: string;
  activityName: string;
  flags: number;
  activity: number;
  /** `actweight` at +20; stock studiomdl refuses a sequence with `activity` and no weight. */
  activityWeight: number;
  frameCount: number;
  fps: number;
  firstAnimation: number;
  /** Declared blend count; `groupSizes[0] * groupSizes[1]` animations are indexed. */
  blendCount: number;
  groupSizes: [number, number];
  /** Absolute offset of the descriptor; the animation-index list is relative to it. */
  baseOffset: number;
  animIndexOffset: number;
  paramIndices: [number, number];
  paramStart: [number, number];
  paramEnd: [number, number];
  fadeInTime: number;
  fadeOutTime: number;
  /**
   * `numikrules` at +144: IK rules the sequence's animations carry.
   *
   * Stock L4D2 uses them heavily -- 532 of the gambler's 814 sequences, 380 of the common
   * infected's 407 -- and neither this decompiler nor the reference one reconstructs the
   * `ikrule` lines, so a recompile loses them. The count is what lets `decompile_model` say
   * so instead of staying silent.
   */
  ikrules: number;
  /** `numautolayers` at +148: `addlayer`/`blendlayer` entries. */
  autolayers: number;
  /** `weightlistindex` at +156; 0 is the default all-ones list. */
  weightlist: number;
  /** `addlayer`/`blendlayer` records (`mstudioautolayer_t`, 24 bytes each). */
  autoLayers: MdlAutoLayer[];
  /** `event` lines stored with the sequence, in file order. */
  events: MdlEvent[];
}

/** One `mstudioautolayer_t`: a layer of another sequence blended over this one. */
export interface MdlAutoLayer {
  /** Index of the sequence used as the layer. */
  sequence: number;
  /** Pose parameter index when `flags` has `STUDIO_AL_POSE`. */
  pose: number;
  flags: number;
  /** Influence window as phases 0..1; `blendlayer` writes them as frames. */
  start: number;
  peak: number;
  tail: number;
  end: number;
}

export const STUDIO_AL_SPLINE = 0x40;
export const STUDIO_AL_XFADE = 0x80;
export const STUDIO_AL_NOBLEND = 0x200;
export const STUDIO_AL_LOCAL = 0x1000;
export const STUDIO_AL_POSE = 0x4000;

/** One `mstudioevent_t`: 80 bytes, with an optional name relative to the record. */
export interface MdlEvent {
  /** Normalised cycle in 0..1 as stored; the frame is `round(cycle * (frameCount - 1))`. */
  cycle: number;
  /** Numeric event id (`5004`, `AE_MUZZLEFLASH`, ...) when the record has no name. */
  event: number;
  /** `NEW_EVENT_STYLE` (1024) marks a named event. */
  type: number;
  /** The event name, or the numeric id as a string. */
  name: string;
  options: string;
}

/** One `mstudioposeparamdesc_t`, the controller a `blend` line drives. */
export interface MdlPoseParam {
  index: number;
  name: string;
  flags: number;
  /** Range the animation was authored over; a blend line quotes these. */
  start: number;
  end: number;
  /** Looping span, 0 for none, 360 for rotations. */
  loop: number;
}

/** One `mstudioikchain_t`: a three-bone chain and the bones it moves. */
export interface MdlIkChain {
  index: number;
  name: string;
  /** 0 = the old "foot" solver, 1 = the two-bone solver; the value is copied to the QC. */
  linkType: number;
  /** Bone indices from the end effector up the chain. */
  bones: number[];
  /** `$ikchain`'s `knee` hint, the first link's ideal bending direction. */
  knee: Vec3;
}

/** One `mstudioiklock_t`: a chain the sequence (or autoplay) may pin. */
export interface MdlIkLock {
  chain: number;
  positionWeight: number;
  localQWeight: number;
  flags: number;
}

export interface MdlAnimationDesc {
  index: number;
  name: string;
  fps: number;
  frameCount: number;
  flags: number;
  animBlock: number;
  animOffset: number;
  sectionOffset: number;
  sectionFrameCount: number;
  /** Absolute file offset of the descriptor, which all its data offsets are relative to. */
  baseOffset: number;
}

export interface MdlAnimBlock {
  dataStart: number;
  dataEnd: number;
}

/** The first bytes of an external `.ani`: `IDAG` and a version word (49 in L4D2). */
export interface MdlAniHeader {
  magic: string;
  version: number;
}

export function readAniHeader(ani: Buffer): MdlAniHeader | null {
  if (ani.length < 8) return null;
  return { magic: ani.subarray(0, 4).toString("latin1"), version: ani.readInt32LE(4) };
}

export interface AnimationFrame {
  time: number;
  bones: Array<{ position: Vec3; rotation: Vec3 }>;
}

export interface AnimationClip {
  sequence: MdlSequence;
  animation: MdlAnimationDesc;
  frames: AnimationFrame[];
}

/** External `.ani` block table: `numanimblocks` at 352 and `animblockindex` at 356. */
export function readAnimBlocks(mdl: Buffer): MdlAnimBlock[] {
  if (mdl.length < 360) return [];
  const count = mdl.readInt32LE(352);
  const offset = mdl.readInt32LE(356);
  if (count <= 0 || count > 100_000 || offset <= 0 || offset >= mdl.length) return [];
  const blocks: MdlAnimBlock[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = offset + i * 8;
    if (at + 8 > mdl.length) break;
    blocks.push({ dataStart: mdl.readInt32LE(at), dataEnd: mdl.readInt32LE(at + 4) });
  }
  return blocks;
}

const ANIM_RAWPOS = 0x01;
const ANIM_RAWROT = 0x02;
const ANIM_ANIMPOS = 0x04;
const ANIM_ANIMROT = 0x08;
const ANIM_DELTA = 0x10;
const ANIM_RAWROT2 = 0x20;

/**
 * Reads a sequence's `mstudioautolayer_t` list.
 *
 * `numautolayers` (148) and `autolayerindex` (152) are relative to the sequence descriptor;
 * each record is 24 bytes: `short sequence, short pose, int flags, float start/peak/tail/end`.
 * The window is a phase in 0..1, and `blendlayer` wants frames, which is why the writer
 * multiplies by `frameCount - 1` (unless `STUDIO_AL_POSE`, where the values are used as given).
 */
function readAutoLayers(mdl: Buffer, base: number): MdlAutoLayer[] {
  const count = mdl.readInt32LE(base + 148);
  const offset = mdl.readInt32LE(base + 152);
  if (count <= 0 || count > 64 || offset <= 0) return [];
  const layers: MdlAutoLayer[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = base + offset + index * 24;
    if (at + 24 > mdl.length) break;
    layers.push({
      sequence: mdl.readInt16LE(at),
      pose: mdl.readInt16LE(at + 2),
      flags: mdl.readInt32LE(at + 4),
      start: mdl.readFloatLE(at + 8),
      peak: mdl.readFloatLE(at + 12),
      tail: mdl.readFloatLE(at + 16),
      end: mdl.readFloatLE(at + 20),
    });
  }
  return layers;
}

function readName(bytes: Buffer, offset: number): string {
  if (offset < 0 || offset >= bytes.length) return "";
  const end = bytes.indexOf(0, offset);
  return bytes.subarray(offset, end < 0 ? bytes.length : end).toString("latin1");
}

function float16(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >> 10) & 0x1f;
  const mantissa = value & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 31) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

function vector48(bytes: Buffer, at: number): Vec3 {
  return [float16(bytes.readUInt16LE(at)), float16(bytes.readUInt16LE(at + 2)), float16(bytes.readUInt16LE(at + 4))];
}

function quaternion48(bytes: Buffer, at: number): [number, number, number, number] {
  const x = (bytes.readUInt16LE(at) - 32768) / 32768;
  const y = (bytes.readUInt16LE(at + 2) - 32768) / 32768;
  const zw = bytes.readUInt16LE(at + 4);
  const z = ((zw & 0x7fff) - 16384) / 16384;
  const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)) * (zw & 0x8000 ? -1 : 1);
  return [x, y, z, w];
}

function quaternion64(bytes: Buffer, at: number): [number, number, number, number] {
  let bits = 0n;
  for (let i = 0; i < 8; i += 1) bits |= BigInt(bytes[at + i]!) << BigInt(i * 8);
  const read = (shift: bigint): number => Number((bits >> shift) & 0x1fffffn) / 1048576.5 - 1;
  const x = read(0n);
  const y = read(21n);
  const z = read(42n);
  const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)) * (bits >> 63n ? -1 : 1);
  return [x, y, z, w];
}

export function readSequences(mdl: Buffer, animations: MdlAnimationDesc[]): MdlSequence[] {
  const count = mdl.readInt32LE(188);
  const offset = mdl.readInt32LE(192);
  if (count <= 0 || count > 100_000 || offset <= 0 || offset >= mdl.length) return [];
  const sequences: MdlSequence[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = offset + i * 212;
    if (base + 212 > mdl.length) break;
    const nameOffset = mdl.readInt32LE(base + 4);
    const activityOffset = mdl.readInt32LE(base + 8);
    const blendCount = mdl.readInt32LE(base + 56);
    const animIndexOffset = mdl.readInt32LE(base + 60);
    const groupSizes: [number, number] = [
      mdl.readInt32LE(base + 68),
      mdl.readInt32LE(base + 72),
    ];
    const blendTotal = groupSizes[0] * groupSizes[1];
    const firstAnimation =
      blendTotal > 0 && animIndexOffset > 0 && base + animIndexOffset + 2 <= mdl.length
        ? mdl.readInt16LE(base + animIndexOffset)
        : -1;
    const animation = animations[firstAnimation];
    sequences.push({
      index: i,
      name: readName(mdl, base + nameOffset) || `sequence_${i}`,
      activityName: readName(mdl, base + activityOffset),
      flags: mdl.readInt32LE(base + 12),
      activity: mdl.readInt32LE(base + 16),
      activityWeight: mdl.readInt32LE(base + 20),
      frameCount: animation?.frameCount ?? 0,
      fps: animation?.fps ?? 30,
      firstAnimation,
      blendCount,
      groupSizes,
      baseOffset: base,
      animIndexOffset,
      paramIndices: [mdl.readInt32LE(base + 76), mdl.readInt32LE(base + 80)],
      paramStart: [mdl.readFloatLE(base + 84), mdl.readFloatLE(base + 88)],
      paramEnd: [mdl.readFloatLE(base + 92), mdl.readFloatLE(base + 96)],
      fadeInTime: mdl.readFloatLE(base + 104),
      fadeOutTime: mdl.readFloatLE(base + 108),
      ikrules: mdl.readInt32LE(base + 144),
      autolayers: mdl.readInt32LE(base + 148),
      weightlist: mdl.readInt32LE(base + 156),
      autoLayers: readAutoLayers(mdl, base),
      events: readSequenceEvents(mdl, base),
    });
  }
  return sequences;
}

/**
 * Reads a sequence's `mstudioevent_t` list.
 *
 * The descriptor stores `numevents` (24) and `eventindex` (28), where the index is relative
 * to the sequence descriptor. Each record is 80 bytes; its name offset is relative to the
 * record. A zero name offset means the numeric id is the name, which is how `event 5004`
 * survives a decompile.
 */
function readSequenceEvents(mdl: Buffer, base: number): MdlEvent[] {
  const count = mdl.readInt32LE(base + 24);
  const offset = mdl.readInt32LE(base + 28);
  if (count <= 0 || count > 1000 || offset <= 0) return [];
  const events: MdlEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = base + offset + index * 80;
    if (at + 80 > mdl.length) break;
    const nameOffset = mdl.readInt32LE(at + 76);
    const number = mdl.readInt32LE(at + 4);
    const options = mdl
      .subarray(at + 12, at + 76)
      .toString("latin1")
      .replace(/\0.*$/s, "");
    events.push({
      cycle: mdl.readFloatLE(at),
      event: number,
      type: mdl.readInt32LE(at + 8),
      name:
        nameOffset !== 0 && at + nameOffset > at && at + nameOffset < mdl.length
          ? readName(mdl, at + nameOffset)
          : String(number),
      options,
    });
  }
  return events;
}

/**
 * The animation indices a sequence blends, in `groupSizes[0] * groupSizes[1]` order.
 *
 * A three-way aim blend names three SMDs; the descriptor stores only the first index and the
 * list offset, so a reader that stops at `firstAnimation` cannot recreate the other two.
 */
export function sequenceAnimationIndices(mdl: Buffer, sequence: MdlSequence): number[] {
  const total = sequence.groupSizes[0] * sequence.groupSizes[1];
  if (total <= 0 || sequence.animIndexOffset <= 0) return [];
  const at = sequence.baseOffset + sequence.animIndexOffset;
  if (at + total * 2 > mdl.length) return [];
  const indices: number[] = [];
  for (let index = 0; index < total; index += 1) {
    const value = mdl.readInt16LE(at + index * 2);
    if (value >= 0) indices.push(value);
  }
  return indices;
}

/**
 * Pose parameters (`mstudioposeparamdesc_t`), which a multi-blend `$sequence` names.
 *
 * The header keeps the count at 300 and the list offset at 304; each record is 20 bytes and
 * its name is relative to the record. These are the controllers a decompiled `blend` line
 * must quote, so a blend that references one is not invisible.
 */
export function readPoseParams(mdl: Buffer): MdlPoseParam[] {
  if (mdl.length < 308) return [];
  const count = mdl.readInt32LE(300);
  const offset = mdl.readInt32LE(304);
  if (count <= 0 || count > 4096 || offset <= 0 || offset >= mdl.length) return [];
  const params: MdlPoseParam[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = offset + index * 20;
    if (base + 20 > mdl.length) break;
    params.push({
      index,
      name: readName(mdl, base + mdl.readInt32LE(base)) || `pose_${index}`,
      flags: mdl.readInt32LE(base + 4),
      start: mdl.readFloatLE(base + 8),
      end: mdl.readFloatLE(base + 12),
      loop: mdl.readFloatLE(base + 16),
    });
  }
  return params;
}

/**
 * IK chains (`mstudioikchain_t`): the count is at 284 and the list at 288.
 *
 * A chain record is 16 bytes and its links are 28 bytes each (`bone`, knee direction,
 * unused vector), addressed relative to the chain. The bone ids are what `$ikchain` needs;
 * the vectors are the pose-space hint and are not written by this reader.
 */
export function readIkChains(mdl: Buffer): MdlIkChain[] {
  if (mdl.length < 292) return [];
  const count = mdl.readInt32LE(284);
  const offset = mdl.readInt32LE(288);
  if (count <= 0 || count > 4096 || offset <= 0 || offset >= mdl.length) return [];
  const chains: MdlIkChain[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = offset + index * 16;
    if (base + 16 > mdl.length) break;
    const nameOffset = mdl.readInt32LE(base);
    const linkType = mdl.readInt32LE(base + 4);
    const linkCount = mdl.readInt32LE(base + 8);
    const linkOffset = mdl.readInt32LE(base + 12);
    if (linkCount < 0 || linkCount > 64 || linkOffset <= 0) continue;
    const linkBase = base + linkOffset;
    if (linkBase + linkCount * 28 > mdl.length) continue;
    const bones: number[] = [];
    for (let link = 0; link < linkCount; link += 1) {
      bones.push(mdl.readInt32LE(linkBase + link * 28));
    }
    const firstLink = linkBase;
    chains.push({
      index,
      name: readName(mdl, base + nameOffset) || `ikchain_${index}`,
      linkType,
      bones,
      knee: [
        mdl.readFloatLE(firstLink + 4),
        mdl.readFloatLE(firstLink + 8),
        mdl.readFloatLE(firstLink + 12),
      ],
    });
  }
  return chains;
}

/**
 * Model-level IK locks (`mstudioiklock_t`, count at 320, list at 324), which the QC writes
 * as `$ikautoplaylock`. Each record is 16 bytes. A sequence can carry its own `iklock`
 * list; this reads the model-level autoplay set only, which is what a decompile needs.
 */
export function readIkLocks(mdl: Buffer): MdlIkLock[] {
  if (mdl.length < 328) return [];
  const count = mdl.readInt32LE(320);
  const offset = mdl.readInt32LE(324);
  if (count <= 0 || count > 4096 || offset <= 0 || offset >= mdl.length) return [];
  const locks: MdlIkLock[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = offset + index * 16;
    if (base + 16 > mdl.length) break;
    locks.push({
      chain: mdl.readInt32LE(base),
      positionWeight: mdl.readFloatLE(base + 4),
      localQWeight: mdl.readFloatLE(base + 8),
      flags: mdl.readInt32LE(base + 12),
    });
  }
  return locks;
}

export function readAnimations(mdl: Buffer): MdlAnimationDesc[] {
  const count = mdl.readInt32LE(180);
  const offset = mdl.readInt32LE(184);
  if (count <= 0 || count > 100_000 || offset <= 0 || offset >= mdl.length) return [];
  const animations: MdlAnimationDesc[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = offset + i * 100;
    if (base + 100 > mdl.length) break;
    animations.push({
      index: i,
      name: readName(mdl, base + mdl.readInt32LE(base + 4)) || `animation_${i}`,
      fps: mdl.readFloatLE(base + 8),
      frameCount: mdl.readInt32LE(base + 16),
      flags: mdl.readInt32LE(base + 12),
      animBlock: mdl.readInt32LE(base + 52),
      animOffset: mdl.readInt32LE(base + 56),
      sectionOffset: mdl.readInt32LE(base + 80),
      sectionFrameCount: mdl.readInt32LE(base + 84),
      baseOffset: base,
    });
  }
  return animations;
}

/**
 * Reads one channel of an RLE stream at `at` for `frame`.
 *
 * Values are stored as `valid`/`total` byte pairs followed by `valid` little-endian int16s.
 * Frames inside a block past its stored values repeat the last one; a stream that ends before
 * the requested frame yields 0, which is what `bone_setup.cpp` does.
 */
export function readAnimValue(bytes: Buffer, frame: number, at: number, scale: number): number {
  if (at < 0 || at + 2 > bytes.length) return 0;
  let position = at;
  let remaining = frame;
  for (let guard = 0; guard < 10_000; guard += 1) {
    if (position + 2 > bytes.length) return 0;
    const valid = bytes[position]!;
    const total = bytes[position + 1]!;
    // A zero total past the last block means the stream ran out, which the engine treats as 0.
    if (total === 0) return 0;
    if (total <= remaining) {
      remaining -= total;
      position += 2 + valid * 2;
      continue;
    }
    // Frames past the block's stored values reuse its last value, exactly as bone_setup.cpp does.
    const index = Math.min(remaining, Math.max(0, valid - 1));
    if (position + 4 + index * 2 > bytes.length) return 0;
    return bytes.readInt16LE(position + 2 + index * 2) * scale;
  }
  return 0;
}

interface BoneTrack {
  bone: number;
  flags: number;
  /** Where the rotation `mstudioanim_valueptr_t` lives; its offsets are relative to itself. */
  rotationBase: number;
  /** Where the position `mstudioanim_valueptr_t` lives, one pointer later when rotation is animated. */
  positionBase: number;
  rawPosition?: Vec3;
  rawRotation?: [number, number, number, number];
  rawRotation2?: [number, number, number, number];
  rotationOffsets?: [number, number, number];
  positionOffsets?: [number, number, number];
}

function readBoneTracks(mdl: Buffer, dataOffset: number, boneCount: number): BoneTrack[] {
  const tracks: BoneTrack[] = [];
  let at = dataOffset;
  for (let guard = 0; guard < boneCount + 1; guard += 1) {
    if (at < 0 || at + 4 > mdl.length) break;
    const bone = mdl[at]!;
    if (bone === 255) break;
    if (bone >= boneCount) break;
    const flags = mdl[at + 1]!;
    const next = mdl.readInt16LE(at + 2);
    let pointer = at + 4;
    let rawRotation2: [number, number, number, number] | undefined;
    let rawRotation: [number, number, number, number] | undefined;
    let rawPosition: Vec3 | undefined;
    if (flags & ANIM_RAWROT2) {
      if (pointer + 8 > mdl.length) break;
      rawRotation2 = quaternion64(mdl, pointer);
      pointer += 8;
    } else if (flags & ANIM_RAWROT) {
      if (pointer + 6 > mdl.length) break;
      rawRotation = quaternion48(mdl, pointer);
      pointer += 6;
    }
    if (flags & ANIM_RAWPOS) {
      if (pointer + 6 > mdl.length) break;
      rawPosition = vector48(mdl, pointer);
      pointer += 6;
    }
    let rotationOffsets: [number, number, number] | undefined;
    let positionOffsets: [number, number, number] | undefined;
    const rotationBase = pointer;
    if (flags & ANIM_ANIMROT) {
      if (pointer + 6 > mdl.length) break;
      rotationOffsets = [
        mdl.readInt16LE(pointer),
        mdl.readInt16LE(pointer + 2),
        mdl.readInt16LE(pointer + 4),
      ];
      pointer += 6;
    }
    // The position value pointer follows the rotation one, and its offsets are relative to
    // its own address, not to the rotation pointer.
    const positionBase = pointer;
    if (flags & ANIM_ANIMPOS) {
      if (pointer + 6 > mdl.length) break;
      positionOffsets = [
        mdl.readInt16LE(pointer),
        mdl.readInt16LE(pointer + 2),
        mdl.readInt16LE(pointer + 4),
      ];
      pointer += 6;
    }
    tracks.push({
      bone,
      flags,
      rotationBase,
      positionBase,
      ...(rawPosition ? { rawPosition } : {}),
      ...(rawRotation ? { rawRotation } : {}),
      ...(rawRotation2 ? { rawRotation2 } : {}),
      ...(rotationOffsets ? { rotationOffsets } : {}),
      ...(positionOffsets ? { positionOffsets } : {}),
    });
    if (next === 0) break;
    at += next;
  }
  return tracks;
}

/** End of one RLE channel, including its terminating `total = 0` pair. */
function rleStreamEnd(mdl: Buffer, at: number): number {
  let position = at;
  for (let guard = 0; guard < 100_000; guard += 1) {
    if (position + 2 > mdl.length) return position;
    const valid = mdl[position]!;
    const total = mdl[position + 1]!;
    if (total === 0) return position + 2;
    position += 2 + valid * 2;
  }
  return position;
}

/** End offset of a whole bone-track list, including every RLE stream it points at. */
function trackListEnd(mdl: Buffer, dataOffset: number, boneCount: number): number {
  let end = dataOffset;
  let at = dataOffset;
  for (let guard = 0; guard < boneCount + 1; guard += 1) {
    if (at + 4 > mdl.length) return end;
    const bone = mdl[at]!;
    if (bone === 255) return Math.max(end, at + 4);
    if (bone >= boneCount) return end;
    const flags = mdl[at + 1]!;
    const next = mdl.readInt16LE(at + 2);
    let pointer = at + 4;
    if (flags & ANIM_RAWROT2) pointer += 8;
    else if (flags & ANIM_RAWROT) pointer += 6;
    if (flags & ANIM_RAWPOS) pointer += 6;
    const rotationBase = pointer;
    if (flags & ANIM_ANIMROT) pointer += 6;
    const positionBase = pointer;
    if (flags & ANIM_ANIMPOS) pointer += 6;
    if (flags & ANIM_ANIMROT) {
      for (let axis = 0; axis < 3; axis += 1) {
        const offset = mdl.readInt16LE(rotationBase + axis * 2);
        if (offset > 0) end = Math.max(end, rleStreamEnd(mdl, rotationBase + offset));
      }
    }
    if (flags & ANIM_ANIMPOS) {
      for (let axis = 0; axis < 3; axis += 1) {
        const offset = mdl.readInt16LE(positionBase + axis * 2);
        if (offset > 0) end = Math.max(end, rleStreamEnd(mdl, positionBase + offset));
      }
    }
    if (next === 0) return end;
    at += next;
  }
  return end;
}

/** Finds the next section's track list after the current one, skipping alignment padding. */
function nextSectionStart(mdl: Buffer, from: number, boneCount: number): number {
  const limit = Math.min(mdl.length - 4, from + 32);
  for (let at = from; at <= limit; at += 1) {
    const bone = mdl[at]!;
    const flags = mdl[at + 1]!;
    if (bone >= boneCount) continue;
    if ((flags & (ANIM_RAWPOS | ANIM_RAWROT | ANIM_ANIMPOS | ANIM_ANIMROT | ANIM_RAWROT2)) === 0) {
      continue;
    }
    const next = mdl.readInt16LE(at + 2);
    if (next >= 0 && next < 512) return at;
  }
  return -1;
}

/**
 * Decodes one bone-track list for `frameCount` frames.
 *
 * The same code serves a whole non-sectioned clip and one section of a fast-lookup clip.
 * `startFrame` keeps the SMD times continuous when sections are concatenated.
 */
function decodeTrackList(
  mdl: Buffer,
  dataOffset: number,
  frameCount: number,
  fps: number,
  bones: ModelBone[],
  startFrame: number,
): AnimationFrame[] | null {
  if (dataOffset < 0 || dataOffset + 2 > mdl.length || frameCount <= 0) return null;
  const tracks = readBoneTracks(mdl, dataOffset, Math.max(1, bones.length));
  const byBone = new Map(tracks.map((track) => [track.bone, track]));
  const frames: AnimationFrame[] = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameBones: AnimationFrame["bones"] = [];
    for (let index = 0; index < Math.max(1, bones.length); index += 1) {
      const bone = bones[index];
      const track = byBone.get(index);
      let position: Vec3 = bone ? [...bone.position] : [0, 0, 0];
      let rotation: Vec3 = bone ? [...bone.rotationEuler] : [0, 0, 0];
      if (track) {
        if (track.rawPosition) {
          position = [...track.rawPosition];
        } else if (track.positionOffsets) {
          const offsets = track.positionOffsets;
          const scale = bone?.positionScale ?? [0.00390625, 0.00390625, 0.00390625];
          const base = bone?.position ?? [0, 0, 0];
          position = [0, 1, 2].map((axis) => {
            const value =
              offsets[axis]! > 0
                ? readAnimValue(mdl, frame, track.positionBase + offsets[axis]!, scale[axis]!)
                : 0;
            return track.flags & ANIM_DELTA ? value : value + base[axis]!;
          }) as Vec3;
        } else if (track.flags & ANIM_DELTA) {
          position = [0, 0, 0];
        }

        const rawRotation = track.rawRotation2 ?? track.rawRotation;
        if (rawRotation) {
          rotation = quaternionToEuler(rawRotation);
        } else if (track.rotationOffsets) {
          const offsets = track.rotationOffsets;
          const scale = bone?.rotationScale ?? [0.0001, 0.0001, 0.0001];
          const base = bone?.rotationEuler ?? [0, 0, 0];
          rotation = [0, 1, 2].map((axis) => {
            const value =
              offsets[axis]! > 0
                ? readAnimValue(mdl, frame, track.rotationBase + offsets[axis]!, scale[axis]!)
                : 0;
            return track.flags & ANIM_DELTA ? value : value + base[axis]!;
          }) as Vec3;
        } else if (track.flags & ANIM_DELTA) {
          rotation = [0, 0, 0];
        }
      }
      frameBones.push({ position, rotation });
    }
    frames.push({ time: (startFrame + frame) / fps, bones: frameBones });
  }
  return frames;
}

/**
 * Decodes a sectioned ("fast lookup") clip by walking the contiguous section track lists.
 *
 * `sectionFrameCount` frames are stored per section; the array at `sectionOffset` does not
 * contain useful starts for the early sections, so the reader advances to the next plausible
 * bone/flags pair after each track list. The bogus trailing sections are ignored: only
 * `ceil(frameCount / sectionFrameCount)` sections are read.
 */
function decodeSections(
  mdl: Buffer,
  animation: MdlAnimationDesc,
  bones: ModelBone[],
  ani?: Buffer,
): AnimationFrame[] | null {
  const sectionFrames = animation.sectionFrameCount;
  if (sectionFrames <= 0) return null;
  const sectionCount = Math.ceil(animation.frameCount / sectionFrames);
  const fps = animation.fps > 0 ? animation.fps : 30;
  const frames: AnimationFrame[] = [];
  const boneCount = Math.max(1, bones.length);
  const sections: Array<{ animBlock: number; animOffset: number }> = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const at = animation.baseOffset + animation.sectionOffset + i * 8;
    if (at + 8 > mdl.length) break;
    sections.push({
      animBlock: mdl.readInt32LE(at),
      animOffset: mdl.readInt32LE(at + 4),
    });
  }
  const blocks = ani ? readAnimBlocks(mdl) : [];
  const externalSections = sections.some((section) => section.animBlock > 0);

  if (externalSections) {
    for (let section = 0; section < sectionCount; section += 1) {
      const count = Math.min(sectionFrames, animation.frameCount - frames.length);
      if (count <= 0) break;
      const entry = sections[section];
      if (!entry) return null;
      let buffer: Buffer = mdl;
      let dataOffset = 0;
      if (entry.animBlock > 0) {
        if (!ani) return null;
        const block = blocks[entry.animBlock];
        if (!block) return null;
        buffer = ani;
        dataOffset = block.dataStart + entry.animOffset;
      } else {
        dataOffset =
          animation.baseOffset +
          entry.animOffset +
          (animation.animOffset - (sections[0]?.animOffset ?? 0));
      }
      const decoded = decodeTrackList(buffer, dataOffset, count, fps, bones, frames.length);
      if (!decoded) return null;
      frames.push(...decoded);
    }
    return frames.length > 0 ? frames : null;
  }

  let cursor = animation.baseOffset + animation.animOffset;
  for (let section = 0; section < sectionCount; section += 1) {
    const count = Math.min(sectionFrames, animation.frameCount - frames.length);
    if (count <= 0) break;
    const decoded = decodeTrackList(mdl, cursor, count, fps, bones, frames.length);
    if (!decoded) return null;
    frames.push(...decoded);
    if (section === sectionCount - 1) break;
    const end = trackListEnd(mdl, cursor, boneCount);
    const next = nextSectionStart(mdl, end, boneCount);
    if (next < 0) break;
    cursor = next;
  }

  return frames.length > 0 ? frames : null;
}

/** 48-bit sorted quaternion (`Quaternion48S`), used by the frame-by-bone layout. */
function quaternion48s(bytes: Buffer, at: number): [number, number, number, number] {
  const first = bytes.readUInt16LE(at);
  const second = bytes.readUInt16LE(at + 2);
  const third = bytes.readUInt16LE(at + 4);
  const a = first & 0x7fff;
  const b = second & 0x7fff;
  const c = third & 0x7fff;
  const offset = ((second >> 15) & 1) + ((first >> 15) & 1) * 2;
  const indices = [offset, (offset + 1) % 4, (offset + 2) % 4, (offset + 3) % 4];
  const values = [0, 0, 0, 0];
  values[indices[0]!] = (a - 16384) / 23168;
  values[indices[1]!] = (b - 16384) / 23168;
  values[indices[2]!] = (c - 16384) / 23168;
  const square = 1 - values[0]! ** 2 - values[1]! ** 2 - values[2]! ** 2;
  values[indices[3]!] = Math.sqrt(Math.max(0, square)) * (third & 0x8000 ? -1 : 1);
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

/**
 * Decodes the frame-by-bone layout (`STUDIO_FRAMEANIM`, 0x40).
 *
 * The block starts with constants/frame offsets and a per-bone flag byte, then one fixed-size
 * record per frame. Positions are compressed Vector48 or full floats; rotations are
 * Quaternion48 or Quaternion48S. The values are already absolute local transforms, so the
 * bind pose is only used for a bone with no position/rotation channel.
 */
function decodeFrameAnim(
  bytes: Buffer,
  dataOffset: number,
  frameCount: number,
  fps: number,
  bones: ModelBone[],
  startFrame: number,
): AnimationFrame[] | null {
  if (dataOffset < 0 || dataOffset + 24 > bytes.length) return null;
  const constantsOffset = bytes.readInt32LE(dataOffset);
  const frameOffset = bytes.readInt32LE(dataOffset + 4);
  const frameLength = bytes.readInt32LE(dataOffset + 8);
  if (frameOffset <= 0 || frameLength <= 0) return null;
  const boneCount = Math.max(1, bones.length);
  const flagsAt = dataOffset + 24;
  if (flagsAt + boneCount > bytes.length) return null;
  const flags = Array.from({ length: boneCount }, (_, index) => bytes[flagsAt + index]!);

  const constants = new Map<
    number,
    { position?: Vec3; rotation?: [number, number, number, number] }
  >();
  if (constantsOffset > 0) {
    let at = dataOffset + constantsOffset;
    for (let index = 0; index < boneCount; index += 1) {
      const flag = flags[index]!;
      const entry: { position?: Vec3; rotation?: [number, number, number, number] } = {};
      if (flag & 0x40) {
        if (at + 6 > bytes.length) break;
        entry.rotation = quaternion48s(bytes, at);
        at += 6;
      }
      if (flag & 0x20) {
        if (at + 12 > bytes.length) break;
        entry.position = [bytes.readFloatLE(at), bytes.readFloatLE(at + 4), bytes.readFloatLE(at + 8)];
        at += 12;
      }
      if (flag & 0x02) {
        if (at + 6 > bytes.length) break;
        entry.rotation = quaternion48(bytes, at);
        at += 6;
      }
      if (flag & 0x01) {
        if (at + 6 > bytes.length) break;
        entry.position = vector48(bytes, at);
        at += 6;
      }
      constants.set(index, entry);
    }
  }

  const frames: AnimationFrame[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameAt = dataOffset + frameOffset + frame * frameLength;
    let cursor = frameAt;
    const frameBones: AnimationFrame["bones"] = [];
    for (let index = 0; index < boneCount; index += 1) {
      const bone = bones[index];
      const flag = flags[index]!;
      const constant = constants.get(index);
      let position: Vec3 = bone ? [...bone.position] : [0, 0, 0];
      let rotation: Vec3 = bone ? [...bone.rotationEuler] : [0, 0, 0];
      let rawRotation: [number, number, number, number] | undefined;
      if (flag & 0x80) {
        if (cursor + 6 > bytes.length) return null;
        rawRotation = quaternion48s(bytes, cursor);
        cursor += 6;
      }
      if (flag & 0x08) {
        if (cursor + 6 > bytes.length) return null;
        rawRotation = quaternion48(bytes, cursor);
        cursor += 6;
      }
      if (flag & 0x04) {
        if (cursor + 6 > bytes.length) return null;
        position = vector48(bytes, cursor);
        cursor += 6;
      }
      if (flag & 0x10) {
        if (cursor + 12 > bytes.length) return null;
        position = [
          bytes.readFloatLE(cursor),
          bytes.readFloatLE(cursor + 4),
          bytes.readFloatLE(cursor + 8),
        ];
        cursor += 12;
      }
      if (!(flag & (0x80 | 0x08)) && constant?.rotation) rawRotation = constant.rotation;
      if (!(flag & (0x04 | 0x10)) && constant?.position) position = constant.position;
      if (rawRotation) rotation = quaternionToEuler(rawRotation);
      frameBones.push({ position, rotation });
    }
    frames.push({ time: (startFrame + frame) / fps, bones: frameBones });
  }
  return frames;
}

/**
 * Decodes one animation whose data is inside the `.mdl` or an external `.ani`.
 *
 * Returns null for a missing external `.ani` or a missing data offset. A clip whose track
 * list starts with the 255 terminator is the bind pose, which is what the engine plays; only
 * unreadable data is a refusal, because the caller reports it as skipped.
 */
export function decodeAnimation(
  mdl: Buffer,
  animation: MdlAnimationDesc,
  bones: ModelBone[],
  ani?: Buffer,
): AnimationFrame[] | null {
  if (animation.frameCount <= 0 || animation.frameCount > 100_000) return null;
  const fps = animation.fps > 0 ? animation.fps : 30;
  if (animation.flags & 0x40) {
    // Frame-by-bone (`STUDIO_FRAMEANIM`); external survivors keep almost every clip here.
    if (animation.animBlock !== 0) {
      if (!ani) return null;
      const block = readAnimBlocks(mdl)[animation.animBlock];
      if (!block) return null;
      return decodeFrameAnim(
        ani,
        block.dataStart + animation.animOffset,
        animation.frameCount,
        fps,
        bones,
        0,
      );
    }
    if (animation.animOffset <= 0) return null;
    return decodeFrameAnim(
      mdl,
      animation.baseOffset + animation.animOffset,
      animation.frameCount,
      fps,
      bones,
      0,
    );
  }
  if (animation.sectionOffset > 0 && animation.sectionFrameCount > 0) {
    return decodeSections(mdl, animation, bones, ani);
  }
  if (animation.animBlock !== 0) {
    if (!ani) return null;
    const block = readAnimBlocks(mdl)[animation.animBlock];
    if (!block) return null;
    return decodeTrackList(
      ani,
      block.dataStart + animation.animOffset,
      animation.frameCount,
      fps,
      bones,
      0,
    );
  }
  if (animation.animOffset <= 0) return null;
  return decodeTrackList(
    mdl,
    animation.baseOffset + animation.animOffset,
    animation.frameCount,
    fps,
    bones,
    0,
  );
}

/** Whether a sequence's animation can be decoded from the MDL, and why not when it cannot. */
export function animationSkippedReason(
  animation: MdlAnimationDesc,
  hasAni = false,
): string | null {
  if (animation.animBlock !== 0 && !hasAni) {
    return "animation data is in an external .ani file that is not installed";
  }
  if (animation.animOffset <= 0 && animation.sectionFrameCount <= 0) {
    return "animation has no data offset";
  }
  return null;
}
