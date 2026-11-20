import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readBspLumpTool, writeBspLumpTool } from "../../src/maps/typescript/tools/bsplump.js";
import { editBspEntitiesTool } from "../../src/maps/typescript/tools/bspedit.js";
import { runPack } from "../../src/maps/typescript/tools/compile.js";
import { readEntityLump } from "../../src/maps/typescript/bsp/entities.js";
import { LUMP_PAKFILE, readHeader } from "../../src/maps/typescript/bsp/header.js";
import { readPakfile as readPakEntries } from "../../src/maps/typescript/bsp/pakwrite.js";
import { config, has, ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-bsp-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A stock L4D2 map, when the install is present. Nothing here compiles or launches it. */
const REAL = config.gameDir ? join(config.gameDir, "maps", "c1m1_hotel.bsp") : "";
const hasReal = REAL.length > 0 && existsSync(REAL) && has.sidecar;

const sha = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

describe.skipIf(!hasReal)("BSP lumps on a stock map", () => {
  it("round-trips a text lump through LZMA and a binary lump uncompressed", async () => {
    const entities = join(scratch, "entities.bin");
    const first = (await readBspLumpTool.handler(
      { path: REAL, lump: "ENTITIES", out: entities } as never,
      ctx,
    )) as unknown as { bytes: number; sha256: string; lump: { compressed: boolean } };
    expect(first.bytes).toBeGreaterThan(0);
    expect(first.sha256).toBe(sha(entities));

    const compressed = join(scratch, "entities_compressed.bsp");
    const written = (await writeBspLumpTool.handler(
      {
        path: REAL,
        lump: "ENTITIES",
        data: { source: entities },
        compress: true,
        out: compressed,
        backup: false,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { verified: boolean; lump: { compressed: boolean }; sha256: string };
    expect(written.verified).toBe(true);
    expect(written.lump.compressed).toBe(true);

    const back = join(scratch, "entities_back.bin");
    const again = (await readBspLumpTool.handler(
      { path: compressed, lump: "ENTITIES", out: back } as never,
      ctx,
    )) as unknown as { sha256: string; lump: { compressed: boolean } };
    expect(again.lump.compressed).toBe(true);
    expect(again.sha256).toBe(first.sha256);
    expect(readFileSync(back).equals(readFileSync(entities))).toBe(true);

    // A binary lump, uncompressed, to prove the writer is not text-only.
    const planes = join(scratch, "planes.bin");
    const planeRead = (await readBspLumpTool.handler(
      { path: REAL, lump: "PLANES", out: planes } as never,
      ctx,
    )) as unknown as { sha256: string; bytes: number };
    expect(planeRead.bytes).toBeGreaterThan(0);

    const plainOut = join(scratch, "planes_copy.bsp");
    const planeWrite = (await writeBspLumpTool.handler(
      {
        path: REAL,
        lump: "PLANES",
        data: { source: planes },
        compress: false,
        out: plainOut,
        backup: false,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { verified: boolean; sha256: string };
    expect(planeWrite.verified).toBe(true);
    expect(planeWrite.sha256).toBe(planeRead.sha256);

    const planeBack = join(scratch, "planes_back.bin");
    await readBspLumpTool.handler(
      { path: plainOut, lump: "PLANES", out: planeBack } as never,
      ctx,
    );
    expect(readFileSync(planeBack).equals(readFileSync(planes))).toBe(true);
  }, 120_000);

  it("adds, updates and removes an entity in the compiled lump", async () => {
    const copy = join(scratch, "entities_edit.bsp");
    copyFileSync(REAL, copy);
    const before = readEntityLump(copy).entities.length;

    const added = (await editBspEntitiesTool.handler(
      {
        bsp: copy,
        ops: [
          {
            op: "add",
            keyvalues: {
              classname: "light",
              targetname: "hsmcp_probe",
              origin: "0 0 0",
              _light: "1 2 3 4",
            },
          },
        ],
        backup: false,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entitiesAfter: number };
    expect(added.entitiesAfter).toBe(before + 1);
    expect(readEntityLump(copy).text).toContain('"targetname" "hsmcp_probe"');

    await editBspEntitiesTool.handler(
      {
        bsp: copy,
        ops: [
          {
            op: "update",
            match: { targetname: "hsmcp_probe" },
            keyvalues: { _light: "9 9 9 9" },
          },
        ],
        backup: false,
        confirm: true,
      } as never,
      ctx,
    );
    expect(readEntityLump(copy).text).toContain('"_light" "9 9 9 9"');

    await editBspEntitiesTool.handler(
      {
        bsp: copy,
        ops: [{ op: "remove", match: { targetname: "hsmcp_probe" } }],
        backup: false,
        confirm: true,
      } as never,
      ctx,
    );
    const after = readEntityLump(copy);
    expect(after.entities.length).toBe(before);
    expect(after.text).not.toContain("hsmcp_probe");
  }, 120_000);
});

describe.skipIf(!hasReal)("packing into a compiled map", () => {
  it("packs a file and reads it back out of the pakfile", async () => {
    const copy = join(scratch, "packed.bsp");
    copyFileSync(REAL, copy);

    const material = join(scratch, "hsmcp_probe.vmt");
    writeFileSync(
      material,
      `"LightmappedGeneric"\n{\n\t"$basetexture" "hsmcp/probe"\n}\n`,
      "utf8",
    );

    const packed = (await runPack.handler(
      {
        bsp: copy,
        files: [{ internal: "materials/hsmcp_probe.vmt", source: material }],
        backup: false,
        confirm: true,
      } as never,
      ctx,
    )) as { added: number; ok: boolean };
    expect(packed.added).toBe(1);
    expect(packed.ok).toBe(true);

    // The listing tool returns the LARGEST entries, and a 60-byte VMT is not one of them on
    // a 1700-entry map. Read the archive directly instead.
    const bytes = readFileSync(copy);
    const header = readHeader(copy);
    const lump = header.lumps[LUMP_PAKFILE]!;
    const entries = readPakEntries(
      bytes,
      { offset: lump.offset, length: lump.length, layout: header.layout },
      copy,
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((entry) => entry.name.endsWith("materials/hsmcp_probe.vmt"))).toBe(true);
  }, 180_000);
});
