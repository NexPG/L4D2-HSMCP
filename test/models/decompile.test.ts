/**
 * Decompiling a compiled model back to a QC and a reference SMD.
 *
 * The unit checks pin the shape of the output. The round-trip test compiles the decompiled
 * QC with the game's own studiomdl and compares the recompiled hull with the source: that is
 * the only proof that the vertex order, the static-prop axis swap and the one-frame sequence
 * are right, rather than merely plausible.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { decompileModelTool } from "../../src/models/typescript/tools/decompile.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-decompile-"));
const outputModelDir = (): string => join(ctx.config.gameDir!, "models", "hsmcp_decompile_test");
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(outputModelDir(), { recursive: true, force: true });
});

const MODEL = "props_vehicles/cara_84sedan.mdl";

describe.skipIf(!has.gameContent)("decompile_model", () => {
  it("writes a QC, a reference SMD and a collision SMD", async () => {
    const outDir = join(scratch, "car");
    const r = (await decompileModelTool.handler(
      {
        model: MODEL,
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/car.mdl",
      } as never,
      ctx,
    )) as {
      qc: string;
      smd: string;
      collisionSmd: string | null;
      triangleCount: number;
      collisionTriangles: number;
      warnings: string[];
    };
    expect(r.triangleCount).toBe(5515);
    expect(r.collisionTriangles).toBe(634);
    expect(existsSync(r.qc)).toBe(true);
    expect(existsSync(r.smd)).toBe(true);
    expect(r.collisionSmd).not.toBeNull();
    expect(existsSync(r.collisionSmd!)).toBe(true);

    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain('$modelname "hsmcp_decompile_test/car.mdl"');
    expect(qc).toContain('$body "Body" "cara_84sedan_ref.smd"');
    expect(qc).toContain("$staticprop");
    expect(qc).toContain("$cdmaterials \"models/props_vehicles/\"");
    expect(qc).toContain("$collisionmodel \"cara_84sedan_phys.smd\"");
    expect(qc).toContain("$concave");
    expect(qc).toContain('$sequence "idle" "cara_84sedan_ref.smd" fps 1');
    expect(r.warnings.join(" ")).toMatch(/Animations, flexes/);

    const smd = readFileSync(r.smd, "latin1");
    expect(smd.startsWith("version 1\nnodes\n")).toBe(true);
    expect(smd).toContain("triangles");
    expect(smd).toContain("4carz1024");
  });

  it.skipIf(!has.toolchain)("recompiles to the same hull as the source", async () => {
    const outDir = join(scratch, "roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: MODEL,
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/car.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean; model: string | null };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const source = openGameVpk(ctx.config.gameDir!)!.read(
      "models/props_vehicles/cara_84sedan.mdl",
    )!;
    const recompiled = readFileSync(join(outputModelDir(), "car.mdl"));
    const hull = (bytes: Buffer): { min: number[]; max: number[] } => ({
      min: [bytes.readFloatLE(104), bytes.readFloatLE(108), bytes.readFloatLE(112)],
      max: [bytes.readFloatLE(116), bytes.readFloatLE(120), bytes.readFloatLE(124)],
    });
    const a = hull(source);
    const b = hull(recompiled);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(a.min[axis]! - b.min[axis]!)).toBeLessThan(8);
      expect(Math.abs(a.max[axis]! - b.max[axis]!)).toBeLessThan(8);
    }
  });
});
