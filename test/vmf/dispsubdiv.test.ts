import { describe, expect, it } from "vitest";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { readDisplacements } from "../../src/maps/typescript/vmf/displacement.js";
import {
  subdivideDisplacements,
  VmfDispWriteError,
  writeDisplacements,
} from "../../src/maps/typescript/vmf/dispwrite.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";

const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function terrain(power: number): { text: string; id: number } {
  const built = insertSolids(
    EMPTY,
    [{ shape: "box", mins: [0, 0, 0], maxs: [256, 256, 64] }],
    { material: "NATURE/BLENDROCKGRASS001A" },
  );
  const id = checkVmfSolids("x", built.text).solids[0]!.id!;
  const written = writeDisplacements(
    built.text,
    { solidIds: [id], facing: "up" },
    {
      power,
      height: (x) => x * 4,
      alpha: (x) => x * 10,
    },
  );
  return { text: written.text, id };
}

describe("subdivideDisplacements", () => {
  it("raises power and samples the old shape into the new grid", () => {
    const { text, id } = terrain(2);
    const before = readDisplacements(text).displacements[0]!;
    const result = subdivideDisplacements(text, { solidIds: [id] }, 3);

    expect(result.matched).toBe(1);
    expect(result.subdivided[0]).toMatchObject({
      solidId: id,
      fromPower: 2,
      toPower: 3,
      vertices: 81,
    });
    const after = readDisplacements(result.text).displacements[0]!;
    expect(after.power).toBe(3);
    expect(after.size).toBe(9);
    expect(after.vertices).toHaveLength(81);

    // A linear ramp survives interpolation exactly: old x*4 becomes 4*gx.
    for (const v of after.vertices) {
      const gx = (v.x / (after.size - 1)) * (before.size - 1);
      expect(v.distance).toBeCloseTo(gx * 4, 4);
      expect(v.alpha).toBe(Math.round(gx * 10));
    }
  });

  it("keeps the brush itself unchanged", () => {
    const { text, id } = terrain(2);
    const before = checkVmfSolids("x", text);
    const result = subdivideDisplacements(text, { solidIds: [id] }, 4);
    const after = checkVmfSolids("x", result.text);
    expect(after.solidCount).toBe(before.solidCount);
    expect(after.solids[0]!.volume).toBe(before.solids[0]!.volume);
  });

  it("refuses a lower or equal power, an empty selector, and a miss", () => {
    const { text, id } = terrain(3);
    expect(() => subdivideDisplacements(text, { solidIds: [id] }, 3)).toThrow(
      VmfDispWriteError,
    );
    expect(() => subdivideDisplacements(text, {}, 4)).toThrow(/empty selector/);
    const miss = subdivideDisplacements(text, { solidIds: [999999] }, 4);
    expect(miss.matched).toBe(0);
    expect(miss.unchanged).toBe(true);
  });
});
