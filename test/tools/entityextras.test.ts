import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  writeAmbientGenericTool,
  writeConstraintTool,
  writeLadderTool,
  writePropTool,
  writeSceneTool,
} from "../../src/maps/typescript/tools/entityextras.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx } from "../support/env.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-extras-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

let counter = 0;
function map(): string {
  counter += 1;
  const path = join(scratch, `map-${counter}.vmf`);
  writeFileSync(path, SEED);
  return path;
}
const entities = (path: string) => readEntities(readFileSync(path, "utf8")).entities;

describe("props and constraints", () => {
  it("writes a prop_static with model, angles, skin and solid", async () => {
    const path = map();
    const r = (await writePropTool.handler(
      {
        path,
        kind: "static",
        origin: [0, 0, 16],
        model: "models/props/cs_office/chair.mdl",
        angles: [0, 90, 0],
        skin: 1,
        solid: 6,
        validateModel: false,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    const e = entities(path).find((entity) => entity.id === r.entityId)!;
    expect(e.classname).toBe("prop_static");
    expect(e.keyvalues["model"]).toBe("models/props/cs_office/chair.mdl");
    expect(e.keyvalues["angles"]).toBe("0 90 0");
    expect(e.keyvalues["skin"]).toBe("1");
    expect(e.keyvalues["solid"]).toBe("6");
  });

  it("writes a hinge constraint between two names", async () => {
    const path = map();
    const r = (await writeConstraintTool.handler(
      {
        path,
        kind: "hinge",
        origin: [0, 0, 32],
        attach1: "door",
        attach2: "frame",
        keyvalues: { hingeaxis: "0 1 0", forcelimit: "0" },
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    const e = entities(path).find((entity) => entity.id === r.entityId)!;
    expect(e.classname).toBe("phys_hinge");
    expect(e.keyvalues["attach1"]).toBe("door");
    expect(e.keyvalues["attach2"]).toBe("frame");
    expect(e.keyvalues["hingeaxis"]).toBe("0 1 0");
  });
});

describe("ladders, scenes and ambient sounds", () => {
  it("writes a func_ladder brush and a useable point", async () => {
    const path = map();
    const r = (await writeLadderTool.handler(
      {
        path,
        bounds: { mins: [0, 0, 0], maxs: [32, 32, 128] },
        targetname: "ladder",
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number; useableId: number; solidIds: number[] };
    expect(entities(path).find((entity) => entity.id === r.entityId)?.classname).toBe("func_ladder");
    expect(entities(path).find((entity) => entity.id === r.entityId)?.solidCount).toBe(1);
    expect(entities(path).find((entity) => entity.id === r.useableId)?.classname).toBe(
      "func_useableladder",
    );
    expect(r.solidIds).toHaveLength(1);
  });

  it("writes a choreographed scene with a scene file and target", async () => {
    const path = map();
    const r = (await writeSceneTool.handler(
      {
        path,
        origin: [0, 0, 16],
        sceneFile: "scenes/MyScene.vcd",
        targetname: "scene",
        targets: ["actor_a"],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    const e = entities(path).find((entity) => entity.id === r.entityId)!;
    expect(e.classname).toBe("logic_choreographed_scene");
    expect(e.keyvalues["SceneFile"]).toBe("scenes/MyScene.vcd");
    expect(e.keyvalues["target1"]).toBe("actor_a");
  });

  it("writes an ambient_generic with its soundscript name and volume", async () => {
    const path = map();
    const r = (await writeAmbientGenericTool.handler(
      {
        path,
        origin: [0, 0, 64],
        message: "MyAddon.Ambient",
        volume: 8,
        radius: 512,
        pitch: 90,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    const e = entities(path).find((entity) => entity.id === r.entityId)!;
    expect(e.classname).toBe("ambient_generic");
    expect(e.keyvalues["message"]).toBe("MyAddon.Ambient");
    expect(e.keyvalues["health"]).toBe("8");
    expect(e.keyvalues["radius"]).toBe("512");
    expect(e.keyvalues["pitch"]).toBe("90");
  });
});
