/**
 * `read_model_animation`: sequences, events, pose parameters, IK chains and includes.
 *
 * The compiled `.mdl` keeps more than the frames: every sequence has its activity, flags,
 * fade times, pose ranges and an `event` list (`AE_MUZZLEFLASH`, `5004`, ...), and the model
 * names the animation models it reuses. This tool reports that structure without decoding
 * frames; `decompile_model` is the one that writes SMDs.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import {
  readAnimations,
  readIkChains,
  readPoseParams,
  readSequences,
  sequenceAnimationIndices,
} from "../formats/mdlanim.js";
import { readIncludedModels } from "../formats/mdlmeta.js";
import { looseOrVpk, normalizeModelPath } from "./source.js";

/** `STUDIO_LOOPING`: the sequence loops instead of stopping on its last frame. */
const STUDIO_LOOPING = 1;

const EVENT = z.object({
  cycle: z.number(),
  /** `round(cycle * (frameCount - 1))`, with a one-frame clip pinned to 0. */
  frame: z.number(),
  event: z.number(),
  type: z.number(),
  name: z.string(),
  options: z.string(),
});

export const readModelAnimationTool = defineTool({
  name: "read_model_animation",
  description:
    "Reads a compiled model's animation structure: every sequence with its activity, flags, " +
    "fps, frame count, blend width and pose range, the `mstudioevent_t` events (name or " +
    "numeric id, frame and options), the pose parameters, the IK chains, and the " +
    "`$includemodel` entries that let a survivor reuse another model's sequences. Reports " +
    "whether each animation lives in the `.mdl` or in an external `.ani`. Frames are not " +
    "decoded; use `decompile_model` for SMDs. Pass an engine model path or a local `.mdl`.",
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
    sequence: z
      .string()
      .optional()
      .describe("Only report sequences whose name contains this text (case-insensitive)."),
    limit: z.number().int().min(1).max(5000).default(200),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    path: z.string().nullable(),
    model: z.string().nullable(),
    sequenceCount: z.number(),
    animationCount: z.number(),
    returned: z.number(),
    sequences: z.array(
      z.object({
        index: z.number(),
        name: z.string(),
        activity: z.number(),
        activityName: z.string(),
        flags: z.number(),
        loop: z.boolean(),
        fps: z.number(),
        frameCount: z.number(),
        blendCount: z.number(),
        groupSizes: z.tuple([z.number(), z.number()]),
        animationIndices: z.array(z.number()),
        animationNames: z.array(z.string()),
        paramIndices: z.tuple([z.number(), z.number()]),
        paramStart: z.tuple([z.number(), z.number()]),
        paramEnd: z.tuple([z.number(), z.number()]),
        /** IK rules the sequence carries; the decompiler cannot write `ikrule` back. */
        ikrules: z.number(),
        /** `addlayer`/`blendlayer` entries on the sequence. */
        autolayers: z.number(),
        weightlist: z.number(),
        events: z.array(EVENT),
      }),
    ),
    animations: z.array(
      z.object({
        index: z.number(),
        name: z.string(),
        fps: z.number(),
        frameCount: z.number(),
        flags: z.number(),
        /** Non-zero means the data is in an external `.ani` block. */
        animBlock: z.number(),
        external: z.boolean(),
        sectionFrameCount: z.number(),
      }),
    ),
    poseParams: z.array(
      z.object({
        index: z.number(),
        name: z.string(),
        flags: z.number(),
        start: z.number(),
        end: z.number(),
        loop: z.number(),
      }),
    ),
    ikChains: z.array(
      z.object({
        index: z.number(),
        name: z.string(),
        linkType: z.number(),
        bones: z.array(z.number()),
        /** `$ikchain`'s knee hint (first link's ideal bending direction). */
        knee: z.tuple([z.number(), z.number(), z.number()]),
      }),
    ),
    includedModels: z.array(
      z.object({ index: z.number(), label: z.string(), model: z.string() }),
    ),
    mass: z.number(),
    contents: z.number(),
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

    const animations = readAnimations(bytes);
    const sequences = readSequences(bytes, animations);
    const filter = args.sequence?.toLowerCase();
    const matching = filter
      ? sequences.filter((sequence) => sequence.name.toLowerCase().includes(filter))
      : sequences;

    const warnings: string[] = [];
    if (sequences.length === 0) warnings.push("The .mdl has no readable sequence list.");
    if (animations.length === 0) warnings.push("The .mdl has no readable animation list.");
    const external = animations.filter((animation) => animation.animBlock !== 0);
    if (external.length > 0) {
      warnings.push(
        `${external.length} of ${animations.length} animations live in external .ani blocks; ` +
          "this tool reports their descriptors, not frames.",
      );
    }

    return {
      game: gameBlock(game, from),
      path,
      model,
      sequenceCount: sequences.length,
      animationCount: animations.length,
      returned: Math.min(matching.length, args.limit),
      sequences: matching.slice(0, args.limit).map((sequence) => {
        const indices = sequenceAnimationIndices(bytes, sequence);
        return {
          index: sequence.index,
          name: sequence.name,
          activity: sequence.activity,
          activityName: sequence.activityName,
          flags: sequence.flags,
          loop: (sequence.flags & STUDIO_LOOPING) !== 0,
          fps: sequence.fps,
          frameCount: sequence.frameCount,
          blendCount: sequence.blendCount,
          groupSizes: sequence.groupSizes,
          animationIndices: indices,
          animationNames: indices.map((index) => animations[index]?.name ?? `animation_${index}`),
          paramIndices: sequence.paramIndices,
          paramStart: sequence.paramStart,
          paramEnd: sequence.paramEnd,
          ikrules: sequence.ikrules,
          autolayers: sequence.autolayers,
          weightlist: sequence.weightlist,
          events: sequence.events.map((event) => ({
            ...event,
            frame:
              sequence.frameCount <= 1
                ? 0
                : Math.round(event.cycle * (sequence.frameCount - 1)),
          })),
        };
      }),
      animations: animations.map((animation) => ({
        index: animation.index,
        name: animation.name,
        fps: animation.fps,
        frameCount: animation.frameCount,
        flags: animation.flags,
        animBlock: animation.animBlock,
        external: animation.animBlock !== 0,
        sectionFrameCount: animation.sectionFrameCount,
      })),
      poseParams: readPoseParams(bytes),
      ikChains: readIkChains(bytes),
      includedModels: readIncludedModels(bytes),
      mass: bytes.length >= 332 ? bytes.readFloatLE(328) : 0,
      contents: bytes.length >= 336 ? bytes.readInt32LE(332) : 0,
      warnings,
    };
  },
});

export const modelAnimationTools = [readModelAnimationTool];
