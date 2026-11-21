import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { renderBspViewTool } from "../../src/maps/typescript/tools/renderbsp.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");

describe.skipIf(!has.gameContent)("render_bsp_view", () => {
  it("renders a compiled map with baked lightmap colours", async () => {
    const r = (await renderBspViewTool.handler(
      {
        path: map(),
        origin: [2032.11, 5680.25, 2529],
        angles: [0, 0, 0],
        fov: 90,
        width: 320,
        height: 180,
        near: 8,
        lighting: "auto",
      } as never,
      ctx,
    )) as {
      lighting: string;
      faceCount: number;
      lightmapFaces: number;
      facesDrawn: number;
      pngBytes: number;
      _image: { data: string; mimeType: string };
    };
    expect(r.lighting).toBe("hdr");
    expect(r.faceCount).toBeGreaterThan(1000);
    expect(r.lightmapFaces).toBeGreaterThan(1000);
    expect(r.facesDrawn).toBeGreaterThan(0);
    expect(r.pngBytes).toBeGreaterThan(100);
    const png = Buffer.from(r._image.data, "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(r._image.mimeType).toBe("image/png");
  });
});
