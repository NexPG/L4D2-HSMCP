import { describe, expect, it } from "vitest";
import { insertSolids } from "../../src/vmf/build.js";
import { extractInstance, instanceFileKey, VmfInstanceError } from "../../src/vmf/instance.js";
import { checkVmfSolids } from "../../src/vmf/solid.js";

const EMPTY =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';
const BOX = {
  shape: "box" as const,
  mins: [0, 0, 0] as [number, number, number],
  maxs: [64, 64, 64] as [number, number, number],
};

describe("extractInstance", () => {
  it("moves a world brush into an instance and leaves func_instance behind", () => {
    const built = insertSolids(EMPTY, [BOX], { material: "BRICK/BRICKWALL001A" });
    const id = built.solidIds[0]!;
    const r = extractInstance(built.text, [id], { file: "instances/hut.vmf" });
    expect(r.instanceSolids).toBe(1);
    expect(r.removedSolids).toBe(1);
    expect(r.targetText).toContain('"classname" "func_instance"');
    expect(r.targetText).toContain('"file" "instances/hut.vmf"');
    expect(checkVmfSolids("x", r.targetText).solidCount).toBe(0);
    const instance = checkVmfSolids("x", r.instanceText);
    expect(instance.solidCount).toBe(1);
    // The instance is recentred: the 64-unit box now spans -32..32.
    expect(instance.solids[0]!.mins[0]).toBeCloseTo(-32, 3);
    expect(instance.solids[0]!.maxs[0]).toBeCloseTo(32, 3);
    expect(r.targetText).toMatch(/"origin"\s+"32 32 32"/);
  });

  it("takes a brush entity whole", () => {
    const withEntity = EMPTY + 'entity\n{\n\t"id" "100"\n\t"classname" "func_detail"\n}\n';
    const built = insertSolids(withEntity, [BOX], {
      entityId: 100,
      material: "BRICK/BRICKWALL001A",
    });
    const id = checkVmfSolids("x", built.text).solids[0]!.id!;
    const r = extractInstance(built.text, [id], { file: "instances/brush.vmf" });
    expect(r.removedEntities).toBe(1);
    expect(r.targetText).not.toContain('"classname" "func_detail"');
    expect(r.instanceText).toContain('"classname" "func_detail"');
    expect(r.instanceSolids).toBe(1);
  });

  it("refuses part of a brush entity", () => {
    const withEntity = EMPTY + 'entity\n{\n\t"id" "100"\n\t"classname" "func_detail"\n}\n';
    const first = insertSolids(withEntity, [BOX], { entityId: 100, material: "BRICK/BRICKWALL001A" });
    const both = insertSolids(
      first.text,
      [{ ...BOX, mins: [64, 0, 0], maxs: [128, 64, 64] }],
      { entityId: 100, material: "BRICK/BRICKWALL001A" },
    );
    const id = checkVmfSolids("x", both.text).solids[0]!.id!;
    expect(() => extractInstance(both.text, [id], { file: "instances/part.vmf" })).toThrow(
      VmfInstanceError,
    );
  });

  it("names the file relative to the map", () => {
    expect(instanceFileKey("D:/maps/c1.vmf", "D:/maps/instances/hut.vmf")).toBe("instances/hut.vmf");
  });
});
