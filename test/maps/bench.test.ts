import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeTestBenchTool } from "../../src/maps/typescript/tools/bench.js";
import { writeDisplacementTool } from "../../src/maps/typescript/tools/displacement.js";
import { setLightmapScaleTool } from "../../src/maps/typescript/tools/optimise.js";
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

  it("refuses a displacement that vbsp cannot split", async () => {
    // A 2048 x 4608 floor at lightmap scale 16 is 288 luxels across; a displacement is not
    // split the way a brush face is, so vbsp exits with "Bad surface extents" and writes no
    // BSP. The writer must say that before the compile, with the two ways out.
    const path = join(scratch, "bench-big.vmf");
    await writeTestBenchTool.handler({ path, confirm: true } as never, ctx);
    expect(() =>
      writeDisplacementTool.handler(
        { path, solidIds: [2], power: 3, confirm: true } as never,
        ctx,
      ),
    ).toThrow(/Bad surface extents/);
  }, 30_000);

  it("writes a displacement that fits the lightmap budget", async () => {
    const path = join(scratch, "bench-disp.vmf");
    await writeTestBenchTool.handler(
      { path, width: 1024, length: 2048, height: 256, bays: 2, archWidth: 256, confirm: true } as never,
      ctx,
    );
    await setLightmapScaleTool.handler(
      { path, scale: 32, solidIds: [2], confirm: true } as never,
      ctx,
    );
    const written = (await writeDisplacementTool.handler(
      { path, solidIds: [2], power: 3, seal: true, confirm: true } as never,
      ctx,
    )) as { created: Array<{ power: number }>; sealed: unknown[] };
    expect(written.created.length).toBeGreaterThan(0);
    expect(written.sealed.length).toBeGreaterThan(0);
  }, 30_000);
});
