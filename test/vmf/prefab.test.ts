import { describe, expect, it } from "vitest";
import { insertSolids } from "../../src/vmf/build.js";
import { insertPrefab } from "../../src/vmf/prefab.js";
import { checkVmfSolids } from "../../src/vmf/solid.js";

const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function prefab(): string {
  const box = insertSolids(EMPTY, [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }], {
    material: "BRICK/BRICKWALL001A",
  }).text;
  return `${box}entity\n{\n\t"id" "99"\n\t"classname" "info_target"\n\t"targetname" "prefab_marker"\n\t"origin" "0 0 0"\n\t"angles" "0 0 0"\n}\n`;
}

function brushEntityPrefab(): string {
  const withEntity =
    EMPTY + 'entity\n{\n\t"id" "50"\n\t"classname" "func_detail"\n}\n';
  return insertSolids(
    withEntity,
    [{ shape: "box", mins: [0, 0, 0], maxs: [32, 32, 32] }],
    { entityId: 50, material: "BRICK/BRICKWALL001A" },
  ).text;
}

describe("insertPrefab", () => {
  it("pastes solids and entities, remaps ids and moves both", () => {
    const target = insertSolids(EMPTY, [{ shape: "box", mins: [-256, -256, 0], maxs: [-192, -192, 64] }], {
      material: "BRICK/BRICKWALL001A",
    }).text;
    const before = checkVmfSolids("x", target);
    const result = insertPrefab(target, prefab(), [128, 0, 0]);
    const after = checkVmfSolids("x", result.text);

    expect(result.solids).toBe(1);
    expect(result.entities).toBe(1);
    expect(after.solidCount).toBe(before.solidCount + 1);
    const pasted = after.solids.find((s) => s.id === result.newSolidIds[0])!;
    expect(pasted.valid, pasted.findings.map((f) => f.message).join(" | ")).toBe(true);
    expect(pasted.mins[0]).toBeCloseTo(128, 3);
    expect(result.text).toContain('"targetname" "prefab_marker"');
    expect(result.text).toMatch(/"origin"\s+"128 0 0"/);
    const ids = [...result.text.matchAll(/^\s*"id" "(\d+)"/gm)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("turns the fragment and the entity around a pivot", () => {
    const target = insertSolids(EMPTY, [{ shape: "box", mins: [-256, -256, 0], maxs: [-192, -192, 64] }], {
      material: "BRICK/BRICKWALL001A",
    }).text;
    const result = insertPrefab(target, prefab(), [0, 0, 0], { rotate: 90, pivot: [10, 0, 0] });
    const after = checkVmfSolids("x", result.text);
    const pasted = after.solids.find((s) => s.id === result.newSolidIds[0])!;
    expect(pasted.valid, pasted.findings.map((f) => f.message).join(" | ")).toBe(true);
    expect(pasted.mins[0]).toBeCloseTo(-54, 3);
    expect(result.text).toMatch(/"origin"\s+"10 -10 0"/);
    expect(result.text).toMatch(/"angles"\s+"0 90 0"/);
  });

  it("moves and turns solids owned by a brush entity", () => {
    const target = insertSolids(EMPTY, [{ shape: "box", mins: [-256, -256, 0], maxs: [-192, -192, 64] }], {
      material: "BRICK/BRICKWALL001A",
    }).text;
    const result = insertPrefab(target, brushEntityPrefab(), [128, 0, 0], { rotate: 90 });
    const after = checkVmfSolids("x", result.text);
    expect(result.solids).toBe(1);
    const pasted = after.solids.find((s) => s.id === result.newSolidIds[0])!;
    expect(pasted.valid, pasted.findings.map((f) => f.message).join(" | ")).toBe(true);
    expect(pasted.owner).toBe("func_detail");
    expect(pasted.mins[0]).toBeCloseTo(96, 3);
  });

  it("separates an appended entity from a target without a trailing newline", () => {
    const target = insertSolids(EMPTY, [{ shape: "box", mins: [0, 0, 0], maxs: [16, 16, 16] }], {
      material: "BRICK/BRICKWALL001A",
    }).text.trimEnd();
    const result = insertPrefab(target, prefab());
    expect(result.text).toMatch(/\}\s*\nentity\s*\{/);
    expect(result.entities).toBe(1);
  });

  it("refuses a fragment without solids or entities", () => {
    expect(() => insertPrefab(EMPTY, 'world\n{\n\t"id" "1"\n}\n')).toThrow(/no world solids/);
  });
});
