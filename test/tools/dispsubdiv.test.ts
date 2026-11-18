import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { readDisplacements } from "../../src/maps/typescript/vmf/displacement.js";
import { writeDisplacements } from "../../src/maps/typescript/vmf/dispwrite.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { subdivideDisplacementsTool } from "../../src/maps/typescript/tools/displacement.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-dispsubdiv-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function terrain(name: string): { path: string; id: number } {
  const built = insertSolids(
    EMPTY,
    [{ shape: "box", mins: [0, 0, 0], maxs: [256, 256, 64] }],
    { material: "NATURE/BLENDROCKGRASS001A" },
  );
  const id = checkVmfSolids("x", built.text).solids[0]!.id!;
  const text = writeDisplacements(
    built.text,
    { solidIds: [id], facing: "up" },
    { power: 2, height: (x) => x * 4 },
  ).text;
  const path = join(scratch, name);
  writeFileSync(path, text, "utf8");
  return { path, id };
}

describe("subdivide_displacements tool", () => {
  it("writes a higher-power displacement", async () => {
    const { path, id } = terrain("up.vmf");
    const out = (await subdivideDisplacementsTool.handler(
      { path, solidIds: [id], power: 3, backup: false, confirm: true },
      ctx,
    )) as { written: boolean; matched: number; subdivided: unknown[] };

    expect(out.written).toBe(true);
    expect(out.matched).toBe(1);
    expect(out.subdivided).toHaveLength(1);
    const after = readDisplacements(readFileSync(path, "utf8")).displacements[0]!;
    expect(after.power).toBe(3);
    expect(after.size).toBe(9);
  });

  it("does not write on a dry run", async () => {
    const { path, id } = terrain("dry.vmf");
    const before = readFileSync(path, "utf8");
    const out = (await subdivideDisplacementsTool.handler(
      { path, solidIds: [id], power: 4, dryRun: true, backup: false, confirm: true },
      ctx,
    )) as { written: boolean; unchanged: boolean };
    expect(out.written).toBe(false);
    expect(out.unchanged).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses a lower power", async () => {
    const { path, id } = terrain("lower.vmf");
    expect(() =>
      subdivideDisplacementsTool.handler(
        { path, solidIds: [id], power: 3, backup: false, confirm: true },
        ctx,
      ),
    ).not.toThrow();
    expect(() =>
      subdivideDisplacementsTool.handler(
        { path, solidIds: [id], power: 3, backup: false, confirm: true },
        ctx,
      ),
    ).toThrow(/already power/);
  });
});
