import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { assertWritable } from "../fs/guard.js";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "./paths.js";

const MAX_BYTES = 16 * 1024 * 1024;

/**
 * Raw text, not a template.
 *
 * QC, SMD, VMT and mission files are all text formats this server does not model field by
 * field. A model author needs to write the source the same way they would in an editor;
 * a fixed template would be exactly the "choose from prepared answers" the project bans.
 */
export const readTextFileTool = defineTool({
  name: "read_text_file",
  description:
    "Reads a UTF-8 text file with a byte cap, optional 1-based line window and no binary " +
    "guessing: a NUL byte is refused. This is the general reader for source formats the " +
    "toolkit does not model (QC, SMD, VMT, mission files). Use the format-specific readers " +
    "when one exists. Read-only.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the text file, absolute or relative to the repo root."),
    startLine: z.number().int().min(1).optional().describe("1-based first line. Default 1."),
    maxLines: z.number().int().min(1).max(20000).optional().describe("Default 2000."),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(MAX_BYTES)
      .optional()
      .describe("Refuse a file larger than this. Default 1 MiB, maximum 16 MiB."),
  },
  outputSchema: {
    path: z.string(),
    bytes: z.number(),
    totalLines: z.number(),
    returned: z.number(),
    truncated: z.boolean(),
    text: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const size = statSync(path).size;
    const maxBytes = args.maxBytes ?? 1024 * 1024;
    if (size > maxBytes) {
      throw new Error(
        `${path} is ${size} bytes; the cap is ${maxBytes}. Raise maxBytes or read a range.`,
      );
    }
    const raw = readFileSync(path, "utf8");
    if (raw.includes("\0")) {
      throw new Error(`${path} contains a NUL byte; it is not a text file`);
    }
    const lines = raw.split(/\r?\n/);
    if (raw.endsWith("\n") && lines[lines.length - 1] === "") lines.pop();
    const start = (args.startLine ?? 1) - 1;
    const maxLines = args.maxLines ?? 2000;
    const page = lines.slice(start, start + maxLines);
    return {
      path,
      bytes: size,
      totalLines: lines.length,
      returned: page.length,
      truncated: start + page.length < lines.length,
      text: page.join("\n"),
    };
  },
});

export const writeTextFileTool = defineTool({
  name: "write_text_file",
  description:
    "Writes arbitrary UTF-8 text: the primitive for QC, SMD, VMT, VTA, DMX and mission " +
    "files the structured tools do not model. It does not impose a template or a schema; " +
    "the consumer is the oracle (studiomdl for a QC, the game for a mission, vbsp for a " +
    "VMT). Refuses to replace an existing file unless overwrite is true, refuses forbidden " +
    "trees, and writes through the shared backup/dry-run guard. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Destination path, absolute or relative to the repo root."),
    content: z.string().describe("The exact UTF-8 text to write."),
    overwrite: z.boolean().default(false).describe("Replace an existing file only when true."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    bytes: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (existsSync(path) && !args.overwrite) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }
    assertWritable(path, ctx.config);
    mkdirSync(dirname(path), { recursive: true });
    const before = existsSync(path) ? readFileSync(path, "utf8") : null;
    const write = writeGuarded(path, args.content, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: before === args.content,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: before === args.content,
      bytes: Buffer.byteLength(args.content, "utf8"),
    };
  },
});

export const textTools = [readTextFileTool, writeTextFileTool];
