import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { insertSolids } from "../../src/vmf/build.js";
import { alignFaces } from "../../src/vmf/face.js";
import { copyFaceAlignmentTool } from "../../src/tools/face.js";
import { checkVmfSolids } from "../../src/vmf/solid.js";
import type { SolidCheck } from "../../src/vmf/solid.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-face-copy-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function map(name: string): string {
  const first = insertSolids(EMPTY, [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }], {
    material: "BRICK/BRICKWALL001A",
  }).text;
  const text = insertSolids(first, [{ shape: "box", mins: [128, 0, 0], maxs: [192, 64, 64] }], {
    material: "WOOD/WOODWALL001A",
  }).text;
  const path = join(scratch, name);
  writeFileSync(path, text, "utf8");
  return path;
}

function solids(path: string): SolidCheck[] {
  return checkVmfSolids(path, readFileSync(path, "utf8")).solids;
}

function sideId(solid: SolidCheck, axis: 0 | 1 | 2, sign: 1 | -1): number {
  const side = solid.sides.find(
    (s) => s.plane && Math.abs(s.plane.normal[axis]! - sign) < 0.01 && s.id !== null,
  );
  if (!side) throw new Error("no face");
  return side.id!;
}

describe("copy_face_alignment tool", () => {
  it("copies axes onto the target and leaves geometry alone", async () => {
    const path = map("copy.vmf");
    const before = solids(path);
    const source = before[0]!;
    const target = before[1]!;
    // Give the source a distinctive alignment so the copy has something to change.
    writeFileSync(
      path,
      alignFaces(readFileSync(path, "utf8"), { solidIds: [source.id!] }, {
        mode: "face",
        shift: [32, 48],
      }).text,
      "utf8",
    );
    const out = (await copyFaceAlignmentTool.handler(
      {
        path,
        sourceSolidId: source.id!,
        sourceSideId: sideId(source, 0, 1),
        solidIds: [target.id!],
        sideIds: [sideId(target, 0, 1)],
        backup: false,
        confirm: true,
      },
      ctx,
    )) as { written: boolean; matched: number; changed: unknown[]; warnings: string[] };

    expect(out.written).toBe(true);
    expect(out.matched).toBe(1);
    expect(out.changed.length).toBeGreaterThan(0);
    const after = solids(path);
    expect(after.map((s) => s.volume)).toEqual(before.map((s) => s.volume));
  });

  it("copies the material when asked", async () => {
    const path = map("material.vmf");
    const before = solids(path);
    const source = before[0]!;
    const target = before[1]!;
    await copyFaceAlignmentTool.handler(
      {
        path,
        sourceSolidId: source.id!,
        sourceSideId: sideId(source, 0, 1),
        solidIds: [target.id!],
        sideIds: [sideId(target, 0, 1)],
        copyMaterial: true,
        backup: false,
        confirm: true,
      },
      ctx,
    );
    const targetAfter = solids(path).find((s) => s.id === target.id)!;
    const copied = targetAfter.sides.find((s) => s.id === sideId(target, 0, 1))!;
    expect(copied.material).toBe("BRICK/BRICKWALL001A");
  });

  it("refuses axes that lie along the target normal", async () => {
    const path = map("invalid.vmf");
    const before = solids(path);
    const source = before[0]!;
    const target = before[1]!;
    expect(() =>
      copyFaceAlignmentTool.handler(
        {
          path,
          sourceSolidId: source.id!,
          sourceSideId: sideId(source, 2, 1),
          solidIds: [target.id!],
          sideIds: [sideId(target, 0, 1)],
          backup: false,
          confirm: true,
        },
        ctx,
      ),
    ).toThrow(/texture axes the checker rejects/);
  });

  it("does not write on a dry run", async () => {
    const path = map("dry.vmf");
    const before = readFileSync(path, "utf8");
    const s = solids(path);
    const out = (await copyFaceAlignmentTool.handler(
      {
        path,
        sourceSolidId: s[0]!.id!,
        sourceSideId: sideId(s[0]!, 0, 1),
        solidIds: [s[1]!.id!],
        sideIds: [sideId(s[1]!, 0, 1)],
        dryRun: true,
        backup: false,
        confirm: true,
      },
      ctx,
    )) as { written: boolean };
    expect(out.written).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});
