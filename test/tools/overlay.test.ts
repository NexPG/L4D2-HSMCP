import { describe, expect, it } from "vitest";
import { buildOverlay } from "../../src/vmf/overlay.js";

const FLOOR = `versioninfo
{
	"editorversion" "400"
}
world
{
	"id" "1"
	"classname" "worldspawn"
	solid
	{
		"id" "2"
		side
		{
			"id" "3"
			"plane" "(-64 64 0) (64 64 0) (64 -64 0)"
			"material" "BRICK/BRICK_EXT_01"
			"uaxis" "[1 0 0 0] 0.25"
			"vaxis" "[0 -1 0 0] 0.25"
			"rotation" "0"
			"lightmapscale" "16"
			"smoothing_groups" "0"
		}
	}
}
`;

describe("buildOverlay", () => {
  it("computes the outward basis and the four corners", () => {
    const overlay = buildOverlay(FLOOR, {
      sideId: 3,
      material: "decals/blood1",
      origin: [0, 0, 0],
      width: 64,
      height: 32,
    });
    expect(overlay.normal).toEqual([0, 0, 1]);
    expect(overlay.sideClass).toBe("worldspawn");
    expect(overlay.keyvalues["sides"]).toBe("3");
    expect(overlay.keyvalues["BasisNormal"]).toBe("0 0 1");
    expect(overlay.keyvalues["uv0"]).toBe("-32 -16 0");
    expect(overlay.keyvalues["uv2"]).toBe("32 16 0");
  });

  it("refuses an origin that is not on the face", () => {
    expect(() =>
      buildOverlay(FLOOR, {
        sideId: 3,
        material: "decals/blood1",
        origin: [0, 0, 10],
        width: 64,
        height: 64,
      }),
    ).toThrow(/off the plane/);
  });

  it("refuses an unknown side", () => {
    expect(() =>
      buildOverlay(FLOOR, {
        sideId: 99,
        material: "decals/blood1",
        origin: [0, 0, 0],
        width: 64,
        height: 64,
      }),
    ).toThrow(/no side with id 99/);
  });
});
