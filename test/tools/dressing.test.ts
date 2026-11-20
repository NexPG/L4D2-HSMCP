import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  writeDecalTool,
  writeLightTool,
  writePostprocessTool,
  writeRopeTool,
  writeSpriteTool,
} from "../../src/maps/typescript/tools/dressing.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-dress-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

function map(): string {
  const path = join(scratch, `map-${Math.round(performance.now() * 1000)}.vmf`);
  writeFileSync(path, SEED);
  return path;
}

const entities = (path: string) => readEntities(readFileSync(path, "utf8")).entities;

describe("write_light", async () => {
  it("writes a point light as the colour and brightness Source reads", async () => {
    const path = map();
    const r = (await writeLightTool.handler(
      {
        path,
        kind: "point",
        origin: [0, 0, 64],
        color: [255, 200, 100],
        brightness: 300,
        targetname: "lamp",
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number; keyvalues: Record<string, string> };
    const e = entities(path).find((entity) => entity.id === r.entityId)!;
    expect(e.classname).toBe("light");
    expect(e.keyvalues["_light"]).toBe("255 200 100 300");
    expect(e.keyvalues["targetname"]).toBe("lamp");
  });

  it("writes a light_environment with ambient and angles", async () => {
    const path = map();
    const r = (await writeLightTool.handler(
      {
        path,
        kind: "environment",
        origin: [0, 0, 128],
        angles: [-45, 30, 0],
        color: [255, 240, 220],
        brightness: 400,
        ambient: [100, 120, 150],
        ambientBrightness: 30,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    const e = entities(path).find((entity) => entity.id === r.entityId)!;
    expect(e.classname).toBe("light_environment");
    expect(e.keyvalues["_ambient"]).toBe("100 120 150 30");
    expect(e.keyvalues["angles"]).toBe("-45 30 0");
    expect(e.keyvalues["pitch"]).toBe("-45");
  });

  it("refuses an origin outside the world", async () => {
    const path = map();
    await expect(
      writeLightTool.handler(
        { path, kind: "point", origin: [20000, 0, 0], confirm: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/world/);
  });
});

describe("write_postprocess", async () => {
  it("wires a tonemap controller to a logic_auto with repeated OnMapSpawn outputs", async () => {
    const path = map();
    const r = (await writePostprocessTool.handler(
      {
        path,
        kind: "tonemap",
        exposureMin: 0.5,
        exposureMax: 2,
        bloomScale: 1.2,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { controllerId: number; logicAutoId: number };
    const text = readFileSync(path, "utf8");
    expect(entities(path).find((e) => e.id === r.controllerId)?.classname).toBe(
      "env_tonemap_controller",
    );
    expect(entities(path).find((e) => e.id === r.logicAutoId)?.classname).toBe("logic_auto");
    expect(text.match(/"OnMapSpawn"/g)).toHaveLength(3);
    expect(text).toContain("SetAutoExposureMin,0.5,0,-1");
    expect(text).toContain("SetBloomScale,1.2,0,-1");
  });

  it("writes a fade with its duration and colour", async () => {
    const path = map();
    const r = (await writePostprocessTool.handler(
      { path, kind: "fade", duration: 3, amount: 200, color: [10, 20, 30], confirm: true } as never,
      ctx,
    )) as unknown as { entityId: number };
    const e = entities(path).find((x) => x.id === r.entityId)!;
    expect(e.classname).toBe("env_fade");
    expect(e.keyvalues["duration"]).toBe("3");
    expect(e.keyvalues["rendercolor"]).toBe("10 20 30");
  });

  it("writes the L4D2 colour-correction class, not the other games' spelling", async () => {
    const path = map();
    const r = (await writePostprocessTool.handler(
      {
        path,
        kind: "colorcorrection",
        correctionFile: "materials/color_correction/dawn.raw",
        minFalloff: 200,
        maxFalloff: 1200,
        maxWeight: 0.8,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number; warnings: string[] };
    const e = entities(path).find((x) => x.id === r.entityId)!;
    expect(e.classname).toBe("color_correction");
    expect(e.keyvalues["filename"]).toBe("materials/color_correction/dawn.raw");
    expect(e.keyvalues["minfalloff"]).toBe("200");
    expect(e.keyvalues["maxfalloff"]).toBe("1200");
    expect(r.warnings).toEqual([]);
  });
});

describe("write_decal, write_rope, write_sprite", () => {
  it("places several decals with one material", async () => {
    const path = map();
    const r = (await writeDecalTool.handler(
      {
        path,
        material: "decals/blood1",
        positions: [
          [0, 0, 1],
          [32, 0, 1],
        ],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { ids: number[]; count: number };
    expect(r.count).toBe(2);
    const placed = entities(path).filter((e) => r.ids.includes(e.id!));
    expect(placed.map((e) => e.classname)).toEqual(["infodecal", "infodecal"]);
    expect(placed.every((e) => e.keyvalues["texture"] === "decals/blood1")).toBe(
      true,
    );
  });

  it("links a move_rope to its keyframe_rope", async () => {
    const path = map();
    const r = (await writeRopeTool.handler(
      {
        path,
        start: [0, 0, 128],
        end: [128, 0, 128],
        material: "cable/cable.vmt",
        width: 3,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { startId: number; endId: number; startName: string; endName: string };
    const start = entities(path).find((e) => e.id === r.startId)!;
    const end = entities(path).find((e) => e.id === r.endId)!;
    expect(start.classname).toBe("move_rope");
    expect(end.classname).toBe("keyframe_rope");
    expect(start.keyvalues["NextKey"]).toBe(r.endName);
    expect(end.keyvalues["targetname"]).toBe(r.endName);
    expect(start.keyvalues["Width"]).toBe("3");
  });

  it("creates the two info_targets a beam needs", async () => {
    const path = map();
    const r = (await writeSpriteTool.handler(
      {
        path,
        kind: "beam",
        start: [0, 0, 64],
        end: [128, 0, 64],
        texture: "sprites/laserbeam.spr",
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { ids: number[]; classes: string[] };
    expect(r.classes).toEqual(["info_target", "info_target", "env_beam"]);
    const placed = entities(path).filter((e) => r.ids.includes(e.id!));
    expect(placed.map((e) => e.classname)).toEqual(["info_target", "info_target", "env_beam"]);
    const beam = placed[2]!;
    expect(beam.keyvalues["LightningStart"]).toBeTruthy();
    expect(beam.keyvalues["LightningEnd"]).toBeTruthy();
  });

  it("creates a laser's end target when none is named", async () => {
    const path = map();
    const r = (await writeSpriteTool.handler(
      {
        path,
        kind: "laser",
        origin: [0, 0, 64],
        end: [128, 0, 64],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { ids: number[]; classes: string[] };
    expect(r.classes).toEqual(["info_target", "env_laser"]);
    const laser = entities(path).find((e) => e.id === r.ids[1])!;
    expect(laser.classname).toBe("env_laser");
    expect(laser.keyvalues["LaserTarget"]).toBeTruthy();
  });
});
