/**
 * `read_model_procedural`: the `.vrd` a model's procedural bones came from.
 *
 * A quat-interp helper (`proctype 2`) has a control bone and a list of triggers; an aim rule
 * (`3`/`4`) names a parent and an aim bone or attachment. The reader exposes both and builds
 * the `.vrd` text. `decompile_model` writes the same file and a `$proceduralbones` line.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { readMdlBones } from "../formats/mdlbones.js";
import { readAttachments } from "../formats/mdlmeta.js";
import { buildVrd, parseVrd, readProceduralBones } from "../formats/mdlprocedural.js";
import { looseOrVpk, normalizeModelPath } from "./source.js";

const QUAT = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const readModelProceduralTool = defineTool({
  name: "read_model_procedural",
  description:
    "Reads a compiled model's procedural bones: quat-interp helpers (proctype 2) with their " +
    "control bone and triggers, and aim rules (proctype 3/4) with parent, aim bone or " +
    "attachment, aim/up vectors and base position. Also returns the `.vrd` text `$proceduralbones` " +
    "needs. These are the bones that make an elbow follow a hand or an eye aim at a target.",
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
    entries: z.array(
      z.union([
        z.object({
          kind: z.literal("quatinterp"),
          bone: z.number(),
          boneName: z.string(),
          control: z.number(),
          controlName: z.string(),
          triggers: z.array(
            z.object({
              inverseTolerance: z.number(),
              trigger: QUAT,
              position: z.tuple([z.number(), z.number(), z.number()]),
              quat: QUAT,
            }),
          ),
        }),
        z.object({
          kind: z.literal("aim"),
          bone: z.number(),
          boneName: z.string(),
          parent: z.number(),
          parentName: z.string(),
          aimKind: z.enum(["bone", "attachment"]),
          aimIndex: z.number(),
          aimName: z.string().nullable(),
          aim: z.tuple([z.number(), z.number(), z.number()]),
          up: z.tuple([z.number(), z.number(), z.number()]),
          basePos: z.tuple([z.number(), z.number(), z.number()]),
        }),
      ]),
    ),
    vrd: z.string(),
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

    const bones = readMdlBones(bytes);
    const attachments = readAttachments(bytes);
    const entries = readProceduralBones(bytes, bones, attachments);
    return {
      game: gameBlock(game, from),
      path,
      model,
      count: entries.length,
      entries,
      vrd: buildVrd(entries, bones),
      ...(entries.length === 0
        ? { note: "No bone has proctype 2, 3 or 4; the model has no procedural bones." }
        : {}),
    };
  },
});

export const readVrdTool = defineTool({
  name: "read_vrd",
  description:
    "Reads a hand-authored `.vrd` procedural-bones file: quat-interp helpers with their " +
    "control bone and triggers, and aim constraints with their aim/up vectors. Reports the " +
    "structure a compile would otherwise swallow -- a missing `<basepos>`, a `<trigger>` with " +
    "nine numbers instead of ten, an aim rule without vectors, a tag outside a block. Use it " +
    "before pointing `$proceduralbones` at a file; `read_model_procedural` is the compiled " +
    "side of the same data.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vrd, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    count: z.number(),
    lineCount: z.number(),
    entries: z.array(
      z.union([
        z.object({
          kind: z.literal("quatinterp"),
          bone: z.string(),
          parent: z.string(),
          controlParent: z.string().optional(),
          control: z.string().optional(),
          display: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
          basePos: z.tuple([z.number(), z.number(), z.number()]).nullable(),
          triggers: z.array(
            z.object({
              tolerance: z.number(),
              trigger: z.tuple([z.number(), z.number(), z.number()]),
              pose: z.tuple([z.number(), z.number(), z.number()]),
              position: z.tuple([z.number(), z.number(), z.number()]),
            }),
          ),
        }),
        z.object({
          kind: z.literal("aim"),
          bone: z.string(),
          parent: z.string(),
          aimBone: z.string().optional(),
          aimVector: z.tuple([z.number(), z.number(), z.number()]).optional(),
          upVector: z.tuple([z.number(), z.number(), z.number()]).optional(),
          display: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
          basePos: z.tuple([z.number(), z.number(), z.number()]).nullable(),
          triggers: z.array(z.never()),
        }),
      ]),
    ),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const parsed = parseVrd(readFileSync(path, "utf8"));
    return {
      path,
      count: parsed.entries.length,
      lineCount: parsed.lineCount,
      entries: parsed.entries,
      warnings: parsed.warnings,
    };
  },
});

export const modelProceduralTools = [readModelProceduralTool, readVrdTool];
