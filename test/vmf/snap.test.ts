import { describe, expect, it } from "vitest";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { transformSolids } from "../../src/maps/typescript/vmf/modify.js";
import { rotation } from "../../src/maps/typescript/vmf/transform.js";
import { moveToSurface, VmfSnapError } from "../../src/maps/typescript/vmf/snap.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";

const EMPTY =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function room(): { text: string; id: number } {
  const out = insertSolids(
    EMPTY,
    [
      { shape: "box", mins: [-256, -256, -32], maxs: [256, 256, 0] },
      { shape: "box", mins: [-256, -256, 192], maxs: [256, 256, 224] },
      { shape: "box", mins: [0, 0, 64], maxs: [64, 64, 128] },
    ],
    { material: "BRICK/BRICKWALL001A" },
  );
  // The floating box is the one whose bottom is above the floor.
  const solids = checkVmfSolids("x", out.text).solids;
  const id = solids.find((s) => Math.abs(s.mins[2] - 64) < 0.01)!.id!;
  return { text: out.text, id };
}

describe("moveToSurface", () => {
  it("drops a floating brush onto the floor", () => {
    const { text, id } = room();
    const r = moveToSurface(text, [id], { direction: "down" });
    const after = checkVmfSolids("x", r.text).solids.find((s) => s.id === id)!;
    expect(r.moved).toHaveLength(1);
    expect(r.moved[0]!.delta[2]).toBeCloseTo(-64, 2);
    expect(after.mins[2]).toBeCloseTo(0, 2);
    expect(after.valid, after.findings.map((f) => f.message).join(" | ")).toBe(true);
  });

  it("raises a floating brush to the ceiling", () => {
    const { text, id } = room();
    const r = moveToSurface(text, [id], { direction: "up" });
    const after = checkVmfSolids("x", r.text).solids.find((s) => s.id === id)!;
    expect(r.moved[0]!.delta[2]).toBeCloseTo(64, 2);
    expect(after.maxs[2]).toBeCloseTo(192, 2);
  });

  it("says when there is no surface in reach instead of moving blindly", () => {
    const only = insertSolids(EMPTY, [{ shape: "box", mins: [0, 0, 64], maxs: [32, 32, 96] }], {
      material: "BRICK/BRICKWALL001A",
    });
    const id = checkVmfSolids("x", only.text).solids[0]!.id!;
    const r = moveToSurface(only.text, [id], { direction: "down" });
    expect(r.unchanged).toBe(true);
    expect(r.moved).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/no floor/);
  });

  it("turns the brush to follow a sloped floor", () => {
    const { text, id } = room();
    const floor = checkVmfSolids("x", text).solids.find((s) => Math.abs(s.mins[2] + 32) < 0.01)!.id!;
    const tilted = transformSolids(text, { ids: [floor] }, rotation([0, 1, 0], 15, [0, 0, 0])).text;
    const r = moveToSurface(tilted, [id], { direction: "down", alignToNormal: true });
    const after = checkVmfSolids("x", r.text).solids.find((s) => s.id === id)!;
    expect(r.moved[0]!.rotated).toBe(true);
    expect(after.valid, after.findings.map((f) => f.message).join(" | ")).toBe(true);
  });

  it("refuses an id that is not in the map", () => {
    const { text } = room();
    expect(() => moveToSurface(text, [9999], { direction: "down" })).toThrow(VmfSnapError);
  });
});
