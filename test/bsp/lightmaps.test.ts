import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readBspLightmapsTool } from "../../src/maps/typescript/tools/lightmaps.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-lightmaps-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");

describe.skipIf(!has.gameContent)("read_bsp_lightmaps", () => {
  it("reads HDR luxels from a stock map and exports one face as a PNG", async () => {
    const first = (await readBspLightmapsTool.handler(
      { path: map(), limit: 2, samples: 3, confirm: true } as never,
      ctx,
    )) as {
      source: string;
      sampledFaces: number;
      totalLuxels: number;
      faces: Array<{
        index: number;
        sizeLuxels: [number, number];
        average: [number, number, number];
        samples: Array<[number, number, number]>;
      }>;
    };
    expect(first.source).toBe("hdr");
    expect(first.sampledFaces).toBeGreaterThan(0);
    expect(first.totalLuxels).toBeGreaterThan(0);
    const face = first.faces[0]!;
    expect(face.average).toHaveLength(3);
    expect(face.samples.length).toBeGreaterThan(0);
    expect(face.samples[0]!).toHaveLength(3);

    const out = join(scratch, "face.png");
    const png = (await readBspLightmapsTool.handler(
      { path: map(), face: face.index, out, samples: 0, confirm: true } as never,
      ctx,
    )) as { screenshotPath: string | null; width: number | null; height: number | null };
    expect(png.screenshotPath).toBe(out);
    expect(png.width).toBe(face.sizeLuxels[0] + 1);
    expect(png.height).toBe(face.sizeLuxels[1] + 1);
    const bytes = readFileSync(out);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
