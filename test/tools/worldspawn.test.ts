import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { setWorldspawnTool } from "../../src/maps/typescript/tools/worldspawn.js";
import { FIXTURES, ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-worldspawn-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function probe(name: string): string {
  const path = join(scratch, name);
  copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), path);
  return path;
}

describe("set_worldspawn", () => {
  it("writes an arbitrary key and removes another", async () => {
    const path = probe("any.vmf");
    const before = checkVmfSolids(path, readFileSync(path, "utf8"));

    const out = (await setWorldspawnTool.handler(
      {
        path,
        set: { message: "HSMCP test map", custom_author: "Test Author" },
        remove: ["skyname"],
        backup: false,
        confirm: true,
      },
      ctx,
    )) as {
      written: boolean;
      changed: Record<string, { from: string | null; to: string }>;
      removed: string[];
      solidsBefore: number;
      solidsAfter: number;
    };

    expect(out.written).toBe(true);
    expect(out.changed["message"]).toEqual({ from: null, to: "HSMCP test map" });
    expect(out.removed).toEqual(["skyname"]);
    expect(out.solidsBefore).toBe(before.solidCount);
    expect(out.solidsAfter).toBe(before.solidCount);

    const text = readFileSync(path, "utf8");
    expect(text).toContain('"message" "HSMCP test map"');
    expect(text).toContain('"custom_author" "Test Author"');
    expect(text).not.toContain('"skyname"');
  });

  it("does not write on a dry run", async () => {
    const path = probe("dry.vmf");
    const before = readFileSync(path, "utf8");
    const out = (await setWorldspawnTool.handler(
      { path, set: { message: "x" }, dryRun: true, backup: false, confirm: true },
      ctx,
    )) as { written: boolean; unchanged: boolean };
    expect(out.written).toBe(false);
    expect(out.unchanged).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("refuses an empty call and a protected key", async () => {
    const path = probe("bad.vmf");
    expect(() =>
      setWorldspawnTool.handler({ path, backup: false, confirm: true }, ctx),
    ).toThrow(/no worldspawn keyvalues/);
    expect(() =>
      setWorldspawnTool.handler(
        { path, set: { id: "9" }, backup: false, confirm: true },
        ctx,
      ),
    ).toThrow(/identity/);
  });
});
