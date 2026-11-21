/**
 * Water surfaces and fog in a real outdoor map.
 *
 * `c2m1_highway` has 70 water faces at z = -1792 and its first player start stands at the
 * river bank. A camera there must report water faces, draw at least one blended surface and
 * carry a fog controller; a renderer that ignores both returns a dry, unfogged picture that
 * still looks plausible.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { renderBspViewTool } from "../../src/maps/typescript/tools/renderbsp.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe.skipIf(!has.gameContent)("water and fog", () => {
  it("draws water and applies the river's fog", async () => {
    const r = (await renderBspViewTool.handler(
      {
        path: join(ctx.config.gameDir!, "maps", "c2m1_highway.bsp"),
        origin: [1845, 1613, -1720],
        angles: [5, 180, 0],
        fov: 90,
        width: 320,
        height: 180,
        near: 8,
        lighting: "auto",
        props: true,
        propDistance: 1200,
        propTriangles: 40_000,
        fog: true,
      } as never,
      ctx,
    )) as {
      waterFaces: number;
      waterFacesTotal: number;
      fogName: string | null;
      fogStart: number;
      fogEnd: number;
      pngBytes: number;
      _image: { data: string };
    };
    expect(r.waterFacesTotal).toBeGreaterThan(0);
    expect(r.waterFaces).toBeGreaterThan(0);
    expect(r.fogName).not.toBeNull();
    expect(r.fogEnd).toBeGreaterThan(r.fogStart);
    expect(r.pngBytes).toBeGreaterThan(100);
  });
});
