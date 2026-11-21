/**
 * Fog choice and the pixel blend.
 *
 * `c1m1_hotel` keeps its indoor fog in named `env_fog_controller`s and selects one with a
 * `fog_volume` brush. The lobby camera is inside the `fog_topfloors` volume, so the reader
 * must report that controller rather than the nearest one by origin.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFog, readFogFor } from "../../src/maps/typescript/render/fog.js";
import { ctx, has } from "../support/env.js";

describe.skipIf(!has.gameContent)("fog", () => {
  const map = (): string => join(ctx.config.gameDir!, "maps", "c1m1_hotel.bsp");

  it("chooses the controller named by the camera's fog_volume", () => {
    const choice = readFogFor(map(), [780, 5450, 2700]);
    expect(choice.volumes).toBeGreaterThan(0);
    expect(choice.fog).not.toBeNull();
    expect(choice.fog!.name).toBe("fog_topfloors");
    expect(choice.fog!.start).toBe(1);
    expect(choice.fog!.end).toBe(2500);
    expect(choice.fog!.color).toEqual([188, 174, 150]);
  });

  it("blends only pixels beyond the fog start", () => {
    const width = 2;
    const height = 1;
    const rgb = new Uint8Array([10, 20, 30, 200, 200, 200]);
    const invDepth = new Float32Array([1 / 100, 1 / 2000]);
    const touched = applyFog(
      { width, height, rgb, invDepth, ids: new Int32Array(2), sky: new Uint8Array(2) },
      { start: 0, end: 1000, color: [100, 100, 100], maxDensity: 1, name: "test" },
    );
    expect(touched).toBe(2);
    // 100 units is 10% fog, 2000 is clamped to 100%.
    expect(rgb[0]).toBe(19);
    expect(rgb[1]).toBe(28);
    expect(rgb[2]).toBe(37);
    expect([rgb[3], rgb[4], rgb[5]]).toEqual([100, 100, 100]);
  });
});
