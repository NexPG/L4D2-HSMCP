import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { readHeader } from "../bsp/header.js";
import { editEntityText, writeBspEntities, writeEntityText } from "../bsp/edit.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { BACKUP, BACKUP_PATH, CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

const MATCH = z.object({
  id: z.number().optional().describe("Hammer id, when the compiled entity kept one."),
  index: z.number().int().min(0).optional().describe("Zero-based position in the lump."),
  classname: z.string().optional(),
  targetname: z.string().optional(),
});

const OP = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    keyvalues: z
      .record(z.string())
      .describe(
        "The whole entity. Must include classname. Compiled outputs are ordinary keys: " +
          '"OnMapSpawn" "cmd,Command,buildcubemaps,0,-1".',
      ),
  }),
  z.object({
    op: z.literal("update"),
    match: MATCH,
    keyvalues: z.record(z.string()).optional().describe("Keys to set or replace."),
    removeKeys: z.array(z.string()).optional().describe("Keys to delete."),
  }),
  z.object({
    op: z.literal("remove"),
    match: MATCH,
  }),
]);

/**
 * The primitive for compiled entities.
 *
 * A `.bsp` entity lump is not a VMF: outputs are flat keyvalues and there is no Hammer id
 * on most entities. This tool edits that lump directly, appending the new text and moving
 * only the entity lump's directory entry, so no brush, pakfile or lighting byte shifts.
 */
export const editBspEntitiesTool = defineTool({
  name: "edit_bsp_entities",
  description:
    "Adds, updates or removes entities in a COMPILED .bsp -- the primitive needed for " +
    "things a source map cannot express, such as point_servercommand plus logic_auto for " +
    "buildcubemaps. The new entity text is appended and only lump 0's directory entry moves, " +
    "so no other lump is shifted by a byte. A compressed entity lump is decompressed first " +
    "and written back uncompressed, with the fourCC cleared. Compiled outputs are ordinary " +
    "keyvalues. Writes in place by default, or to `out`; refuses an empty operation list and " +
    "a result with no worldspawn. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    bsp: z.string().describe("Path to the compiled .bsp, absolute or relative to the repo."),
    ops: z.array(OP).min(1),
    out: z
      .string()
      .optional()
      .describe("Write a new .bsp instead of changing this one. Must not already exist."),
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    bsp: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    entitiesBefore: z.number(),
    entitiesAfter: z.number(),
    outcomes: z.array(
      z.object({
        op: z.enum(["add", "update", "remove"]),
        matched: z.number(),
        index: z.number().optional(),
      }),
    ),
    warnings: z.array(z.string()),
    lumpOffset: z.number(),
    lumpBytes: z.number(),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    decompressed: z.boolean(),
  },
  handler: async (args, ctx) => {
    const bsp = resolveInput(args.bsp, ctx.config);
    if (!existsSync(bsp)) throw new Error(`${bsp} does not exist`);
    if (extname(bsp).toLowerCase() !== ".bsp") throw new Error(`${bsp} is not a .bsp`);

    const out = args.out ? resolveInput(args.out, ctx.config) : undefined;
    if (out && existsSync(out)) {
      throw new Error(`${out} already exists; this tool only creates a new file, never replaces one`);
    }
    assertWritable(out ?? bsp, ctx.config);

    const before = statSync(bsp).size;
    const header = readHeader(bsp);
    const lump = header.lumps[0];
    let result: {
      entitiesBefore: number;
      entitiesAfter: number;
      outcomes: unknown[];
      warnings: string[];
      path: string;
      written: boolean;
      backupPath: string | null;
      lumpOffset: number;
      lumpBytes: number;
    };
    let decompressed = false;

    if (lump?.compressed) {
      const stored = readFileSync(bsp).subarray(lump.offset, lump.offset + lump.length);
      const decoded = await callSidecar<{ dataBase64: string }>(
        "lzma_decompress",
        { dataBase64: stored.toString("base64") },
        ctx.config,
        300_000,
      );
      let text = Buffer.from(decoded.dataBase64, "base64").toString("utf8");
      if (text.endsWith("\0")) text = text.slice(0, -1);
      const edited = editEntityText(text, args.ops);
      const written = writeEntityText(bsp, edited.text, {
        ...(out ? { out } : {}),
        backup: args.backup,
      });
      result = { ...edited, ...written };
      decompressed = true;
    } else {
      result = writeBspEntities(bsp, args.ops, {
        ...(out ? { out } : {}),
        backup: args.backup,
      });
    }
    const after = statSync(result.path).size;

    return {
      bsp: result.path,
      written: result.written,
      backupPath: result.backupPath,
      entitiesBefore: result.entitiesBefore,
      entitiesAfter: result.entitiesAfter,
      outcomes: result.outcomes,
      warnings: result.warnings,
      lumpOffset: result.lumpOffset,
      lumpBytes: result.lumpBytes,
      bytesBefore: before,
      bytesAfter: after,
      decompressed,
    };
  },
});

export const bspEditTools = [editBspEntitiesTool];
