import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runVpkPackTool } from "../../src/tools/addon.js";
import { ctx as sharedCtx, has } from "../support/env.js";
import type { ToolContext } from "../../src/mcp/registry.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "l4d2-addon-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function staging(name: string): string {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "missions"), { recursive: true });
  mkdirSync(join(dir, "maps"), { recursive: true });
  mkdirSync(join(dir, "materials", "vgui", "maps"), { recursive: true });
  writeFileSync(join(dir, "missions", "testcamp.txt"), '"mission"\n{\n}\n');
  writeFileSync(join(dir, "maps", "testm1.bsp"), "stub");
  writeFileSync(join(dir, "materials", "vgui", "maps", "testm1.vmt"), "stub");
  return dir;
}

const pack = (args: Record<string, unknown>) =>
  runVpkPackTool.handler(
    { overwrite: false, confirm: true, ...args } as never,
    ctx,
  ) as unknown as Promise<{
    vpk: string;
    entries: string[];
    entryCount: number;
    addoninfoWritten: boolean;
    verified: { compared: number; missingFromVpk: string[]; extraInVpk: string[] };
  }>;

describe.skipIf(!has.sidecar || !has.vpk)("run_vpk_pack", () => {
  it("packs the staging tree root-relative and verifies every file came through", async () => {
    const dir = staging("PackOne");
    const out = join(scratch, "packone.vpk");
    const r = await pack({
      dir,
      out,
      addoninfo: { title: "Pack One", author: "Tester", version: "1" },
    });

    expect(r.addoninfoWritten).toBe(true);
    expect(r.entries).toEqual(
      expect.arrayContaining([
        "addoninfo.txt",
        "missions/testcamp.txt",
        "maps/testm1.bsp",
        "materials/vgui/maps/testm1.vmt",
      ]),
    );
    expect(r.verified.missingFromVpk).toEqual([]);
    expect(r.verified.extraInVpk).toEqual([]);
    expect(r.verified.compared).toBe(4);
    expect(readFileSync(out).length).toBeGreaterThan(0);
    // The manifest really is the conventional one, not a placeholder.
    expect(readFileSync(join(dir, "addoninfo.txt"), "utf8")).toContain('"addontitle"');
  }, 120_000);

  it("refuses to replace an archive unasked, and replaces it when told", async () => {
    const dir = staging("PackTwo");
    const out = join(scratch, "packtwo.vpk");
    await pack({ dir, out, addoninfo: { title: "Pack Two" } });
    await expect(pack({ dir, out, addoninfo: { title: "Pack Two" } })).rejects.toThrow(
      /already exists/,
    );
    const again = await pack({
      dir,
      out,
      overwrite: true,
      addoninfo: { title: "Pack Two, rebuilt" },
    });
    expect(again.entries).toContain("addoninfo.txt");
  }, 120_000);

  it("names a staging directory with no manifest rather than packing it", async () => {
    const dir = staging("PackThree");
    await expect(pack({ dir })).rejects.toThrow(/no addoninfo\.txt/);
  }, 120_000);
});
