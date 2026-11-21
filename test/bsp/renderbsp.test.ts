import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { renderBspViewTool } from "../../src/maps/typescript/tools/renderbsp.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");

describe.skipIf(!has.gameContent)("render_bsp_view", () => {
  it("renders a compiled map with baked lightmaps, textures and static props", async () => {
    const r = (await renderBspViewTool.handler(
      {
        path: map(),
        origin: [780, 5450, 2700],
        angles: [0, 270, 0],
        fov: 90,
        width: 320,
        height: 180,
        near: 8,
        lighting: "auto",
        props: true,
        propDistance: 1200,
      } as never,
      ctx,
    )) as {
      lighting: string;
      faceCount: number;
      lightmapFaces: number;
      gradientFaces: number;
      textureFaces: number;
      propsTotal: number;
      propsDrawn: number;
      propTriangles: number;
      propLodCounts: number[];
      ambientSamples: number;
      facesDrawn: number;
      pngBytes: number;
      _image: { data: string; mimeType: string };
    };
    expect(r.lighting).toBe("hdr");
    expect(r.faceCount).toBeGreaterThan(1000);
    expect(r.lightmapFaces).toBeGreaterThan(1000);
    expect(r.gradientFaces).toBeGreaterThan(1000);
    expect(r.textureFaces).toBeGreaterThan(1000);
    // The lobby camera sees chairs, tables, curtain cards and door frames.
    expect(r.propsTotal).toBeGreaterThan(1000);
    expect(r.propsDrawn).toBeGreaterThan(0);
    expect(r.propTriangles).toBeGreaterThan(1000);
    // At `propDistance: 1200` the lobby contains props at several switch distances.
    expect(r.propLodCounts.reduce((sum, count) => sum + count, 0)).toBe(r.propsDrawn);
    expect(r.propLodCounts.some((count, index) => index > 0 && count > 0)).toBe(true);
    expect(r.ambientSamples).toBeGreaterThan(1000);
    expect(r.facesDrawn).toBeGreaterThan(0);
    expect(r.pngBytes).toBeGreaterThan(100);
    const png = Buffer.from(r._image.data, "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(r._image.mimeType).toBe("image/png");
  });
});
