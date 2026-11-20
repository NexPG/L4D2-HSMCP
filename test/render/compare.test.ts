import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { compareRendersTool } from "../../src/maps/typescript/tools/render.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-compare-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

/** A room with one box in front of the camera. */
function room(boxZ: number): string {
  const shell = insertSolids(SEED, [
    { shape: "box", mins: [-256, -256, -32], maxs: [256, 256, 0] },
    { shape: "box", mins: [-256, -256, 256], maxs: [256, 256, 288] },
    { shape: "box", mins: [-256, -256, 0], maxs: [-224, 256, 256] },
    { shape: "box", mins: [224, -256, 0], maxs: [256, 256, 256] },
    { shape: "box", mins: [-224, -256, 0], maxs: [224, -224, 256] },
    { shape: "box", mins: [-224, 224, 0], maxs: [224, 256, 256] },
  ], { material: "DEV/DEV_MEASUREGENERIC01" });
  return insertSolids(shell.text, [
    { shape: "box", mins: [64, -32, boxZ], maxs: [160, 32, boxZ + 64] },
  ], { material: "BRICK/BRICKWALL001A" }).text;
}

const CAMERA = { origin: [0, 0, 96], angles: [0, 0, 0] } as const;

type Compare = {
  changedPixels: number;
  changedFraction: number;
  meanDelta: number;
  maxDelta: number;
  identical: boolean;
  facesDrawnBefore: number;
  facesDrawnAfter: number;
  pngBytes: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
};

describe("compare_renders", () => {
  it("reports no change for the same file", () => {
    const path = join(scratch, "same.vmf");
    writeFileSync(path, room(0));
    const r = compareRendersTool.handler(
      { before: path, after: path, ...CAMERA, width: 160, height: 120, image: false } as never,
      ctx,
    ) as unknown as Compare;
    expect(r.identical).toBe(true);
    expect(r.changedPixels).toBe(0);
    expect(r.bbox).toBeNull();
    expect(r.facesDrawnBefore).toBeGreaterThan(0);
    expect(r.pngBytes).toBeGreaterThan(0);
  });

  it("finds the box after it moved, and reports where", () => {
    const before = join(scratch, "before.vmf");
    const after = join(scratch, "after.vmf");
    writeFileSync(before, room(0));
    writeFileSync(after, room(96));
    const r = compareRendersTool.handler(
      { before, after, ...CAMERA, width: 160, height: 120, threshold: 4, image: false } as never,
      ctx,
    ) as unknown as Compare;
    expect(r.identical).toBe(false);
    expect(r.changedPixels).toBeGreaterThan(0);
    expect(r.changedFraction).toBeGreaterThan(0);
    expect(r.maxDelta).toBeGreaterThan(4);
    expect(r.bbox).not.toBeNull();
    expect(r.bbox!.minX).toBeLessThanOrEqual(r.bbox!.maxX);
    expect(r.bbox!.minY).toBeLessThanOrEqual(r.bbox!.maxY);
  });

  it("a threshold of 255 ignores every difference", () => {
    const before = join(scratch, "th-before.vmf");
    const after = join(scratch, "th-after.vmf");
    writeFileSync(before, room(0));
    writeFileSync(after, room(96));
    const r = compareRendersTool.handler(
      { before, after, ...CAMERA, width: 160, height: 120, threshold: 255, image: false } as never,
      ctx,
    ) as unknown as Compare;
    expect(r.identical).toBe(true);
    expect(r.changedPixels).toBe(0);
  });
});
