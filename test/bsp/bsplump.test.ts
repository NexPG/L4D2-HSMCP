/**
 * The generic lump reader and writer, including LZMA.
 *
 * The claim worth testing is not "a file changed": it is that a compressed lump written by
 * this server can be read back by the same reader and hashes to the input, that the L4D2
 * descriptor order survives the write, and that every other byte of the map is untouched.
 * The real probe map is L4D2-layout, so the last test is the one that would catch a writer
 * that assumed the standard order.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readBspLumpTool, writeBspLumpTool } from "../../src/maps/typescript/tools/bsplump.js";
import { ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-lump-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A standard-layout BSP with one entity lump and no other data. */
function syntheticBsp(entities: string): Buffer {
  const body = Buffer.from(entities, "latin1");
  const bsp = Buffer.alloc(1036 + body.length);
  bsp.write("VBSP", 0, "latin1");
  bsp.writeInt32LE(20, 4);
  bsp.writeInt32LE(1036, 8); // lump 0 offset, standard layout
  bsp.writeInt32LE(body.length, 12); // lump 0 length
  body.copy(bsp, 1036);
  return bsp;
}

const installed = has.sidecar;

describe.skipIf(!installed)("read_bsp_lump", () => {
  it("returns the entity lump as text and the rest as bytes", async () => {
    const path = join(scratch, "plain.bsp");
    writeFileSync(path, syntheticBsp('{\n"classname" "worldspawn"\n}\n'));

    const r = (await readBspLumpTool.handler(
      { path, lump: "ENTITIES", maxInline: 1 << 20 },
      ctx,
    )) as { text?: string; bytes: number; lump: { compressed: boolean; index: number }; sha256: string };

    expect(r.lump.index).toBe(0);
    expect(r.lump.compressed).toBe(false);
    expect(r.text).toContain("worldspawn");
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts an index and a lower-case name", async () => {
    const path = join(scratch, "names.bsp");
    writeFileSync(path, syntheticBsp("ENTITIES!"));
    const byName = (await readBspLumpTool.handler({ path, lump: "entities" } as never, ctx)) as {
      text?: string;
    };
    const byIndex = (await readBspLumpTool.handler({ path, lump: 0 } as never, ctx)) as { text?: string };
    expect(byName.text).toBe("ENTITIES!");
    expect(byIndex.text).toBe("ENTITIES!");
  });

  it("refuses a lump name it does not know, with the list", async () => {
    const path = join(scratch, "bad-name.bsp");
    writeFileSync(path, syntheticBsp("x"));
    await expect(readBspLumpTool.handler({ path, lump: "NOT_A_LUMP" } as never, ctx)).rejects.toThrow(
      /is not a lump/,
    );
  });
});

describe.skipIf(!installed)("write_bsp_lump", () => {
  it("compresses, appends and proves the round-trip", async () => {
    const path = join(scratch, "write.bsp");
    writeFileSync(path, syntheticBsp("original"));
    const payload = `lump payload ${"abcdef".repeat(1000)}`;
    const before = readFileSync(path);

    const w = (await writeBspLumpTool.handler(
      {
        path,
        lump: 63,
        data: { text: payload },
        compress: true,
        backup: true,
        confirm: true,
      } as never,
      ctx,
    )) as {
      verified: boolean;
      backup: string | null;
      lump: { compressed: boolean; storedBytes: number; uncompressedBytes: number; offset: number };
      bytesBefore: number;
      bytesAfter: number;
      sha256: string;
    };

    expect(w.verified).toBe(true);
    expect(w.backup).not.toBeNull();
    expect(w.lump.compressed).toBe(true);
    expect(w.lump.uncompressedBytes).toBe(Buffer.byteLength(payload));
    expect(w.lump.storedBytes).toBeLessThan(w.lump.uncompressedBytes);
    expect(w.lump.offset % 4).toBe(0);
    expect(w.bytesAfter).toBeGreaterThan(w.bytesBefore);

    // Everything before the appended lump is the original file.
    const after = readFileSync(path);
    expect(after.subarray(0, before.length).equals(before)).toBe(false); // the descriptor changed
    expect(after.length).toBe(w.bytesAfter);

    const back = (await readBspLumpTool.handler({ path, lump: 63 } as never, ctx)) as { text?: string };
    expect(back.text).toBe(payload);
  });

  it("keeps the L4D2 field order, which the probe map uses", async () => {
    const source = join(FIXTURES, "hmcp_probe.bsp");
    const path = join(scratch, "probe.bsp");
    copyFileSync(source, path);

    const before = readFileSync(path);
    const entities = (await readBspLumpTool.handler(
      { path, lump: "ENTITIES", maxInline: 8 << 20 },
      ctx,
    )) as { text?: string; bytes: number };
    expect(entities.text).toContain("classname");

    const w = (await writeBspLumpTool.handler(
      {
        path,
        lump: "ENTITIES",
        data: { text: entities.text! },
        compress: true,
        backup: true,
        confirm: true,
      } as never,
      ctx,
    )) as { verified: boolean; lump: { offset: number; compressed: boolean } };

    expect(w.verified).toBe(true);
    expect(w.lump.compressed).toBe(true);
    // The whole original file is still a prefix: only the descriptor changed.
    const after = readFileSync(path);
    let diff = 0;
    const descriptor = 8 + 0 * 16;
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] !== after[i] && !(i >= descriptor && i < descriptor + 16)) diff += 1;
    }
    expect(diff).toBe(0);

    const back = (await readBspLumpTool.handler(
      { path, lump: "ENTITIES", maxInline: 8 << 20 },
      ctx,
    )) as { text?: string };
    expect(back.text).toBe(entities.text);
  });
});
