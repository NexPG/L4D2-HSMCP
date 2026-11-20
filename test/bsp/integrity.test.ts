import { copyFileSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkBsp } from "../../src/maps/typescript/bsp/integrity.js";
import { readHeader, setLumpDescriptor } from "../../src/maps/typescript/bsp/header.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { checkBspTool } from "../../src/maps/typescript/tools/bsp.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { applyVmfOps } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-bspcheck-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SKELETON =
  `versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n\t"prefab" "0"\n}\n` +
  `visgroups\n{\n}\n` +
  `world\n{\n\t"id" "1"\n\t"mapversion" "1"\n\t"classname" "worldspawn"\n` +
  `\t"skyname" "sky_l4d_c1_1_hdr"\n}\n` +
  `entity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n` +
  `entity\n{\n\t"id" "3"\n\t"classname" "light"\n\t"origin" "0 0 128"\n\t"_light" "255 255 255 200"\n}\n`;

const SHELL = [
  { shape: "box" as const, mins: [-288, -288, -32] as [number, number, number], maxs: [288, 288, 0] as [number, number, number] },
  { shape: "box" as const, mins: [-288, -288, 256] as [number, number, number], maxs: [288, 288, 288] as [number, number, number] },
  { shape: "box" as const, mins: [-288, -288, 0] as [number, number, number], maxs: [-256, 288, 256] as [number, number, number] },
  { shape: "box" as const, mins: [256, -288, 0] as [number, number, number], maxs: [288, 288, 256] as [number, number, number] },
  { shape: "box" as const, mins: [-256, -288, 0] as [number, number, number], maxs: [256, -256, 256] as [number, number, number] },
  { shape: "box" as const, mins: [-256, 256, 0] as [number, number, number], maxs: [256, 288, 256] as [number, number, number] },
];

async function compiled(): Promise<{ vmf: string; bsp: string }> {
  const vmf = join(scratch, `room-${Math.round(performance.now() * 1000)}.vmf`);
  writeFileSync(vmf, insertSolids(SKELETON, SHELL, { material: "DEV/DEV_MEASUREGENERIC01" }).text);
  const out = (await runCompile.handler(
    {
      vmf,
      fast: true,
      hdr: false,
      stages: ["vbsp"],
      toolchain: "stock",
      cull: false,
      timeoutMinutes: 10,
      confirm: true,
    } as never,
    ctx,
  )) as { bspExists: boolean };
  expect(out.bspExists).toBe(true);
  return { vmf, bsp: vmf.replace(/\.vmf$/, ".bsp") };
}

describe.skipIf(!has.toolchain)("check_bsp", () => {
  it("accepts a freshly compiled map and matches its source", async () => {
    const map = await compiled();
    const r = checkBsp(map.bsp, map.vmf);
    expect(r.ok).toBe(true);
    expect(r.stale).toBe(false);
    expect(r.skyname.match).toBe(true);
    expect(r.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(r.lumps.nonEmpty).toBeGreaterThan(0);
    expect(r.entities.bsp).toBeGreaterThan(0);

    const viaTool = checkBspTool.handler({ bsp: map.bsp, vmf: map.vmf } as never, ctx) as unknown as {
      ok: boolean;
    };
    expect(viaTool.ok).toBe(true);
  }, 300_000);

  it("calls a map stale when the VMF is newer, and names the class the BSP lacks", async () => {
    const map = await compiled();
    const edited = applyVmfOps(readFileSync(map.vmf, "utf8"), [
      { op: "add", keyvalues: { classname: "env_global", globalstate: "HSMCP_TEST" } },
    ]).text;
    writeFileSync(map.vmf, edited);

    const r = checkBsp(map.bsp, map.vmf);
    expect(r.stale).toBe(true);
    expect(r.entities.classesMissing).toContain("env_global");
    expect(r.problems.some((p) => p.code === "stale")).toBe(true);
    expect(r.problems.some((p) => p.code === "entity-class-missing")).toBe(true);
  }, 300_000);

  it("finds two lumps pointing at the same bytes", async () => {
    const map = await compiled();
    const copy = join(scratch, "overlap.bsp");
    copyFileSync(map.bsp, copy);
    const header = readHeader(copy);
    const lump0 = header.lumps[0]!;
    const lump1 = header.lumps[1]!;
    expect(lump0.length).toBeGreaterThan(0);
    expect(lump1.length).toBeGreaterThan(0);

    const bytes = readFileSync(copy);
    setLumpDescriptor(bytes, 1, header.layout, lump0.offset, lump0.length);
    writeFileSync(copy, bytes);

    const r = checkBsp(copy);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.code === "lump-overlap")).toBe(true);
  }, 300_000);

  it("reports a truncated file instead of throwing", async () => {
    const map = await compiled();
    const broken = join(scratch, "truncated.bsp");
    copyFileSync(map.bsp, broken);
    truncateSync(broken, 100);
    const r = checkBsp(broken);
    expect(r.ok).toBe(false);
    expect(r.problems[0]?.code).toBe("header");
  }, 300_000);
});
