import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { insertSolids } from "../../src/vmf/build.js";
import { checkVmfSolids } from "../../src/vmf/solid.js";
import { cloneSolidsTool } from "../../src/tools/modify.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-clone-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function map(name: string): string {
  const path = join(scratch, name);
  const built = insertSolids(EMPTY, [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }], {
    material: "BRICK/BRICKWALL001A",
  }).text;
  writeFileSync(path, built, "utf8");
  return path;
}

function boxId(path: string): number {
  return checkVmfSolids(path, readFileSync(path, "utf8")).solids[0]!.id!;
}

describe("clone_solids tool", () => {
  it("writes a copy and reports its new id", async () => {
    const path = map("plain.vmf");
    const id = boxId(path);
    const out = (await cloneSolidsTool.handler(
      { path, solidIds: [id], backup: false, confirm: true },
      ctx,
    )) as {
      written: boolean;
      clones: Array<{ sourceId: number; newId: number }>;
      solidsBefore: number;
      solidsAfter: number;
    };

    expect(out.written).toBe(true);
    expect(out.clones).toHaveLength(1);
    expect(out.solidsBefore).toBe(1);
    expect(out.solidsAfter).toBe(2);
    const after = checkVmfSolids(path, readFileSync(path, "utf8"));
    expect(after.solids.find((s) => s.id === out.clones[0]!.newId)?.valid).toBe(true);
  });

  it("applies one transform to the copy", async () => {
    const path = map("scaled.vmf");
    const id = boxId(path);
    const out = (await cloneSolidsTool.handler(
      {
        path,
        solidIds: [id],
        scale: { factor: [0.5, 0.5, 0.5], pivot: [32, 32, 32] },
        backup: false,
        confirm: true,
      },
      ctx,
    )) as { clones: Array<{ newId: number }> };

    const after = checkVmfSolids(path, readFileSync(path, "utf8"));
    const original = after.solids.find((s) => s.id === id)!;
    const clone = after.solids.find((s) => s.id === out.clones[0]!.newId)!;
    expect(clone.volume).toBeCloseTo(original.volume / 8, 3);
  });

  it("does not write on a dry run", async () => {
    const path = map("dry.vmf");
    const id = boxId(path);
    const before = readFileSync(path, "utf8");
    const out = (await cloneSolidsTool.handler(
      { path, solidIds: [id], dryRun: true, backup: false, confirm: true },
      ctx,
    )) as { written: boolean; unchanged: boolean };
    expect(out.written).toBe(false);
    expect(out.unchanged).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses count and a transform together", async () => {
    const path = map("many.vmf");
    const id = boxId(path);
    expect(() =>
      cloneSolidsTool.handler(
        { path, solidIds: [id], count: 2, move: [64, 0, 0], backup: false, confirm: true },
        ctx,
      ),
    ).toThrow(/transform applies to one copy/);
  });
});

