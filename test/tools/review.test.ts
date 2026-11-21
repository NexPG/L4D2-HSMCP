import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { reviewMapTool } from "../../src/maps/typescript/tools/review.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-review-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SKELETON =
  `versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n\t"prefab" "0"\n}\n` +
  `visgroups\n{\n}\n` +
  `world\n{\n\t"id" "1"\n\t"mapversion" "1"\n\t"classname" "worldspawn"\n` +
  `\t"skyname" "sky_l4d_c1_1_hdr"\n}\n` +
  `entity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n` +
  `entity\n{\n\t"id" "3"\n\t"classname" "light"\n\t"origin" "0 0 128"\n\t"_light" "255 255 255 200"\n}\n`;

const SHELL = [
  { shape: "box" as const, mins: [-288, -288, -32] as [number, number, number], maxs: [288, 288, 0] as [number, number, number] },
  { shape: "box" as const, mins: [-288, -288, 256] as [number, number, number], maxs: [288, 288, 288] as [number, number, number] },
  { shape: "box" as const, mins: [-288, -288, 0] as [number, number, number], maxs: [-256, 288, 256] as [number, number, number] },
  { shape: "box" as const, mins: [256, -288, 0] as [number, number, number], maxs: [288, 288, 256] as [number, number, number] },
  { shape: "box" as const, mins: [-256, -288, 0] as [number, number, number], maxs: [256, -256, 256] as [number, number, number] },
  { shape: "box" as const, mins: [-256, 256, 0] as [number, number, number], maxs: [256, 288, 256] as [number, number, number] },
];

const room = (): string =>
  insertSolids(SKELETON, SHELL, { material: "DEV/DEV_MEASUREGENERIC01" }).text;

type Review = {
  vmf: string;
  bsp: string | null;
  verdict: string;
  counts: { errors: number; warnings: number; skipped: number };
  sections: Record<string, { ran: boolean; ok: boolean; error: string | null } | null>;
};

describe("review_map", () => {
  it("runs the offline sections and leaves the compiled ones null when there is no BSP", { timeout: 30_000 }, async () => {
    const path = join(scratch, "uncompiled.vmf");
    writeFileSync(path, room());

    const r = (await reviewMapTool.handler({ vmf: path, limit: 20 } as never, ctx)) as unknown as Review;
    expect(r.vmf).toBe(path);
    expect(r.bsp).toBeNull();
    expect(r.sections.organisation?.ran).toBe(true);
    expect(r.sections.rules?.ran).toBe(true);
    // Lint needs the sidecar and the game; it must be present as a section either way, and
    // a failure must carry its reason rather than vanish.
    expect(r.sections.lint).not.toBeNull();
    if (!r.sections.lint!.ran) expect(r.sections.lint!.error).toBeTruthy();
    expect(r.sections.report).toBeNull();
    expect(["clean", "warning", "error", "incomplete"]).toContain(r.verdict);
    expect(r.counts.errors).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!has.toolchain)(
    "reads a compiled sibling's budget, lightmap and visleaf sections",
    async () => {
      const path = join(scratch, "compiled.vmf");
      writeFileSync(path, room());
      const out = (await runCompile.handler(
        {
          vmf: path,
          fast: true,
          hdr: false,
          stages: ["vbsp"],
          toolchain: "stock",
          cull: false,
          timeoutMinutes: 10,
          confirm: true,
        } as never,
        ctx,
      )) as { bspExists: boolean };
      expect(out.bspExists).toBe(true);

      const r = (await reviewMapTool.handler({ vmf: path, limit: 20 } as never, ctx)) as unknown as Review;
      expect(r.bsp).toBe(path.replace(/\.vmf$/, ".bsp"));
      expect(r.sections.report?.ran).toBe(true);
      expect(r.sections.lightmap?.ran).toBe(true);
      expect(r.sections.visleaf?.ran).toBe(true);
    },
    300_000,
  );
});
