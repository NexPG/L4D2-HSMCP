import { describe, expect, it } from "vitest";
import { insertSolids } from "../../src/vmf/build.js";
import { alignFaces, copyFaceAlignment, VmfFaceError } from "../../src/vmf/face.js";
import { setLightmapScale } from "../../src/vmf/lightmap.js";
import { checkVmfSolids } from "../../src/vmf/solid.js";
import type { SolidCheck, SolidSide } from "../../src/vmf/solid.js";

const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function twoBoxes(): string {
  const first = insertSolids(EMPTY, [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }], {
    material: "BRICK/BRICKWALL001A",
  }).text;
  return insertSolids(first, [{ shape: "box", mins: [128, 0, 0], maxs: [192, 64, 64] }], {
    material: "WOOD/WOODWALL001A",
  }).text;
}

function face(solid: SolidCheck, axis: "x" | "y" | "z", sign: 1 | -1): SolidSide {
  const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const side = solid.sides.find(
    (s) => s.plane && Math.abs(s.plane.normal[index]! - sign) < 0.01 && s.id !== null,
  );
  if (!side) throw new Error(`no ${sign > 0 ? "+" : "-"}${axis} face`);
  return side;
}

function solids(text: string): SolidCheck[] {
  return checkVmfSolids("x", text).solids;
}

describe("copyFaceAlignment", () => {
  it("copies the exact axes and offsets onto another face", () => {
    const text = twoBoxes();
    const before = solids(text);
    const sourceSolid = before[0]!;
    const targetSolid = before[1]!;
    const sourceSide = face(sourceSolid, "x", 1);
    const targetSide = face(targetSolid, "x", 1);

    const aligned = alignFaces(
      text,
      { solidIds: [sourceSolid.id!] },
      { mode: "face", shift: [32, 48] },
    ).text;
    const sourceAfter = face(
      solids(aligned).find((s) => s.id === sourceSolid.id)!,
      "x",
      1,
    );

    const result = copyFaceAlignment(aligned, sourceSolid.id!, sourceSide.id!, {
      solidIds: [targetSolid.id!],
      sideIds: [targetSide.id!],
    });
    const targetAfter = face(
      solids(result.text).find((s) => s.id === targetSolid.id)!,
      "x",
      1,
    );

    expect(targetAfter.id).toBe(targetSide.id);
    expect(targetAfter.uaxis).toEqual(sourceAfter.uaxis);
    expect(targetAfter.vaxis).toEqual(sourceAfter.vaxis);
    expect(result.changed.some((c) => c.field === "uaxis")).toBe(true);
  });

  it("can copy the material and an explicit lightmap scale", () => {
    const text = twoBoxes();
    const before = solids(text);
    const sourceSolid = before[0]!;
    const targetSolid = before[1]!;
    const sourceSide = face(sourceSolid, "x", 1);
    const targetSide = face(targetSolid, "x", 1);

    const withLightmap = setLightmapScale(text, 8, { solidIds: [sourceSolid.id!] }).text;
    const result = copyFaceAlignment(
      withLightmap,
      sourceSolid.id!,
      sourceSide.id!,
      { solidIds: [targetSolid.id!], sideIds: [targetSide.id!] },
      { copyMaterial: true, copyLightmapScale: true },
    );
    const targetAfter = face(
      solids(result.text).find((s) => s.id === targetSolid.id)!,
      "x",
      1,
    );

    expect(targetAfter.material).toBe("BRICK/BRICKWALL001A");
    expect(targetAfter.lightmapScale).toBe(8);
  });

  it("refuses a face that is not on the named solid, and an empty selector", () => {
    const text = twoBoxes();
    const before = solids(text);
    const sourceSolid = before[0]!;
    const sourceSide = face(sourceSolid, "x", 1);

    expect(() => copyFaceAlignment(text, sourceSolid.id!, 999999, { solidIds: [before[1]!.id!] })).toThrow(
      VmfFaceError,
    );
    expect(() => copyFaceAlignment(text, sourceSolid.id!, sourceSide.id!, {})).toThrow(
      /empty target selector/,
    );
  });

  it("warns when the target faces another way but still copies exactly", () => {
    const text = twoBoxes();
    const before = solids(text);
    const sourceSolid = before[0]!;
    const targetSolid = before[1]!;
    const sourceSide = face(sourceSolid, "z", 1);
    const targetSide = face(targetSolid, "x", 1);

    const result = copyFaceAlignment(text, sourceSolid.id!, sourceSide.id!, {
      solidIds: [targetSolid.id!],
      sideIds: [targetSide.id!],
    });
    const targetAfter = face(
      solids(result.text).find((s) => s.id === targetSolid.id)!,
      "x",
      1,
    );
    expect(targetAfter.uaxis).toEqual(sourceSide.uaxis);
    expect(result.warnings.some((w) => w.includes("does not point the same way"))).toBe(true);
  });
});
