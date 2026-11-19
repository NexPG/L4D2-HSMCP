/**
 * Soundscapes: the ambient bed an `env_soundscape` selects.
 *
 * `read_soundscript` names individual sounds; this names the mix a place plays — a looping
 * wind bed, random bird calls, child scapes and DSP. Nothing else in the toolkit could read
 * or create `scripts/soundscapes_*.txt`, so a map could be geometrically finished and sound
 * empty.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";

const POSITION = z.union([z.enum(["ambient", "random"]), z.number().int().min(0)]);

const LOOP = z.object({
  wave: z.string().describe("Wave path relative to sound/, e.g. ambient/wind.wav."),
  volume: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
  pitch: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
  level: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
  position: POSITION.optional(),
  radius: z.number().optional(),
  noRestore: z.boolean().optional(),
});

const RANDOM = z.object({
  waves: z.array(z.string()).min(1),
  time: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
  volume: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
  pitch: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
  level: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
  position: POSITION.optional(),
  noRestore: z.boolean().optional(),
});

const CHILD = z.object({
  name: z.string(),
  volume: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional(),
  position: z.number().int().min(0).optional(),
  positionOverride: z.number().int().min(0).optional(),
  ambientPositionOverride: z.number().int().min(0).optional(),
});

export const readSoundscapeTool = defineTool({
  name: "read_soundscape",
  description:
    "Reads soundscape definitions from one file or from the game's scripts/soundscapes_*.txt. " +
    "Returns each scape's looping beds, random one-shots, child scapes, DSP, fadetime and " +
    "soundmixer, and checks every wave under sound/ so a typo is found before the map loads " +
    "silent. `name` filters (case-insensitive substring). A soundscape is selected by an " +
    "env_soundscape entity's `soundscape` key. Needs the Python sidecar.",
  realm: "map",
  inputSchema: {
    path: z.string().optional().describe("A loose soundscape file. Wins over gameDir."),
    name: z.string().optional().describe("Case-insensitive substring of the scape name."),
    limit: z.number().int().min(1).max(10_000).default(100),
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
    missingWaves: z.array(z.string()).optional(),
    soundscapes: z.array(z.record(z.string(), z.unknown())).optional(),
    truncated: z.boolean().optional(),
    name: z.string().nullable().optional(),
    note: z.string().optional(),
    readError: z.string().optional(),
  },
  handler: async (args, ctx) => {
    if (args.path) {
      const path = resolveInput(args.path, ctx.config);
      if (!existsSync(path)) throw new Error(`${path} does not exist`);
      return (await callSidecar(
        "soundscape_read",
        { path, name: args.name, limit: args.limit },
        ctx.config,
        120_000,
      )) as Record<string, unknown>;
    }
    const { game, from } = gameFor(ctx.config, args.game);
    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    const result = (await callSidecar(
      "soundscape_read",
      { gameDir: game.gameDir, name: args.name, limit: args.limit },
      ctx.config,
      300_000,
    )) as Record<string, unknown>;
    return { ...result, game: gameBlock(game, from) };
  },
});

export const writeSoundscapeTool = defineTool({
  name: "write_soundscape",
  description:
    "Builds one soundscape and appends it to a .txt without rewriting the rest of the file. " +
    "`loopSounds` are continuous beds (`wave`, volume/pitch/level, radius, position), " +
    "`randomSounds` are timed one-shots over a wave list, `children` trigger another scape. " +
    "DSP, fadetime and soundmixer are optional. If gameDir is resolved, every wave is checked " +
    "under sound/ and missing ones are returned. An existing name is refused, not duplicated. " +
    "The result is parsed back before it is reported as written.",
  realm: "local",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Soundscape .txt to create or append to."),
    name: z.string().min(1),
    loopSounds: z.array(LOOP).optional(),
    randomSounds: z.array(RANDOM).optional(),
    children: z.array(CHILD).optional(),
    dsp: z.number().int().optional(),
    dspSpatial: z.number().int().optional(),
    dspVolume: z.number().optional(),
    fadetime: z.number().optional(),
    soundmixer: z.string().optional(),
    game: GAME,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    name: z.string(),
    loops: z.number(),
    randoms: z.number(),
    children: z.number(),
    verified: z.boolean(),
    missingWaves: z.array(z.string()),
    soundscape: z.record(z.string(), z.unknown()).nullable(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const { game } = gameFor(ctx.config, args.game);
    const result = (await callSidecar(
      "soundscape_write",
      {
        path,
        name: args.name,
        loopSounds: args.loopSounds,
        randomSounds: args.randomSounds,
        children: args.children,
        dsp: args.dsp,
        dspSpatial: args.dspSpatial,
        dspVolume: args.dspVolume,
        fadetime: args.fadetime,
        soundmixer: args.soundmixer,
        gameDir: game.gameDir ?? undefined,
      },
      ctx.config,
      120_000,
    )) as Record<string, unknown>;
    ctx.audit.record({ kind: "file_write", data: { path, created: true } });
    return result;
  },
});

export const soundscapeTools = [readSoundscapeTool, writeSoundscapeTool];
