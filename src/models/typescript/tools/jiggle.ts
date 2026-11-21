/**
 * `read_model_jiggle`: the `$jigglebone` blocks a compiled model carries.
 *
 * A bone with `proctype 5` points at 140 bytes of jiggle data. The reader exposes the flags
 * and every field, and the QC block it would write. The decompiler writes the same block;
 * this tool exists so a model can be inspected without decompiling it first.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { readMdlBones } from "../formats/mdlbones.js";
import {
  JIGGLE_HAS_ANGLE_CONSTRAINT,
  JIGGLE_HAS_BASE_SPRING,
  JIGGLE_HAS_LENGTH_CONSTRAINT,
  JIGGLE_HAS_PITCH_CONSTRAINT,
  JIGGLE_HAS_YAW_CONSTRAINT,
  JIGGLE_IS_BOING,
  JIGGLE_IS_FLEXIBLE,
  JIGGLE_IS_RIGID,
  jiggleQcLines,
  readJiggleBones,
} from "../formats/mdljiggle.js";
import { looseOrVpk, normalizeModelPath } from "./source.js";

const ENTRY = z.object({
  bone: z.number(),
  boneName: z.string(),
  flags: z.number(),
  flexible: z.boolean(),
  rigid: z.boolean(),
  hasYawConstraint: z.boolean(),
  hasPitchConstraint: z.boolean(),
  hasAngleConstraint: z.boolean(),
  hasLengthConstraint: z.boolean(),
  hasBaseSpring: z.boolean(),
  boing: z.boolean(),
  length: z.number(),
  tipMass: z.number(),
  yawStiffness: z.number(),
  yawDamping: z.number(),
  pitchStiffness: z.number(),
  pitchDamping: z.number(),
  alongStiffness: z.number(),
  alongDamping: z.number(),
  /** Radians, as stored. */
  angleLimit: z.number(),
  minYaw: z.number(),
  maxYaw: z.number(),
  yawFriction: z.number(),
  yawBounce: z.number(),
  minPitch: z.number(),
  maxPitch: z.number(),
  pitchFriction: z.number(),
  pitchBounce: z.number(),
  baseMass: z.number(),
  baseStiffness: z.number(),
  baseDamping: z.number(),
  boingImpactSpeed: z.number(),
  /** Stored as `cos(angle)`. */
  boingImpactAngle: z.number(),
  boingDampingRate: z.number(),
  boingFrequency: z.number(),
  boingAmplitude: z.number(),
  /** The exact `$jigglebone` block, ready to paste. */
  qc: z.string(),
});

export const readModelJiggleTool = defineTool({
  name: "read_model_jiggle",
  description:
    "Reads a compiled model's jigglebones: each bone with `proctype 5`, its flags, length, " +
    "tip mass, stiffness/damping, angle and pitch/yaw constraints, base spring and boing " +
    "parameters, plus the exact `$jigglebone` block. Stock L4D2 has none; the tool is for " +
    "custom models. Pass an engine model path or a local `.mdl`.",
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
    count: z.number(),
    entries: z.array(ENTRY),
    note: z.string().optional(),
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

    const entries = readJiggleBones(bytes, readMdlBones(bytes));
    return {
      game: gameBlock(game, from),
      path,
      model,
      count: entries.length,
      entries: entries.map((entry) => ({
        bone: entry.bone,
        boneName: entry.boneName,
        flags: entry.flags,
        flexible: (entry.flags & JIGGLE_IS_FLEXIBLE) !== 0,
        rigid: (entry.flags & JIGGLE_IS_RIGID) !== 0,
        hasYawConstraint: (entry.flags & JIGGLE_HAS_YAW_CONSTRAINT) !== 0,
        hasPitchConstraint: (entry.flags & JIGGLE_HAS_PITCH_CONSTRAINT) !== 0,
        hasAngleConstraint: (entry.flags & JIGGLE_HAS_ANGLE_CONSTRAINT) !== 0,
        hasLengthConstraint: (entry.flags & JIGGLE_HAS_LENGTH_CONSTRAINT) !== 0,
        hasBaseSpring: (entry.flags & JIGGLE_HAS_BASE_SPRING) !== 0,
        boing: (entry.flags & JIGGLE_IS_BOING) !== 0,
        length: entry.length,
        tipMass: entry.tipMass,
        yawStiffness: entry.yawStiffness,
        yawDamping: entry.yawDamping,
        pitchStiffness: entry.pitchStiffness,
        pitchDamping: entry.pitchDamping,
        alongStiffness: entry.alongStiffness,
        alongDamping: entry.alongDamping,
        angleLimit: entry.angleLimit,
        minYaw: entry.minYaw,
        maxYaw: entry.maxYaw,
        yawFriction: entry.yawFriction,
        yawBounce: entry.yawBounce,
        minPitch: entry.minPitch,
        maxPitch: entry.maxPitch,
        pitchFriction: entry.pitchFriction,
        pitchBounce: entry.pitchBounce,
        baseMass: entry.baseMass,
        baseStiffness: entry.baseStiffness,
        baseDamping: entry.baseDamping,
        boingImpactSpeed: entry.boingImpactSpeed,
        boingImpactAngle: entry.boingImpactAngle,
        boingDampingRate: entry.boingDampingRate,
        boingFrequency: entry.boingFrequency,
        boingAmplitude: entry.boingAmplitude,
        qc: jiggleQcLines(entry).join("\n"),
      })),
      ...(entries.length === 0
        ? { note: "No bone has proctype 5; stock L4D2 models carry no jigglebones." }
        : {}),
    };
  },
});

export const modelJiggleTools = [readModelJiggleTool];
