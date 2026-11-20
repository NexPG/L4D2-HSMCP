/**
 * Writing a map's pakfile: the part of the job `bspzip` used to do.
 *
 * Three claims are worth testing and none of them is "a file appeared". The archive must
 * round-trip byte for byte through our own reader; an existing entry must be replaced rather
 * than duplicated; and every other lump must be byte-identical, because the whole design is
 * "append and move the pointer" rather than "rebuild the map". The last test does the same
 * against the real probe BSP the suite already ships — which is an L4D2-layout file, where
 * the lump descriptor fields are in the other order.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LUMP_PAKFILE, readHeader } from "../../src/maps/typescript/bsp/header.js";
import { addToPakfile, readPakfile } from "../../src/maps/typescript/bsp/pakwrite.js";
import type { PakTarget } from "../../src/maps/typescript/bsp/pakwrite.js";
import { readZip, writeZip } from "../../src/maps/typescript/bsp/zip.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runPakfileAddTool } from "../../src/maps/typescript/tools/pakfileadd.js";
import { ctx as sharedCtx, FIXTURES } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-pak-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A standard-layout BSP with one entity lump and no pakfile. */
function syntheticBsp(): Buffer {
  const entities = Buffer.from("ENTITIES!", "latin1");
  const bsp = Buffer.alloc(1036 + entities.length);
  bsp.write("VBSP", 0, "latin1");
  bsp.writeInt32LE(20, 4);
  bsp.writeInt32LE(1036, 8); // lump 0 offset
  bsp.writeInt32LE(entities.length, 12); // lump 0 length
  entities.copy(bsp, 1036);
  return bsp;
}

const EMPTY: PakTarget = { offset: 0, length: 0, layout: "standard" };

/** True when the two share every byte except the pakfile descriptor the writer changed. */
function sameExceptDescriptor(a: Buffer, b: Buffer, size: number): boolean {
  const at = 8 + LUMP_PAKFILE * 16;
  for (let i = 0; i < size; i += 1) {
    if (i >= at && i < at + 16) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function targetOf(bytes: Buffer, archiveOffset: number): PakTarget {
  return {
    offset: archiveOffset,
    length: bytes.length - archiveOffset,
    layout: "standard",
  };
}

describe("zip", () => {
  it("round-trips stored and deflated entries", () => {
    const files = [
      { name: "materials/foo/a.vmt", data: Buffer.from('"VertexLitGeneric" {}') },
      { name: "sound/boom.wav", data: Buffer.from([0, 1, 2, 3, 4, 5]) },
    ];
    for (const options of [{ store: true }, {}]) {
      const zip = writeZip(files, options);
      const read = readZip(zip);
      expect(read.map((e) => e.name)).toEqual(["materials/foo/a.vmt", "sound/boom.wav"]);
      for (const entry of read) {
        expect(entry.data.equals(files.find((f) => f.name === entry.name)!.data)).toBe(true);
      }
    }
  });

  it("is deterministic, so an unchanged tree produces the same archive", () => {
    const files = [
      { name: "b.txt", data: Buffer.from("b") },
      { name: "a.txt", data: Buffer.from("a") },
    ];
    expect(writeZip(files).equals(writeZip([...files].reverse()))).toBe(true);
  });

  it("refuses a path that escapes the archive", () => {
    expect(() => writeZip([{ name: "../evil.txt", data: Buffer.from("x") }])).toThrow(
      /refusing the in-archive path/,
    );
  });
});

describe("pakfile writer", () => {
  it("appends the archive, moves the lump, and leaves every other byte alone", () => {
    const bsp = syntheticBsp();
    const result = addToPakfile(
      bsp,
      [
        { internal: "materials/foo/a.vmt", data: Buffer.from('"VertexLitGeneric" {}') },
        { internal: "models/foo/a.mdl", data: Buffer.from([1, 2, 3]) },
      ],
      EMPTY,
    );

    expect(result.added.sort()).toEqual(["materials/foo/a.vmt", "models/foo/a.mdl"]);
    expect(result.replaced).toEqual([]);
    expect(result.entryCount).toBe(2);
    expect(result.archiveOffset % 4).toBe(0);

    // The header's pakfile entry points at the archive (standard layout: offset then length).
    const at = 8 + LUMP_PAKFILE * 16;
    expect(result.bytes.readInt32LE(at)).toBe(result.archiveOffset);
    expect(result.bytes.readInt32LE(at + 4)).toBe(result.bytes.length - result.archiveOffset);

    // Everything before the archive is the original file, byte for byte.
    expect(sameExceptDescriptor(bsp, result.bytes, bsp.length)).toBe(true);
    // And the entity lump is still where it was.
    expect(result.bytes.readInt32LE(8)).toBe(1036);
    expect(result.bytes.toString("latin1", 1036, 1045)).toBe("ENTITIES!");

    const entries = readPakfile(result.bytes, targetOf(result.bytes, result.archiveOffset));
    expect(entries.map((e) => e.name).sort()).toEqual(["materials/foo/a.vmt", "models/foo/a.mdl"]);
  });

  it("replaces an entry with the same name instead of duplicating it", () => {
    const first = addToPakfile(
      syntheticBsp(),
      [{ internal: "materials/a.vmt", data: Buffer.from("one") }],
      EMPTY,
    );
    const second = addToPakfile(
      first.bytes,
      [{ internal: "materials/a.vmt", data: Buffer.from("two") }],
      targetOf(first.bytes, first.archiveOffset),
    );

    expect(second.added).toEqual([]);
    expect(second.replaced).toEqual(["materials/a.vmt"]);
    expect(second.entryCount).toBe(1);
    expect(readPakfile(second.bytes, targetOf(second.bytes, second.archiveOffset))[0]!.data.toString()).toBe("two");
  });

  it("refuses a path that would escape the map", () => {
    expect(() =>
      addToPakfile(syntheticBsp(), [{ internal: "../../outside.txt", data: Buffer.from("x") }], EMPTY),
    ).toThrow(/refusing the in-archive path/);
  });

  it("packs into the real L4D2-layout probe map and preserves its existing entries", () => {
    const path = join(FIXTURES, "hmcp_probe.bsp");
    const source = readFileSync(path);
    const header = readHeader(path);
    const lump = header.lumps[LUMP_PAKFILE]!;
    const before = readPakfile(source, { offset: lump.offset, length: lump.length, layout: header.layout });

    const result = addToPakfile(
      source,
      [{ internal: "materials/hmcp/test.vmt", data: Buffer.from('"UnlitGeneric" {}') }],
      { offset: lump.offset, length: lump.length, layout: header.layout },
    );
    const after = readPakfile(result.bytes, {
      offset: result.archiveOffset,
      length: result.bytes.length - result.archiveOffset,
      layout: header.layout,
    });

    expect(after.length).toBe(before.length + 1);
    for (const entry of before) {
      expect(after.find((e) => e.name === entry.name)!.data.equals(entry.data), entry.name).toBe(true);
    }
    expect(sameExceptDescriptor(source, result.bytes, source.length)).toBe(true);
  });

  it("writes a copy through the tool and proves each entry landed", () => {
    const target = join(scratch, "copy.bsp");
    copyFileSync(join(FIXTURES, "hmcp_probe.bsp"), target);
    const payload = join(scratch, "note.vmt");
    writeFileSync(payload, '"UnlitGeneric" { "$basetexture" "vgui/white" }');

    const r = runPakfileAddTool.handler(
      {
        bsp: target,
        files: [{ internal: "materials/hmcp/note.vmt", source: payload }],
        backup: true,
        confirm: true,
      },
      ctx,
    ) as { verified: boolean; added: string[]; backup: string | null; entryCount: number };

    expect(r.verified).toBe(true);
    expect(r.added).toEqual(["materials/hmcp/note.vmt"]);
    expect(r.backup).not.toBeNull();

    const written = readFileSync(target);
    const header = readHeader(target);
    const entries = readPakfile(written, {
      offset: header.lumps[LUMP_PAKFILE]!.offset,
      length: header.lumps[LUMP_PAKFILE]!.length,
      layout: header.layout,
    });
    expect(entries.some((e) => e.name === "materials/hmcp/note.vmt")).toBe(true);
  });
});
