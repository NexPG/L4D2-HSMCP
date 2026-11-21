import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readBspOverlaysTool } from "../../src/maps/typescript/tools/overlays.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");

describe.skipIf(!has.gameContent)("read_bsp_overlays", () => {
  it("decodes compiled overlay records with faces, material and UV basis", async () => {
    const r = (await readBspOverlaysTool.handler(
      { path: map(), limit: 200, faceLimit: 4 } as never,
      ctx,
    )) as {
      recordBytes: number;
      count: number;
      withFaces: number;
      returned: number;
      overlays: Array<{
        id: number;
        texinfo: number;
        texdata: number;
        material: string;
        faceCount: number;
        faces: number[];
        u: [number, number];
        v: [number, number];
        uvPoints: Array<[number, number, number]>;
        origin: [number, number, number];
        normal: [number, number, number];
      }>;
    };
    expect(r.recordBytes).toBe(352);
    expect(r.count).toBeGreaterThan(0);
    expect(r.withFaces).toBeGreaterThan(0);
    expect(r.returned).toBeGreaterThan(0);
    const overlay = r.overlays.find((entry) => entry.material !== "")!;
    expect(overlay).toBeDefined();
    expect(overlay.material).toMatch(/^decals\//i);
    expect(overlay.faceCount).toBeGreaterThan(0);
    expect(overlay.faces.length).toBeGreaterThan(0);
    expect(overlay.faces.length).toBeLessThanOrEqual(4);
    expect(overlay.uvPoints).toHaveLength(4);
    expect(overlay.u).toHaveLength(2);
    expect(overlay.v).toHaveLength(2);
    expect(overlay.origin).toHaveLength(3);
    expect(overlay.normal).toHaveLength(3);
  });
});
