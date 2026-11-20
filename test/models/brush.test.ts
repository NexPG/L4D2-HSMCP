/**
 * Brush -> model, the Propper++ path.
 *
 * The brush is written by the repository's own VMF writer (`insertSolids`) and read back by
 * the independent oracle (`checkVmfSolids`), so the geometry in this test is not a hand-made
 * fixture that could share a sign error with the converter. The UV assertion is the VMF
 * formula: `uaxis "[1 0 0 0] 0.25"` on a 512 texture means one repeat per 128 units, and the
 * SMD V is inverted once for studiomdl.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { loadQc } from "../../src/formats/typescript/formats/qc.js";
import { readModelInfoTool } from "../../src/assets/typescript/tools/content.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { brushToModelTool } from "../../src/models/typescript/tools/brush.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { FIXTURES, config, ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-brush-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const installed = has.sidecar;

/** A 64x64x64 box on the floor, written by the VMF builder and then read back. */
function boxVmf(name: string): { path: string; solidId: number } {
  const base = readFileSync(join(FIXTURES, "hmcp_probe.vmf"), "utf8");
  const inserted = insertSolids(
    base,
    [{ shape: "box", mins: [-32, -32, 0], maxs: [32, 32, 64] }],
    { material: "BRICK/BRICKWALL003A", textureScale: 0.25 },
  );
  const path = join(scratch, `${name}.vmf`);
  writeFileSync(path, inserted.text);
  return { path, solidId: inserted.solidIds[0]! };
}

interface SmdRead {
  boneCount: number;
  triangleCount: number;
  triangles?: {
    material: string;
    vertices: { position: number[]; normal: number[]; uv: number[] }[];
  }[];
}

const BASE_ARGS = {
  scale: 1,
  textureSize: 512,
  flipV: true,
  overwrite: true,
  confirm: true,
} as const;

describe.skipIf(!installed)("brush_to_model", () => {
  it("triangulates the brush, derives the material directories and computes VMF UVs", async () => {
    const { path, solidId } = boxVmf("uv");
    const smd = join(scratch, "uv.smd");
    const result = (await brushToModelTool.handler(
      {
        vmf: path,
        solids: [solidId],
        output: smd,
        origin: "world",
        ...BASE_ARGS,
        collision: "brush",
      },
      ctx,
    )) as {
      triangles: number;
      vertices: number;
      mins: number[];
      maxs: number[];
      originShift: number[];
      materials: { name: string; smd: string; triangles: number }[];
      collision: { triangles: number; concave: boolean; verified: boolean } | null;
      verified: boolean;
    };
    expect(result.triangles).toBe(12);
    expect(result.vertices).toBe(36);
    expect(result.mins).toEqual([-32, -32, 0]);
    expect(result.maxs).toEqual([32, 32, 64]);
    expect(result.originShift).toEqual([0, 0, 0]);
    expect(result.materials).toEqual([
      { name: "brick/brickwall003a", smd: "brickwall003a", triangles: 12, textureSize: 512 },
    ]);
    expect(result.collision).toMatchObject({ triangles: 12, concave: false, verified: true });
    expect(result.verified).toBe(true);

    const read = await callSidecar<SmdRead>("smd_read", { path: smd, includeTriangles: true }, config);
    expect(read.triangleCount).toBe(12);
    expect(read.boneCount).toBe(1);
    const vertices = read.triangles!.flatMap((triangle) => triangle.vertices);
    const top = vertices.find(
      (vertex) =>
        Math.abs(vertex.position[0]! - 32) < 1e-6 &&
        Math.abs(vertex.position[1]! - 32) < 1e-6 &&
        Math.abs(vertex.position[2]! - 64) < 1e-6,
    );
    expect(top).toBeDefined();
    // u = 32 / (0.25 * 512) = 0.25; v = -32 / (0.25 * 512) = -0.25, then SMD flips it.
    expect(top!.uv[0]).toBeCloseTo(0.25, 6);
    expect(top!.uv[1]).toBeCloseTo(1.25, 6);
  });

  it("moves the origin to the centre and writes the QC with the brush collision", async () => {
    const { path, solidId } = boxVmf("qc");
    const smd = join(scratch, "qc.smd");
    const qc = join(scratch, "qc.qc");
    const result = (await brushToModelTool.handler(
      {
        vmf: path,
        solids: [solidId],
        output: smd,
        origin: "center",
        ...BASE_ARGS,
        collision: "brush",
        qc: {
          path: qc,
          modelname: "props_test/box.mdl",
          surfaceprop: "brick",
          staticprop: true,
          sequence: "idle",
          fps: 30,
          mass: 25,
          overwrite: true,
        },
      },
      ctx,
    )) as {
      mins: number[];
      maxs: number[];
      originShift: number[];
      qc: { body: string; collision: string | null; diagnostics: { severity: string }[] };
    };
    expect(result.originShift).toEqual([0, 0, -32]);
    expect(result.mins).toEqual([-32, -32, -32]);
    expect(result.maxs).toEqual([32, 32, 32]);
    expect(result.qc.body).toBe("qc.smd");
    expect(result.qc.collision).toBe("qc_phys.smd");
    expect(result.qc.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    const text = readFileSync(qc, "utf8");
    expect(text).toContain('$modelname "props_test/box.mdl"');
    expect(text).toContain('$cdmaterials "brick/"');
    expect(text).toContain('$staticprop');
    expect(text).toContain('$sequence "idle" "qc.smd" fps 30');
    expect(text).toContain('$collisionmodel "qc_phys.smd"');
    expect(text).toContain("$mass 25");
    expect(loadQc(qc).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("refuses a solid id that is not in the file", async () => {
    const { path } = boxVmf("missing");
    await expect(
      brushToModelTool.handler(
        {
          vmf: path,
          solids: [999999],
          output: join(scratch, "missing.smd"),
          origin: "center",
          ...BASE_ARGS,
          collision: "none",
        },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe.skipIf(!installed || !has.toolchain)("brush -> SMD -> studiomdl", () => {
  it(
    "compiles the converted brush and proves the .phy exists",
    async () => {
      const { path, solidId } = boxVmf("compile");
      const smd = join(scratch, "compile.smd");
      const qc = join(scratch, "compile.qc");
      const unique = `hsmcp_brush_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
      let compiledModel: string | null = null;

      try {
        const converted = (await brushToModelTool.handler(
          {
            vmf: path,
            solids: [solidId],
            output: smd,
            origin: "center",
            ...BASE_ARGS,
            collision: "brush",
            qc: {
              path: qc,
              modelname: `${unique}/box.mdl`,
              surfaceprop: "brick",
              staticprop: true,
              sequence: "idle",
              fps: 30,
              mass: 25,
              overwrite: true,
            },
          },
          ctx,
        )) as { qc: { diagnostics: { severity: string }[] } };
        expect(converted.qc.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

        const compile = (await runStudiomdlTool.handler(
          { qc, timeoutMinutes: 2, confirm: true },
          ctx,
        )) as {
          ok: boolean;
          model: string | null;
          warning: string | null;
          compiler: "studiomdl++" | "studiomdl";
          files: { name: string }[];
        };
        compiledModel = compile.model;
        expect(compile.warning).toBeNull();
        expect(compile.ok).toBe(true);
        expect(["studiomdl++", "studiomdl"]).toContain(compile.compiler);
        expect(compile.files.map((f) => f.name)).toEqual(
          expect.arrayContaining(["box.mdl", "box.vvd", "box.dx90.vtx", "box.phy"]),
        );

        const info = (await readModelInfoTool.handler({ model: `models/${unique}/box.mdl` }, ctx)) as {
          found: boolean;
          boneCount: number;
          hasPhysics: boolean;
          skins: string[][];
          cdmaterials: string[];
        };
        expect(info.found).toBe(true);
        expect(info.boneCount).toBe(1);
        expect(info.hasPhysics).toBe(true);
        // The skin keeps the SMD material name and the QC's directory. The .vmt itself is
        // not required to exist for the model to compile; a missing one is a checkerboard.
        expect(info.skins).toContainEqual(["brickwall003a"]);
        expect(info.cdmaterials).toContain("brick/");
      } finally {
        const folder = compiledModel
          ? dirname(compiledModel)
          : config.gameDir
            ? join(config.gameDir, "models", unique)
            : null;
        if (folder && existsSync(folder) && folder.toLowerCase().includes(unique.toLowerCase())) {
          rmSync(folder, { recursive: true, force: true });
        }
      }
    },
    120_000,
  );
});
