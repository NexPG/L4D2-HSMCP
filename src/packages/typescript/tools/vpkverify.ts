/**
 * `verify_vpk`: structural checks on an archive, not just a listing.
 *
 * `read_vpk` already lists entries and can compare a returned entry's CRC. This tool is the
 * verifier: duplicate paths, entries past the end of their archive, numbered archives that
 * the tree references but the disk does not have, and the version 2 MD5 records (tree,
 * archive-MD5 section, whole file and every archive chunk) plus the optional signature.
 *
 * It is read-only and needs no game, no sidecar and no `vpk.exe`: a downloaded addon can be
 * checked before it is installed.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { openVpk } from "../../../formats/typescript/formats/vpkio.js";
import { verifyVpk } from "../../../formats/typescript/formats/vpkverify.js";

const ISSUE = z.object({
  severity: z.enum(["error", "warning"]),
  rule: z.string(),
  path: z.string().optional(),
  message: z.string(),
});

export const verifyVpkTool = defineTool({
  name: "verify_vpk",
  description:
    "Checks a .vpk for structural defects: the header and tree, duplicate entry paths, entries " +
    "whose offset and length run past the directory or numbered archive, numbered archives " +
    "the tree references but the disk lacks, every entry's CRC-32, and on version 2 the tree " +
    "MD5, the archive-MD5 section's own MD5, the whole-file MD5 and every archive chunk's MD5. " +
    "The optional signature is verified when Node can parse its public key and reported as " +
    "unverified otherwise. Read-only: no `vpk.exe`, no sidecar, no game install. `crc` and " +
    "`md5` are on by default and cost a full read of the archive data.",
  realm: "local",
  inputSchema: {
    path: z.string().describe("Path to a .vpk or _dir.vpk; a numbered archive is accepted too."),
    crc: z
      .boolean()
      .optional()
      .describe("Compare every entry's CRC-32. Default true."),
    md5: z
      .boolean()
      .optional()
      .describe("Check the version 2 MD5 sections. Default true. Version 1 has none."),
    signature: z
      .boolean()
      .optional()
      .describe("Try to verify the optional version 2 signature. Default true."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional()
      .describe("Maximum issues to return. Default 200; counts always cover all of them."),
  },
  outputSchema: {
    path: z.string(),
    version: z.number(),
    entryCount: z.number(),
    archiveCount: z.number(),
    dirBytes: z.number(),
    dataBytes: z.number(),
    archives: z.array(
      z.object({
        index: z.number(),
        path: z.string(),
        present: z.boolean(),
        bytes: z.number(),
      }),
    ),
    md5: z.object({
      tree: z.enum(["ok", "mismatch", "absent", "unreadable"]),
      entries: z.enum(["ok", "mismatch", "absent", "unreadable"]),
      wholeFile: z.enum(["ok", "mismatch", "absent", "unreadable"]),
      archive: z.object({ checked: z.number(), mismatched: z.number() }),
    }),
    signature: z.enum(["absent", "verified", "mismatch", "unverified"]),
    crc: z.object({ checked: z.number(), mismatched: z.number() }),
    issues: z.array(ISSUE),
    issueCount: z.number(),
    errorCount: z.number(),
    warningCount: z.number(),
    ok: z.boolean(),
  },
  handler: (args, ctx) => {
    const { archive, openArchive, statArchive, archivePath } = openVpk(
      resolveInput(args.path, ctx.config),
    );
    const result = verifyVpk(archive, openArchive, {
      crc: args.crc ?? true,
      md5: args.md5 ?? true,
      signature: args.signature ?? true,
      archivePath,
      statArchive,
    });
    const limit = args.limit ?? 200;
    return {
      path: archive.path,
      version: result.version,
      entryCount: result.entryCount,
      archiveCount: result.archiveCount,
      dirBytes: result.dirBytes,
      dataBytes: result.dataBytes,
      archives: result.archives,
      md5: result.md5,
      signature: result.signature,
      crc: result.crc,
      issues: result.issues.slice(0, limit),
      issueCount: result.issues.length,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      ok: result.ok,
    };
  },
});

export const vpkVerifyTools = [verifyVpkTool];
