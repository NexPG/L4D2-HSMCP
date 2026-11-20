import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "../../../core/typescript/tools/paths.js";
import { readRectFile, writeRectFile } from "../../../formats/typescript/formats/rect.js";

const RECT = z.object({
  mins: z.tuple([z.number(), z.number()]).describe("Top-left corner in texture pixels."),
  maxs: z.tuple([z.number(), z.number()]).describe("Bottom-right corner."),
});

export const readRectTool = defineTool({
  name: "read_rect",
  description:
    "Reads a Hammer++ `.rect` hotspot file: the sub-rectangles of a trim-sheet texture that " +
    "can be fitted to faces. The format is KeyValues, not binary: an optional " +
    "`output_scale`, then a `Rectangles` block with one `rectangle` per rectangle, each a " +
    "`min` and `max` pair in texture pixels with the origin at the top-left. Pass one of " +
    "these to align_faces(fitRect) to map a face onto that panel instead of stretching the " +
    "whole texture over it.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .rect file, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    outputScale: z.number().nullable(),
    count: z.number(),
    rectangles: z.array(RECT),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const r = readRectFile(readFileSync(path, "utf8"));
    return {
      path,
      outputScale: r.outputScale,
      count: r.rectangles.length,
      rectangles: r.rectangles,
      warnings: r.warnings,
      nextStep:
        "Choose a rectangle by its size and aspect ratio, then call align_faces with mode " +
        "'fit' and fitRect set to it. The coordinates are the texture's own, not the face's.",
    };
  },
});

export const writeRectTool = defineTool({
  name: "write_rect",
  description:
    "Writes a Hammer++ `.rect` hotspot file. Rectangles are in texture pixels, origin at " +
    "the top-left, and maxs must be below and right of mins; a degenerate rectangle is " +
    "refused rather than written, because Hammer++ would not know what to fit. " +
    "`outputScale` is for rectangles drawn on a downscaled preview and is omitted when it " +
    "is 1. The result is parsed back before the write, so the tool's own reader is the " +
    "oracle. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .rect file, absolute or relative to the repo root."),
    rectangles: z.array(RECT).min(1),
    outputScale: z
      .number()
      .positive()
      .optional()
      .describe("Multiply every coordinate by this when it is not 1. Omitted when 1."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    count: z.number(),
    bytes: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const text = writeRectFile(args.rectangles, {
      ...(args.outputScale !== undefined ? { outputScale: args.outputScale } : {}),
    });
    // The oracle: the writer and the reader are separate functions and must agree.
    const back = readRectFile(text);
    if (back.rectangles.length !== args.rectangles.length) {
      throw new Error(
        `refusing to write: ${args.rectangles.length} rectangles went in and ` +
          `${back.rectangles.length} came back`,
      );
    }
    let before: string | null = null;
    try {
      before = readFileSync(path, "utf8");
    } catch {
      before = null;
    }
    const write = writeGuarded(path, text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: before === text,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: before === text,
      count: back.rectangles.length,
      bytes: Buffer.byteLength(text, "utf8"),
    };
  },
});

export const rectTools = [readRectTool, writeRectTool];
