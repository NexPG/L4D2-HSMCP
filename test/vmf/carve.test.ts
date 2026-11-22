/**
 * `carve_solids` is Hammer's Carve, delegated to the sidecar verb of the same name, which
 * calls `srctools.geometry.Geometry.carve`. These tests exercise the wrapper (id lookup,
 * owner, guarded write, reply shape) and the one property that makes the result usable:
 * the pieces conserve volume — target volume less the overlap with the carver.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { carveSolidsTool } from "../../src/maps/typescript/tools/carve.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { emptyVmf } from "../../src/maps/typescript/vmf/skeleton.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-carve-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const MATERIAL = "BRICK/BRICKWALL001A";

function box(
  text: string,
  mins: [number, number, number],
  maxs: [number, number, number],
): string {
  return insertSolids(text, [{ shape: "box", mins, maxs }], { material: MATERIAL }).text;
}

function brushEntity(text: string, id: number, classname: string): string {
  return (
    text +
    ["entity", "{", `\t"id" "${id}"`, `\t"classname" "${classname}"`, "}", ""].join("\n")
  );
}

function volume(
  mins: readonly [number, number, number],
  maxs: readonly [number, number, number],
): number {
  return (maxs[0] - mins[0]) * (maxs[1] - mins[1]) * (maxs[2] - mins[2]);
}

function totalVolume(text: string): number {
  return checkVmfSolids("x", text).solids.reduce((sum, solid) => sum + solid.volume, 0);
}

describe.skipIf(!has.sidecar)("carve_solids", () => {
  it("splits a target into pieces that sum to target minus overlap", async () => {
    // A 64 cube carved by a 32 cube in its middle: eight corners remain, and nothing else.
    const target: [[number, number, number], [number, number, number]] = [
      [0, 0, 0],
      [64, 64, 64],
    ];
    const carver: [[number, number, number], [number, number, number]] = [
      [16, 16, 16],
      [48, 48, 48],
    ];
    const text = box(box(emptyVmf(), target[0], target[1]), carver[0], carver[1]);
    const path = join(scratch, "volume.vmf");
    writeFileSync(path, text);
    const before = checkVmfSolids(path, text);
    const targetId = before.solids.find((s) => s.mins[0] === 0)!.id as number;
    const carverId = before.solids.find((s) => s.mins[0] === 16)!.id as number;

    const out = join(scratch, "volume-out.vmf");
    const reply = await carveSolidsTool.handler(
      {
        path,
        out,
        targets: { solidIds: [targetId] },
        carver: carverId,
        keepCarver: false,
        confirm: true,
        backup: false,
        dryRun: false,
      },
      ctx,
    );

    expect(reply.out).toBe(out);
    expect(reply.written).toBe(true);
    expect(reply.newSolidIds).toHaveLength(6);
    expect(reply.removedTargetCount).toBe(1);
    expect(reply.removedCarver).toBe(true);
    expect(reply.owner).toBe("worldspawn");

    const after = checkVmfSolids(out, readFileSync(out, "utf8"));
    expect(after.solids).toHaveLength(6);
    expect(after.solids.every((s) => s.valid)).toBe(true);
    expect(totalVolume(readFileSync(out, "utf8"))).toBeCloseTo(
      volume(target[0], target[1]) - volume(carver[0], carver[1]),
      3,
    );
  });

  it("keeps the carver when asked and still reports the pieces", async () => {
    const text = box(box(emptyVmf(), [0, 0, 0], [64, 64, 64]), [16, 16, 16], [48, 48, 48]);
    const path = join(scratch, "keep.vmf");
    writeFileSync(path, text);
    const before = checkVmfSolids(path, text);
    const targetId = before.solids.find((s) => s.mins[0] === 0)!.id as number;
    const carverId = before.solids.find((s) => s.mins[0] === 16)!.id as number;

    const out = join(scratch, "keep-out.vmf");
    const reply = await carveSolidsTool.handler(
      {
        path,
        out,
        targets: { solidIds: [targetId] },
        carver: carverId,
        keepCarver: true,
        confirm: true,
        backup: false,
        dryRun: false,
      },
      ctx,
    );

    expect(reply.removedCarver).toBe(false);
    const after = checkVmfSolids(out, readFileSync(out, "utf8"));
    expect(after.solids).toHaveLength(7);
    expect(after.solids.some((s) => s.id === carverId)).toBe(true);
  });

  it("gives faces created by the cut the requested material", async () => {
    const text = box(box(emptyVmf(), [0, 0, 0], [64, 64, 64]), [16, 16, 16], [48, 48, 48]);
    const path = join(scratch, "material.vmf");
    writeFileSync(path, text);
    const before = checkVmfSolids(path, text);
    const targetId = before.solids.find((s) => s.mins[0] === 0)!.id as number;
    const carverId = before.solids.find((s) => s.mins[0] === 16)!.id as number;

    const out = join(scratch, "material-out.vmf");
    await carveSolidsTool.handler(
      {
        path,
        out,
        targets: { solidIds: [targetId] },
        carver: carverId,
        material: "DEV/DEV_MEASUREGENERIC01B",
        confirm: true,
        backup: false,
        dryRun: false,
      },
      ctx,
    );

    const written = readFileSync(out, "utf8");
    expect(written).toContain("DEV/DEV_MEASUREGENERIC01B");
  });

  it("keeps the pieces in the brush entity that owned the target", async () => {
    // The solid has to be *inside* the entity block; a `solid` before it belongs to the world.
    const withEntity = brushEntity(emptyVmf(), 900, "func_detail");
    const withSolid = insertSolids(
      withEntity,
      [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }],
      { material: MATERIAL, entityId: 900 },
    ).text;
    const text = box(withSolid, [16, 16, 16], [48, 48, 48]);
    const path = join(scratch, "owner.vmf");
    writeFileSync(path, text);
    const before = checkVmfSolids(path, text);
    const targetId = before.solids.find((s) => s.mins[0] === 0)!.id as number;
    const carverId = before.solids.find((s) => s.mins[0] === 16)!.id as number;

    const out = join(scratch, "owner-out.vmf");
    const reply = await carveSolidsTool.handler(
      {
        path,
        out,
        targets: { solidIds: [targetId] },
        carver: carverId,
        confirm: true,
        backup: false,
        dryRun: false,
      },
      ctx,
    );

    expect(reply.owner).toBe("func_detail");
    const after = checkVmfSolids(out, readFileSync(out, "utf8"));
    expect(after.solids).toHaveLength(6);
    expect(after.solids.every((s) => s.owner === "func_detail")).toBe(true);
  });

  it("refuses an unknown solid id and a carver that is also a target", async () => {
    const text = box(emptyVmf(), [0, 0, 0], [64, 64, 64]);
    const path = join(scratch, "refuse.vmf");
    writeFileSync(path, text);
    const id = checkVmfSolids(path, text).solids[0]!.id as number;
    const out = join(scratch, "refuse-out.vmf");

    await expect(
      carveSolidsTool.handler(
        { path, out, targets: { solidIds: [id] }, carver: 999_999, confirm: true, backup: false, dryRun: false },
        ctx,
      ),
    ).rejects.toThrow(/999999/);

    await expect(
      carveSolidsTool.handler(
        { path, out, targets: { solidIds: [id] }, carver: id, confirm: true, backup: false, dryRun: false },
        ctx,
      ),
    ).rejects.toThrow(/carver cannot also be a target/);
  });

  it("dry run reports the pieces without writing", async () => {
    const text = box(box(emptyVmf(), [0, 0, 0], [64, 64, 64]), [16, 16, 16], [48, 48, 48]);
    const path = join(scratch, "dry.vmf");
    writeFileSync(path, text);
    const before = checkVmfSolids(path, text);
    const targetId = before.solids.find((s) => s.mins[0] === 0)!.id as number;
    const carverId = before.solids.find((s) => s.mins[0] === 16)!.id as number;
    const out = join(scratch, "dry-out.vmf");

    const reply = await carveSolidsTool.handler(
      {
        path,
        out,
        targets: { solidIds: [targetId] },
        carver: carverId,
        confirm: true,
        backup: false,
        dryRun: true,
      },
      ctx,
    );

    expect(reply.written).toBe(false);
    expect(reply.newSolidIds).toHaveLength(6);
    expect(readFileSync(path, "utf8")).toBe(text);
  });
});

describe("what the compiler says about a carved block", () => {
  const canCompile = has.toolchain;
  const compileScratch = mkdtempSync(join(tmpdir(), "hammer-carve-c-"));
  afterAll(() => rmSync(compileScratch, { recursive: true, force: true }));

  it.skipIf(!canCompile)(
    "an indentation carved into the probe's floor still seals",
    async () => {
      // A pit, not a hole: the carver stops 24 units short of the floor's underside, so
      // the room stays sealed and vbsp has to accept the pieces the boolean made.
      const probe = readFileSync(join(FIXTURES, "hmcp_probe.vmf"), "utf8");
      const floor = checkVmfSolids("x", probe).solids.find((s) => s.id === 7)!;
      const cx = (floor.mins[0] + floor.maxs[0]) / 2;
      const cy = (floor.mins[1] + floor.maxs[1]) / 2;
      const withCarver = insertSolids(
        probe,
        [
          {
            shape: "box",
            mins: [cx - 64, cy - 64, floor.maxs[2] - 8],
            maxs: [cx + 64, cy + 64, floor.maxs[2] + 8],
          },
        ],
        { material: "DEV/DEV_MEASUREGENERIC01" },
      );
      const path = join(compileScratch, "pit.vmf");
      writeFileSync(path, withCarver.text);
      const carverId = withCarver.solidIds[0]!;

      const carved = (await carveSolidsTool.handler(
        {
          path,
          targets: { solidIds: [7] },
          carver: carverId,
          confirm: true,
          backup: false,
          dryRun: false,
        },
        ctx,
      )) as { newSolidIds: number[] };
      expect(carved.newSolidIds.length).toBeGreaterThanOrEqual(5);

      const after = checkVmfSolids(path, readFileSync(path, "utf8"));
      expect(after.solids.filter((s) => !s.valid)).toHaveLength(0);

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
