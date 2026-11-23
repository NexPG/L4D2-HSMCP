import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDisplacements } from "../../src/maps/typescript/bsp/displacements.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readBspDisplacementsTool } from "../../src/maps/typescript/tools/bsp.js";
import { config, ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe("read_bsp_displacements", () => {
  it.skipIf(!has.gameContent)("finds the terrain in an official swamp chapter", async () => {
    const path = join(config.gameDir!, "maps", "c3m2_swamp.bsp");
    if (!existsSync(path)) return;
    const r = (await readBspDisplacementsTool.handler({ path, limit: 5 }, ctx)) as {
      count: number;
      powerCounts: Record<string, number>;
      dispVertRecords: number;
      bbox: { mins: number[]; maxs: number[] } | null;
      displacements: Array<{ power: number; size: number }>;
      note: string;
    };
    // DISPINFO is lump 26: 43 records on c1m1 and thousands on the swamp. The old
    // lump-22 label read PORTALS and reported zero terrain on both.
    expect(r.count).toBeGreaterThan(0);
    expect(r.dispVertRecords).toBeGreaterThan(0);
    expect(r.bbox).not.toBeNull();
    expect(r.displacements[0]!.size).toBe((1 << r.displacements[0]!.power) + 1);
    expect(r.note).toMatch(/lump 26/);
  });

  it.skipIf(!has.gameContent)("reads a hotel chapter and a flat fixture", async () => {
    const hotel = join(config.gameDir!, "maps", "c1m1_hotel.bsp");
    if (existsSync(hotel)) {
      const r = readDisplacements(hotel, 1);
      expect(r.count).toBeGreaterThan(0);
      expect(r.bbox).not.toBeNull();
    }
    const flat = join(FIXTURES, "hmcp_probe.bsp");
    const r = readDisplacements(flat, 1);
    expect(r.count).toBe(0);
    expect(r.bbox).toBeNull();
    expect(r.note).toMatch(/No DISPINFO/);
  });
});
