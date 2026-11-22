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
import { copyFileSync, readdirSync, statSync } from "node:fs";
import { readHeader } from "../../src/maps/typescript/bsp/header.js";
import { readLightmapBudget } from "../../src/maps/typescript/bsp/lightmap.js";
import { writeBspLightmapTool } from "../../src/maps/typescript/tools/lightmaps.js";

function ldrMap(): string | null {
  const dir = ctx.config.gameDir;
  if (!dir) return null;
  for (const name of readdirSync(join(dir, "maps"))) {
    if (!name.toLowerCase().endsWith(".bsp")) continue;
    const path = join(dir, "maps", name);
    try {
      if ((readHeader(path).lumps[8]?.length ?? 0) > 0) return path;
    } catch {
      // A map this reader cannot open is not a candidate.
    }
  }
  return null;
}

describe.skipIf(!has.gameContent)("write_bsp_lightmap", () => {
  it("scales one face's LDR luxels in place and reads the average back", async () => {
    const source = ldrMap();
    if (source === null) return; // no stock map with an LDR lump on this install
    const path = join(scratch, "lightmap-edit.bsp");
    copyFileSync(source, path);
    const budget = readLightmapBudget(path, 7);
    const face = budget.faces.find((candidate) => candidate.hasLightmap)!;
    const beforeBytes = statSync(path).size;

    const r = writeBspLightmapTool.handler(
      { path, face: face.index, scale: 0.5, confirm: true, backup: true } as never,
      ctx,
    ) as {
      written: boolean;
      verified: boolean;
      backupPath: string | null;
      beforeAverage: number[];
      afterAverage: number[];
      luxels: number;
      bytes: number;
    };
    expect(r.written).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.backupPath).not.toBeNull();
    expect(r.luxels).toBe(face.luxels);
    expect(r.bytes).toBe(beforeBytes);
    for (let c = 0; c < 3; c += 1) {
      expect(Math.abs(r.afterAverage[c]! - r.beforeAverage[c]! * 0.5)).toBeLessThanOrEqual(1);
    }

    const read = (await readBspLightmapsTool.handler(
      { path, face: face.index, samples: 0, hdr: "ldr", confirm: true } as never,
      ctx,
    )) as { source: string; faces: Array<{ average: [number, number, number] }> };
    expect(read.source).toBe("ldr");
    expect(read.faces[0]!.average).toEqual(r.afterAverage);
  });

  it("does not write a dry run and writes an out copy", () => {
    const source = ldrMap();
    if (source === null) return;
    const base = join(scratch, "lightmap-dry.bsp");
    copyFileSync(source, base);
    const budget = readLightmapBudget(base, 7);
    const face = budget.faces.find((candidate) => candidate.hasLightmap)!;
    const before = readFileSync(base);

    const dry = writeBspLightmapTool.handler(
      { path: base, face: face.index, offset: [10, 0, 0], dryRun: true } as never,
      ctx,
    ) as { written: boolean; verified: boolean; afterAverage: number[] };
    expect(dry.written).toBe(false);
    expect(dry.verified).toBe(false);
    expect(readFileSync(base).equals(before)).toBe(true);

    const out = join(scratch, "lightmap-copy.bsp");
    const copied = writeBspLightmapTool.handler(
      { path: base, out, face: face.index, offset: [10, 0, 0], confirm: true } as never,
      ctx,
    ) as { written: boolean; verified: boolean; out: string };
    expect(copied.written).toBe(true);
    expect(copied.verified).toBe(true);
    expect(readFileSync(base).equals(before)).toBe(true);
    expect(readFileSync(copied.out).equals(before)).toBe(false);
  });
});
