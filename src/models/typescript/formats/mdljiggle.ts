/**
 * Jigglebones: the `mstudiojigglebone_t` record a bone's `proctype 5` points at.
 *
 * The bone record stores `proctype` (164) and `procindex` (168); `procindex` is relative to
 * the bone record and points at 140 bytes of jiggle data. The flags pick which blocks the
 * QC needs: flexible, rigid, yaw/pitch/angle constraints, a length constraint, a base
 * spring and the "boing" squash. The file stores angles in radians except the boing impact
 * angle, which is `cos(angle)`; the QC takes degrees and the angle itself, so the writer
 * reverses both.
 */
import type { ModelBone } from "./mdlbones.js";

export const JIGGLE_IS_FLEXIBLE = 0x01;
export const JIGGLE_IS_RIGID = 0x02;
export const JIGGLE_HAS_YAW_CONSTRAINT = 0x04;
export const JIGGLE_HAS_PITCH_CONSTRAINT = 0x08;
export const JIGGLE_HAS_ANGLE_CONSTRAINT = 0x10;
export const JIGGLE_HAS_LENGTH_CONSTRAINT = 0x20;
export const JIGGLE_HAS_BASE_SPRING = 0x40;
export const JIGGLE_IS_BOING = 0x80;
/** `STUDIO_PROC_JIGGLE`. */
export const STUDIO_PROC_JIGGLE = 5;

export const JIGGLE_BYTES = 140;

export interface MdlJiggleBone {
  bone: number;
  boneName: string;
  flags: number;
  length: number;
  tipMass: number;
  yawStiffness: number;
  yawDamping: number;
  pitchStiffness: number;
  pitchDamping: number;
  alongStiffness: number;
  alongDamping: number;
  angleLimit: number;
  minYaw: number;
  maxYaw: number;
  yawFriction: number;
  yawBounce: number;
  minPitch: number;
  maxPitch: number;
  pitchFriction: number;
  pitchBounce: number;
  baseMass: number;
  baseStiffness: number;
  baseDamping: number;
  baseMinLeft: number;
  baseMaxLeft: number;
  baseLeftFriction: number;
  baseMinUp: number;
  baseMaxUp: number;
  baseUpFriction: number;
  baseMinForward: number;
  baseMaxForward: number;
  baseForwardFriction: number;
  boingImpactSpeed: number;
  /** Stored as `cos(angle)` in radians. */
  boingImpactAngle: number;
  boingDampingRate: number;
  boingFrequency: number;
  boingAmplitude: number;
}

export function readJiggleBones(mdl: Buffer, bones: readonly ModelBone[]): MdlJiggleBone[] {
  const out: MdlJiggleBone[] = [];
  for (const bone of bones) {
    if (bone.proctype !== STUDIO_PROC_JIGGLE || bone.procindex === 0) continue;
    const at = bone.baseOffset + bone.procindex;
    if (at <= bone.baseOffset || at + JIGGLE_BYTES > mdl.length) continue;
    const f = (offset: number): number => mdl.readFloatLE(at + offset);
    out.push({
      bone: bone.index,
      boneName: bone.name,
      flags: mdl.readInt32LE(at),
      length: f(4),
      tipMass: f(8),
      yawStiffness: f(12),
      yawDamping: f(16),
      pitchStiffness: f(20),
      pitchDamping: f(24),
      alongStiffness: f(28),
      alongDamping: f(32),
      angleLimit: f(36),
      minYaw: f(40),
      maxYaw: f(44),
      yawFriction: f(48),
      yawBounce: f(52),
      minPitch: f(56),
      maxPitch: f(60),
      pitchFriction: f(64),
      pitchBounce: f(68),
      baseMass: f(72),
      baseStiffness: f(76),
      baseDamping: f(80),
      baseMinLeft: f(84),
      baseMaxLeft: f(88),
      baseLeftFriction: f(92),
      baseMinUp: f(96),
      baseMaxUp: f(100),
      baseUpFriction: f(104),
      baseMinForward: f(108),
      baseMaxForward: f(112),
      baseForwardFriction: f(116),
      boingImpactSpeed: f(120),
      boingImpactAngle: f(124),
      boingDampingRate: f(128),
      boingFrequency: f(132),
      boingAmplitude: f(136),
    });
  }
  return out;
}

const fmt = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : "0.000000");
const degrees = (radians: number): number => (radians * 180) / Math.PI;

/** The `$jigglebone` block, in the order and with the flags the compiler writes. */
export function jiggleQcLines(jiggle: MdlJiggleBone): string[] {
  const lines: string[] = [`$jigglebone "${jiggle.boneName.replace(/"/g, "")}"`, "{"];
  const constraints = (indent: string): void => {
    if ((jiggle.flags & JIGGLE_HAS_PITCH_CONSTRAINT) !== 0) {
      lines.push(
        `${indent}pitch_constraint ${fmt(degrees(jiggle.minPitch))} ${fmt(degrees(jiggle.maxPitch))}`,
        `${indent}pitch_friction ${fmt(jiggle.pitchFriction)}`,
        `${indent}pitch_bounce ${fmt(jiggle.pitchBounce)}`,
      );
    }
    if ((jiggle.flags & JIGGLE_HAS_YAW_CONSTRAINT) !== 0) {
      lines.push(
        `${indent}yaw_constraint ${fmt(degrees(jiggle.minYaw))} ${fmt(degrees(jiggle.maxYaw))}`,
        `${indent}yaw_friction ${fmt(jiggle.yawFriction)}`,
        `${indent}yaw_bounce ${fmt(jiggle.yawBounce)}`,
      );
    }
    if ((jiggle.flags & JIGGLE_HAS_ANGLE_CONSTRAINT) !== 0) {
      lines.push(`${indent}angle_constraint ${fmt(degrees(jiggle.angleLimit))}`);
    }
  };

  if ((jiggle.flags & JIGGLE_IS_FLEXIBLE) !== 0) {
    lines.push("\tis_flexible", "\t{");
    lines.push(
      `\t\tlength ${fmt(jiggle.length)}`,
      `\t\ttip_mass ${fmt(jiggle.tipMass)}`,
      `\t\tpitch_stiffness ${fmt(jiggle.pitchStiffness)}`,
      `\t\tpitch_damping ${fmt(jiggle.pitchDamping)}`,
      `\t\tyaw_stiffness ${fmt(jiggle.yawStiffness)}`,
      `\t\tyaw_damping ${fmt(jiggle.yawDamping)}`,
    );
    if ((jiggle.flags & JIGGLE_HAS_LENGTH_CONSTRAINT) === 0) {
      lines.push("\t\tallow_length_flex");
    }
    lines.push(
      `\t\talong_stiffness ${fmt(jiggle.alongStiffness)}`,
      `\t\talong_damping ${fmt(jiggle.alongDamping)}`,
    );
    constraints("\t\t");
    lines.push("\t}");
  }
  if ((jiggle.flags & JIGGLE_IS_RIGID) !== 0) {
    lines.push(
      "\tis_rigid",
      "\t{",
      `\t\tlength ${fmt(jiggle.length)}`,
      `\t\ttip_mass ${fmt(jiggle.tipMass)}`,
    );
    constraints("\t\t");
    lines.push("\t}");
  }
  if ((jiggle.flags & JIGGLE_HAS_BASE_SPRING) !== 0) {
    lines.push(
      "\thas_base_spring",
      "\t{",
      `\t\tbase_mass ${fmt(jiggle.baseMass)}`,
      `\t\tstiffness ${fmt(jiggle.baseStiffness)}`,
      `\t\tdamping ${fmt(jiggle.baseDamping)}`,
      `\t\tleft_constraint ${fmt(jiggle.baseMinLeft)} ${fmt(jiggle.baseMaxLeft)}`,
      `\t\tleft_friction ${fmt(jiggle.baseLeftFriction)}`,
      `\t\tup_constraint ${fmt(jiggle.baseMinUp)} ${fmt(jiggle.baseMaxUp)}`,
      `\t\tup_friction ${fmt(jiggle.baseUpFriction)}`,
      `\t\tforward_constraint ${fmt(jiggle.baseMinForward)} ${fmt(jiggle.baseMaxForward)}`,
      `\t\tforward_friction ${fmt(jiggle.baseForwardFriction)}`,
      "\t}",
    );
  }
  if ((jiggle.flags & JIGGLE_IS_BOING) !== 0) {
    const impact = degrees(Math.acos(Math.max(-1, Math.min(1, jiggle.boingImpactAngle))));
    lines.push(
      "\tis_boing",
      "\t{",
      `\t\timpact_speed ${fmt(jiggle.boingImpactSpeed)}`,
      `\t\timpact_angle ${fmt(impact)}`,
      `\t\tdamping_rate ${fmt(jiggle.boingDampingRate)}`,
      `\t\tfrequency ${fmt(jiggle.boingFrequency)}`,
      `\t\tamplitude ${fmt(jiggle.boingAmplitude)}`,
      "\t}",
    );
  }
  lines.push("}");
  return lines;
}
