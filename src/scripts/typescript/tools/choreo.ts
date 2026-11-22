/**
 * Choreography scenes: text `.vcd` timelines and the `scenes/scenes.image` summary.
 *
 * Both parsers are `srctools.choreo` through the sidecar; this file only names the fields a
 * caller acts on. A `.vcd` is the timeline a scene uses (events, actor channels, times,
 * sounds); `scenes.image` is the CRC-keyed summary the engine loads first.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import {
  BACKUP,
  BACKUP_PATH,
  CONFIRM,
  DRY_RUN,
  resolveInput,
} from "../../../core/typescript/tools/paths.js";

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
    "pointer to `read_scenes_image`. Read-only; `edit_choreo_events` changes an existing timeline.",
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

const EVENT_UPDATE = z.object({
  name: z
    .string()
    .min(1)
    .describe("Event name exactly as read_choreo returns it, e.g. SpeakEvent."),
  actor: z.string().optional().describe("Only events on this actor."),
  channel: z.string().optional().describe("Only events on this channel."),
  occurrence: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "0-based match among events with this name/actor/channel, in file order. Required " +
        "when more than one matches; without it an ambiguous selector is refused.",
    ),
  start: z.number().min(0).optional().describe("New start time in seconds."),
  end: z
    .number()
    .min(0)
    .nullable()
    .optional()
    .describe("New end time in seconds, or null for an event without an end."),
  parameters: z
    .array(z.string())
    .min(1)
    .max(3)
    .optional()
    .describe(
      "Replace the event's parameter slots. A speak event's first parameter is its sound " +
        "name; missing slots are written as empty strings.",
    ),
  remove: z
    .boolean()
    .default(false)
    .describe("Delete the selected event. Other fields are ignored when this is true."),
});

const EVENT_ADD = z.object({
  type: z.enum(["speak", "firetrigger", "stoppoint"]),
  name: z
    .string()
    .min(1)
    .describe("Event name as the VCD writes it; for speak, the sound is the first parameter."),
  actor: z.string().min(1).describe("Existing actor to put the event on."),
  channel: z.string().min(1).describe("Existing channel on that actor, e.g. voice or triggers."),
  start: z.number().min(0),
  end: z.number().min(0).nullable().optional(),
  parameters: z
    .array(z.string())
    .max(3)
    .optional()
    .describe("Parameter slots; a speak event defaults its first slot to the event name."),
});

export const editChoreoEventsTool = defineTool({
  name: "edit_choreo_events",
  description:
    "Edits a text .vcd choreography timeline: change the start, end and parameter slots of " +
    "existing events, remove one, or add a speak/firetrigger/stoppoint event to an existing " +
    "actor channel. For a speak event the first parameter is the sound name, so this is how " +
    "a dialogue line is created, swapped or retimed without Faceposer. Select by event name, " +
    "optionally narrowed by actor and channel; a name that appears more than once needs " +
    "occurrence. The file is re-serialised by " +
    "srctools.choreo.Scene and then parsed again: `verified` means every requested field " +
    "came back. Formatting and indentation are normalised, comments are not kept, and the " +
    "semantic round-trip is measured against the stock L4D2 scenes. Read first with " +
    "read_choreo; binary VCD and scenes.image are refused. A backup is written.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to a text .vcd, absolute or relative to the repo root."),
    updates: z
      .array(EVENT_UPDATE)
      .default([])
      .describe("Existing events to retime, re-parameterise or remove."),
    add: z
      .array(EVENT_ADD)
      .default([])
      .describe("New events to insert into an existing actor channel."),
    backup: BACKUP,
    dryRun: DRY_RUN,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    backup: BACKUP_PATH,
    written: z.boolean(),
    updated: z.number(),
    removed: z.number(),
    added: z.number(),
    eventCount: z.number(),
    duration: z.number(),
    verified: z.boolean(),
    bytes: z.number(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} was not found`);
    const before = readFileSync(path, "utf8");
    const reply = (await callSidecar(
      "choreo_edit_events",
      { path, updates: args.updates ?? [], add: args.add ?? [] },
      ctx.config,
      120_000,
    )) as {
      text: string;
      updated: number;
      removed: number;
      added: number;
      eventCount: number;
      duration: number;
      verified: boolean;
    };
    const write = writeGuarded(path, reply.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup ?? true,
      unchanged: reply.text === before,
    });
    if (write.written) {
      ctx.audit.record({
        kind: "file_write",
        data: { path: write.path, backup: write.backupPath, updated: reply.updated },
      });
    }
    return {
      path: write.path || path,
      backup: write.backupPath,
      written: write.written,
      updated: reply.updated,
      removed: reply.removed,
      added: reply.added,
      eventCount: reply.eventCount,
      duration: reply.duration,
      verified: reply.verified,
      bytes: Buffer.byteLength(reply.text, "utf8"),
    };
  },
});

const SCENES_ENTRY = z.object({
  checksum: z.string(),
  durationMs: z.number(),
  lastSpeakMs: z.number(),
  sounds: z.array(z.string()),
});

export const writeScenesImageTool = defineTool({
  name: "write_scenes_image",
  description:
    "Builds a `scenes/scenes.image` VSIF container from text `.vcd` files. Each entry's " +
    "CRC comes from the filename (`scenes/<name>`), and duration, last-speak time and sounds " +
    "come from the parsed scene; `srctools.choreo.save_scenes_image_sync` writes it. The " +
    "output is parsed again before `verified` is returned. This is only needed when a pack " +
    "ships the compiled image; a loose VCD is loaded by filename without it. Duplicate " +
    "filenames are refused because the image is keyed by CRC. A backup is taken when " +
    "replacing an existing image.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    paths: z.array(z.string().min(1)).min(1).describe("Text .vcd files to index."),
    path: z.string().describe("Where to write scenes.image, absolute or repo-relative."),
    version: z.union([z.literal(2), z.literal(3)]).default(3),
    backup: BACKUP,
    dryRun: DRY_RUN,
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    backup: BACKUP_PATH,
    written: z.boolean(),
    count: z.number(),
    version: z.number(),
    verified: z.boolean(),
    entries: z.array(SCENES_ENTRY),
    bytes: z.number(),
  },
  handler: async (args, ctx) => {
    const paths = args.paths.map((path) => resolveInput(path, ctx.config));
    for (const path of paths) {
      if (!existsSync(path)) throw new Error(`${path} does not exist`);
      if (!path.toLowerCase().endsWith(".vcd")) throw new Error(`${path} is not a .vcd`);
    }
    const names = paths.map((path) => basename(path).toLowerCase());
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate !== undefined) {
      throw new Error(
        `two VCDs are named ${duplicate}; scenes.image is keyed by filename CRC, so one ` +
          `would replace the other`,
      );
    }
    const out = resolveInput(args.path, ctx.config);
    if (existsSync(out) && !args.overwrite) {
      throw new Error(`${out} already exists; pass overwrite:true to replace it`);
    }

    const scratch = mkdtempSync(join(tmpdir(), "hsmcp-scenes-image-"));
    const temp = join(scratch, "scenes.image");
    try {
      const reply = (await callSidecar(
        "scenes_image_write",
        { paths, out: temp, version: args.version },
        ctx.config,
        180_000,
      )) as {
        count: number;
        version: number;
        entries: Array<{
          checksum: string;
          durationMs: number;
          lastSpeakMs: number;
          sounds: string[];
        }>;
      };
      const verified = reply.count === paths.length && reply.entries.length === paths.length;
      if (!verified) {
        throw new Error(
          `the image has ${reply.entries.length} entries for ${paths.length} VCDs; ` +
            `the engine would not find every scene`,
        );
      }
      if (args.dryRun) {
        return {
          path: out,
          backup: null,
          written: false,
          count: reply.count,
          version: reply.version,
          verified,
          entries: reply.entries,
          bytes: readFileSync(temp).length,
        };
      }

      const target = assertWritable(out, ctx.config);
      let backup: string | null = null;
      if (args.backup ?? true) {
        if (existsSync(target)) {
          backup = assertWritable(`${target}.bak`, ctx.config);
          copyFileSync(target, backup);
        }
      }
      writeFileSync(target, readFileSync(temp));
      ctx.audit.record({ kind: "file_write", data: { path: target, backup, scenes: reply.count } });
      return {
        path: target,
        backup,
        written: true,
        count: reply.count,
        version: reply.version,
        verified,
        entries: reply.entries,
        bytes: readFileSync(temp).length,
      };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
});

export const choreoTools = [
  readChoreoTool,
  readScenesImageTool,
  editChoreoEventsTool,
  writeScenesImageTool,
];

