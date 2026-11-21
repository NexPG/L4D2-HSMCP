/**
 * Eyeballs and mouths from a compiled model.
 *
 * The records are stored per body-part model (`mstudiomodel_t` at offsets 100/104) and, for
 * mouths, once in the header (292/296). `$eyeball` wants its position in the bone's local
 * frame while the file stores it in model space, so the reader resolves the bind pose and
 * converts. The stored texture index on the stock survivors points at the head material
 * (0), not the eyeball material; this reader therefore prefers a texture whose name says
 * `eyeball_l`/`eyeball_r`, matching the eye's side, and reports which one it used.
 *
 * L4D2's studiomdl has no `$eyeball`/`$eyelid`/`$mouth` command: the strings are absent from
 * both `bin/studiomdl.exe` and StudioMDL++, and a QC containing either form fails with
 * `bad command`. Eyes in this branch are authored in DMX. This reader exists so the data is
 * inspectable even though the QC text path cannot recreate it.
 */
import type { Vec3 } from "./mdlmesh.js";

export interface MdlEyeball {
  index: number;
  bodyPart: number;
  model: number;
  /** Bone index the eye is attached to. */
  bone: number;
  /**
   * The stored origin. On the stock survivors its magnitude is ~3 units while the head bone
   * sits at z ~57-68, and it is the value that differs by 1.2 units between the eyes: it is
   * already in the bone's local frame, not model space.
   */
  org: Vec3;
  zOffset: number;
  radius: number;
  up: Vec3;
  forward: Vec3;
  /** Stored texture index; on stock survivors this is 0 (the head material). */
  texture: number;
  /** Stored as `1 / scale`; the QC argument is the inverse of this. */
  irisScale: number;
  upperFlexDesc: [number, number, number];
  lowerFlexDesc: [number, number, number];
  /** Lid angles in radians, lowerer/neutral/raiser. */
  upperTarget: [number, number, number];
  lowerTarget: [number, number, number];
  upperLidFlexDesc: number;
  lowerLidFlexDesc: number;
  nonFACS: boolean;
}

export interface MdlMouth {
  index: number;
  bone: number;
  forward: Vec3;
  flexDesc: number;
}

export interface MdlEyeData {
  /** The model's `mstudiotexture_t` names, in index order. */
  textures: string[];
  eyeballs: MdlEyeball[];
  mouths: MdlMouth[];
}

function readName(mdl: Buffer, at: number): string {
  if (at < 0 || at >= mdl.length) return "";
  const end = mdl.indexOf(0, at);
  return mdl.subarray(at, end < 0 ? mdl.length : end).toString("latin1");
}

/** The `mstudiotexture_t` table (count 204, offset 208; 64 bytes per record). */
export function readMdlTextures(mdl: Buffer): string[] {
  if (mdl.length < 212) return [];
  const count = mdl.readInt32LE(204);
  const offset = mdl.readInt32LE(208);
  if (count <= 0 || count > 10_000 || offset <= 0 || offset >= mdl.length) return [];
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = offset + index * 64;
    if (base + 64 > mdl.length) break;
    names.push(readName(mdl, base + mdl.readInt32LE(base)));
  }
  return names;
}

/** Reads every eyeball and mouth. A malformed record stops that model, not the file. */
export function readEyeData(mdl: Buffer): MdlEyeData {
  const textures = readMdlTextures(mdl);
  const eyeballs: MdlEyeball[] = [];
  const mouths: MdlMouth[] = [];

  if (mdl.length >= 236) {
    const partCount = mdl.readInt32LE(232);
    const partOffset = mdl.readInt32LE(236);
    if (partCount > 0 && partCount < 5000 && partOffset > 0 && partOffset < mdl.length) {
      for (let part = 0; part < partCount; part += 1) {
        const partBase = partOffset + part * 16;
        if (partBase + 16 > mdl.length) break;
        const modelCount = mdl.readInt32LE(partBase + 4);
        const modelOffset = mdl.readInt32LE(partBase + 12);
        if (modelCount < 0 || modelCount > 5000) continue;
        for (let model = 0; model < modelCount; model += 1) {
          const modelBase = partBase + modelOffset + model * 148;
          if (modelBase + 148 > mdl.length) break;
          const count = mdl.readInt32LE(modelBase + 100);
          const indexOffset = mdl.readInt32LE(modelBase + 104);
          if (count <= 0 || count > 64 || indexOffset <= 0) continue;
          for (let eye = 0; eye < count; eye += 1) {
            const at = modelBase + indexOffset + eye * 172;
            if (at + 172 > mdl.length) break;
            const org: Vec3 = [
              mdl.readFloatLE(at + 8),
              mdl.readFloatLE(at + 12),
              mdl.readFloatLE(at + 16),
            ];
            const bone = mdl.readInt32LE(at + 4);
            eyeballs.push({
              index: eye,
              bodyPart: part,
              model,
              bone,
              org,
              zOffset: mdl.readFloatLE(at + 20),
              radius: mdl.readFloatLE(at + 24),
              up: [mdl.readFloatLE(at + 28), mdl.readFloatLE(at + 32), mdl.readFloatLE(at + 36)],
              forward: [
                mdl.readFloatLE(at + 40),
                mdl.readFloatLE(at + 44),
                mdl.readFloatLE(at + 48),
              ],
              texture: mdl.readInt32LE(at + 52),
              irisScale: mdl.readFloatLE(at + 60),
              upperFlexDesc: [
                mdl.readInt32LE(at + 68),
                mdl.readInt32LE(at + 72),
                mdl.readInt32LE(at + 76),
              ],
              lowerFlexDesc: [
                mdl.readInt32LE(at + 80),
                mdl.readInt32LE(at + 84),
                mdl.readInt32LE(at + 88),
              ],
              upperTarget: [
                mdl.readFloatLE(at + 92),
                mdl.readFloatLE(at + 96),
                mdl.readFloatLE(at + 100),
              ],
              lowerTarget: [
                mdl.readFloatLE(at + 104),
                mdl.readFloatLE(at + 108),
                mdl.readFloatLE(at + 112),
              ],
              upperLidFlexDesc: mdl.readInt32LE(at + 116),
              lowerLidFlexDesc: mdl.readInt32LE(at + 120),
              nonFACS: mdl.readUInt8(at + 140) !== 0,
            });
          }
        }
      }
    }
  }

  if (mdl.length >= 300) {
    const count = mdl.readInt32LE(292);
    const offset = mdl.readInt32LE(296);
    if (count > 0 && count < 1000 && offset > 0 && offset + count * 20 <= mdl.length) {
      for (let index = 0; index < count; index += 1) {
        const at = offset + index * 20;
        mouths.push({
          index,
          bone: mdl.readInt32LE(at),
          forward: [
            mdl.readFloatLE(at + 4),
            mdl.readFloatLE(at + 8),
            mdl.readFloatLE(at + 12),
          ],
          flexDesc: mdl.readInt32LE(at + 16),
        });
      }
    }
  }

  return { textures, eyeballs, mouths };
}

/**
 * The eye's side, from its material name if possible, else the z-offset sign. The two stock
 * eyes differ only by that sign and by the `_l`/`_r` texture suffix.
 */
export function eyeballSide(eye: MdlEyeball, textures: string[]): "right" | "left" {
  const stored = textures[eye.texture]?.toLowerCase() ?? "";
  if (stored.includes("_r") || stored.endsWith("r")) return "right";
  if (stored.includes("_l") || stored.endsWith("l")) return "left";
  return eye.zOffset >= 0 ? "right" : "left";
}

/**
 * The material the eye should use. The stored index on the stock survivors is 0, which is
 * the head; prefer a texture whose name contains `eyeball` and the eye's side.
 */
export function eyeballMaterial(
  eye: MdlEyeball,
  textures: string[],
  side: "right" | "left",
): { name: string | null; guessed: boolean } {
  const suffix = side === "right" ? "_r" : "_l";
  const match = textures.find((name) => {
    const lower = name.toLowerCase();
    return lower.includes("eyeball") && lower.includes(suffix);
  });
  if (match) return { name: match, guessed: true };
  const stored = textures[eye.texture];
  return { name: stored ?? null, guessed: false };
}
