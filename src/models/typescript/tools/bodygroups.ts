/**
 * `read_model_bodygroups`: body parts with their mixed-radix bases and any
 * `$bodygrouppreset` entries.
 *
 * The preset table is a v49 header section that no stock L4D2 model fills in; the decoder is
 * still useful for models from other branches and for diagnosing a decompile. Writing is
 * blocked by the compiler, not by the format: L4D2's `studiomdl` answers
 * `bad command $bodygrouppreset` when the QC contains the command, so `decompile_model` reads
 * the table and warns instead of emitting it.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { loadModelGeometry, normalizeModelPath } from "./source.js";

export const readModelBodygroupsTool = defineTool({
  name: "read_model_bodygroups",
  description:
    "Reads a compiled model's body parts and `$bodygrouppreset` table. Each part reports " +
    "its name, mixed-radix `base` and alternative count; each preset reports the value, mask " +
    "and the bodypart/model index it selects. L4D2 ships no model with presets, and L4D2's " +
    "`studiomdl` rejects `$bodygrouppreset` with `bad command`, so `decompile_model` reads " +
    "and warns rather than emitting. Read-only.",
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
    bodyPartCount: z.number(),
    bodyParts: z.array(
      z.object({
        name: z.string(),
        base: z.number(),
        modelCount: z.number(),
      }),
    ),
    presetCount: z.number(),
    presets: z.array(
      z.object({
        name: z.string(),
        value: z.number(),
        mask: z.number(),
        parts: z.array(z.object({ part: z.string(), index: z.number() })),
      }),
    ),
    note: z.string().optional(),
  },
  handler: (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    let path: string | null = null;
    let model: string | null = null;
    if (args.path) {
      path = resolveInput(args.path, ctx.config);
      model = path;
    } else if (args.model) {
      model = normalizeModelPath(args.model);
      path = model;
    } else {
      throw new Error("give `model` (engine path) or `path` (local .mdl)");
    }
    if (args.path && !existsSync(path)) throw new Error(`${path} was not found`);
    const geometry = loadModelGeometry(game.gameDir, model);
    if (!geometry) throw new Error(`${model} has no readable .mdl/.vvd/.vtx trio`);

    return {
      game: gameBlock(game, from),
      path,
      model,
      bodyPartCount: geometry.bodyParts.length,
      bodyParts: geometry.bodyParts.map((part) => ({
        name: part.name,
        base: part.base,
        modelCount: part.models.length,
      })),
      presetCount: geometry.presets.length,
      presets: geometry.presets,
      note:
        geometry.presets.length === 0
          ? "no `$bodygrouppreset` entries in this model"
          : "L4D2's studiomdl rejects `$bodygrouppreset` (`bad command`); decompile reads the " +
            "table and does not emit it",
    };
  },
});

export const modelBodygroupTools = [readModelBodygroupsTool];
