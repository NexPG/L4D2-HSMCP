/**
 * The skeleton and header fields a decompiler needs, read from a compiled `.mdl`.
 *
 * The renderer never needed bones: it draws the reference pose. A decompiler does, because
 * an SMD's nodes and skeleton section are the bone hierarchy, and each vertex line names the
 * bone that owns it. The bone struct is 216 bytes in MDL v49; the fields used here are the
 * name offset, parent, local bind position, local bind quaternion and flags. The pose-to-bone
 * matrix is skipped because SMD vertices are written in model space and only the skeleton
 * needs the local transform.
 */
import type { Vec3 } from "./mdlmesh.js";

export interface ModelBone {
  index: number;
  name: string;
  /** Parent bone index, or -1 for a root. */
  parent: number;
  /** Local bind position, relative to the parent. */
  position: Vec3;
  /** Local bind rotation as a quaternion, `x y z w`. */
  rotation: [number, number, number, number];
  /** The same bind rotation as Euler radians, which is what an SMD skeleton writes. */
  rotationEuler: Vec3;
  /** Scale applied to animation position values. */
  positionScale: Vec3;
  /** Scale applied to animation rotation values. */
  rotationScale: Vec3;
  flags: number;
}

export interface ModelHeaderInfo {
  name: string;
  flags: number;
  eyePosition: Vec3;
  illuminationPosition: Vec3;
  surfaceProp: string | null;
}

const IDST = 0x54534449;
const BONE_BYTES = 216;

function readName(bytes: Buffer, offset: number): string {
  if (offset < 0 || offset >= bytes.length) return "";
  const end = bytes.indexOf(0, offset);
  return bytes.subarray(offset, end < 0 ? bytes.length : end).toString("latin1");
}

export function readModelHeaderInfo(mdl: Buffer): ModelHeaderInfo | null {
  if (mdl.length < 316 || mdl.readInt32LE(0) !== IDST) return null;
  const surfacePropOffset = mdl.readInt32LE(308);
  return {
    name: readName(mdl, 12),
    flags: mdl.readInt32LE(152),
    eyePosition: [mdl.readFloatLE(80), mdl.readFloatLE(84), mdl.readFloatLE(88)],
    illuminationPosition: [mdl.readFloatLE(92), mdl.readFloatLE(96), mdl.readFloatLE(100)],
    surfaceProp:
      surfacePropOffset > 0 && surfacePropOffset < mdl.length
        ? readName(mdl, surfacePropOffset) || null
        : null,
  };
}

export function readMdlBones(mdl: Buffer): ModelBone[] {
  const count = mdl.readInt32LE(156);
  const offset = mdl.readInt32LE(160);
  if (count <= 0 || count > 10_000 || offset <= 0 || offset >= mdl.length) return [];
  const bones: ModelBone[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = offset + i * BONE_BYTES;
    if (base + BONE_BYTES > mdl.length) break;
    const nameOffset = mdl.readInt32LE(base);
    const parent = mdl.readInt32LE(base + 4);
    const position: Vec3 = [
      mdl.readFloatLE(base + 32),
      mdl.readFloatLE(base + 36),
      mdl.readFloatLE(base + 40),
    ];
    const rotationEuler: Vec3 = [
      mdl.readFloatLE(base + 60),
      mdl.readFloatLE(base + 64),
      mdl.readFloatLE(base + 68),
    ];
    const positionScale: Vec3 = [
      mdl.readFloatLE(base + 72),
      mdl.readFloatLE(base + 76),
      mdl.readFloatLE(base + 80),
    ];
    const rotationScale: Vec3 = [
      mdl.readFloatLE(base + 84),
      mdl.readFloatLE(base + 88),
      mdl.readFloatLE(base + 92),
    ];
    let rotation: [number, number, number, number] = [
      mdl.readFloatLE(base + 44),
      mdl.readFloatLE(base + 48),
      mdl.readFloatLE(base + 52),
      mdl.readFloatLE(base + 56),
    ];
    const length = Math.hypot(...rotation);
    if (!Number.isFinite(length) || length < 1e-6) {
      // Fall back to the Euler angles studiomdl stores beside the quaternion.
      rotation = eulerToQuaternion(rotationEuler[0], rotationEuler[1], rotationEuler[2]);
    }
    bones.push({
      index: i,
      name: readName(mdl, nameOffset > 0 ? base + nameOffset : -1) || `bone_${i}`,
      parent,
      position,
      rotation,
      rotationEuler,
      positionScale,
      rotationScale,
      flags: mdl.readInt32LE(base + 160),
    });
  }
  return bones;
}

export function eulerToQuaternion(x: number, y: number, z: number): [number, number, number, number] {
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

/**
 * Source's quaternion-to-Euler conversion, in radians, returning `[roll, pitch, yaw]`.
 *
 * This is the inverse of `eulerToQuaternion` and the order an SMD `time` line writes. At
 * `pitch = ±90°` roll and yaw are not separable; yaw is set to zero and roll carries the
 * combined turn, matching `QuaternionAngles` in the engine.
 */
export function quaternionToEuler([x, y, z, w]: [number, number, number, number]): Vec3 {
  const sinPitch = Math.max(-1, Math.min(1, 2 * (w * y - x * z)));
  const pitch = Math.asin(sinPitch);
  const r01 = 2 * (x * y - w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  if (Math.abs(sinPitch) > 0.9999) {
    return [Math.atan2(sinPitch > 0 ? r01 : -r01, r11), pitch, 0];
  }
  const roll = Math.atan2(2 * (y * z + w * x), 1 - 2 * (x * x + y * y));
  const yaw = Math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z));
  return [roll, pitch, yaw];
}
