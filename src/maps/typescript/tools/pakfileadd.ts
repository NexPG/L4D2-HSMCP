/**
 * Adding files to a map's pakfile, natively.
 *
 * `run_pack` drives `bspzip`, which ships with the game — so shipping a map with its assets
 * needed a Steam install even though the format is a plain ZIP. This tool does the same job
 * in-process: append the archive, point lump 40 at it, read it back. `run_pakfile_extract`
 * is the other direction, and `run_pack` remains the path for the `auto` dependency scan.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";
import { LUMP_PAKFILE, readHeader } from "../bsp/header.js";
import { addToPakfile, readPakfile } from "../bsp/pakwrite.js";

export const runPakfileAddTool = defineTool({
  name: "run_pakfile_add",
  description:
    "Adds files to a compiled .bsp's pakfile with this server's own ZIP writer: no bspzip, " +
    "no game install. Each entry is a pair of in-map path and source file; an existing entry " +
    "with the same name is replaced. The archive is appended and lump 40 moved to it, so the " +
    "map's other lumps are byte-identical, and the result is read back to prove every entry " +
    "is there. Use it to ship custom materials, models or sounds with a map.",
  realm: "map",
  guarded: true,
  inputSchema: {
    bsp: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    files: z
      .array(
        z.object({
          internal: z.string().describe("Path inside the map, e.g. materials/foo/bar.vmt."),
          source: z.string().describe("File on disk to pack."),
        }),
      )
      .min(1),
    out: z
      .string()
      .optional()
      .describe("Write to a copy instead of the map itself. Defaults to in place."),
    backup: z.boolean().default(true).describe("Write <bsp>.bak before changing it in place."),
    confirm: CONFIRM,
  },
  outputSchema: {
    bsp: z.string(),
    out: z.string(),
    backup: z.string().nullable(),
    added: z.array(z.string()),
    replaced: z.array(z.string()),
    entryCount: z.number(),
    archiveOffset: z.number(),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    verified: z.boolean(),
  },
  handler: (args, ctx) => {
    const bsp = resolveInput(args.bsp, ctx.config);
    if (!existsSync(bsp)) throw new Error(`${bsp} does not exist`);
    const source = readFileSync(bsp);

    const files = args.files.map((entry) => {
      const file = resolveInput(entry.source, ctx.config);
      if (!existsSync(file)) throw new Error(`${file} does not exist`);
      return { internal: entry.internal, data: readFileSync(file) };
    });

    const before = readHeader(bsp);
    const lump = before.lumps[LUMP_PAKFILE]!;
    const result = addToPakfile(source, files, {
      offset: lump.offset,
      length: lump.length,
      layout: before.layout,
    });
    const out = args.out ? assertWritable(resolveInput(args.out, ctx.config), ctx.config) : assertWritable(bsp, ctx.config);

    let backup: string | null = null;
    if (args.out === undefined && args.backup) {
      backup = assertWritable(`${out}.bak`, ctx.config);
      copyFileSync(out, backup);
    }
    writeFileSync(out, result.bytes);
    ctx.audit.record({
      kind: "file_write",
      data: { path: out, entries: files.length, backup, created: true },
    });

    // Read the written file back: a lump entry that points at the wrong offset is the one
    // failure this tool must not report as success.
    const written = readFileSync(out);
    const after = readHeader(out);
    const entries = readPakfile(
      written,
      {
        offset: after.lumps[LUMP_PAKFILE]!.offset,
        length: after.lumps[LUMP_PAKFILE]!.length,
        layout: after.layout,
      },
      out,
    );
    const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry.data]));
    const verified = files.every((file) => {
      const stored = byName.get(file.internal.replace(/\\/g, "/").toLowerCase());
      return stored !== undefined && stored.equals(file.data);
    });

    return {
      bsp,
      out,
      backup,
      added: result.added,
      replaced: result.replaced,
      entryCount: result.entryCount,
      archiveOffset: result.archiveOffset,
      bytesBefore: source.length,
      bytesAfter: written.length,
      verified,
    };
  },
});

export const pakfileAddTools = [runPakfileAddTool];
