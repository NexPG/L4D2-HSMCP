/**
 * `verify_vpk` checks structure, not contents. These tests build archives with the native
 * writer, then either read them cleanly or damage exactly one field so the expected rule is
 * the only one that fires. The version 2 fixture is assembled from a version 1 archive: the
 * tree and entry layout are identical, and only the header, MD5 sections and checksums are
 * added, which is what the format defines.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readVpk, vpkArchivePath, writeVpk } from "../../src/formats/typescript/formats/vpk.js";
import type { VpkArchive, VpkWriteResult } from "../../src/formats/typescript/formats/vpk.js";
import { verifyVpk } from "../../src/formats/typescript/formats/vpkverify.js";
import { verifyVpkTool } from "../../src/packages/typescript/tools/vpkverify.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-vpk-verify-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const md5 = (bytes: Buffer): Buffer => createHash("md5").update(bytes).digest();

function material(name: string, size: number): Buffer {
  return Buffer.alloc(size, name.charCodeAt(0));
}

function buildV1(split = false): VpkWriteResult {
  return writeVpk(
    new Map([
      ["materials/a.vmt", material("a", 40)],
      ["materials/b.vmt", material("b", 60)],
      ["scripts/vscripts/test.nut", material("c", 30)],
    ]),
    split ? { splitBytes: 64 } : {},
  );
}

/** Adds the version 2 header, MD5 sections and checksums to a version 1 archive. */
function upgradeV2(v1: VpkWriteResult): { dir: Buffer; archives: Buffer[] } {
  const tree = v1.dir.subarray(12, 12 + v1.treeSize);
  const fileData = v1.dir.subarray(12 + v1.treeSize);
  const records: Buffer[] = [];
  for (const archive of v1.archives) {
    const record = Buffer.alloc(28);
    record.writeUInt32LE(archive.index, 0);
    record.writeUInt32LE(0, 4);
    record.writeUInt32LE(archive.bytes.length, 8);
    md5(archive.bytes).copy(record, 12);
    records.push(record);
  }
  const archiveMd5 = Buffer.concat(records);
  const header = Buffer.alloc(28);
  header.writeUInt32LE(0x55aa1234, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(tree.length, 8);
  header.writeUInt32LE(fileData.length, 12);
  header.writeUInt32LE(archiveMd5.length, 16);
  header.writeUInt32LE(48, 20);
  header.writeUInt32LE(0, 24);

  const treeChecksum = md5(tree);
  const entriesChecksum = md5(archiveMd5);
  const beforeWhole = Buffer.concat([header, tree, fileData, archiveMd5]);
  const whole = md5(Buffer.concat([beforeWhole, treeChecksum, entriesChecksum]));
  const other = Buffer.concat([treeChecksum, entriesChecksum, whole]);
  return {
    dir: Buffer.concat([header, tree, fileData, archiveMd5, other]),
    archives: v1.archives.map((archive) => archive.bytes),
  };
}

function writeArchive(v1: VpkWriteResult, suffix: string): string {
  const dir = join(scratch, `pak01${suffix}_dir.vpk`);
  writeFileSync(dir, v1.dir);
  for (const archive of v1.archives) {
    writeFileSync(vpkArchivePath(dir, archive.index), archive.bytes);
  }
  return dir;
}

function writeV2(dirBytes: Buffer, archives: Buffer[], suffix: string): string {
  const dir = join(scratch, `pak01${suffix}_dir.vpk`);
  writeFileSync(dir, dirBytes);
  archives.forEach((bytes, index) => {
    writeFileSync(vpkArchivePath(dir, index + 1), bytes);
  });
  return dir;
}

interface Issue {
  severity: "error" | "warning";
  rule: string;
  path?: string;
  message: string;
}

interface Reply {
  ok: boolean;
  version: number;
  entryCount: number;
  archiveCount: number;
  archives: Array<{ index: number; present: boolean }>;
  md5: {
    tree: string;
    entries: string;
    wholeFile: string;
    archive: { checked: number; mismatched: number };
  };
  signature: string;
  crc: { checked: number; mismatched: number };
  issues: Issue[];
  issueCount: number;
  errorCount: number;
  warningCount: number;
}

const run = async (path: string, extra: Record<string, unknown> = {}): Promise<Reply> =>
  (await verifyVpkTool.handler({ path, ...extra }, ctx)) as unknown as Reply;

const rules = (reply: Reply): string[] => reply.issues.map((issue) => issue.rule);

describe("verify_vpk", () => {
  it("accepts a clean version 1 archive and checks every CRC", async () => {
    const path = writeArchive(buildV1(), "a");
    const reply = await run(path);
    expect(reply.ok).toBe(true);
    expect(reply.version).toBe(1);
    expect(reply.entryCount).toBe(3);
    expect(reply.crc.checked).toBe(3);
    expect(reply.crc.mismatched).toBe(0);
    expect(reply.issues).toEqual([]);
    expect(reply.signature).toBe("absent");
    expect(reply.md5.tree).toBe("absent");
  });

  it("finds a numbered archive that the tree references but the disk lacks", async () => {
    const v1 = buildV1(true);
    const path = writeArchive(v1, "missing");
    rmSync(vpkArchivePath(path, 1));
    const reply = await run(path);
    expect(reply.ok).toBe(false);
    expect(rules(reply)).toContain("missing-archive");
    expect(reply.archives.find((a) => a.index === 1)?.present).toBe(false);
  });

  it("names a CRC mismatch and the entry it belongs to", async () => {
    const v1 = buildV1();
    const path = writeArchive(v1, "crc");
    const archive = readVpk(readFileSync(path), path);
    const entry = archive.entries[0]!;
    const data = readFileSync(path);
    const at = archive.fileDataOffset + entry.offset;
    data[at] = data[at]! ^ 0xff;
    writeFileSync(path, data);

    const reply = await run(path);
    expect(reply.ok).toBe(false);
    expect(rules(reply)).toContain("crc-mismatch");
    expect(reply.crc.mismatched).toBe(1);
  });

  it("refuses a truncated tree rather than reading it wrong", async () => {
    const v1 = buildV1();
    const path = join(scratch, "truncated_dir.vpk");
    writeFileSync(path, v1.dir.subarray(0, 12 + v1.treeSize - 4));
    await expect(run(path)).rejects.toThrow(/past the end|tree/i);
  });

  it("reports a duplicate path as ambiguous", () => {
    const archive: VpkArchive = readVpk(buildV1().dir, "x");
    archive.entries.push({ ...archive.entries[0]! });
    const reply = verifyVpk(archive, () => undefined);
    expect(reply.errorCount).toBeGreaterThan(0);
    expect(reply.issues.map((issue) => issue.rule)).toContain("duplicate-entry");
  });

  it("accepts a clean version 2 archive and its MD5 records", async () => {
    const v1 = buildV1(true);
    const v2 = upgradeV2(v1);
    const path = writeV2(v2.dir, v2.archives, "v2");
    const reply = await run(path);
    expect(reply.ok).toBe(true);
    expect(reply.version).toBe(2);
    expect(reply.md5.tree).toBe("ok");
    expect(reply.md5.entries).toBe("ok");
    expect(reply.md5.wholeFile).toBe("ok");
    expect(reply.md5.archive.mismatched).toBe(0);
    expect(reply.md5.archive.checked).toBe(v2.archives.length);
  });

  it("detects a damaged tree through the tree MD5", async () => {
    const v1 = buildV1(true);
    const v2 = upgradeV2(v1);
    // The tree starts at offset 28; the first byte is the first extension character.
    v2.dir[28] = v2.dir[28]! ^ 0x01;
    const path = writeV2(v2.dir, v2.archives, "v2tree");
    const reply = await run(path);
    expect(reply.ok).toBe(false);
    expect(reply.md5.tree).toBe("mismatch");
    expect(rules(reply)).toContain("md5-tree");
  });

  it("detects a damaged numbered archive through its MD5 record", async () => {
    const v1 = buildV1(true);
    const v2 = upgradeV2(v1);
    v2.archives[0]![0] = v2.archives[0]![0]! ^ 0xff;
    const path = writeV2(v2.dir, v2.archives, "v2archive");
    const reply = await run(path, { crc: false });
    expect(reply.ok).toBe(false);
    expect(reply.md5.archive.mismatched).toBe(1);
    expect(rules(reply)).toContain("md5-archive-mismatch");
  });

  it("detects a damaged archive-MD5 section through its own MD5", async () => {
    const v1 = buildV1(true);
    const v2 = upgradeV2(v1);
    const archiveMd5Start = v2.dir.length - 28 * v1.archives.length - 48;
    v2.dir[archiveMd5Start] = v2.dir[archiveMd5Start]! ^ 0x01;
    const path = writeV2(v2.dir, v2.archives, "v2entries");
    const reply = await run(path, { crc: false });
    expect(reply.ok).toBe(false);
    expect(reply.md5.entries).toBe("mismatch");
    expect(rules(reply)).toContain("md5-entries");
  });

  it("reports an unparseable signature as unverified, not as a corrupt archive", async () => {
    const v1 = buildV1(true);
    const v2 = upgradeV2(v1);
    const key = Buffer.from("not a DER key");
    const signature = Buffer.from("not a signature");
    const section = Buffer.alloc(8 + key.length + signature.length);
    section.writeUInt32LE(key.length, 0);
    key.copy(section, 4);
    section.writeUInt32LE(signature.length, 4 + key.length);
    signature.copy(section, 8 + key.length);
    // The whole-file checksum covers the header, so the signature size must be set before
    // it is computed; the signature section itself is outside the hashed range.
    v2.dir.writeUInt32LE(section.length, 24);
    const otherStart = v2.dir.length - 48;
    md5(v2.dir.subarray(0, otherStart + 32)).copy(v2.dir, otherStart + 32);
    const path = writeV2(Buffer.concat([v2.dir, section]), v2.archives, "v2sig");
    const reply = await run(path);
    expect(reply.signature).toBe("unverified");
    expect(reply.ok).toBe(true);
    expect(reply.warningCount).toBeGreaterThan(0);
    expect(rules(reply)).toContain("signature-unverified");
  });

  it("truncates the issue list without hiding the counts", async () => {
    const v1 = buildV1(true);
    const path = writeArchive(v1, "limit");
    for (const archive of v1.archives) rmSync(vpkArchivePath(path, archive.index));
    const reply = await run(path, { limit: 1 });
    expect(reply.issues).toHaveLength(1);
    expect(reply.issueCount).toBeGreaterThan(1);
    expect(reply.errorCount).toBeGreaterThan(1);
  });
});
