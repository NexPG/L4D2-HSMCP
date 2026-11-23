import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeTestBenchTool } from "../../src/maps/typescript/tools/bench.js";
import { runCompile } from "../../src/maps/typescript/tools/compile.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-bench-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("write_test_bench", () => {
  it("builds a sealed hall with a FINALE end, not a bare CHECKPOINT", async () => {
    const path = join(scratch, "bench.vmf");
    const result = (await writeTestBenchTool.handler(
      { path, width: 1024, length: 2048, height: 256, bays: 2, archWidth: 256, confirm: true } as never,
      ctx,
    )) as {
      solidCount: number;
      entities: { playerStart: number | null; finale: number | null };
      finaleRegion: { id: number | null };
    };

    expect(result.solidCount).toBeGreaterThanOrEqual(8);
    expect(result.entities.playerStart).not.toBeNull();
    expect(result.entities.finale).not.toBeNull();
    expect(result.finaleRegion.id).not.toBeNull();

    const text = readFileSync(path, "utf8");
    expect(text).toContain('"classname" "info_player_start"');
    expect(text).toContain('"classname" "info_director"');
    expect(text).toContain('"classname" "info_zombie_spawn"');
    expect(text).toContain('"classname" "trigger_finale"');
    // The goal a chapter needs: FINALE (64) with the trigger above. A CHECKPOINT region with
    // no checkpoint door and no info_changelevel is what paints NAV ERRORS on screen.
    expect(text).toContain('"classname" "func_nav_attribute_region"');
    expect(text).toContain('"spawnflags" "64"');
    expect(text).not.toContain("info_changelevel");
    expect(text).not.toContain('"spawnflags" "2048"');
  }, 30_000);

  it.skipIf(!has.toolchain)("compiles without a leak", async () => {
    const path = join(scratch, "bench-compile.vmf");
    await writeTestBenchTool.handler(
      { path, width: 1024, length: 2048, height: 256, bays: 2, archWidth: 256, confirm: true } as never,
      ctx,
    );
    const compiled = (await runCompile.handler(
      { vmf: path, fast: true, stages: ["vbsp"], hdr: false, toolchain: "stock", confirm: true } as never,
      ctx,
    )) as { ok: boolean; bsp: string };
    expect(compiled.ok).toBe(true);
    expect(compiled.bsp.toLowerCase()).toContain("bench-compile");
  }, 180_000);
});
