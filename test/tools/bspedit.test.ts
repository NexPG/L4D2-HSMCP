import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readEntityLump } from "../../src/maps/typescript/bsp/entities.js";
import { readHeader } from "../../src/maps/typescript/bsp/header.js";
import { editBspEntitiesTool } from "../../src/maps/typescript/tools/bspedit.js";
import { readBspLumpTool, writeBspLumpTool } from "../../src/maps/typescript/tools/bsplump.js";
import { FIXTURES, ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-bspedit-tool-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function copy(name: string): string {
  const path = join(scratch, name);
  copyFileSync(PROBE, path);
  return path;
}

describe("edit_bsp_entities tool", () => {
  it("adds a point_servercommand to a compiled map", async () => {
    const path = copy("add.bsp");
    const before = readEntityLump(path).entities.length;
    const out = (await editBspEntitiesTool.handler(
      {
        bsp: path,
        ops: [
          {
            op: "add",
            keyvalues: { classname: "point_servercommand", targetname: "hsmcp_cmd" },
          },
        ],
        backup: false,
        confirm: true,
      },
      ctx,
    )) as { written: boolean; entitiesBefore: number; entitiesAfter: number };

    expect(out.written).toBe(true);
    expect(out.entitiesBefore).toBe(before);
    expect(out.entitiesAfter).toBe(before + 1);
    expect(readEntityLump(path).entities.some((e) => e.targetname === "hsmcp_cmd")).toBe(true);
  });

  it("writes a new file when out is given", async () => {
    const path = copy("source.bsp");
    const out = join(scratch, "new.bsp");
    const original = readFileSync(path);
    await editBspEntitiesTool.handler(
      {
        bsp: path,
        out,
        ops: [{ op: "add", keyvalues: { classname: "info_target", targetname: "copy" } }],
        backup: false,
        confirm: true,
      },
      ctx,
    );
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(path).equals(original)).toBe(true);
    expect(readEntityLump(out).entities.some((e) => e.targetname === "copy")).toBe(true);
  });

  it("decompresses a compressed entity lump before editing it", async () => {
    const path = copy("compressed.bsp");
    const textPath = join(scratch, "entities.txt");
    await readBspLumpTool.handler(
      { path, lump: "ENTITIES", out: textPath, maxInline: 0 } as never,
      ctx,
    );
    await writeBspLumpTool.handler(
      {
        path,
        lump: "ENTITIES",
        data: { source: textPath },
        compress: true,
        backup: false,
        confirm: true,
      } as never,
      ctx,
    );
    expect(readHeader(path).lumps[0]!.compressed).toBe(true);

    const result = (await editBspEntitiesTool.handler(
      {
        bsp: path,
        ops: [{ op: "add", keyvalues: { classname: "info_target", targetname: "hsmcp_probe" } }],
        backup: false,
        confirm: true,
      },
      ctx,
    )) as { decompressed: boolean; entitiesBefore: number; entitiesAfter: number };

    expect(result.decompressed).toBe(true);
    expect(result.entitiesAfter).toBe(result.entitiesBefore + 1);
    expect(readHeader(path).lumps[0]!.compressed).toBe(false);
    expect(
      readEntityLump(path).entities.some((entity) => entity.classname === "info_target"),
    ).toBe(true);
  });

  it("refuses an existing output and an empty op list", async () => {
    const path = copy("refuse.bsp");
    await expect(
      editBspEntitiesTool.handler(
        {
          bsp: path,
          out: path,
          ops: [{ op: "add", keyvalues: { classname: "info_target" } }],
          backup: false,
          confirm: true,
        },
        ctx,
      ),
    ).rejects.toThrow(/already exists/);

    await expect(
      editBspEntitiesTool.handler(
        { bsp: path, ops: [], backup: false, confirm: true },
        ctx,
      ),
    ).rejects.toThrow();
  });
});
