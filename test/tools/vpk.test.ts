/**
 * Writing and reading a VPK without `vpk.exe`.
 *
 * The assertions that matter are not "a file appeared". They are: the tree the format
 * requires (extension, then directory, then name, each closed by an empty string) is what
 * got written; a file with no extension and a file at the root survive a round trip; the
 * data offset is measured from the end of the tree rather than the start of the file; and a
 * split archive reads back byte-for-byte, because the offset arithmetic changes completely
 * when a file lives in `_000.vpk`.
 *
 * One test is adversarial: an archive is hand-built with an entry named `../escape.txt`,
 * which our writer refuses to produce. An extractor that trusts the names it reads is how
 * a downloaded addon writes outside the directory someone chose.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  crc32,
  isVpk,
  readVpk,
  readVpkEntry,
  VPK_SIGNATURE,
  vpkArchivePath,
  vpkDirPath,
  vpkPathParts,
  writeVpk,
} from "../../src/formats/typescript/formats/vpk.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readVpkTool, runVpkBuildTool, runVpkExtractTool } from "../../src/packages/typescript/tools/vpk.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-vpk-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The game's own archive, when this machine has one. */
const gameVpk = ctx.config.gameDir === null ? null : join(ctx.config.gameDir, "pak01_dir.vpk");

const ADDON = new Map<string, Buffer>([
  ["addoninfo.txt", Buffer.from('"addoninfo"\n{\n\t"addontitle"\t"Test"\n}\n')],
  ["LICENSE", Buffer.from("no extension, at the root")],
  ["a.b.c", Buffer.from("a name with two dots")],
  ["missions/test.txt", Buffer.from("missions/test.txt")],
  ["maps/test.bsp", Buffer.alloc(1024, 7)],
  ["materials/foo/bar.vtf", Buffer.from([1, 2, 3, 4])],
  ["materials/foo/bar.vmt", Buffer.from('"VertexLitGeneric" {}')],
  ["scripts/vscripts/test.nut", Buffer.from("::print(\"hi\")")],
]);

describe("vpk format", () => {
  it("round-trips every path shape the format treats specially", () => {
    const built = writeVpk(ADDON);
    const archive = readVpk(built.dir, "test.vpk");

    expect(archive.version).toBe(1);
    expect(archive.entries.map((e) => e.path).sort()).toEqual([...ADDON.keys()].sort());
    for (const entry of archive.entries) {
      expect(readVpkEntry(archive, entry).toString("utf8"), entry.path).toBe(
        ADDON.get(entry.path)!.toString("utf8"),
      );
      expect(entry.crc32, entry.path).toBe(crc32(ADDON.get(entry.path)!));
      expect(entry.archiveIndex).toBe(0x7fff);
      expect(entry.preload.length).toBe(0);
    }
  });

  it("writes the header and the data at the offsets the format specifies", () => {
    const built = writeVpk(ADDON);
    const treeSize = built.dir.readUInt32LE(8);
    expect(built.dir.readUInt32LE(0)).toBe(VPK_SIGNATURE);
    expect(built.dir.readUInt32LE(4)).toBe(1);
    expect(treeSize).toBe(built.treeSize);

    const expectedTotal =
      12 + treeSize + [...ADDON.values()].reduce((sum, b) => sum + b.length, 0);
    expect(built.dir.length).toBe(expectedTotal);

    // The first entry's offset is measured from the end of the header and tree, not from
    // byte zero. Reading it from zero still finds plausible bytes, which is why this is
    // asserted against the real position rather than against a number copied from a dump.
    const archive = readVpk(built.dir);
    expect(archive.fileDataOffset).toBe(12 + treeSize);
    for (const entry of archive.entries) {
      const at = archive.fileDataOffset + entry.offset;
      expect(built.dir.subarray(at, at + entry.storedLength).equals(ADDON.get(entry.path)!)).toBe(true);
    }
  });

  it("splits into numbered archives and reads them back", () => {
    const built = writeVpk(ADDON, { splitBytes: 1100 });
    expect(built.archives.length).toBeGreaterThan(1);
    expect(built.dir.length).toBeLessThan(12 + built.treeSize + 1024);

    const archive = readVpk(built.dir, "split_dir.vpk");
    const byIndex = new Map(built.archives.map((a) => [a.index, a.bytes]));
    expect(archive.archiveCount).toBe(built.archives.length);

    for (const entry of archive.entries) {
      if (entry.length === 0) continue;
      expect(entry.archiveIndex).not.toBe(0x7fff);
      const data = readVpkEntry(archive, entry, (index) => byIndex.get(index));
      expect(data.equals(ADDON.get(entry.path)!), entry.path).toBe(true);
    }

    // A file larger than the split size cannot be split and must be refused, not truncated.
    expect(() => writeVpk(new Map([["big.bin", Buffer.alloc(2048)]]), { splitBytes: 1024 })).toThrow(
      /larger than the 1024-byte archive limit/,
    );
  });

  it("refuses paths that would escape the archive", () => {
    expect(() => writeVpk(new Map([["../evil.txt", Buffer.from("x")]]))).toThrow(/refusing the entry path/);
    expect(() => writeVpk(new Map([["a/./b.txt", Buffer.from("x")]]))).toThrow(/refusing the entry path/);
    expect(() => writeVpk(new Map([["/absolute.txt", Buffer.from("x")]]))).not.toThrow();
    // Two spellings of one path are one entry, and the map cannot hold both.
    expect(() =>
      writeVpk(
        new Map([
          ["a/b.txt", Buffer.from("x")],
          ["a\\b.txt", Buffer.from("y")],
        ]),
      ),
    ).toThrow(/duplicate entry path/);
    expect(() => writeVpk(new Map())).toThrow(/no entries/);
  });

  it("refuses what it does not understand instead of reading it wrong", () => {
    expect(() => readVpk(Buffer.from("nope"))).toThrow(/too short/);
    expect(() => readVpk(Buffer.alloc(64))).toThrow(/not a VPK/);

    const compressed = Buffer.alloc(12);
    compressed.writeUInt32LE(VPK_SIGNATURE, 0);
    compressed.writeUInt32LE(54, 4);
    expect(() => readVpk(compressed)).toThrow(/version 54/);

    const truncated = Buffer.alloc(12);
    truncated.writeUInt32LE(VPK_SIGNATURE, 0);
    truncated.writeUInt32LE(1, 4);
    truncated.writeUInt32LE(9999, 8);
    expect(() => readVpk(truncated)).toThrow(/past the end/);
  });

  it("splits a path into the extension, directory and name the tree stores", () => {
    expect(vpkPathParts("materials/foo/bar.vtf")).toEqual({
      dir: "materials/foo",
      name: "bar",
      ext: "vtf",
    });
    expect(vpkPathParts("addoninfo.txt")).toEqual({ dir: "", name: "addoninfo", ext: "txt" });
    expect(vpkPathParts("LICENSE")).toEqual({ dir: "", name: "LICENSE", ext: "" });
    expect(vpkPathParts(".gitignore")).toEqual({ dir: "", name: ".gitignore", ext: "" });
    expect(vpkDirPath("pak01_003.vpk")).toBe("pak01_dir.vpk");
    expect(vpkDirPath("pak01_dir.vpk")).toBe("pak01_dir.vpk");
    expect(vpkArchivePath("pak01_dir.vpk", 3)).toBe("pak01_003.vpk");
    expect(isVpk(Buffer.from("VPK"))).toBe(false);
  });

  /**
   * A v1 archive with preload 0 and everything in the directory file, built by hand so the
   * entry name can be one our writer refuses. Layout: header, tree, data.
   */
  function craft(entries: Array<{ dir: string; name: string; ext: string; data: Buffer }>): Buffer {
    const tree: Buffer[] = [];
    const push = (text: string): void => void tree.push(Buffer.from(`${text}\0`, "utf8"));
    let dataOffset = 0;
    for (const entry of entries) {
      push(entry.ext === "" ? " " : entry.ext);
      push(entry.dir === "" ? " " : entry.dir);
      push(entry.name);
      const record = Buffer.alloc(18);
      record.writeUInt32LE(crc32(entry.data), 0);
      record.writeUInt16LE(0, 4);
      record.writeUInt16LE(0x7fff, 6);
      record.writeUInt32LE(dataOffset, 8);
      record.writeUInt32LE(entry.data.length, 12);
      record.writeUInt16LE(0xffff, 16);
      tree.push(record);
      push("");
      push("");
      dataOffset += entry.data.length;
    }
    push("");
    const treeBytes = Buffer.concat(tree);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(VPK_SIGNATURE, 0);
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(treeBytes.length, 8);
    return Buffer.concat([header, treeBytes, ...entries.map((e) => e.data)]);
  }

  it("reads an archive it did not write", () => {
    const bytes = craft([
      { dir: "", name: "addoninfo", ext: "txt", data: Buffer.from("hello") },
      { dir: "materials/x", name: "wall", ext: "vmt", data: Buffer.from('"X"{}') },
    ]);
    const archive = readVpk(bytes);
    expect(archive.entries.map((e) => e.path).sort()).toEqual([
      "addoninfo.txt",
      "materials/x/wall.vmt",
    ]);
    expect(readVpkEntry(archive, archive.entries[0]!).toString()).toBe("hello");
  });
});

describe("vpk tools", () => {
  it("builds an addon, reads it back, and extracts it byte-for-byte", async () => {
    const staging = join(scratch, "myaddon");
    mkdirSync(join(staging, "materials", "vgui", "maps"), { recursive: true });
    mkdirSync(join(staging, "missions"), { recursive: true });
    writeFileSync(join(staging, "addoninfo.txt"), '"addoninfo"\n{\n}\n');
    writeFileSync(join(staging, "missions", "test.txt"), "chapter");
    writeFileSync(join(staging, "materials", "vgui", "maps", "test.vmt"), '"UnlitGeneric" {}');

    const out = join(scratch, "out", "myaddon.vpk");
    const built = (await runVpkBuildTool.handler(
      { dir: staging, out, overwrite: false, confirm: true },
      ctx,
    )) as {
      vpk: string;
      entryCount: number;
      verified: { compared: number; missingFromVpk: string[]; extraInVpk: string[] };
    };

    expect(existsSync(out)).toBe(true);
    expect(built.entryCount).toBe(3);
    expect(built.verified.compared).toBe(3);
    expect(built.verified.missingFromVpk).toEqual([]);
    expect(built.verified.extraInVpk).toEqual([]);

    const listed = (await readVpkTool.handler(
      { path: out, verify: true, limit: 500, sortBy: "path" },
      ctx,
    )) as {
      entries: Array<{ path: string; bytes: number }>;
      verified: { checked: number; mismatched: string[] };
    };
    expect(listed.entries.map((e) => e.path).sort()).toEqual([
      "addoninfo.txt",
      "materials/vgui/maps/test.vmt",
      "missions/test.txt",
    ]);
    expect(listed.verified).toEqual({ checked: 3, mismatched: [], unreadable: [] });

    const into = join(scratch, "extracted");
    const extracted = (await runVpkExtractTool.handler(
      { path: out, into, overwrite: false, limit: 10, confirm: true },
      ctx,
    )) as { count: number; refused: Array<{ path: string; why: string }> };
    expect(extracted.count).toBe(3);
    expect(extracted.refused).toEqual([]);
    expect(readFileSync(join(into, "missions", "test.txt"), "utf8")).toBe("chapter");
    expect(readFileSync(join(into, "materials", "vgui", "maps", "test.vmt"), "utf8")).toBe(
      '"UnlitGeneric" {}',
    );
  });

  it("refuses to overwrite the staging tree it is packing", () => {
    const staging = join(scratch, "selfpack");
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "a.txt"), "a");
    expect(() =>
      runVpkBuildTool.handler(
        { dir: staging, out: join(staging, "a.vpk"), overwrite: true, confirm: true },
        ctx,
      ),
    ).toThrow(/must not live inside/);
  });

  it("refuses an entry whose name escapes the destination directory", async () => {
    const tree: Buffer[] = [];
    const push = (text: string): void => void tree.push(Buffer.from(`${text}\0`, "utf8"));
    push("txt");
    push("..");
    push("escape");
    const record = Buffer.alloc(18);
    record.writeUInt32LE(crc32(Buffer.from("pwned")), 0);
    record.writeUInt16LE(0, 4);
    record.writeUInt16LE(0x7fff, 6);
    record.writeUInt32LE(0, 8);
    record.writeUInt32LE(5, 12);
    record.writeUInt16LE(0xffff, 16);
    tree.push(record);
    push("");
    push("");
    push("");
    const treeBytes = Buffer.concat(tree);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(VPK_SIGNATURE, 0);
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(treeBytes.length, 8);
    const malicious = join(scratch, "evil.vpk");
    writeFileSync(malicious, Buffer.concat([header, treeBytes, Buffer.from("pwned")]));

    const into = join(scratch, "safe");
    mkdirSync(into, { recursive: true });
    const r = (await runVpkExtractTool.handler(
      { path: malicious, into, overwrite: false, limit: 10, confirm: true },
      ctx,
    )) as { count: number; refused: Array<{ path: string; why: string }> };

    expect(r.count).toBe(0);
    expect(r.refused[0]?.why).toMatch(/outside the destination/);
    expect(existsSync(join(scratch, "escape.txt"))).toBe(false);
  });

  it.skipIf(gameVpk === null || !existsSync(gameVpk))(
    "reads a real game archive and agrees with its own CRCs",
    () => {
      const dir = gameVpk as string;
      const archive = readVpk(readFileSync(dir), dir);
      expect(archive.version).toBe(1);
      expect(archive.entries.length).toBeGreaterThan(1000);
      expect(archive.archiveCount).toBeGreaterThan(0);

      // Verify a handful from the middle of the archive: enough to catch an offset that is
      // measured from byte zero instead of from the end of the tree.
      const sample = archive.entries.filter((_, i) => i % Math.floor(archive.entries.length / 8) === 0).slice(0, 8);
      const opened = new Map<number, Buffer | undefined>();
      const openArchive = (index: number): Buffer | undefined => {
        if (!opened.has(index)) {
          const path = vpkArchivePath(dir, index);
          opened.set(index, existsSync(path) ? readFileSync(path) : undefined);
        }
        return opened.get(index);
      };
      for (const entry of sample) {
        const data = readVpkEntry(archive, entry, openArchive);
        expect(crc32(data), entry.path).toBe(entry.crc32);
        expect(data.length).toBe(entry.length);
      }
      expect(statSync(dir).size).toBeGreaterThan(0);
    },
    120_000,
  );
});
