import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  writeItemSpawnsTool,
  writeSaferoomStockTool,
  writeIntroCameraTool,
  writeRescueTool,
  writeZombieBorderTool,
} from "../../src/campaigns/typescript/tools/gameplay.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx } from "../support/env.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-gameplay-"));
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

describe("gameplay entities", () => {
  it("places item spawners with a count and a classname override", async () => {
    const path = map();
    const r = (await writeItemSpawnsTool.handler(
      {
        path,
        kind: "rifle",
        placements: [{ origin: [0, 0, 16], count: 2 }, { origin: [64, 0, 16] }],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { ids: number[]; classname: string };
    expect(r.classname).toBe("weapon_rifle_spawn");
    const placed = entities(path).filter((entity) => r.ids.includes(entity.id!));
    expect(placed).toHaveLength(2);
    expect(placed[0]!.keyvalues["count"]).toBe("2");
  });

  it("places a saferoom stock row", async () => {
    const path = map();
    const r = (await writeSaferoomStockTool.handler(
      {
        path,
        origin: [0, 0, 16],
        items: ["medkit", "pills", "ammo", "pistol"],
        targetname: "stock",
        keyvalues: { spawnflags: "2" },
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { ids: number[]; classes: string[]; targetnames: string[] };
    expect(r.classes).toEqual([
      "weapon_first_aid_kit_spawn",
      "weapon_pain_pills_spawn",
      "weapon_ammo_spawn",
      "weapon_pistol_spawn",
    ]);
    expect(r.targetnames).toEqual(["stock_medkit", "stock_pills", "stock_ammo", "stock_pistol"]);
    expect(entities(path).filter((entity) => r.ids.includes(entity.id!))).toHaveLength(4);
    for (const entity of entities(path).filter((entry) => r.ids.includes(entry.id!))) {
      expect(entity.keyvalues["spawnflags"]).toBe("2");
    }
  });

  it("writes an intro camera, a logic_auto enable and a disable timer", async () => {
    const path = map();
    const r = (await writeIntroCameraTool.handler(
      { path, origin: [0, 0, 64], holdSeconds: 5, confirm: true } as never,
      ctx,
    )) as unknown as { cameraId: number; logicAutoId: number; timerId: number };
    expect(entities(path).find((entity) => entity.id === r.cameraId)?.classname).toBe("point_viewcontrol");
    expect(entities(path).find((entity) => entity.id === r.logicAutoId)?.classname).toBe("logic_auto");
    expect(entities(path).find((entity) => entity.id === r.logicAutoId)?.targetname).toBe(
      "intro_camera_auto",
    );
    expect(entities(path).find((entity) => entity.id === r.timerId)?.classname).toBe("logic_timer");
    const text = readFileSync(path, "utf8");
    expect(text).toContain("OnMapSpawn");
    expect(text).toContain("OnTimer");
  });

  it("writes a rescue point with ordered survivor positions", async () => {
    const path = map();
    const r = (await writeRescueTool.handler(
      { path, origin: [0, 0, 16], survivorPositions: [[0, 0, 16], [32, 0, 16]], confirm: true } as never,
      ctx,
    )) as unknown as { rescueId: number; positionIds: number[] };
    expect(entities(path).find((entity) => entity.id === r.rescueId)?.classname).toBe(
      "info_survivor_rescue",
    );
    expect(r.positionIds).toHaveLength(2);
    expect(
      entities(path).find((entity) => entity.id === r.positionIds[0])?.keyvalues["Order"],
    ).toBe("1");
  });

  it("writes an infected border", async () => {
    const path = map();
    const r = (await writeZombieBorderTool.handler(
      { path, origin: [0, 0, 16], startDisabled: true, confirm: true } as never,
      ctx,
    )) as unknown as { entityId: number };
    const e = entities(path).find((entity) => entity.id === r.entityId)!;
    expect(e.classname).toBe("info_zombie_border");
    expect(e.keyvalues["StartDisabled"]).toBe("1");
  });
});
