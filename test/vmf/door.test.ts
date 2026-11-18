import { describe, expect, it } from "vitest";
import { DoorPlacementError, placeDoor } from "../../src/vmf/door.js";

/** The hull `read_model_info` reports for checkpoint_door_02. */
const CHECKPOINT_02 = {
  mins: [-4.999, -2.608, -53.035] as [number, number, number],
  maxs: [4.293, 55.729, 52.802] as [number, number, number],
};

describe("placeDoor", () => {
  it("puts the hinge at the jamb, not in the middle of the opening", () => {
    const p = placeDoor({
      bounds: CHECKPOINT_02,
      opening: { axis: "x", min: -32, max: 32, at: 208, floorZ: -160 },
      yaw: 90,
    });
    // yaw 90 turns the leaf's local +Y toward world -X, so it hangs on the +X jamb.
    expect(p.hinge).toBe("max");
    expect(p.origin).toEqual([30, 208, -106.965]);
    expect(p.width).toBeCloseTo(58.337, 3);
    expect(p.extension[0]).toBeCloseTo(-1, 6);
  });

  it("flips to the other jamb when the leaf points the other way", () => {
    const p = placeDoor({
      bounds: CHECKPOINT_02,
      opening: { axis: "x", min: -32, max: 32, at: 816, floorZ: -128 },
      yaw: 270,
    });
    expect(p.hinge).toBe("min");
    expect(p.origin).toEqual([-30, 816, -74.965]);
    expect(p.extension[0]).toBeCloseTo(1, 6);
  });

  it("refuses a yaw that crosses the opening", () => {
    expect(() =>
      placeDoor({
        bounds: CHECKPOINT_02,
        opening: { axis: "x", min: -32, max: 32, at: 208, floorZ: -160 },
        yaw: 0,
      }),
    ).toThrow(DoorPlacementError);
  });

  it("refuses an opening narrower than the door", () => {
    expect(() =>
      placeDoor({
        bounds: CHECKPOINT_02,
        opening: { axis: "x", min: -32, max: 32, at: 208, floorZ: -160 },
        yaw: 90,
      }),
    ).not.toThrow();
    expect(() =>
      placeDoor({
        bounds: CHECKPOINT_02,
        opening: { axis: "x", min: -20, max: 20, at: 208, floorZ: -160 },
        yaw: 90,
      }),
    ).toThrow(/narrower than/);
  });
});
