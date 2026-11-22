/**
 * `hull_solids` delegates to `srctools.geometry.Geometry.from_points` (srctools'
 * `quickhull`) through the sidecar. These tests check the wrapper and the one oracle a hull
 * has: a cube's eight corners must come back as the same cube — six planes, exact volume.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { hullSolidsTool } from "../../src/maps/typescript/tools/hull.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { emptyVmf } from "../../src/maps/typescript/vmf/skeleton.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-hull-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const MATERIAL = "BRICK/BRICKWALL001A";

function box(
  text: string,
  mins: [number, number, number],
  maxs: [number, number, number],
): string {
  return insertSolids(text, [{ shape: "box", mins, maxs }], { material: MATERIAL }).text;
}

function entity(text: string, id: number, classname: string): string {
  return (
    text + ["entity", "{", `\t"id" "${id}"`, `\t"classname" "${classname}"`, "}", ""].join("\n")
  );
}

function cubeCorners(size: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const x of [0, size]) {
    for (const y of [0, size]) {
      for (const z of [0, size]) out.push([x, y, z]);
    }
  }
  return out;
}

describe.skipIf(!has.sidecar)("hull_solids", () => {
  it("turns a cube's eight corners back into that cube", async () => {
    const path = join(scratch, "cube.vmf");
    writeFileSync(path, emptyVmf());
    const out = join(scratch, "cube-out.vmf");
    const reply = await hullSolidsTool.handler(
      {
        path,
        out,
        points: cubeCorners(64),
        confirm: true,
        backup: false,
        dryRun: false,
      },
      ctx,
    );

    expect(reply.out).toBe(out);
    expect(reply.written).toBe(true);
    expect(reply.pointCount).toBe(8);
    expect(reply.planeCount).toBe(6);
    expect(reply.owner).toBe("worldspawn");

    const solids = checkVmfSolids(out, readFileSync(out, "utf8")).solids;
    expect(solids).toHaveLength(1);
    expect(solids[0]!.mins).toEqual([0, 0, 0]);
    expect(solids[0]!.maxs).toEqual([64, 64, 64]);
    expect(solids[0]!.volume).toBeCloseTo(64 ** 3, 3);
    expect(solids[0]!.valid).toBe(true);
  });

  it("keeps the sources by default and removes them only on request", async () => {
    const text = box(box(emptyVmf(), [0, 0, 0], [32, 32, 32]), [48, 0, 0], [80, 32, 32]);
    const path = join(scratch, "sources.vmf");
    writeFileSync(path, text);
    const before = checkVmfSolids(path, text);
    const ids = before.solids.map((s) => s.id);

    const keptOut = join(scratch, "sources-kept.vmf");
    const kept = await hullSolidsTool.handler(
      { path, out: keptOut, solids: { solidIds: ids as number[] }, confirm: true, backup: false, dryRun: false },
      ctx,
    );
    expect(kept.keepSources).toBe(true);
    expect(kept.removedSourceCount).toBe(0);
    expect(checkVmfSolids(keptOut, readFileSync(keptOut, "utf8")).solids).toHaveLength(3);

    const cutOut = join(scratch, "sources-cut.vmf");
    const cut = await hullSolidsTool.handler(
      {
        path,
        out: cutOut,
        solids: { solidIds: ids as number[] },
        keepSources: false,
        confirm: true,
        backup: false,
        dryRun: false,
      },
      ctx,
    );
    expect(cut.removedSourceCount).toBe(2);
    const after = checkVmfSolids(cutOut, readFileSync(cutOut, "utf8")).solids;
    expect(after).toHaveLength(1);
    // Two 32 cubes 16 apart: the hull spans their union, so it is bigger than either.
    expect(after[0]!.mins).toEqual([0, 0, 0]);
    expect(after[0]!.maxs).toEqual([80, 32, 32]);
    expect(after[0]!.volume).toBeGreaterThan(32 ** 3);
  });

  it("puts the hull in the brush entity that owned its first source", async () => {
    const withEntity = entity(emptyVmf(), 900, "func_detail");
    const withSolid = insertSolids(
      withEntity,
      [{ shape: "box", mins: [0, 0, 0], maxs: [32, 32, 32] }],
      { material: MATERIAL, entityId: 900 },
    ).text;
    const path = join(scratch, "owner.vmf");
    writeFileSync(path, withSolid);
    const id = checkVmfSolids(path, withSolid).solids[0]!.id as number;

    const out = join(scratch, "owner-out.vmf");
    const reply = await hullSolidsTool.handler(
      { path, out, solids: { solidIds: [id] }, confirm: true, backup: false, dryRun: false },
      ctx,
    );
    expect(reply.owner).toBe("func_detail");
    const after = checkVmfSolids(out, readFileSync(out, "utf8")).solids;
    expect(after.filter((s) => s.owner === "func_detail")).toHaveLength(2);
  });

  it("refuses fewer than four points, coplanar points and mixed owners", async () => {
    const path = join(scratch, "refuse.vmf");
    writeFileSync(path, box(emptyVmf(), [0, 0, 0], [16, 16, 16]));
    const out = join(scratch, "refuse-out.vmf");
    const base = { path, out, confirm: true, backup: false, dryRun: false };

    await expect(
      hullSolidsTool.handler({ ...base, points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }, ctx),
    ).rejects.toThrow(/at least 4 distinct points/);

    await expect(
      hullSolidsTool.handler(
        { ...base, points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]] },
        ctx,
      ),
    ).rejects.toThrow(/coplanar/);

    const withEntity = entity(emptyVmf(), 900, "func_detail");
    const entityText = box(
      insertSolids(
        withEntity,
        [{ shape: "box", mins: [-16, 0, 0], maxs: [0, 16, 16] }],
        { material: MATERIAL, entityId: 900 },
      ).text,
      [64, 0, 0],
      [80, 16, 16],
    );
    const mixed = join(scratch, "mixed.vmf");
    writeFileSync(mixed, entityText);
    const solids = checkVmfSolids(mixed, entityText).solids;
    expect(new Set(solids.map((s) => s.owner)).size).toBe(2);
    await expect(
      hullSolidsTool.handler(
        { ...base, path: mixed, solids: { solidIds: solids.map((s) => s.id as number) } },
        ctx,
      ),
    ).rejects.toThrow(/span 2 owners/);
  });

  it("refuses a request with neither brushes nor points", async () => {
    const path = join(scratch, "empty.vmf");
    writeFileSync(path, emptyVmf());
    await expect(
      hullSolidsTool.handler(
        { path, out: join(scratch, "empty-out.vmf"), confirm: true, backup: false, dryRun: false },
        ctx,
      ),
    ).rejects.toThrow(/needs vertices/);
  });

  it("dry run reports the hull without writing", async () => {
    const path = join(scratch, "dry.vmf");
    const text = emptyVmf();
    writeFileSync(path, text);
    const out = join(scratch, "dry-out.vmf");
    const reply = await hullSolidsTool.handler(
      {
        path,
        out,
        points: cubeCorners(32),
        confirm: true,
        backup: false,
        dryRun: true,
      },
      ctx,
    );
    expect(reply.written).toBe(false);
    expect(reply.planeCount).toBe(6);
    expect(readFileSync(path, "utf8")).toBe(text);
  });
});

describe("what the compiler says about a hull", () => {
  const canCompile = has.toolchain;
  const compileScratch = mkdtempSync(join(tmpdir(), "hammer-hull-c-"));
  afterAll(() => rmSync(compileScratch, { recursive: true, force: true }));

  it.skipIf(!canCompile || !has.sidecar)(
    "a hull built inside the probe's room compiles and does not leak",
    async () => {
      const probe = readFileSync(join(FIXTURES, "hmcp_probe.vmf"), "utf8");
      // Three small boxes near the middle of the floor; their hull is one convex brush,
      // which vbsp must accept as a normal world solid.
      const withBoxes = insertSolids(
        probe,
        [
          { shape: "box", mins: [-96, -96, 0], maxs: [-64, -64, 32] },
          { shape: "box", mins: [64, -96, 0], maxs: [96, -64, 32] },
          { shape: "box", mins: [-16, 64, 0], maxs: [16, 96, 32] },
        ],
        { material: "DEV/DEV_MEASUREGENERIC01" },
      );
      const path = join(compileScratch, "hull.vmf");
      writeFileSync(path, withBoxes.text);

      const hull = await hullSolidsTool.handler(
        {
          path,
          solids: { solidIds: withBoxes.solidIds },
          keepSources: false,
          material: "DEV/DEV_MEASUREGENERIC01",
          confirm: true,
          backup: false,
          dryRun: false,
        },
        ctx,
      );
      expect(hull.newSolidId).toBeGreaterThan(0);

      const solids = checkVmfSolids(path, readFileSync(path, "utf8")).solids;
      expect(solids.filter((s) => !s.valid)).toHaveLength(0);

      const out = (await runCompile.handler(
        {
          vmf: path,
          fast: true,
          hdr: false,
          stages: ["vbsp"],
          toolchain: "stock",
          cull: false,
          timeoutMinutes: 10,
          confirm: true,
        },
        ctx,
      )) as { ok: boolean; leaked: boolean };
      expect(out.leaked).toBe(false);
      expect(out.ok).toBe(true);
    },
    300_000,
  );
});
