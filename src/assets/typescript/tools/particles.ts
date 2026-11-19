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
import { CONFIRM, GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";

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

const OPERATOR_INPUT = z.object({
  name: z.string().min(1),
  function: z.string().min(1),
  options: z.record(z.string(), z.unknown()).optional(),
});

const SYSTEM_INPUT = z.object({
  name: z.string().min(1),
  options: z.record(z.string(), z.unknown()).optional(),
  renderers: z.array(OPERATOR_INPUT).optional(),
  initializers: z.array(OPERATOR_INPUT).optional(),
  emitters: z.array(OPERATOR_INPUT).optional(),
  forces: z.array(OPERATOR_INPUT).optional(),
  constraints: z.array(OPERATOR_INPUT).optional(),
  operators: z.array(OPERATOR_INPUT).optional(),
  children: z.array(z.string()).optional(),
});

export const writeParticleTool = defineTool({
  name: "write_particle",
  description:
    "Builds a binary .pcf particle file from JSON and reads it back. A PCF is a DMX " +
    "(format `pcf`, version 1 or 2): systems, options, renderer/initializer/emitter/force/" +
    "constraint/operator lists, and child references. Options are plain JSON strings, " +
    "numbers, booleans or numeric vectors; use {type, value} for an explicit DMX type " +
    "(int, float, bool, string, vector2/3/4, color, time). Child names must be systems in " +
    "the same file; the writer points at the same elements rather than copying them. " +
    "`source` rewrites an existing loose .pcf or a game-relative particles/*.pcf; otherwise " +
    "`systems` builds a new file. Refuses duplicate or missing system names and an existing " +
    "file without overwrite.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Where to write the .pcf."),
    systems: z
      .array(SYSTEM_INPUT)
      .default([])
      .describe("Every system in a new file, in output order. Ignored when `source` is set."),
    source: z
      .string()
      .optional()
      .describe(
        "Rewrite this PCF instead of building from `systems`: a loose path, or a " +
          "game-relative `particles/foo.pcf` resolved through `game`.",
      ),
    game: GAME,
    formatVersion: z
      .union([z.literal(1), z.literal(2)])
      .default(2)
      .describe("PCF format version. L4D2 uses 2; version 1 is the older layout."),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    source: z.string().nullable().optional(),
    bytes: z.number(),
    format: z.literal("pcf"),
    formatVersion: z.number(),
    systemCount: z.number(),
    systems: z.array(
      z.object({
        name: z.string(),
        optionKeys: z.array(z.string()),
        children: z.array(z.string()),
        renderers: z.number(),
        initializers: z.number(),
        emitters: z.number(),
        forces: z.number(),
        constraints: z.number(),
        operators: z.number(),
      }),
    ),
    verified: z.boolean(),
    warnings: z.array(z.string()),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    if (!args.source && args.systems.length === 0) {
      throw new Error("give `systems` to build a new PCF, or `source` to rewrite an existing one");
    }
    if (args.source && args.systems.length > 0) {
      throw new Error("give either `source` or `systems`, not both");
    }
    const path = resolveInput(args.path, ctx.config);
    if (existsSync(path) && !args.overwrite) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }
    const { game } = gameFor(ctx.config, args.game);
    const result = (await callSidecar(
      "particle_write",
      {
        path,
        systems: args.systems,
        ...(args.source === undefined
          ? {}
          : { source: args.source, gameDir: game.gameDir ?? undefined }),
        formatVersion: args.formatVersion,
        overwrite: args.overwrite,
      },
      ctx.config,
      120_000,
    )) as Record<string, unknown>;
    ctx.audit.record({ kind: "file_write", data: { path, created: true } });
    return result;
  },
});

export const particleTools = [readParticleTool, writeParticleTool];
