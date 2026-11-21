/**
 * `read_model_skeleton`: the bind pose as `$definebone` lines.
 *
 * A compiled model's bone records are parent-relative: position in Source units and a local
 * quaternion. `$definebone` wants the same position and Euler angles in a specific order.
 * That order was checked against the 63-line `bones.qci` shipped with the viewmodel prefabs:
 * all 63 match `v_bat.mdl` by name, parent, position and `(y, z, x)` degrees within 1e-4.
 * Writing that order wrong compiles, but every bone points somewhere else, so the tool
 * emits the line it verified rather than an angle triple with a guessed order.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { readMdlBones } from "../formats/mdlbones.js";
import type { ModelBone } from "../formats/mdlbones.js";
import { looseOrVpk, normalizeModelPath } from "./source.js";

const fmt = (value: number): string => (Object.is(value, -0) ? 0 : value).toFixed(6);

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function defineBoneLine(bone: ModelBone, byIndex: Map<number, ModelBone>): string {
  const parent = bone.parent >= 0 ? (byIndex.get(bone.parent)?.name ?? "") : "";
  const [roll, pitch, yaw] = bone.rotationEuler;
  // `$definebone` takes the rotation as (y, z, x), i.e. (pitch, yaw, roll) of the stored
  // Euler. This is the order the reference `bones.qci` uses; do not "fix" it by eye.
  return (
    `$definebone "${bone.name.replace(/"/g, "")}" "${parent.replace(/"/g, "")}" ` +
    `${fmt(bone.position[0])} ${fmt(bone.position[1])} ${fmt(bone.position[2])} ` +
    `${fmt(degrees(pitch))} ${fmt(degrees(yaw))} ${fmt(degrees(roll))}`
  );
}

/** The verified `$definebone` lines for a bone list, in index order. */
export function defineBoneLines(bones: ModelBone[]): string[] {
  const byIndex = new Map(bones.map((bone) => [bone.index, bone]));
  return bones.map((bone) => defineBoneLine(bone, byIndex));
}

export const readModelSkeletonTool = defineTool({
  name: "read_model_skeleton",
  description:
    "Reads a model's skeleton and writes the bind pose as ready-to-paste `$definebone` " +
    "lines. Each bone reports its local position in Source units, its local Euler in " +
    "degrees, and the `(y, z, x)` degree triple that `$definebone` takes; the order was " +
    "verified against the viewmodel pack's `bones.qci` for all 63 bones of `v_bat`. Use it " +
    "to generate a canonical skeleton from a stock model instead of pasting third-party " +
    "numbers, and to see parents and flags before editing a QC. Pass an engine model path " +
    "or a local `.mdl`.",
  realm: "map",
  inputSchema: {
    model: z
      .string()
      .optional()
      .describe("Engine model path; the models/ prefix and .mdl suffix are added if missing."),
    path: z
      .string()
      .optional()
      .describe("Local .mdl path, absolute or relative to the repo root."),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    path: z.string().nullable(),
    model: z.string().nullable(),
    boneCount: z.number(),
    rootCount: z.number(),
    bones: z.array(
      z.object({
        index: z.number(),
        name: z.string(),
        parent: z.number(),
        parentName: z.string().nullable(),
        /** Local bind position, in Source units. */
        position: z.tuple([z.number(), z.number(), z.number()]),
        /** Local bind Euler in degrees, in the model's stored (x, y, z) order. */
        rotation: z.tuple([z.number(), z.number(), z.number()]),
        /** The same rotation in the `(y, z, x)` order `$definebone` takes. */
        defineBoneRotation: z.tuple([z.number(), z.number(), z.number()]),
        flags: z.number(),
      }),
    ),
    /** One line per bone, in index order. */
    defineBones: z.array(z.string()),
    /** The same lines joined, for a `.qci` or the top of a QC. */
    qc: z.string(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    let path: string | null = null;
    let model: string | null = null;
    let bytes: Buffer | null = null;

    if (args.path) {
      path = resolveInput(args.path, ctx.config);
      bytes = existsSync(path)
        ? readFileSync(path)
        : ctx.config.gameDir
          ? looseOrVpk(ctx.config.gameDir, path)
          : null;
      if (!bytes) throw new Error(`${path} was not found`);
    } else if (args.model) {
      if (!game.gameDir) {
        throw new Error("the game directory is not resolved; run health first");
      }
      model = normalizeModelPath(args.model);
      path = model;
      bytes = looseOrVpk(game.gameDir, model);
      if (!bytes) throw new Error(`${model} was not found in the game directory or its VPK`);
    } else {
      throw new Error("give `model` (engine path) or `path` (local .mdl)");
    }

    const bones = readMdlBones(bytes);
    const byIndex = new Map(bones.map((bone) => [bone.index, bone]));
    const warnings: string[] = [];
    if (bones.length === 0) {
      warnings.push("The .mdl has no readable bones; no $definebone lines were generated.");
    }
    const names = new Set<string>();
    for (const bone of bones) {
      if (names.has(bone.name)) {
        warnings.push(`Bone name "${bone.name}" appears more than once; $definebone would keep the last.`);
      }
      names.add(bone.name);
      if (bone.parent >= bone.index) {
        warnings.push(
          `${bone.name} (index ${bone.index}) has parent ${bone.parent}, which is not earlier in the file; ` +
            "studiomdl expects parents first.",
        );
      }
    }

    const defineBones = defineBoneLines(bones);
    return {
      game: gameBlock(game, from),
      path,
      model,
      boneCount: bones.length,
      rootCount: bones.filter((bone) => bone.parent < 0).length,
      bones: bones.map((bone) => {
        const [roll, pitch, yaw] = bone.rotationEuler;
        return {
          index: bone.index,
          name: bone.name,
          parent: bone.parent,
          parentName: bone.parent >= 0 ? (byIndex.get(bone.parent)?.name ?? null) : null,
          position: [...bone.position] as [number, number, number],
          rotation: [degrees(roll), degrees(pitch), degrees(yaw)] as [number, number, number],
          defineBoneRotation: [degrees(pitch), degrees(yaw), degrees(roll)] as [
            number,
            number,
            number,
          ],
          flags: bone.flags,
        };
      }),
      defineBones,
      qc: defineBones.length > 0 ? `${defineBones.join("\n")}\n` : "",
      warnings,
    };
  },
});

export const modelSkeletonTools = [readModelSkeletonTool];
