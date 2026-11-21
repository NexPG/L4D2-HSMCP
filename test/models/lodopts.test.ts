/**
 * LOD options: `replacematerial`, `facial`/`nofacial` and the read side.
 *
 * Stock L4D2 has no model with a VTX material replacement in the first 1,200 models scanned,
 * so the fixture is a two-material probe compiled with a `$lod` block. The compiler stores the
 * replacement in the VTX (a negative offset relative to the list record), `read_model_lods`
 * reports it, `decompile_model` writes it back as `replacematerial`, and a second compile
 * reproduces the same replacement.
 *
 * `replacebone` and `facial` are checked against stock models in the decompile and eyes tests;
 * this file covers the one option that needs a purpose-built source.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { decompileModelTool } from "../../src/models/typescript/tools/decompile.js";
import { readModelLodsTool } from "../../src/models/typescript/tools/lods.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-lodopts-"));
const outDir = (): string => join(ctx.config.gameDir!, "models", "hsmcp_lodopts_test");
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  if (ctx.config.gameDir) rmSync(outDir(), { recursive: true, force: true });
});

function smd(material: string, child: boolean): string {
  return [
    "version 1",
    "nodes",
    '0 "root" -1',
    '1 "child" 0',
    "end",
    "skeleton",
    "time 0",
    "0 0.000000 0.000000 0.000000 0.000000 0.000000 0.000000",
    "1 0.000000 0.000000 10.000000 0.000000 0.000000 0.000000",
    "end",
    "triangles",
    material,
    `0 0.000000 0.000000 0.000000 0.000000 0.000000 1.000000 0.000000 0.000000 1 1 1.000000`,
    `0 10.000000 0.000000 0.000000 0.000000 0.000000 1.000000 1.000000 0.000000 1 1 1.000000`,
    `${child ? 1 : 0} 0.000000 10.000000 ${child ? 10 : 0}.000000 0.000000 0.000000 1.000000 0.500000 1.000000 1 1 1.000000`,
    "end",
    "",
  ].join("\n");
}

const QC = [
  '$modelname "hsmcp_lodopts_test/probe.mdl"',
  '$body "Body" "ref.smd"',
  '$cdmaterials "models/dev/"',
  '$surfaceprop "flesh"',
  '$sequence "idle" "ref.smd" fps 1',
  "$lod 10",
  "{",
  '\treplacemodel "ref.smd" "lod1.smd"',
  '\treplacematerial "models/dev/mat_a" "models/dev/mat_b"',
  "}",
  "",
].join("\n");

interface LodsResult {
  lods: Array<{
    level: number;
    switchDistance: number;
    facial: boolean;
    materialReplacements: Array<{ materialIndex: number; from: string; to: string }>;
    boneReplacements: Array<{ from: string; to: string }>;
    removedModels: string[];
  }>;
}

describe.skipIf(!has.toolchain)("LOD material replacements", () => {
  it("reads a compiled replacematerial and writes it back through decompile", { timeout: 90_000 }, async () => {
    mkdirSync(outDir(), { recursive: true });
    writeFileSync(join(scratch, "ref.smd"), smd("mat_a", true), "latin1");
    writeFileSync(join(scratch, "lod1.smd"), smd("mat_a", false), "latin1");
    writeFileSync(join(scratch, "probe.qc"), QC, "latin1");

    const first = (await runStudiomdlTool.handler(
      { qc: join(scratch, "probe.qc"), timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(first.ok).toBe(true);
    expect(first.modelExists).toBe(true);

    const compiled = (await readModelLodsTool.handler(
      { model: "hsmcp_lodopts_test/probe.mdl" } as never,
      ctx,
    )) as unknown as LodsResult;
    expect(compiled.lods).toHaveLength(2);
    expect(compiled.lods[1]!.switchDistance).toBe(10);
    expect(compiled.lods[1]!.materialReplacements).toEqual([
      { materialIndex: 0, from: "models/dev/mat_a", to: "models/dev/mat_b" },
    ]);
    expect(compiled.lods[1]!.facial).toBe(false);

    const decompiled = (await decompileModelTool.handler(
      {
        path: join(outDir(), "probe.mdl"),
        outDir: join(scratch, "decompiled"),
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_lodopts_test/roundtrip.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const qc = readFileSync(decompiled.qc, "utf8");
    expect(qc).toContain('$lod 10');
    expect(qc).toContain('replacematerial "models/dev/mat_a" "models/dev/mat_b"');
    expect(qc).toContain("\tnofacial");

    const second = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean };
    expect(second.ok).toBe(true);

    const rebuilt = (await readModelLodsTool.handler(
      { model: "hsmcp_lodopts_test/roundtrip.mdl" } as never,
      ctx,
    )) as unknown as LodsResult;
    expect(rebuilt.lods[1]!.materialReplacements).toEqual(
      compiled.lods[1]!.materialReplacements,
    );
  });
});
