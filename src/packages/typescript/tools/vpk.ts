/**
 * Pack files, without the game's `vpk.exe`.
 *
 * The addon pipeline had one hole shaped like a 2003 command-line tool: `run_vpk_pack`
 * shells out to `vpk.exe`, so an agent on a machine without the Left 4 Dead 2 client could
 * not build an addon at all, and an agent *with* the client could not read one back without
 * the Python sidecar. The format itself is a header and a tree, so it lives in
 * `src/formats/vpk.ts` and these three tools are the surface:
 *
 * * `read_vpk` — what is in this archive, and does the CRC agree;
 * * `run_vpk_extract` — get the files out;
 * * `run_vpk_build` — build one from a staging directory, and read it back to prove the
 *   file list matches the tree that was packed.
 *
 * `run_vpk_pack` still exists and still drives `vpk.exe`: a second writer is only worth
 * trusting when the first one can be compared against it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import {
  crc32,
  readVpk,
  readVpkEntry,
  vpkArchivePath,
  writeVpk,
} from "../../../formats/typescript/formats/vpk.js";
import { openVpk } from "../../../formats/typescript/formats/vpkio.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

/** Every file below `dir`, as archive-relative paths. */
function walk(dir: string): Array<{ path: string; full: string; bytes: number }> {
  const out: Array<{ path: string; full: string; bytes: number }> = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        out.push({
          path: full.slice(dir.length + 1).replace(/\\/g, "/"),
          full,
          bytes: statSync(full).size,
        });
      }
    }
  };
  visit(dir);
  return out;
}

const ENTRY = z.object({
  path: z.string(),
  bytes: z.number(),
  crc32: z.string().describe("Stored CRC-32, eight lowercase hex digits."),
  archive: z
    .number()
    .describe("0x7FFF means the directory file itself, otherwise the 1-based numbered archive."),
});

export const readVpkTool = defineTool({
  name: "read_vpk",
  description:
    "Lists what is inside a .vpk, and optionally verifies every CRC-32 against the bytes. " +
    "Reads the directory archive directly -- no vpk.exe, no sidecar, no game install -- and " +
    "follows numbered archives (_000.vpk ...) when a file lives in one. A path to _003.vpk is " +
    "treated as its _dir.vpk. This is the check that a packed addon contains what the staging " +
    "tree did, and the only way to see inside a downloaded addon.",
  realm: "local",
  inputSchema: {
    path: z.string().describe("Path to the .vpk, absolute or relative to the repo root."),
    filter: z
      .string()
      .optional()
      .describe("Case-insensitive substring on the in-archive path, e.g. `missions/`."),
    limit: z.number().int().min(1).max(100_000).default(500),
    sortBy: z.enum(["path", "size"]).default("path"),
    verify: z
      .boolean()
      .default(false)
      .describe(
        "Read the bytes of each returned entry and compare its CRC-32. Off by default: a " +
          "1 GiB game archive is 1 GiB of reading for a check most callers do not need.",
      ),
  },
  outputSchema: {
    path: z.string(),
    version: z.number(),
    treeSize: z.number(),
    entryCount: z.number(),
    totalBytes: z.number(),
    archiveCount: z.number().describe("Numbered archives referenced by the tree."),
    returned: z.number(),
    entries: z.array(ENTRY),
    verified: z
      .object({
        checked: z.number(),
        mismatched: z.array(z.string()),
        unreadable: z.array(z.object({ path: z.string(), why: z.string() })),
      })
      .nullable(),
  },
  handler: (args, ctx) => {
    const { archive, openArchive } = openVpk(resolveInput(args.path, ctx.config));

    const needle = args.filter?.toLowerCase();
    const matching = needle
      ? archive.entries.filter((e) => e.path.toLowerCase().includes(needle))
      : archive.entries;

    const sorted = [...matching].sort((a, b) =>
      args.sortBy === "size" ? b.length - a.length : a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    const returned = sorted.slice(0, args.limit);

    let verified: { checked: number; mismatched: string[]; unreadable: Array<{ path: string; why: string }> } | null =
      null;
    if (args.verify) {
      const mismatched: string[] = [];
      const unreadable: Array<{ path: string; why: string }> = [];
      let checked = 0;
      for (const entry of returned) {
        try {
          const data = readVpkEntry(archive, entry, openArchive);
          checked += 1;
          if (crc32(data) !== entry.crc32) mismatched.push(entry.path);
        } catch (error) {
          unreadable.push({ path: entry.path, why: (error as Error).message });
        }
      }
      verified = { checked, mismatched, unreadable };
    }

    return {
      path: archive.path,
      version: archive.version,
      treeSize: archive.treeSize,
      entryCount: archive.entries.length,
      totalBytes: archive.entries.reduce((sum, e) => sum + e.length, 0),
      archiveCount: archive.archiveCount,
      returned: returned.length,
      entries: returned.map((e) => ({
        path: e.path,
        bytes: e.length,
        crc32: e.crc32.toString(16).padStart(8, "0"),
        archive: e.archiveIndex,
      })),
      verified,
    };
  },
});

export const runVpkExtractTool = defineTool({
  name: "run_vpk_extract",
  description:
    "Extracts files from a .vpk into a directory. Refuses an entry whose path would escape " +
    "the destination instead of sanitising it -- the same rule run_pakfile_extract follows, " +
    "because both read names written by someone else. Knows about numbered archives. Use it " +
    "to look inside a downloaded addon, or to get a map's packed content back out.",
  realm: "local",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Path to the .vpk, absolute or relative to the repo root."),
    into: z.string().describe("Directory to write into. Created if it is not there."),
    filter: z
      .string()
      .optional()
      .describe("Case-insensitive substring on the in-archive path, e.g. `materials/`."),
    limit: z.number().int().min(1).max(100_000).default(2000),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    vpk: z.string(),
    into: z.string(),
    matched: z.number(),
    written: z.array(z.object({ path: z.string(), file: z.string(), bytes: z.number() })),
    refused: z.array(z.object({ path: z.string(), why: z.string() })),
    skippedOverLimit: z.number(),
    count: z.number(),
    bytes: z.number(),
  },
  handler: (args, ctx) => {
    const into = assertWritable(resolveInput(args.into, ctx.config), ctx.config);
    const { archive, openArchive } = openVpk(resolveInput(args.path, ctx.config));

    const needle = args.filter?.toLowerCase();
    const matching = needle
      ? archive.entries.filter((e) => e.path.toLowerCase().includes(needle))
      : archive.entries;

    mkdirSync(into, { recursive: true });
    const written: Array<{ path: string; file: string; bytes: number }> = [];
    const refused: Array<{ path: string; why: string }> = [];
    let skippedOverLimit = 0;

    for (const entry of matching) {
      if (written.length >= args.limit) {
        skippedOverLimit += 1;
        continue;
      }
      const target = resolve(into, entry.path);
      if (target !== into && !target.startsWith(into + sep)) {
        refused.push({ path: entry.path, why: "would resolve outside the destination directory" });
        continue;
      }
      if (existsSync(target) && !args.overwrite) {
        refused.push({ path: entry.path, why: "already exists; pass overwrite: true to replace it" });
        continue;
      }
      let data: Buffer;
      try {
        data = readVpkEntry(archive, entry, openArchive);
      } catch (error) {
        refused.push({ path: entry.path, why: (error as Error).message });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(assertWritable(target, ctx.config), data);
      written.push({ path: entry.path, file: target, bytes: data.length });
    }

    ctx.audit.record({
      kind: "file_write",
      data: { path: into, from: archive.path, written: written.length, created: true },
    });

    return {
      vpk: archive.path,
      into,
      matched: matching.length,
      written,
      refused,
      skippedOverLimit,
      count: written.length,
      bytes: written.reduce((sum, f) => sum + f.bytes, 0),
    };
  },
});

export const runVpkBuildTool = defineTool({
  name: "run_vpk_build",
  description:
    "Builds a version 1 .vpk from a staging directory with this server's own writer: no " +
    "vpk.exe, no game install. Paths are packed root-relative, so `addoninfo.txt`, " +
    "`missions/`, `maps/` and `materials/` land where the engine looks for them. Afterwards " +
    "the archive is read back and compared entry by entry with the staging tree -- the " +
    "failure this check exists for is a packer that silently drops a file. Use `addoninfo` " +
    "to write the manifest first, or run_vpk_pack when vpk.exe is what you want to drive.",
  realm: "local",
  guarded: true,
  inputSchema: {
    dir: z.string().describe("Staging directory: the addon's tree, root-relative."),
    out: z
      .string()
      .optional()
      .describe("Destination .vpk. Defaults to <parent>/<directory name>.vpk."),
    splitBytes: z
      .number()
      .int()
      .min(1024)
      .optional()
      .describe(
        "Split data across numbered archives at this many bytes per file. Absent writes a " +
          "single archive, which is what an addon normally is.",
      ),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    vpk: z.string(),
    bytes: z.number(),
    entryCount: z.number(),
    treeSize: z.number(),
    archives: z.array(z.object({ index: z.number(), path: z.string(), bytes: z.number() })),
    entries: z.array(z.string()),
    staging: z.string(),
    verified: z.object({
      compared: z.number(),
      missingFromVpk: z.array(z.string()),
      extraInVpk: z.array(z.string()),
    }),
  },
  handler: (args, ctx) => {
    const dir = resolveInput(args.dir, ctx.config);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new Error(`${dir} is not an existing directory`);
    }

    const parent = dirname(dir);
    const out = args.out
      ? resolveInput(args.out, ctx.config)
      : join(parent, `${dir.slice(parent.length + 1).toLowerCase()}.vpk`);
    if (resolve(out) === dir || resolve(out).startsWith(dir + sep)) {
      throw new Error(`the output VPK must not live inside the directory being packed: ${out}`);
    }

    const files = walk(dir);
    if (files.length === 0) throw new Error(`${dir} contains no files to pack`);
    if (existsSync(out) && !args.overwrite) {
      throw new Error(`${out} already exists; pass overwrite: true to replace it`);
    }

    const contents = new Map<string, Buffer>();
    for (const file of files) contents.set(file.path, readFileSync(file.full));

    const built = writeVpk(contents, args.splitBytes === undefined ? {} : { splitBytes: args.splitBytes });

    const written: string[] = [];
    const write = (path: string, bytes: Buffer): void => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(assertWritable(path, ctx.config), bytes);
      written.push(path);
    };
    write(out, built.dir);
    const archives = built.archives.map((a) => {
      const path = vpkArchivePath(out, a.index);
      write(path, a.bytes);
      return { index: a.index, path, bytes: a.bytes.length };
    });

    // The oracle: a packer that quietly drops a file is the failure worth testing for.
    const readBack = readVpk(readFileSync(out), out);
    const have = new Set(readBack.entries.map((e) => e.path));
    const expected = new Set(contents.keys());
    const missingFromVpk = [...expected].filter((p) => !have.has(p));
    const extraInVpk = [...have].filter((p) => !expected.has(p));

    ctx.audit.record({
      kind: "file_write",
      data: { path: out, from: dir, written: written.length, created: true },
    });

    return {
      vpk: out,
      bytes: statSync(out).size,
      entryCount: readBack.entries.length,
      treeSize: built.treeSize,
      archives,
      entries: [...have].sort(),
      staging: dir,
      verified: { compared: expected.size, missingFromVpk, extraInVpk },
    };
  },
});

export const vpkTools = [readVpkTool, runVpkExtractTool, runVpkBuildTool];
