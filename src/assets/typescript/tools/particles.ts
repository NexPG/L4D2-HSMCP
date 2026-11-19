/**
 * Particle systems: what is actually inside a `.pcf`.
 *
 * `read_game_content` names the files; a map points `info_particle_system` at a system
 * inside one. A renamed or missing system shows nothing and no compile error. This reads
 * the DMX-based PCF and reports systems, child references, operator functions and the
 * materials they draw, so a choice is checked before it ships.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";

const OPERATOR = z.object({
  name: z.string(),
  function: z.string(),
  options: z.record(z.string(), z.unknown()),
});

const SYSTEM = z.object({
  name: z.string(),
  file: z.string(),
  materials: z.array(z.string()),
  children: z.array(z.string()),
  optionKeys: z.array(z.string()),
  options: z.record(z.string(), z.unknown()),
  renderers: z.array(OPERATOR),
  initializers: z.array(OPERATOR),
  emitters: z.array(OPERATOR),
  forces: z.array(OPERATOR),
  constraints: z.array(OPERATOR),
  operators: z.array(OPERATOR),
});

export const readParticleTool = defineTool({
  name: "read_particle",
  description:
    "Reads a .pcf particle file, or searches the game's particles/*.pcf, and lists every " +
    "system: child references, renderer/initializer/emitter/force/constraint operators and " +
    "the materials it draws. Use it before pointing an info_particle_system at a name: a " +
    "missing or renamed system renders nothing and the compiler never complains. `name` " +
    "filters systems, `filePattern` filters files. `includeOperators: false` gives a compact " +
    "list when only names and materials matter. Needs the Python sidecar.",
  realm: "map",
  inputSchema: {
    path: z.string().optional().describe("A loose .pcf. Wins over gameDir."),
    name: z.string().optional().describe("Case-insensitive substring of the system name."),
    filePattern: z.string().optional().describe("Only game files whose path contains this."),
    maxFiles: z.number().int().min(1).max(2000).default(200),
    limit: z.number().int().min(1).max(10_000).default(200),
    includeOperators: z.boolean().default(true),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK.optional(),
    read: z.boolean(),
    mounted: z.boolean().optional(),
    mountError: z.string().nullable().optional(),
    files: z.array(z.string()).optional(),
    fileCount: z.number().optional(),
    total: z.number().optional(),
    count: z.number().optional(),
    problems: z.array(z.string()).optional(),
    systems: z.array(SYSTEM).optional(),
    truncated: z.boolean().optional(),
    name: z.string().nullable().optional(),
    note: z.string().optional(),
    path: z.string().optional(),
    readError: z.string().optional(),
  },
  handler: async (args, ctx) => {
    if (args.path) {
      const path = resolveInput(args.path, ctx.config);
      if (!existsSync(path)) throw new Error(`${path} does not exist`);
      return (await callSidecar(
        "particle_read",
        {
          path,
          name: args.name,
          limit: args.limit,
          includeOperators: args.includeOperators,
        },
        ctx.config,
        120_000,
      )) as Record<string, unknown>;
    }
    const { game, from } = gameFor(ctx.config, args.game);
    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    const result = (await callSidecar(
      "particle_read",
      {
        gameDir: game.gameDir,
        name: args.name,
        filePattern: args.filePattern,
        maxFiles: args.maxFiles,
        limit: args.limit,
        includeOperators: args.includeOperators,
      },
      ctx.config,
      300_000,
    )) as Record<string, unknown>;
    return { ...result, game: gameBlock(game, from) };
  },
});

export const particleTools = [readParticleTool];
