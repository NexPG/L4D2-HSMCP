import { describe, expect, it } from "vitest";
import { insertSolids } from "../../src/vmf/build.js";
import { cloneSolids, VmfCloneError } from "../../src/vmf/clone.js";
import { checkVmfSolids } from "../../src/vmf/solid.js";
import { scaling, translation } from "../../src/vmf/transform.js";

const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function box(): string {
  return insertSolids(EMPTY, [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }], {
    material: "BRICK/BRICKWALL001A",
  }).text;
}

function ids(text: string): number[] {
  return [...text.matchAll(/^\s*"id" "(\d+)"/gm)].map((m) => Number(m[1]));
}

describe("cloneSolids", () => {
  it("adds a byte-for-byte copy with fresh ids", () => {
    const source = box();
    const before = checkVmfSolids("x", source);
    const original = before.solids[0]!;
    const result = cloneSolids(source, { ids: [original.id!] });

    expect(result.clones).toHaveLength(1);
    expect(result.clones[0]!.sourceId).toBe(original.id);
    expect(result.clones[0]!.newId).not.toBe(original.id);

    const after = checkVmfSolids("x", result.text);
    expect(after.solidCount).toBe(2);
    for (const solid of after.solids) {
      expect(solid.valid, solid.findings.map((f) => f.message).join(" | ")).toBe(true);
      expect(solid.volume).toBeCloseTo(original.volume, 6);
    }
    expect(result.text.match(/BRICK\/BRICKWALL001A/g)).toHaveLength(
      (source.match(/BRICK\/BRICKWALL001A/g) ?? []).length * 2,
    );

    const all = ids(result.text);
    expect(new Set(all).size, `duplicate id in ${all.join(", ")}`).toBe(all.length);
  });

  it("copies multiple times", () => {
    const source = box();
    const id = checkVmfSolids("x", source).solids[0]!.id!;
    const result = cloneSolids(source, { ids: [id] }, 2);
    expect(result.clones).toHaveLength(2);
    expect(checkVmfSolids("x", result.text).solidCount).toBe(3);
    const all = ids(result.text);
    expect(new Set(all).size).toBe(all.length);
  });

  it("scales the copy around a pivot", () => {
    const source = box();
    const original = checkVmfSolids("x", source).solids[0]!;
    const result = cloneSolids(
      source,
      { ids: [original.id!] },
      1,
      scaling([0.5, 0.5, 0.5], [32, 32, 32]),
    );

    const after = checkVmfSolids("x", result.text);
    const clone = after.solids.find((s) => s.id === result.clones[0]!.newId)!;
    expect(clone.valid).toBe(true);
    expect(clone.volume).toBeCloseTo(original.volume / 8, 3);
    // Pivot at the centre: the copy shrinks towards it rather than drifting.
    expect(clone.mins[0]).toBeCloseTo(16, 3);
    expect(clone.maxs[0]).toBeCloseTo(48, 3);
  });

  it("refuses a transform on more than one copy", () => {
    const source = box();
    const id = checkVmfSolids("x", source).solids[0]!.id!;
    expect(() => cloneSolids(source, { ids: [id] }, 2, translation([64, 0, 0]))).toThrow(
      VmfCloneError,
    );
  });

  it("refuses an empty selector and reports a miss", () => {
    const source = box();
    expect(() => cloneSolids(source, {})).toThrow(/empty selector/);
    const miss = cloneSolids(source, { ids: [999] });
    expect(miss.clones).toEqual([]);
    expect(miss.unchanged).toBe(true);
    expect(miss.warnings.join(" ")).toMatch(/nothing matched/);
  });
});
