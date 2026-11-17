import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { insertSolids } from "../../src/vmf/build.js";
import { checkVmfSolids } from "../../src/vmf/solid.js";
import { insertPrefabTool } from "../../src/tools/prefab.js";
import { FIXTURES, ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-prefab-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

function files(): { target: string; prefab: string } {
  const target = join(scratch, "target.vmf");
  copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), target);
  const box = insertSolids(EMPTY, [{ shape: "box", mins: [0, 0, 0], maxs: [32, 32, 32] }], {
    material: "BRICK/BRICKWALL001A",
  }).text;
  const prefab = join(scratch, "prefab.vmf");
  writeFileSync(
    prefab,
    `${box}entity\n{\n\t"id" "7"\n\t"classname" "info_target"\n\t"targetname" "prefab_entity"\n\t"origin" "0 0 0"\n\t"angles" "0 0 0"\n}\n`,
    "utf8",
  );
  return { target, prefab };
}

describe("insert_prefab", () => {
  it("writes the prefab and reports counts", async () => {
    const { target, prefab } = files();
    const before = checkVmfSolids(target, readFileSync(target, "utf8")).solidCount;
    const out = (await insertPrefabTool.handler(
      { path: target, prefab, move: [0, 0, 32], rotate: 90, pivot: [0, 0, 0], backup: false, dryRun: false, confirm: true },
      ctx,
    )) as { written: boolean; solids: number; entities: number; solidsAfter: number };

    expect(out.written).toBe(true);
    expect(out.solids).toBe(1);
    expect(out.entities).toBe(1);
    expect(out.solidsAfter).toBe(before + 1);
    const text = readFileSync(target, "utf8");
    expect(text).toContain('"targetname" "prefab_entity"');
    expect(text).toContain('"origin" "0 0 32"');
    expect(text).toContain('"angles" "0 90 0"');
    expect(checkVmfSolids(target, text).validCount).toBeGreaterThan(0);
  });

  it("does not write on a dry run", async () => {
    const { target, prefab } = files();
    const before = readFileSync(target, "utf8");
    const out = (await insertPrefabTool.handler(
      { path: target, prefab, dryRun: true, backup: false, confirm: true },
      ctx,
    )) as { written: boolean };
    expect(out.written).toBe(false);
    expect(readFileSync(target, "utf8")).toBe(before);
  });
});
