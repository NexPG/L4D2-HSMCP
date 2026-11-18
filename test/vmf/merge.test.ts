import { describe, expect, it } from "vitest";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { mergeSolids, VmfMergeError } from "../../src/maps/typescript/vmf/merge.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";

const EMPTY =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';
const BOX = { shape: "box" as const, mins: [0, 0, 0] as [number, number, number], maxs: [64, 64, 64] as [number, number, number] };

function two(): { text: string; ids: number[] } {
  const out = insertSolids(
    EMPTY,
    [BOX, { ...BOX, mins: [64, 0, 0], maxs: [128, 64, 64] }],
    { material: "BRICK/BRICKWALL001A" },
  );
  return { text: out.text, ids: out.solidIds };
}

describe("mergeSolids", () => {
  it("replaces two adjacent boxes with the one box around them", () => {
    const { text, ids } = two();
    const before = checkVmfSolids("x", text).solidCount;
    const r = mergeSolids(text, ids);
    const after = checkVmfSolids("x", r.text);
    expect(after.solidCount).toBe(before - 1);
    const merged = after.solids.find((s) => s.id === r.mergedId)!;
    expect(merged.valid, merged.findings.map((f) => f.message).join(" | ")).toBe(true);
    expect(merged.volume).toBeCloseTo(128 * 64 * 64, 3);
    expect(r.facesCopied).toBeGreaterThan(0);
    expect(r.text).toContain("BRICK/BRICKWALL001A");
  });

  it("refuses a non-convex pair instead of filling the hollow", () => {
    const out = insertSolids(
      EMPTY,
      [BOX, { ...BOX, mins: [64, 64, 0], maxs: [128, 128, 64] }],
      { material: "BRICK/BRICKWALL001A" },
    );
    expect(() => mergeSolids(out.text, out.solidIds)).toThrow(VmfMergeError);
    expect(() => mergeSolids(out.text, out.solidIds)).toThrow(/do not form one convex volume/);
  });

  it("refuses brushes that belong to different owners", () => {
    const withEntity =
      EMPTY + 'entity\n{\n\t"id" "100"\n\t"classname" "func_detail"\n}\n';
    const world = insertSolids(withEntity, [BOX], { material: "BRICK/BRICKWALL001A" });
    const body = insertSolids(world.text, [{ ...BOX, mins: [64, 0, 0], maxs: [128, 64, 64] }], {
      entityId: 100,
      material: "BRICK/BRICKWALL001A",
    });
    const ids = checkVmfSolids("x", body.text).solids.map((s) => s.id!);
    expect(() => mergeSolids(body.text, ids)).toThrow(/different entities/);
  });
});
