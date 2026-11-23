/**
 * `read_model_keyvalues`: the `$keyvalues` block a model carries.
 *
 * A compiled model can hold data no QC field expresses: `prop_data` for breakables, weapon
 * particle attachments, and `door_options`, which is where a door's open/close/pound sounds
 * live. L4D2 infected pound on doors, so a door recompiled without that block loses the
 * behaviour even though it still looks and swings correctly.
 *
 * The bytes come from `readModelHeaderInfo`, the same reader `decompile_model` uses for
 * `$keyvalues`, so this tool cannot disagree with the QC that would be written.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { readModelHeaderInfo } from "../formats/mdlbones.js";
import { looseOrVpk, normalizeModelPath } from "./source.js";

/** The inside of one named KeyValues block, by brace matching. */
function blockBody(text: string, name: string): string | null {
  const match = new RegExp(`"?${name}"?\\s*\\{`, "i").exec(text);
  if (!match) return null;
  let depth = 0;
  for (let index = match.index + match[0].length - 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(match.index + match[0].length, index);
    }
  }
  return null;
}

/** `"key" "value"` pairs, in source order. Unquoted keys are legal in a model block. */
function pairs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /"?([A-Za-z0-9_.]+)"?\s+"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

export const readModelKeyValuesTool = defineTool({
  name: "read_model_keyvalues",
  description:
    "Reads the `$keyvalues` block a compiled model carries: the raw block, and `door_options` " +
    "parsed out when present. L4D2's `prop_door_rotating` takes its open/close/move/pound " +
    "sounds from the model, not from the entity, so a door recompiled without `door_options` " +
    "loses the sound infected make when they pound on it. `prop_data` and particle " +
    "attachments live in the same block. Needs `model` (engine path) or `path` (local .mdl).",
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
    found: z.boolean(),
    /** The block exactly as the file stores it, without the `mdlkeyvalue` wrapper. */
    keyvalues: z.string().nullable(),
    /** The `door_options` block, parsed; null when the model has none. */
    doorOptions: z.record(z.string()).nullable(),
    /** Blocks the text contains, for orientation. */
    blocks: z.array(z.string()),
    note: z.string().optional(),
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
      if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
      model = normalizeModelPath(args.model);
      path = model;
      bytes = looseOrVpk(game.gameDir, model);
      if (!bytes) throw new Error(`${model} was not found in the game directory or its VPK`);
    } else {
      throw new Error("give `model` (engine path) or `path` (local .mdl)");
    }

    const header = readModelHeaderInfo(bytes);
    const keyvalues = header?.keyvalues ?? null;
    const door = keyvalues ? blockBody(keyvalues, "door_options") : null;
    const doorOptions = door ? pairs(door) : null;
    const blocks = keyvalues ? [...keyvalues.matchAll(/"?([A-Za-z0-9_]+)"?\s*\{/g)].map((m) => m[1]!) : [];

    return {
      game: gameBlock(game, from),
      path,
      model,
      found: keyvalues !== null,
      keyvalues,
      doorOptions,
      blocks,
      ...(keyvalues === null
        ? {
            note:
              "The model stores no $keyvalues. A prop_door_rotating from this model has no " +
              "door_options, so the entity's own default sounds are all it can use.",
          }
        : {}),
    };
  },
});

export const modelKeyValueTools = [readModelKeyValuesTool];
