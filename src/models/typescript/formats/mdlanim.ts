/**
 * MDL sequences and the animation data stored inside the `.mdl`.
 *
 * A model's animation is a linked list of per-bone `mstudioanim_t` records: raw constant
 * position/rotation, or three RLE streams for position and three for rotation. The RLE stream
 * is pairs of `valid`/`total` bytes followed by `valid` int16 values; a value covers `total`
 * frames. This reader implements the same extraction the engine does, and writes the result
 * as SMD skeleton frames a person can inspect.
 *
 * External `.ani` blocks, the `sectionFrameCount` fast-lookup layout and multi-blend
 * sequences are not decoded yet. Those clips are reported as skipped rather than emitted with
 * the bind pose pretending to be an animation.
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
  frameCount: number;
  fps: number;
  firstAnimation: number;
  /** Declared blend count; `groupSizes[0] * groupSizes[1]` animations are indexed. */
  blendCount: number;
  groupSizes: [number, number];
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

export interface AnimationFrame {
  time: number;
  bones: Array<{ position: Vec3; rotation: Vec3 }>;
}

export interface AnimationClip {
  sequence: MdlSequence;
  animation: MdlAnimationDesc;
  frames: AnimationFrame[];
}

const ANIM_RAWPOS = 0x01;
const ANIM_RAWROT = 0x02;
const ANIM_ANIMPOS = 0x04;
const ANIM_ANIMROT = 0x08;
const ANIM_DELTA = 0x10;
const ANIM_RAWROT2 = 0x20;

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
      frameCount: animation?.frameCount ?? 0,
      fps: animation?.fps ?? 30,
      firstAnimation,
      blendCount,
      groupSizes,
    });
  }
  return sequences;
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

/**
 * Decodes one animation whose data is inside the `.mdl`.
 *
 * Returns null for an external `.ani` block, a sectioned animation or a missing data offset.
 * A clip whose track list starts with the 255 terminator is the bind pose, which is what the
 * engine plays; only unreadable data is a refusal, because the caller reports it as skipped.
 */
export function decodeAnimation(
  mdl: Buffer,
  animation: MdlAnimationDesc,
  bones: ModelBone[],
): AnimationFrame[] | null {
  if (animation.animBlock !== 0) return null;
  if (animation.animOffset <= 0) return null;
  if (animation.sectionOffset > 0 || animation.sectionFrameCount > 0) return null;
  if (animation.frameCount <= 0 || animation.frameCount > 100_000) return null;

  const dataOffset = animation.baseOffset + animation.animOffset;
  if (dataOffset < 0 || dataOffset + 2 > mdl.length) return null;
  const tracks = readBoneTracks(mdl, dataOffset, Math.max(1, bones.length));
  // A track list that starts with the 255 terminator means the clip is identical to the bind
  // pose, which is a real answer; only unreadable data is a refusal.
  const byBone = new Map(tracks.map((track) => [track.bone, track]));
  const fps = animation.fps > 0 ? animation.fps : 30;
  const frames: AnimationFrame[] = [];

  for (let frame = 0; frame < animation.frameCount; frame += 1) {
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
    frames.push({ time: frame / fps, bones: frameBones });
  }
  return frames;
}

/** Whether a sequence's animation can be decoded from the MDL, and why not when it cannot. */
export function animationSkippedReason(animation: MdlAnimationDesc): string | null {
  if (animation.animBlock !== 0) return "animation data is in an external .ani file";
  if (animation.animOffset <= 0) return "animation has no data offset";
  if (animation.sectionOffset > 0 || animation.sectionFrameCount > 0) {
    return "animation uses the sectioned fast-lookup layout";
  }
  return null;
}
