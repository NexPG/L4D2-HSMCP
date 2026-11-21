/**
 * Eyes and mouths: data that is readable but not writable in an L4D2 QC.
 *
 * The stock survivor has two eyeballs and one mouth. The eyeball `org` is already in the
 * head bone's local frame (its magnitude is ~3 units while the head bone sits at z ~57), the
 * stored texture index is the head material, and the side comes from the `_l`/`_r` texture
 * name. `qcWritable` is false because both L4D2 compilers reject `$eyeball`, `$eyelid` and
 * `$mouth` — the tool reports the boundary rather than emitting a QC that cannot compile.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { decompileModelTool } from "../../src/models/typescript/tools/decompile.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { readModelEyesTool } from "../../src/models/typescript/tools/eyes.js";
import { ctx as sharedCtx, has } from "../support/env.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-eyes-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(join(ctx.config.gameDir!, "models", "hsmcp_eyes_test"), { recursive: true, force: true });
});

describe.skipIf(!has.gameContent)("read_model_eyes", () => {
  it("reads the two survivor eyes and the mouth", async () => {
    const r = (await readModelEyesTool.handler(
      { model: "survivors/survivor_producer.mdl" } as never,
      ctx,
    )) as {
      eyeballCount: number;
      mouthCount: number;
      qcWritable: boolean;
      eyeballs: Array<{
        side: string;
        material: string | null;
        materialGuessed: boolean;
        boneName: string | null;
        org: number[];
        radius: number;
        diameter: number;
        angle: number;
        iris: number;
        upperLid: string | null;
        lowerLid: string | null;
        upper: Array<{ flex: string | null; target: number }>;
        lower: Array<{ flex: string | null; target: number }>;
      }>;
      mouths: Array<{ boneName: string | null; flex: string | null; forward: number[] }>;
      note: string;
    };
    expect(r.eyeballCount).toBe(2);
    expect(r.mouthCount).toBe(1);
    expect(r.qcWritable).toBe(false);
    expect(r.note).toMatch(/bad command/);

    const right = r.eyeballs.find((eye) => eye.side === "right")!;
    expect(right.boneName).toBe("ValveBiped.Bip01_Head1");
    expect(right.material).toContain("producer_eyeball_r");
    expect(right.materialGuessed).toBe(true);
    // Bone-local: the head bone is at z 57, the eye origin is a few units from it.
    expect(Math.hypot(...right.org)).toBeLessThan(5);
    expect(right.radius).toBeCloseTo(0.525, 4);
    expect(right.diameter).toBeCloseTo(1.05, 4);
    expect(right.angle).toBeCloseTo(3, 3);
    expect(right.iris).toBeCloseTo(0.53, 3);
    expect(right.upperLid).toBe("upper_right");
    expect(right.lowerLid).toBe("lower_right");
    expect(right.upper.map((entry) => entry.flex)).toEqual([
      "upper_right_lowerer",
      "upper_right_neutral",
      "upper_right_raiser",
    ]);
    expect(right.upper[2]!.target).toBeCloseTo(0.318122, 5);
    expect(right.lower[0]!.target).toBeCloseTo(-0.279892, 5);

    const left = r.eyeballs.find((eye) => eye.side === "left")!;
    expect(left.material).toContain("producer_eyeball_l");
    expect(left.angle).toBeCloseTo(-3, 3);

    expect(r.mouths[0]).toMatchObject({
      boneName: "ValveBiped.Bip01_Head1",
      flex: "mouth",
    });
    expect(r.mouths[0]!.forward).toEqual([0, 1, 0]);
  });

  it("reports no eyes for a model without them", async () => {
    const r = (await readModelEyesTool.handler(
      { model: "infected/boomette.mdl" } as never,
      ctx,
    )) as { eyeballCount: number; mouthCount: number };
    expect(r.eyeballCount).toBe(0);
    expect(r.mouthCount).toBe(0);
  });
});

describe.skipIf(!has.gameContent)("decompile_model eyes", () => {
  it("warns that eyes cannot be written and does not claim to write them", async () => {
    const r = (await decompileModelTool.handler(
      {
        model: "survivors/survivor_producer.mdl",
        outDir: join(scratch, "producer"),
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_eyes_test/producer.mdl",
      } as never,
      ctx,
    )) as { qc: string; warnings: string[] };
    expect(r.warnings.join(" ")).toMatch(/2 eyeball\(s\) and 1 mouth\(s\)/);
    expect(r.warnings.join(" ")).toMatch(/no `\$eyeball`/);
    const qc = readFileSync(r.qc, "utf8");
    expect(qc).not.toContain("$eyeball");
    expect(qc).not.toContain("$eyelid");
    expect(qc).not.toContain("$mouth");
    // The eyelid drivers survive as local variables and rules, not as VTA frames.
    expect(qc).toContain("localvar biter");
    expect(qc).toContain("%upper_right_lowerer =");
    expect(qc).toContain("localvar upper_right_lowerer");
  });

  it.skipIf(!has.toolchain)("compiles the survivor and reports that its eyes were lost", { timeout: 60_000 }, async () => {
    const decompiled = (await decompileModelTool.handler(
      {
        model: "survivors/survivor_producer.mdl",
        outDir: join(scratch, "producer-roundtrip"),
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_eyes_test/producer.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 20 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);
    const rebuilt = (await readModelEyesTool.handler(
      { model: "hsmcp_eyes_test/producer.mdl" } as never,
      ctx,
    )) as { eyeballCount: number };
    // Expected: the QC path cannot express eyes, so a recompile loses them. The warning
    // above is what tells the user this is a known limitation, not a silent drop.
    expect(rebuilt.eyeballCount).toBe(0);
  });
});
