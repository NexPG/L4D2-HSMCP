/**
 * Sound: reading a WAV and making it game-ready.
 *
 * An addon that ships a sound must ship a WAV L4D2 decodes: 16-bit PCM, mono or stereo,
 * at 22050 or 44100 Hz. Anything else often plays on the author's machine and fails on
 * someone else's. `read_wav` says whether a file is already in that shape; `convert_wav`
 * resamples, mixes and re-encodes, then reads the result back.
 *
 * The loop chunk (`smpl`) is reported rather than dropped silently: a looping ambient that
 * does not loop is a failure no directory listing shows.
 */
import { existsSync, statSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

export const readWavTool = defineTool({
  name: "read_wav",
  description:
    "Reads a WAV's format and content: encoding, channels, sample rate, bit depth, frames, " +
    "duration, byte size, the chunk list and the `smpl` loop when one is present. " +
    "`gameReady` is L4D2's shape — 16-bit PCM, mono or stereo, 22050/44100 Hz — so a sound " +
    "that will fail on a stricter machine is named before it ships. Compressed WAV (ADPCM, " +
    "mu-law) is reported as such rather than decoded as noise. Needs the Python sidecar.",
  realm: "local",
  inputSchema: {
    path: z.string().describe("Path to the .wav, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    read: z.boolean(),
    bytes: z.number().optional(),
    format: z.number().optional(),
    formatName: z.string().optional(),
    channels: z.number().optional(),
    sampleRate: z.number().optional(),
    blockAlign: z.number().optional(),
    bitsPerSample: z.number().optional(),
    frames: z.number().optional(),
    duration: z.number().optional(),
    dataBytes: z.number().optional(),
    loop: z.object({ start: z.number(), end: z.number() }).nullable().optional(),
    chunks: z.array(z.string()).optional(),
    gameReady: z.boolean().optional(),
    note: z.string().optional(),
    readError: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    return (await callSidecar("wav_read", { path }, ctx.config, 120_000)) as Record<
      string,
      unknown
    >;
  },
});

export const convertWavTool = defineTool({
  name: "convert_wav",
  description:
    "Converts a WAV to the shape L4D2 expects: 16-bit PCM, mono or stereo, at a chosen " +
    "rate (22050 or 44100 are the safe ones). Decodes PCM 8/16/24/32 and IEEE float, " +
    "downmixes or duplicates channels, resamples linearly and writes a canonical file. " +
    "Reports peak and RMS so a silent or clipped source is visible, scales an existing " +
    "`smpl` loop to the new rate (or drops it with keepLoop:false), and reads the result " +
    "back to confirm the frame count. A compressed source is refused with its format name. " +
    "This is a format conversion, not a mastering chain.",
  realm: "local",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Source .wav, absolute or relative to the repo root."),
    output: z.string().describe("Destination .wav."),
    sampleRate: z
      .number()
      .int()
      .min(8000)
      .max(192_000)
      .default(22_050)
      .describe("Target rate. L4D2 sounds are usually 22050; music is often 44100."),
    channels: z.number().int().min(1).max(2).default(1).describe("1 for mono, 2 for stereo."),
    bitDepth: z.literal(16).default(16).describe("Only 16 is accepted: it is what the game decodes."),
    keepLoop: z
      .boolean()
      .default(true)
      .describe("Scale and keep an existing smpl loop. false drops it."),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    source: z.string(),
    sourceFormat: z.string(),
    sourceChannels: z.number(),
    sourceSampleRate: z.number(),
    channels: z.number(),
    sampleRate: z.number(),
    bitDepth: z.number(),
    frames: z.number(),
    duration: z.number(),
    peak: z.number(),
    rms: z.number(),
    verified: z.boolean(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const out = resolveInput(args.output, ctx.config);
    if (existsSync(out) && !args.overwrite) {
      throw new Error(`${out} already exists; pass overwrite: true to replace it`);
    }
    const result = (await callSidecar(
      "wav_convert",
      {
        path,
        out,
        sampleRate: args.sampleRate,
        channels: args.channels,
        bitDepth: args.bitDepth,
      },
      ctx.config,
      300_000,
    )) as Record<string, unknown>;
    ctx.audit.record({
      kind: "file_write",
      data: { path: out, created: true, bytes: statSync(out).size },
    });
    return result;
  },
});

export const wavTools = [readWavTool, convertWavTool];
