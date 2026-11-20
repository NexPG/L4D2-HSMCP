import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeQcTool } from "../../src/models/typescript/tools/qc.js";
import { checkModelTool } from "../../src/models/typescript/tools/check.js";
import { ctx as sharedCtx } from "../support/env.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-model-advanced-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function path(name: string): string {
  return join(scratch, name);
}

const BASE = {
  modelname: "props_test/advanced.mdl",
  body: [{ name: "Body", smd: "body.smd" }],
  cdmaterials: ["models/props_test"],
  staticprop: false,
  overwrite: true,
  confirm: true,
};

describe("write_qc advanced blocks", () => {
  it("writes bodygroups, LODs, hitboxes and bounding volumes", async () => {
    const file = path("advanced.qc");
    await writeQcTool.handler(
      {
        path: file,
        ...BASE,
        bodygroups: [
          {
            name: "skins",
            options: [{ studio: "a.smd" }, { blank: 1 }],
          },
        ],
        lods: [{ distance: 100, source: "high.smd", replace: "low.smd" }],
        hitboxSets: [
          {
            name: "default",
            boxes: [{ group: 0, bone: "bip_head", mins: [-3, -3, -3], maxs: [3, 3, 3] }],
          },
        ],
        bbox: { mins: [-10, -10, 0], maxs: [10, 10, 20] },
        cbox: { mins: [-5, -5, 0], maxs: [5, 5, 10] },
        illumposition: [0, 0, 10],
        eyeposition: [0, 0, 15],
      } as never,
      ctx,
    );
    const body = readFileSync(file, "utf8");
    expect(body).toContain('$bodygroup "skins"');
    expect(body).toContain('studio "a.smd"');
    expect(body).toContain("blank 1");
    expect(body).toContain("$lod 100");
    expect(body).toContain('replacemodel "high.smd" "low.smd"');
    expect(body).toContain('$hboxset "default"');
    expect(body).toContain('$hbox 0 "bip_head" -3 -3 -3 3 3 3');
    expect(body).toContain("$bbox -10 -10 0 10 10 20");
    expect(body).toContain("$cbox -5 -5 0 5 5 10");
    expect(body).toContain("$illumposition 0 0 10");
    expect(body).toContain("$eyeposition 0 0 15");
  });

  it("refuses a bodygroup option that is both studio and blank, and a bad LOD distance", async () => {
    expect(() =>
      writeQcTool.handler(
        {
          path: path("bad-bodygroup.qc"),
          ...BASE,
          bodygroups: [{ name: "x", options: [{ studio: "a.smd", blank: 1 }] }],
        } as never,
        ctx,
      ),
    ).toThrow(/studio or blank/);
    expect(() =>
      writeQcTool.handler(
        {
          path: path("bad-lod.qc"),
          ...BASE,
          lods: [{ distance: 0, source: "a.smd", replace: "b.smd" }],
        } as never,
        ctx,
      ),
    ).toThrow(/positive/);
  });
});

describe("check_model", () => {
  it("passes a QC with geometry and reports its advanced blocks", async () => {
    const file = path("check.qc");
    writeFileSync(
      file,
      '$modelname "props_test/check.mdl"\n' +
        '$body "Body" "body.smd"\n' +
        '$cdmaterials "models/props_test"\n' +
        '$bodygroup "skins"\n{\n\tstudio "a.smd"\n\tblank 1\n}\n' +
        '$lod 100\n{\n\treplacemodel "high.smd" "low.smd"\n}\n' +
        '$hboxset "default"\n$hbox 0 "bip_head" -3 -3 -3 3 3 3\n',
    );
    const result = (await checkModelTool.handler({ path: file } as never, ctx)) as unknown as {
      overall: string;
      bodygroups: number;
      lods: number;
      hitboxSets: number;
      sequences: number;
    };
    expect(result.bodygroups).toBe(1);
    expect(result.lods).toBe(1);
    expect(result.hitboxSets).toBe(1);
    expect(result.overall).not.toBe("fail");
  });

  it("fails a QC with no geometry", async () => {
    const file = path("empty.qc");
    writeFileSync(file, '$modelname "props_test/empty.mdl"\n$cdmaterials "models/props_test"\n');
    const result = (await checkModelTool.handler({ path: file } as never, ctx)) as unknown as {
      overall: string;
      findings: Array<{ rule: string }>;
    };
    expect(result.overall).toBe("fail");
    expect(result.findings.some((finding) => finding.rule === "qc-geometry")).toBe(true);
  });
});
