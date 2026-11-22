/**
 * `collapse_instances` is a wrapper around the sidecar's `vmf_collapse`, which delegates to
 * `srctools.instancing`. Keeping a second expander here was duplication of a tested library;
 * these tests exercise the wrapper (paths, guarded write, counts) and leave the expansion
 * semantics to srctools, which the reference oracle test in the delete history used to pin.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { emptyVmf } from "../../src/maps/typescript/vmf/skeleton.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { collapseInstancesTool } from "../../src/maps/typescript/tools/instancecollapse.js";
import { ctx as sharedCtx, has } from "../support/env.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-collapse-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function box(text: string, mins: [number, number, number], maxs: [number, number, number]): string {
  return insertSolids(text, [{ shape: "box", mins, maxs }], {
    material: "BRICK/BRICKWALL001A",
  }).text;
}

function entity(
  text: string,
  id: number,
  classname: string,
  keyvalues: Record<string, string>,
): string {
  return (
    text +
    [
      "entity",
      "{",
      `\t"id" "${id}"`,
      `\t"classname" "${classname}"`,
      ...Object.entries(keyvalues).map(([key, value]) => `\t"${key}" "${value}"`),
      "}",
      "",
    ].join("\n")
  );
}

describe.skipIf(!has.sidecar)("collapse_instances", () => {
  it("writes the expanded map through the guarded path", async () => {
    const inner = entity(box(emptyVmf(), [0, 0, 0], [16, 16, 16]), 800, "info_target", {
      targetname: "marker",
      origin: "1 2 3",
    });
    writeFileSync(join(scratch, "inner.vmf"), inner);
    const target = entity(emptyVmf(), 700, "func_instance", {
      file: "inner.vmf",
      targetname: "room",
      origin: "0 0 0",
      angles: "0 0 0",
      fixup_style: "0",
    });
    const path = join(scratch, "target.vmf");
    const out = join(scratch, "out.vmf");
    writeFileSync(path, target);
    const r = (await collapseInstancesTool.handler(
      { path, out, confirm: true, backup: false, dryRun: false, maxDepth: 16 } as never,
      ctx,
    )) as { written: boolean; collapsed: number; solidCount: number; files: string[] };

    expect(r.written).toBe(true);
    expect(r.collapsed).toBe(1);
    expect(r.solidCount).toBe(1);
    expect(r.files).toHaveLength(1);
    const written = readFileSync(out, "utf8");
    expect(written).toContain('"targetname" "room-marker"');
    expect(written).not.toContain('"classname" "func_instance"');
    expect(checkVmfSolids(out, written).solidCount).toBe(1);
  });

  it("names a missing instance file", async () => {
    const target = entity(emptyVmf(), 700, "func_instance", {
      file: "no_such_instance.vmf",
      targetname: "missing",
      origin: "0 0 0",
      angles: "0 0 0",
      fixup_style: "0",
    });
    const path = join(scratch, "missing.vmf");
    writeFileSync(path, target);
    await expect(
      collapseInstancesTool.handler(
        { path, confirm: true, backup: false, dryRun: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/instance file not found: no_such_instance\.vmf/);
  });
});
