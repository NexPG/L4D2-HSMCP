/**
 * `read_model_eyes`: eyeballs and mouths, and why they cannot be written into a QC here.
 *
 * The records are inspectable (bone, model-space and bone-local origin, radius, lid flexes
 * and targets), but L4D2's studiomdl has no `$eyeball`/`$eyelid`/`$mouth` command: both the
 * stock binary and StudioMDL++ reject either the `$` form or the bare one with `bad command`,
 * and neither binary contains the command strings. Valves' L4D2 survivors got their eyes from
 * the DMX pipeline. The tool reports the data and that boundary instead of emitting a QC that
 * cannot compile.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { readMdlBones } from "../formats/mdlbones.js";
import { readEyeData, eyeballMaterial, eyeballSide } from "../formats/mdleyes.js";
import { readFlexHeader } from "../formats/mdlflex.js";
import { looseOrVpk, normalizeModelPath } from "./source.js";

export const readModelEyesTool = defineTool({
  name: "read_model_eyes",
  description:
    "Reads a compiled model's eyeball and mouth records: bone, model-space and bone-local " +
    "origin, radius, z-offset, iris scale, the upper/lower lid flexes and their target " +
    "angles, and the eye material (with the stored index and the `_l`/`_r` guess). Reports " +
    "`qcWritable: false`: L4D2's studiomdl has no `$eyeball`/`$eyelid`/`$mouth` command " +
    "(both compilers reject it), so the records can be inspected but not recreated in a QC; " +
    "eyes come from DMX. Pass an engine model path or a local `.mdl`.",
  realm: "map",
  inputSchema: {
    model: z
      .string()
      .optional()
      .describe("Engine model path; the models/ prefix and .mdl suffix are added if missing."),
    path: z.string().optional().describe("Local .mdl path, absolute or relative to the repo root."),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    path: z.string().nullable(),
    model: z.string().nullable(),
    eyeballCount: z.number(),
    mouthCount: z.number(),
    textures: z.array(z.string()),
    eyeballs: z.array(
      z.object({
        index: z.number(),
        bodyPart: z.number(),
        model: z.number(),
        bone: z.number(),
        boneName: z.string().nullable(),
        side: z.enum(["right", "left"]),
        material: z.string().nullable(),
        materialGuessed: z.boolean(),
        /** The stored origin, already in the bone's local frame. */
        org: z.tuple([z.number(), z.number(), z.number()]),
        zOffset: z.number(),
        radius: z.number(),
        diameter: z.number(),
        /** `atan(zOffset)` in degrees, the value `$eyeball` calls `angle`. */
        angle: z.number(),
        /** `1 / stored irisScale`, the value `$eyeball` takes. */
        iris: z.number(),
        nonFACS: z.boolean(),
        upperLid: z.string().nullable(),
        lowerLid: z.string().nullable(),
        upper: z.array(z.object({ flex: z.string().nullable(), target: z.number() })),
        lower: z.array(z.object({ flex: z.string().nullable(), target: z.number() })),
      }),
    ),
    mouths: z.array(
      z.object({
        index: z.number(),
        bone: z.number(),
        boneName: z.string().nullable(),
        flexDesc: z.number(),
        flex: z.string().nullable(),
        forward: z.tuple([z.number(), z.number(), z.number()]),
      }),
    ),
    qcWritable: z.boolean(),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    let path: string | null = null;
    let model: string | null = null;
    let bytes: Buffer | null = null;
    if (args.path) {
      path = resolveInput(args.path, ctx.config);
      bytes = existsSync(path) ? readFileSync(path) : ctx.config.gameDir ? looseOrVpk(ctx.config.gameDir, path) : null;
      if (!bytes) throw new Error(`${path} was not found`);
    } else if (args.model) {
      if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
      model = normalizeModelPath(args.model);
      path = model;
      bytes = looseOrVpk(game.gameDir, model);
      if (!bytes) throw new Error(`${model} was not found in the game directory or its VPK`);
    } else {
      throw new Error("give `model` (engine path) or `path` (local .mdl)");
    }

    const data = readEyeData(bytes);
    const bones = readMdlBones(bytes);
    const flex = readFlexHeader(bytes);
    const boneName = (index: number): string | null => bones[index]?.name ?? null;
    const flexName = (index: number): string | null => flex.descriptors[index] ?? null;

    return {
      game: gameBlock(game, from),
      path,
      model,
      eyeballCount: data.eyeballs.length,
      mouthCount: data.mouths.length,
      textures: data.textures,
      eyeballs: data.eyeballs.map((eye) => {
        const side = eyeballSide(eye, data.textures);
        const material = eyeballMaterial(eye, data.textures, side);
        return {
          index: eye.index,
          bodyPart: eye.bodyPart,
          model: eye.model,
          bone: eye.bone,
          boneName: boneName(eye.bone),
          side,
          material: material.name,
          materialGuessed: material.guessed,
          org: eye.org,
          zOffset: eye.zOffset,
          radius: eye.radius,
          diameter: eye.radius * 2,
          angle: (Math.atan(eye.zOffset) * 180) / Math.PI,
          iris: 1 / eye.irisScale,
          nonFACS: eye.nonFACS,
          upperLid: flexName(eye.upperLidFlexDesc),
          lowerLid: flexName(eye.lowerLidFlexDesc),
          upper: eye.upperFlexDesc.map((index, position) => ({
            flex: flexName(index),
            target: eye.upperTarget[position]!,
          })),
          lower: eye.lowerFlexDesc.map((index, position) => ({
            flex: flexName(index),
            target: eye.lowerTarget[position]!,
          })),
        };
      }),
      mouths: data.mouths.map((mouth) => ({
        index: mouth.index,
        bone: mouth.bone,
        boneName: boneName(mouth.bone),
        flexDesc: mouth.flexDesc,
        flex: flexName(mouth.flexDesc),
        forward: mouth.forward,
      })),
      qcWritable: false,
      note:
        "L4D2's studiomdl has no $eyeball, $eyelid or $mouth command: bin/studiomdl.exe and " +
        "StudioMDL++ reject both the `$` form and the bare form with `bad command`, and " +
        "neither binary contains the command strings. The records are reported for " +
        "inspection; eyes in this branch are authored in DMX, not in a QC. The model's " +
        "eyelid flexes still survive in the flex data.",
    };
  },
});

export const modelEyesTools = [readModelEyesTool];
