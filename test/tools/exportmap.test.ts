import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/registry.js";
import { exportMapTool } from "../../src/tools/exportmap.js";
import { FIXTURES, ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-map-export-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function probe(name: string): string {
  const path = join(scratch, name);
  copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), path);
  return path;
}

describe("export_vmf_map", () => {
  it("writes a .map next to the .vmf", async () => {
    const vmf = probe("probe.vmf");
    const out = join(scratch, "probe.map");
    const result = (await exportMapTool.handler(
      { vmf, out, overwrite: false, backup: false, confirm: true },
      ctx,
    )) as { written: boolean; brushes: number; faces: number; bytes: number };

    expect(result.written).toBe(true);
    expect(result.brushes).toBeGreaterThan(0);
    expect(result.faces).toBeGreaterThan(result.brushes);
    expect(result.bytes).toBeGreaterThan(0);
    const text = readFileSync(out, "utf8");
    expect(text).toContain('"classname" "worldspawn"');
    expect(text).toContain('"mapversion" "220"');
  });

  it("refuses to replace without overwrite, and does not write on a dry run", async () => {
    const vmf = probe("dry.vmf");
    const out = join(scratch, "dry.map");
    await exportMapTool.handler(
      { vmf, out, overwrite: false, backup: false, confirm: true },
      ctx,
    );
    const before = readFileSync(out, "utf8");
    expect(() =>
      exportMapTool.handler(
        { vmf, out, overwrite: false, backup: false, confirm: true },
        ctx,
      ),
    ).toThrow(/already exists/);

    const dry = (await exportMapTool.handler(
      { vmf, out, overwrite: true, dryRun: true, backup: false, confirm: true },
      ctx,
    )) as { written: boolean };
    expect(dry.written).toBe(false);
    expect(readFileSync(out, "utf8")).toBe(before);
  });
});
