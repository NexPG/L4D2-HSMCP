/**
 * Soundscripts: the names L4D2 plays, and the wave behind each one.
 *
 * `read_wav` says whether a file decodes and `convert_wav` makes it decodable, but a sound
 * that no soundscript names is never played. This is the missing half: what the game's
 * manifest pulls in, what each named sound resolves to, whether that wave exists, and a
 * writer that appends an entry without destroying the rest of the file.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";

const WAVE = z.object({
  wave: z.string(),
  file: z.string().nullable(),
  sentence: z.boolean(),
  characters: z.string(),
  exists: z.boolean().optional(),
});

const SOUND = z.object({
  name: z.string(),
  script: z.string(),
  channel: z.string().nullable(),
  waves: z.array(WAVE),
});

export const readSoundscriptTool = defineTool({
  name: "read_soundscript",
  description:
    "Lists named sounds and the wave each resolves to, from one loose soundscript or from " +
    "the whole game through scripts/game_sounds_manifest.txt (including #base/#include). " +
    "Reports the first-definition-wins duplicates, files the manifest names but this " +
    "install lacks, the sound characters stripped from each wave, and whether the wave " +
    "exists. Pass `name` to filter (case-insensitive substring) and `limit` to bound the " +
    "reply: the stock game defines about 13,000 names. Use it before wiring an " +
    "ambient_generic or writing a soundscript, so a typo is found here and not as silence " +
    "in game. Needs the Python sidecar.",
  realm: "map",
  inputSchema: {
    path: z.string().optional().describe("A loose soundscript to read. Wins over gameDir."),
    name: z.string().optional().describe("Case-insensitive substring of the sound name."),
    limit: z.number().int().min(1).max(10_000).default(200),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK.optional(),
    read: z.boolean(),
    mounted: z.boolean().optional(),
    mountError: z.string().nullable().optional(),
    scripts: z.array(z.string()).optional(),
    scriptCount: z.number().optional(),
    count: z.number().optional(),
    total: z.number().optional(),
    duplicates: z.number().optional(),
    problems: z.array(z.string()).optional(),
    sounds: z.array(SOUND).optional(),
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
        "soundscript_read",
        { path, name: args.name, limit: args.limit },
        ctx.config,
        120_000,
      )) as Record<string, unknown>;
    }
    const { game, from } = gameFor(ctx.config, args.game);
    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    const result = (await callSidecar(
      "soundscript_read",
      { gameDir: game.gameDir, name: args.name, limit: args.limit },
      ctx.config,
      300_000,
    )) as Record<string, unknown>;
    return { ...result, game: gameBlock(game, from) };
  },
});

export const writeSoundscriptTool = defineTool({
  name: "write_soundscript",
  description:
    "Adds one sound block (`name`, `channel`, `wave` or `waves` as a random pick, volume, " +
    "soundlevel, pitch) to a soundscript. An existing file is appended to, so its comments " +
    "and other entries survive; a name already defined there is refused instead of " +
    "duplicated. The file is parsed back and the entry must come out with the same name, " +
    "which proves the block is well formed. The wave path is relative to sound/; a leading " +
    "sound character (*, @, >, …) is kept as written. Use convert_wav first when the wave " +
    "is not 16-bit PCM.",
  realm: "local",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Soundscript .txt to create or append to."),
    name: z.string().min(1).describe("Sound name the entity will use, e.g. MyAddon.Tone."),
    wave: z.string().optional().describe("One wave, relative to sound/."),
    waves: z.array(z.string()).optional().describe("Several waves: written as `rndwave`."),
    channel: z
      .enum([
        "CHAN_AUTO",
        "CHAN_WEAPON",
        "CHAN_VOICE",
        "CHAN_ITEM",
        "CHAN_BODY",
        "CHAN_STREAM",
        "CHAN_VOICE2",
        "CHAN_STATIC",
      ])
      .default("CHAN_STATIC"),
    volume: z.number().min(0).max(1).default(1),
    soundlevel: z.string().default("75dB").describe("e.g. 75dB, or SNDLVL_NORM."),
    pitch: z.union([z.number().int(), z.string()]).default(100),
    overwrite: z.boolean().default(false).describe("Replace an existing file instead of appending."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    name: z.string(),
    waves: z.array(z.string()),
    channel: z.string(),
    verified: z.boolean(),
    readBack: SOUND.nullable(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!args.wave && !(args.waves && args.waves.length > 0)) {
      throw new Error("give wave or waves");
    }
    const result = (await callSidecar(
      "soundscript_write",
      {
        path,
        name: args.name,
        wave: args.wave,
        waves: args.waves,
        channel: args.channel,
        volume: args.volume,
        soundlevel: args.soundlevel,
        pitch: args.pitch,
        overwrite: args.overwrite,
      },
      ctx.config,
      120_000,
    )) as Record<string, unknown>;
    ctx.audit.record({ kind: "file_write", data: { path, created: true } });
    return result;
  },
});

export const soundscriptTools = [readSoundscriptTool, writeSoundscriptTool];
