/**
 * The ambient lightgrid.
 *
 * `c1m1_hotel` has an HDR grid: 7,053 leaves and 24,541 samples in 28-byte records. The LDR
 * `LEAF_AMBIENT_LIGHTING` lump on the same map is all zero, which is why the reader prefers
 * HDR; a reader that took LDR would light every prop black and look plausible.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAmbientLighting } from "../../src/maps/typescript/bsp/ambient.js";
import { ctx, has } from "../support/env.js";

describe.skipIf(!has.gameContent)("readAmbientLighting", () => {
  const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");

  it("reads the HDR ambient grid and its 28-byte cube records", () => {
    const ambient = readAmbientLighting(map());
    expect(ambient).not.toBeNull();
    expect(ambient!.leafCount).toBe(7053);
    expect(ambient!.sampleCount).toBe(24541);
    expect(ambient!.stride).toBe(28);
  });

  it("finds the lobby leaf and returns a usable colour", () => {
    const ambient = readAmbientLighting(map())!;
    const point: [number, number, number] = [780, 5450, 2700];
    const leaf = ambient.leafAt(point);
    expect(leaf).toBeGreaterThanOrEqual(0);
    expect(leaf).toBeLessThan(ambient.leafCount);
    const colour = ambient.sample(point, [0, 0, 1]);
    expect(colour).not.toBeNull();
    for (const channel of colour!) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
    // The lobby is lit; an all-zero cube is the failure this test is here to catch.
    expect(Math.max(...colour!)).toBeGreaterThan(0.05);
    expect(ambient.sampleLeaf(leaf, [0, 0, 1])).not.toBeNull();
  });
});
