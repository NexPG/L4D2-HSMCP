/**
 * Choreography scenes: text `.vcd` timelines and the `scenes/scenes.image` summary.
 *
 * Both parsers are `srctools.choreo` through the sidecar; this file only names the fields a
 * caller acts on. A `.vcd` is the timeline a scene uses (events, actor channels, times,
 * sounds); `scenes.image` is the CRC-keyed summary the engine loads first.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";

const EVENT = z.object({
  name: z.string(),
  type: z.string(),
  start: z.number(),
  end: z.number().nullable(),
  parameters: z.array(z.string()),
  flags: z.number(),
  actor: z.string().optional(),
  channel: z.string().optional(),
});

export const readChoreoTool = defineTool({
  name: "read_choreo",
  description:
    "Reads a text VCD choreography scene: map name, FPS, duration, every event on the " +
    "timeline (type, start/end, parameters, flags), the actor/channel tree, and the sounds it " +
    "uses. The parser is `srctools.choreo.Scene`; a binary `scenes.image` is refused with a " +
    "pointer to `read_scenes_image`. Read-only.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to a text .vcd, absolute or relative to the repo root."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .describe("Maximum timeline events to return. Default 200; counts always cover all."),
  },
  outputSchema: {
    path: z.string(),
    mapName: z.string(),
    fps: z.number(),
    duration: z.number(),
    eventCount: z.number(),
    events: z.array(EVENT),
    eventsTruncated: z.boolean(),
    actorCount: z.number(),
    actors: z.array(
      z.object({
        name: z.string(),
        active: z.boolean(),
        faceposerModel: z.string(),
        channels: z.array(
          z.object({ name: z.string(), active: z.boolean(), eventCount: z.number() }),
        ),
      }),
    ),
    sounds: z.array(z.string()),
    soundCount: z.number(),
    ignorePhonemes: z.boolean(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} was not found`);
    return (await callSidecar(
      "read_choreo",
      { path, limit: args.limit ?? 200 },
      ctx.config,
      120_000,
    )) as never;
  },
});

export const readScenesImageTool = defineTool({
  name: "read_scenes_image",
  description:
    "Reads `scenes/scenes.image`: one entry per choreo scene, keyed by CRC, with its duration, " +
    "the end of the last spoken line and the sounds it uses. The image stores no filenames. " +
    "`details: true` parses each embedded scene for event and actor counts, which costs more. " +
    "Parser is `srctools.choreo.parse_scenes_image`. Read-only.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to scenes.image, absolute or relative to the repo root."),
    limit: z.number().int().min(1).max(5000).optional().describe("Entries to return. Default 200."),
    details: z
      .boolean()
      .optional()
      .describe("Parse every returned scene for its event and actor counts. Default false."),
  },
  outputSchema: {
    path: z.string(),
    count: z.number(),
    returned: z.number(),
    truncated: z.boolean(),
    entries: z.array(
      z.object({
        checksum: z.string(),
        filename: z.string().nullable(),
        durationMs: z.number(),
        lastSpeakMs: z.number(),
        sounds: z.array(z.string()),
        soundCount: z.number(),
        eventCount: z.number().optional(),
        actorCount: z.number().optional(),
        detailError: z.string().optional(),
      }),
    ),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} was not found`);
    return (await callSidecar(
      "read_scenes_image",
      { path, limit: args.limit ?? 200, details: args.details ?? false },
      ctx.config,
      180_000,
    )) as never;
  },
});

export const choreoTools = [readChoreoTool, readScenesImageTool];
