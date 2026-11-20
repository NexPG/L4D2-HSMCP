import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { alignFacesTool } from "../../src/maps/typescript/tools/face.js";
import { ctx as sharedCtx } from "../support/env.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { alignFaces } from "../../src/maps/typescript/vmf/face.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import type { Vec3 } from "../../src/maps/typescript/vmf/solid.js";

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-hotspot-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A 256 x 128 top face: two by one metres of floor, as a trim sheet sees it. */
function slab(): { text: string; id: number } {
  const built = insertSolids(
    SEED,
    [{ shape: "box", mins: [-128, -64, 0], maxs: [128, 64, 64] }],
    { material: "DEV/DEV_MEASUREGENERIC01" },
  );
  return { text: built.text, id: built.solidIds[0]! };
}

describe("alignFaces with a .rect hotspot", () => {
  it("maps the face onto the rectangle instead of the whole texture", () => {
    const map = slab();
    const r = alignFaces(
      map.text,
      { solidIds: [map.id], facing: "up" },
      {
        mode: "fit",
        fitRect: { mins: [32, 64], maxs: [96, 128] },
      },
    );
    expect(r.changed).toHaveLength(1);
    // The texture size is not needed for a hotspot: the region defines the scale.
    expect(r.warnings.join(" ")).not.toMatch(/assumed a 512/);

    const side = checkVmfSolids("x", r.text)
      .solids.find((solid) => solid.id === map.id)!
      .sides.find((s) => s.plane?.normal[2] === 1)!;
    const u = side.uaxis!;
    const v = side.vaxis!;

    const uv = side.vertices.map((p) => ({
      u: dot(p, u.axis) / u.scale + u.offset,
      v: dot(p, v.axis) / v.scale + v.offset,
    }));
    const uRange = [Math.min(...uv.map((p) => p.u)), Math.max(...uv.map((p) => p.u))];
    const vRange = [Math.min(...uv.map((p) => p.v)), Math.max(...uv.map((p) => p.v))];

    // 256 units wide across 64 texels -> 4 units per texel; 128 across 64 -> 2.
    expect(u.scale).toBeCloseTo(4, 6);
    expect(v.scale).toBeCloseTo(2, 6);
    expect(uRange[0]).toBeCloseTo(32, 6);
    expect(uRange[1]).toBeCloseTo(96, 6);
    expect(vRange[0]).toBeCloseTo(64, 6);
    expect(vRange[1]).toBeCloseTo(128, 6);
  });

  it("refuses a degenerate rectangle rather than writing an infinite scale", () => {
    const map = slab();
    expect(() =>
      alignFaces(
        map.text,
        { solidIds: [map.id], facing: "up" },
        { mode: "fit", fitRect: { mins: [10, 10], maxs: [10, 20] } },
      ),
    ).toThrow(/max above min/);
  });

  it("still fits the whole texture when no rectangle is given", () => {
    const map = slab();
    const r = alignFaces(map.text, { solidIds: [map.id], facing: "up" }, { mode: "fit" });
    // No textureSizes supplied, so the 512 assumption applies and says so.
    expect(r.warnings.join(" ")).toMatch(/assumed a 512/);
  });
});

describe("align_faces fitRect guard", () => {
  it("refuses a hotspot outside mode 'fit' instead of ignoring it", async () => {
    const map = slab();
    const path = join(scratch, "guard.vmf");
    writeFileSync(path, map.text);
    await expect(
      alignFacesTool.handler(
        {
          path,
          mode: "world",
          fitRect: { mins: [0, 0], maxs: [32, 32] },
          solidIds: [map.id],
          backup: false,
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/only meaningful with mode 'fit'/);
  });
});