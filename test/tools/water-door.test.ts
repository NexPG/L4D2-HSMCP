import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { ctx as sharedCtx, has } from "../support/env.js";
import { writeVmfWaterTool } from "../../src/maps/typescript/tools/water.js";
import { placeDoorTool } from "../../src/maps/typescript/tools/door.js";

const ctx = sharedCtx as unknown as ToolContext;
const ready = has.sidecar && has.gameContent;
const made: string[] = [];

function emptyVmf(): string {
  const dir = mkdtempSync(join(tmpdir(), "hsmcp-water-"));
  made.push(dir);
  const path = join(dir, "test.vmf");
  writeFileSync(
    path,
    [
      "versioninfo",
      "{",
      '\t"mapversion" "1"',
      '\t"editorbuild" "8873"',
      "}",
      "world",
      "{",
      '\t"classname" "worldspawn"',
      '\t"skyname" "sky_l4d_rural02_hdr"',
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return path;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!ready)("write_vmf_water", () => {
  it("writes a Water-shader volume and a lod controller", async () => {
    const path = emptyVmf();
    const result = (await writeVmfWaterTool.handler(
      {
        path,
        mins: [-256, -256, -64],
        maxs: [256, 256, -4],
        material: "LIQUIDS/WATER_SWAMP_M1",
        targetname: "test_water",
        addLodControl: true,
        dryRun: false,
        backup: false,
        confirm: true,
      },
      ctx,
    )) as { written: boolean; shader: string | null; lodEntityId: number | null };
    const text = readFileSync(path, "utf8");
    expect(result.written).toBe(true);
    expect(result.shader).toBe("Water");
    expect(result.lodEntityId).not.toBeNull();
    expect(text).toContain('"classname" "func_water_analog"');
    expect(text).toContain('"classname" "water_lod_control"');
    expect(text).toContain("LIQUIDS/WATER_SWAMP_M1");
  }, 30_000);

  it("refuses a material that is not a Water shader", async () => {
    const path = emptyVmf();
    await expect(
      writeVmfWaterTool.handler(
        {
          path,
          mins: [0, 0, 0],
          maxs: [64, 64, 64],
          material: "CONCRETE/CINDERWALL02",
          addLodControl: true,
          dryRun: false,
          backup: false,
          confirm: true,
        },
        ctx,
      ),
    ).rejects.toThrow(/not Water/);
  }, 30_000);
});

describe.skipIf(!ready)("place_door", () => {
  it("puts the origin on the hinge and keeps the checkpoint name", async () => {
    const path = emptyVmf();
    const result = (await placeDoorTool.handler(
      {
        path,
        model: "models/props_doors/checkpoint_door_-02.mdl",
        classname: "prop_door_rotating_checkpoint",
        opening: { axis: "x", min: -32, max: 32, at: 208, floorZ: -160 },
        yaw: 90,
        targetname: "checkpoint_entrance",
        inset: 2,
        dryRun: false,
        backup: false,
        confirm: true,
      },
      ctx,
    )) as { written: boolean; origin: number[]; hinge: string; width: number; warnings: string[] };
    const text = readFileSync(path, "utf8");
    expect(result.written).toBe(true);
    expect(result.origin[0]).toBe(30);
    expect(result.hinge).toBe("max");
    expect(result.width).toBeCloseTo(58.331, 3);
    expect(result.warnings).toEqual([]);
    expect(text).toContain('"targetname" "checkpoint_entrance"');
    expect(text).toContain('"angles" "0 90 0"');
  });

  it("warns when a checkpoint door has the wrong name", async () => {
    const path = emptyVmf();
    const result = (await placeDoorTool.handler(
      {
        path,
        model: "models/props_doors/checkpoint_door_-02.mdl",
        classname: "prop_door_rotating_checkpoint",
        opening: { axis: "x", min: -32, max: 32, at: 0, floorZ: 0 },
        yaw: 90,
        targetname: "checkpoint_exit_door",
        inset: 2,
        dryRun: false,
        backup: false,
        confirm: true,
      },
      ctx,
    )) as { warnings: string[] };
    expect(result.warnings.join(" ")).toMatch(/checkpoint_exit/);
  });
});
