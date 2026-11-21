import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBspFaces } from "../../src/maps/typescript/bsp/faces.js";
import { readBspPolygons } from "../../src/maps/typescript/bsp/polygons.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");

function polygonArea(points: ReadonlyArray<readonly [number, number, number]>): number {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    x += a[1] * b[2] - b[1] * a[2];
    y += a[2] * b[0] - b[2] * a[0];
    z += a[0] * b[1] - b[0] * a[1];
  }
  return Math.hypot(x, y, z) / 2;
}

describe.skipIf(!has.gameContent)("readBspPolygons", () => {
  it("reconstructs loops whose area matches the BSP face area", () => {
    const polygons = readBspPolygons(map(), true);
    const faces = readBspFaces(map(), { limit: 1_000_000 });
    expect(polygons.faces.length).toBeGreaterThan(1000);
    expect(polygons.mins[0]).toBeLessThan(polygons.maxs[0]);
    let checked = 0;
    for (const polygon of polygons.faces.slice(0, 100)) {
      const surface = faces.faces[polygon.index];
      if (!surface || surface.area <= 0) continue;
      const area = polygonArea(polygon.points);
      expect(Math.abs(area - surface.area)).toBeLessThan(Math.max(1, surface.area * 0.01));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
  });
});
