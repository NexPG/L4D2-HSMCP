import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readDisplacements } from "../../src/maps/typescript/vmf/displacement.js";
import { writeVmfTerrain } from "../../src/maps/typescript/tools/terrain.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-terrain-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A world with no shell: the tool test reads the VMF, it does not compile it. */
const WORLD =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

describe("write_vmf_terrain slope", () => {
  it("runs one ramp across the patch instead of one sawtooth per cell", async () => {
    const path = join(scratch, "beach.vmf");
    writeFileSync(path, WORLD);
    await writeVmfTerrain.handler(
      {
        path,
        mins: [0, 0],
        maxs: [512, 256],
        floorZ: 0,
        thickness: 16,
        cellSize: 128,
        power: 2,
        noise: 0,
        slope: { from: 0, to: 128, along: "x" },
        seal: false,
        confirm: true,
      } as never,
      ctx,
    );

    const r = readDisplacements(readFileSync(path, "utf8"));
    expect(r.displacements).toHaveLength(8);
    // A per-cell `slope` would put every cell's left edge at 0 and right edge at 128.
    // One plane puts x=0 at 0 and x=512 at 128, so the cells in between climb continuously.
    const columns = new Map<number, number>();
    for (const d of r.displacements) {
      for (const v of d.vertices) {
        const x = Math.round(v.flat[0]);
        const level = Math.round(v.distance);
        const seen = columns.get(x);
        if (seen === undefined) columns.set(x, level);
        else expect(level, `x=${x} height is shared by every grid`).toBe(seen);
      }
    }
    expect([...columns.keys()].sort((a, b) => a - b)).toEqual(
      [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512],
    );
    for (const [x, level] of columns) expect(level, `x=${x}`).toBe(Math.round(x / 4));
    expect(r.seams).toEqual([]);
  });

  it("forms a dune from a profile and returns to the land at both edges", async () => {
    const path = join(scratch, "dune-profile.vmf");
    writeFileSync(path, WORLD);
    await writeVmfTerrain.handler(
      {
        path,
        mins: [0, 0],
        maxs: [512, 256],
        floorZ: 0,
        thickness: 16,
        cellSize: 256,
        power: 3,
        noise: 0,
        profile: {
          along: "x",
          points: [
            { at: 0, height: 0 },
            { at: 256, height: 48 },
            { at: 512, height: 0 },
          ],
        },
        seal: false,
        confirm: true,
      } as never,
      ctx,
    );
    const d = readDisplacements(readFileSync(path, "utf8")).displacements;
    const all = d.flatMap((x) => x.vertices);
    expect(Math.max(...all.map((v) => v.distance))).toBeCloseTo(48, 4);
    expect(Math.min(...all.map((v) => v.distance))).toBeCloseTo(0, 4);
    expect(readDisplacements(readFileSync(path, "utf8")).seams).toEqual([]);
  });

  it("refuses slope and profile together", async () => {
    const path = join(scratch, "both.vmf");
    writeFileSync(path, WORLD);
    await expect(
      writeVmfTerrain.handler(
        {
          path,
          mins: [0, 0],
          maxs: [256, 256],
          floorZ: 0,
          slope: { from: 0, to: 16, along: "x" },
          profile: { along: "x", points: [{ at: 0, height: 0 }, { at: 256, height: 16 }] },
          seal: false,
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/slope or profile/);
  });

  it("keeps the ramp when noise is added on top", async () => {
    const path = join(scratch, "dune.vmf");
    writeFileSync(path, WORLD);
    await writeVmfTerrain.handler(
      {
        path,
        mins: [0, 0],
        maxs: [256, 256],
        floorZ: 0,
        thickness: 16,
        cellSize: 256,
        power: 3,
        noise: 16,
        slope: { from: 0, to: 48, along: "y" },
        seal: false,
        confirm: true,
      } as never,
      ctx,
    );
    const d = readDisplacements(readFileSync(path, "utf8")).displacements[0]!;
    expect(d.maxDistance).toBeGreaterThan(48);
    expect(d.minDistance).toBeLessThan(0);
  });
});
