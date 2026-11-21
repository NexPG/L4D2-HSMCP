/**
 * Procedural bones: a quat-interp helper read from the MDL and written back as a `.vrd`.
 *
 * No stock L4D2 model carries one, so the test builds a probe with a helper/control pair,
 * compiles it, reads the rule, decompiles it (which writes the `.vrd` and the
 * `$proceduralbones` line), compiles again, and compares the triggers.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readMdlBones } from "../../src/models/typescript/formats/mdlbones.js";
import { readAttachments } from "../../src/models/typescript/formats/mdlmeta.js";
import { readProceduralBones } from "../../src/models/typescript/formats/mdlprocedural.js";
import { decompileModelTool } from "../../src/models/typescript/tools/decompile.js";
import { readModelProceduralTool } from "../../src/models/typescript/tools/procedural.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-vrd-"));
const outDir = (): string => join(ctx.config.gameDir!, "models", "hsmcp_vrd_test");
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(outDir(), { recursive: true, force: true });
});

const SMD = [
  "version 1",
  "nodes",
  '0 "root" -1',
  '1 "control" 0',
  '2 "helper" 0',
  "end",
  "skeleton",
  "time 0",
  "0 0.000000 0.000000 0.000000 0.000000 0.000000 0.000000",
  "1 0.000000 0.000000 10.000000 0.000000 0.000000 0.000000",
  "2 0.000000 0.000000 20.000000 0.000000 0.000000 0.000000",
  "end",
  "triangles",
  "mat",
  "0 0.000000 0.000000 0.000000 0.000000 0.000000 1.000000 0.000000 0.000000 1 1 1.000000",
  "0 10.000000 0.000000 0.000000 0.000000 0.000000 1.000000 1.000000 0.000000 1 1 1.000000",
  "2 0.000000 10.000000 20.000000 0.000000 0.000000 1.000000 0.500000 1.000000 1 2 1.000000",
  "end",
  "",
].join("\n");

const VRD = [
  "<helper> helper root root control",
  "<display> 1 1 1 0",
  "<basepos> 0 0 0",
  "<trigger> 30 0 0 0 0 0 0 0 0 0",
  "<trigger> 20 10 20 30 0 0 45 1 2 3",
  "",
].join("\n");

const QC = [
  '$modelname "hsmcp_vrd_test/probe.mdl"',
  '$proceduralbones "probe.vrd"',
  '$body "Body" "ref.smd"',
  '$cdmaterials "models/dev/"',
  '$surfaceprop "flesh"',
  '$sequence "idle" "ref.smd" fps 1',
  "",
].join("\n");

describe.skipIf(!has.toolchain)("procedural bone round trip", () => {
  it("reads a quat-interp helper and reproduces its triggers through a decompile", { timeout: 90_000 }, async () => {
    mkdirSync(outDir(), { recursive: true });
    writeFileSync(join(scratch, "ref.smd"), SMD, "latin1");
    writeFileSync(join(scratch, "probe.vrd"), VRD, "latin1");
    writeFileSync(join(scratch, "probe.qc"), QC, "latin1");
    const first = (await runStudiomdlTool.handler(
      { qc: join(scratch, "probe.qc"), timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean };
    expect(first.ok).toBe(true);

    const compiledPath = join(outDir(), "probe.mdl");
    const bytes = readFileSync(compiledPath);
    const entries = readProceduralBones(bytes, readMdlBones(bytes), readAttachments(bytes));
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    if (entry.kind !== "quatinterp") throw new Error("expected a quat-interp rule");
    expect(entry.boneName).toBe("helper");
    expect(entry.controlName).toBe("control");
    expect(entry.triggers).toHaveLength(2);
    expect(entry.triggers[0]!.inverseTolerance).toBeCloseTo(1 / ((30 * Math.PI) / 180), 5);
    expect(entry.triggers[0]!.position).toEqual([0, 0, 0]);
    expect(entry.triggers[1]!.position).toEqual([1, 2, 3]);
    expect(entry.triggers[1]!.quat[3]).toBeCloseTo(Math.cos((45 * Math.PI) / 360), 5);

    const read = (await readModelProceduralTool.handler({ path: compiledPath } as never, ctx)) as {
      count: number;
      vrd: string;
    };
    expect(read.count).toBe(1);
    expect(read.vrd).toContain("<helper> helper root root control");
    expect(read.vrd).toContain("<trigger> 30.000000 0.000000 0.000000");
    expect(read.vrd).toContain("<trigger> 20.000000 9.999999 20.000001 30.000002");

    const decompiled = (await decompileModelTool.handler(
      {
        path: compiledPath,
        outDir: join(scratch, "decompiled"),
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_vrd_test/roundtrip.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    expect(readFileSync(decompiled.qc, "utf8")).toContain('$proceduralbones "probe_procedural.vrd"');
    expect(readFileSync(join(scratch, "decompiled", "probe_procedural.vrd"), "utf8")).toContain(
      "<display> 1 1 1 0",
    );
    const second = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean };
    expect(second.ok).toBe(true);
    const againBytes = readFileSync(join(outDir(), "roundtrip.mdl"));
    const again = readProceduralBones(
      againBytes,
      readMdlBones(againBytes),
      readAttachments(againBytes),
    )[0]!;
    if (again.kind !== "quatinterp") throw new Error("expected a quat-interp rule");
    expect(again.controlName).toBe("control");
    expect(again.triggers).toHaveLength(2);
    for (let index = 0; index < 2; index += 1) {
      expect(again.triggers[index]!.inverseTolerance).toBeCloseTo(
        entry.triggers[index]!.inverseTolerance,
        4,
      );
      for (let axis = 0; axis < 3; axis += 1) {
        expect(again.triggers[index]!.position[axis]).toBeCloseTo(
          entry.triggers[index]!.position[axis]!,
          4,
        );
      }
    }
  });
});
