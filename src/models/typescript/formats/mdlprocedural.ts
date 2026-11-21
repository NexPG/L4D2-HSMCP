/**
 * Procedural bones (`$proceduralbones` / `.vrd`): quat-interp helpers and aim constraints.
 *
 * The MDL stores both in the bone's procedural record (`proctype` 2 = quat interp, 3 = aim at
 * bone, 4 = aim at attachment; `procindex` relative to the bone):
 *
 * - quat interp: `control, numtriggers, triggerindex` and 48-byte triggers of
 *   `inv_tolerance, trigger quat, pos, quat`.
 * - aim: `parent, aim, aimvector, upvector, basepos` (44 bytes).
 *
 * The `.vrd` text is a line language, not KeyValues. One detail matters for a round trip:
 * the compiler adds `control bone position * percentage` to a trigger's position, where the
 * percentage is the fourth `<display>` number / 100. Writing `<display> 1 1 1 0` therefore
 * makes the stored position exactly the written one, which is what this writer does.
 */
import { quaternionToEuler } from "./mdlbones.js";
import type { ModelBone } from "./mdlbones.js";
import type { MdlAttachment } from "./mdlmeta.js";
import type { Vec3 } from "./mdlmesh.js";

type Quat = [number, number, number, number];

export interface MdlQuatTrigger {
  /** `1 / radian tolerance`. */
  inverseTolerance: number;
  trigger: Quat;
  position: Vec3;
  quat: Quat;
}

export interface MdlProceduralQuat {
  kind: "quatinterp";
  bone: number;
  boneName: string;
  control: number;
  controlName: string;
  triggers: MdlQuatTrigger[];
}

export interface MdlProceduralAim {
  kind: "aim";
  bone: number;
  boneName: string;
  parent: number;
  parentName: string;
  aimKind: "bone" | "attachment";
  aimIndex: number;
  aimName: string | null;
  aim: Vec3;
  up: Vec3;
  basePos: Vec3;
}

export type MdlProcedural = MdlProceduralQuat | MdlProceduralAim;

export const STUDIO_PROC_QUATINTERP = 2;
export const STUDIO_PROC_AIMATBONE = 3;
export const STUDIO_PROC_AIMATATTACH = 4;

function quatAt(mdl: Buffer, at: number): Quat {
  return [
    mdl.readFloatLE(at),
    mdl.readFloatLE(at + 4),
    mdl.readFloatLE(at + 8),
    mdl.readFloatLE(at + 12),
  ];
}

export function readProceduralBones(
  mdl: Buffer,
  bones: readonly ModelBone[],
  attachments: readonly MdlAttachment[] = [],
): MdlProcedural[] {
  const out: MdlProcedural[] = [];
  for (const bone of bones) {
    if (bone.procindex === 0) continue;
    const at = bone.baseOffset + bone.procindex;
    if (at <= bone.baseOffset || at + 12 > mdl.length) continue;
    if (bone.proctype === STUDIO_PROC_QUATINTERP) {
      const control = mdl.readInt32LE(at);
      const count = mdl.readInt32LE(at + 4);
      const triggerOffset = mdl.readInt32LE(at + 8);
      if (count > 0 && count <= 1000 && triggerOffset > 0) {
        const base = at + triggerOffset;
        if (base + count * 48 > mdl.length) continue;
        const triggers: MdlQuatTrigger[] = [];
        for (let index = 0; index < count; index += 1) {
          const record = base + index * 48;
          triggers.push({
            inverseTolerance: mdl.readFloatLE(record),
            trigger: quatAt(mdl, record + 4),
            position: [
              mdl.readFloatLE(record + 20),
              mdl.readFloatLE(record + 24),
              mdl.readFloatLE(record + 28),
            ],
            quat: quatAt(mdl, record + 32),
          });
        }
        out.push({
          kind: "quatinterp",
          bone: bone.index,
          boneName: bone.name,
          control,
          controlName: bones[control]?.name ?? "",
          triggers,
        });
      }
    } else if (bone.proctype === STUDIO_PROC_AIMATBONE || bone.proctype === STUDIO_PROC_AIMATATTACH) {
      const parent = mdl.readInt32LE(at);
      const aimIndex = mdl.readInt32LE(at + 4);
      const aimKind = bone.proctype === STUDIO_PROC_AIMATBONE ? "bone" : "attachment";
      const aimName =
        aimKind === "bone"
          ? (bones[aimIndex]?.name ?? null)
          : (attachments[aimIndex]?.name ?? null);
      out.push({
        kind: "aim",
        bone: bone.index,
        boneName: bone.name,
        parent,
        parentName: bones[parent]?.name ?? "",
        aimKind,
        aimIndex,
        aimName,
        aim: [mdl.readFloatLE(at + 8), mdl.readFloatLE(at + 12), mdl.readFloatLE(at + 16)],
        up: [mdl.readFloatLE(at + 20), mdl.readFloatLE(at + 24), mdl.readFloatLE(at + 28)],
        basePos: [mdl.readFloatLE(at + 32), mdl.readFloatLE(at + 36), mdl.readFloatLE(at + 40)],
      });
    }
  }
  return out;
}

const fmt = (value: number): string => (Number.isFinite(value) ? value.toFixed(6) : "0.000000");
const degrees = (radians: number): number => (radians * 180) / Math.PI;

/** A VRD wants bone names with everything up to and including the first dot removed. */
function vrdName(name: string): string {
  const cut = name.indexOf(".");
  return cut >= 0 ? name.slice(cut + 1) : name;
}

function eulerDegrees(quat: Quat): string {
  const [roll, pitch, yaw] = quaternionToEuler(quat);
  return `${fmt(degrees(roll))} ${fmt(degrees(pitch))} ${fmt(degrees(yaw))}`;
}

/**
 * Builds the `.vrd` text for the procedural records.
 *
 * `<display> 1 1 1 0` zeroes the control-position percentage, so a trigger's stored position
 * is exactly the number written; the alternative (Crowbar's 100) adds the control bone's
 * position on every compile and the VRD drifts away from the model.
 */
export function buildVrd(
  entries: readonly MdlProcedural[],
  bones: readonly ModelBone[],
): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "quatinterp") {
      const control = bones[entry.control];
      const controlParent = control && control.parent >= 0 ? bones[control.parent] : null;
      const bone = bones[entry.bone];
      const parent = bone && bone.parent >= 0 ? bones[bone.parent] : null;
      lines.push(
        `<helper> ${vrdName(entry.boneName)} ${vrdName(parent?.name ?? "")} ` +
          `${vrdName(controlParent?.name ?? "")} ${vrdName(entry.controlName)}`,
        "<display> 1 1 1 0",
        "<basepos> 0 0 0",
      );
      for (const trigger of entry.triggers) {
        const tolerance = trigger.inverseTolerance !== 0 ? degrees(1 / trigger.inverseTolerance) : 0;
        lines.push(
          `<trigger> ${fmt(tolerance)} ${eulerDegrees(trigger.trigger)} ` +
            `${eulerDegrees(trigger.quat)} ${trigger.position.map(fmt).join(" ")}`,
        );
      }
    } else {
      lines.push(
        `<aimconstraint> ${vrdName(entry.boneName)} ${vrdName(entry.parentName)} ` +
          `${vrdName(entry.aimName ?? "")}`,
        `<aimvector> ${entry.aim.map(fmt).join(" ")}`,
        `<upvector> ${entry.up.map(fmt).join(" ")}`,
        `<basepos> ${entry.basePos.map(fmt).join(" ")}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
