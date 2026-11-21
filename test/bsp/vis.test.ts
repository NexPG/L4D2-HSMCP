import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readBspVisTool } from "../../src/maps/typescript/tools/vis.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");

describe.skipIf(!has.gameContent)("read_bsp_vis", () => {
  it("reads the cluster table and decodes one PVS", async () => {
    const r = (await readBspVisTool.handler(
      { path: map(), cluster: 0, maxVisible: 10 } as never,
      ctx,
    )) as {
      leafCount: number;
      clusterCount: number;
      visibilityBytes: number;
      pvs: { minBytes: number; maxBytes: number; totalBytes: number };
      visibleClusters: number[];
      visibleCount: number;
      truncated: boolean;
    };
    expect(r.leafCount).toBeGreaterThan(0);
    expect(r.clusterCount).toBeGreaterThan(0);
    expect(r.visibilityBytes).toBeGreaterThan(0);
    expect(r.pvs.minBytes).toBe(Math.ceil(r.clusterCount / 8));
    expect(r.pvs.maxBytes).toBe(r.pvs.minBytes);
    expect(r.pvs.totalBytes).toBe(r.pvs.minBytes * r.clusterCount);
    expect(r.visibleCount).toBeLessThanOrEqual(10);
    expect(r.visibleClusters.length).toBe(r.visibleCount);
    expect(r.truncated).toBe(r.visibleCount === 10);
    for (const cluster of r.visibleClusters) {
      expect(cluster).toBeGreaterThanOrEqual(0);
      expect(cluster).toBeLessThan(r.clusterCount);
    }
  });
});
