/**
 * Jigglebones: read from a compiled model and written back as a `$jigglebone` block.
 *
 * There is no stock L4D2 fixture (no stock model has `proctype 5`), so the test builds one:
 * a two-bone SMD, a QC with a flexible + boing jiggle, the real compiler, then the reader,
 * a decompile and a second compile. The struct is compared field by field, including the
 * flags, the angle limit (radians) and the boing impact angle (stored as `cos(angle)`).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readMdlBones } from "../../src/models/typescript/formats/mdlbones.js";
import { readJiggleBones } from "../../src/models/typescript/formats/mdljiggle.js";
import { decompileModelTool } from "../../src/models/typescript/tools/decompile.js";
import { readModelJiggleTool } from "../../src/models/typescript/tools/jiggle.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-jiggle-"));
const outDir = (): string => join(ctx.config.gameDir!, "models", "hsmcp_jiggle_test");
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(outDir(), { recursive: true, force: true });
});

const SMD = [
  "version 1",
  "nodes",
  '0 "root" -1',
  '1 "jiggle_bone" 0',
  "end",
  "skeleton",
  "time 0",
  "0 0.000000 0.000000 0.000000 0.000000 0.000000 0.000000",
  "1 0.000000 0.000000 10.000000 0.000000 0.000000 0.000000",
  "end",
  "triangles",
  "mat",
  "0 0.000000 0.000000 0.000000 0.000000 0.000000 1.000000 0.000000 0.000000 1 1 1.000000",
  "0 10.000000 0.000000 0.000000 0.000000 0.000000 1.000000 1.000000 0.000000 1 1 1.000000",
  "1 0.000000 10.000000 10.000000 0.000000 0.000000 1.000000 0.500000 1.000000 1 1 1.000000",
  "end",
  "",
].join("\n");

const QC = [
  '$modelname "hsmcp_jiggle_test/probe.mdl"',
  '$body "Body" "ref.smd"',
  '$cdmaterials "models/dev/"',
  '$surfaceprop "flesh"',
  '$sequence "idle" "ref.smd" fps 1',
  '$jigglebone "jiggle_bone"',
  "{",
  "\tis_flexible",
  "\t{",
  "\t\tlength 15",
  "\t\ttip_mass 0",
  "\t\tpitch_stiffness 40",
  "\t\tpitch_damping 3",
  "\t\tyaw_stiffness 40",
  "\t\tyaw_damping 3",
  "\t\tallow_length_flex",
  "\t\talong_stiffness 100",
  "\t\talong_damping 0",
  "\t\tpitch_constraint -20 25",
  "\t\tpitch_friction 1.5",
  "\t\tpitch_bounce 0.2",
  "\t\tyaw_constraint -30 30",
  "\t\tyaw_friction 2",
  "\t\tyaw_bounce 0.1",
  "\t\tangle_constraint 30",
  "\t}",
  "\tis_boing",
  "\t{",
  "\t\timpact_speed 250",
  "\t\timpact_angle 45",
  "\t\tdamping_rate 2.5",
  "\t\tfrequency 6",
  "\t\tamplitude 0.4",
  "\t}",
  "}",
  "",
].join("\n");

describe.skipIf(!has.toolchain)("jigglebone round trip", () => {
  it("compiles a probe, reads its struct and reproduces it through a decompile", { timeout: 90_000 }, async () => {
    mkdirSync(outDir(), { recursive: true });
    writeFileSync(join(scratch, "ref.smd"), SMD, "latin1");
    writeFileSync(join(scratch, "probe.qc"), QC, "latin1");
    const first = (await runStudiomdlTool.handler(
      { qc: join(scratch, "probe.qc"), timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(first.ok).toBe(true);
    expect(first.modelExists).toBe(true);

    const compiledPath = join(outDir(), "probe.mdl");
    const compiled = readFileSync(compiledPath);
    const jiggles = readJiggleBones(compiled, readMdlBones(compiled));
    expect(jiggles).toHaveLength(1);
    const jiggle = jiggles[0]!;
    expect(jiggle.boneName).toBe("jiggle_bone");
    expect(jiggle.flags).toBe(157); // flexible + yaw + pitch + angle + boing
    expect(jiggle.length).toBe(15);
    expect(jiggle.tipMass).toBe(0);
    expect(jiggle.yawStiffness).toBe(40);
    expect(jiggle.pitchDamping).toBe(3);
    expect(jiggle.alongStiffness).toBe(100);
    expect(jiggle.angleLimit).toBeCloseTo((30 * Math.PI) / 180, 5);
    expect(jiggle.minPitch).toBeCloseTo((-20 * Math.PI) / 180, 5);
    expect(jiggle.maxPitch).toBeCloseTo((25 * Math.PI) / 180, 5);
    expect(jiggle.boingImpactAngle).toBeCloseTo(Math.cos((45 * Math.PI) / 180), 5);
    expect(jiggle.boingAmplitude).toBeCloseTo(0.4, 5);

    const read = (await readModelJiggleTool.handler({ path: compiledPath } as never, ctx)) as {
      count: number;
      entries: Array<{ qc: string; boing: boolean }>;
    };
    expect(read.count).toBe(1);
    expect(read.entries[0]!.qc).toContain("is_flexible");
    expect(read.entries[0]!.qc).toContain("is_boing");
    expect(read.entries[0]!.qc).toContain("angle_constraint 30.000");
    expect(read.entries[0]!.qc).toContain("impact_angle 45.000");
    expect(read.entries[0]!.boing).toBe(true);

    const decompiled = (await decompileModelTool.handler(
      {
        path: compiledPath,
        outDir: join(scratch, "decompiled"),
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_jiggle_test/roundtrip.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    expect(readFileSync(decompiled.qc, "utf8")).toContain('$jigglebone "jiggle_bone"');
    const second = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(second.ok).toBe(true);

    const rebuilt = readFileSync(join(outDir(), "roundtrip.mdl"));
    const again = readJiggleBones(rebuilt, readMdlBones(rebuilt))[0]!;
    expect(again.flags).toBe(jiggle.flags);
    expect(again.length).toBe(jiggle.length);
    expect(again.tipMass).toBe(jiggle.tipMass);
    expect(again.pitchStiffness).toBe(jiggle.pitchStiffness);
    expect(again.pitchDamping).toBe(jiggle.pitchDamping);
    expect(again.yawStiffness).toBe(jiggle.yawStiffness);
    expect(again.alongStiffness).toBe(jiggle.alongStiffness);
    expect(again.angleLimit).toBeCloseTo(jiggle.angleLimit, 5);
    expect(again.minPitch).toBeCloseTo(jiggle.minPitch, 5);
    expect(again.maxPitch).toBeCloseTo(jiggle.maxPitch, 5);
    expect(again.boingImpactAngle).toBeCloseTo(jiggle.boingImpactAngle, 5);
    expect(again.boingAmplitude).toBeCloseTo(jiggle.boingAmplitude, 5);
  });
});
