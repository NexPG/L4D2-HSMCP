import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  writeLogicTool,
  writeMoverTool,
  writeTriggerTool,
} from "../../src/maps/typescript/tools/entityfamilies.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx } from "../support/env.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-families-"));
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

describe("write_trigger", () => {
  it("writes a trigger_multiple volume with an output", async () => {
    const path = map();
    const result = (await writeTriggerTool.handler(
      {
        path,
        kind: "multiple",
        bounds: { mins: [0, 0, 0], maxs: [128, 128, 64] },
        targetname: "start_trigger",
        wait: 2,
        keyvalues: {},
        outputs: [
          { output: "OnStartTouch", target: "relay", input: "Trigger", parameter: "", delay: 0, times: -1 },
        ],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number; solidIds: number[] };
    const entity = entities(path).find((entry) => entry.id === result.entityId)!;
    expect(entity.classname).toBe("trigger_multiple");
    expect(entity.solidCount).toBe(1);
    expect(entity.keyvalues["wait"]).toBe("2");
    expect(result.solidIds).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toContain("OnStartTouch");
  });

  it("refuses a teleport or look trigger without a destination", async () => {
    const path = map();
    await expect(
      writeTriggerTool.handler(
        {
          path,
          kind: "teleport",
          bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
          keyvalues: {},
          outputs: [],
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/target/);
    await expect(
      writeTriggerTool.handler(
        {
          path,
          kind: "look",
          bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
          keyvalues: {},
          outputs: [],
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/target/);
  });

  it("writes a hurt trigger's damage and a push trigger's direction", async () => {
    const path = map();
    const hurt = (await writeTriggerTool.handler(
      {
        path,
        kind: "hurt",
        bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
        damage: 25,
        damageType: 8,
        keyvalues: {},
        outputs: [],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    expect(entities(path).find((entry) => entry.id === hurt.entityId)!.keyvalues["damage"]).toBe("25");
    const push = (await writeTriggerTool.handler(
      {
        path,
        kind: "push",
        bounds: { mins: [128, 0, 0], maxs: [192, 64, 64] },
        speed: 300,
        pushdir: [0, 0, 1],
        keyvalues: {},
        outputs: [],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    const entity = entities(path).find((entry) => entry.id === push.entityId)!;
    expect(entity.keyvalues["speed"]).toBe("300");
    expect(entity.keyvalues["pushdir"]).toBe("0 0 1");
  });
});

describe("write_mover", () => {
  it("writes a func_movelinear with its volume and movedir", async () => {
    const path = map();
    const result = (await writeMoverTool.handler(
      {
        path,
        kind: "movelinear",
        bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
        movedir: [0, 1, 0],
        speed: 150,
        startPosition: 1,
        keyvalues: {},
        outputs: [],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number; solidIds: number[] };
    const entity = entities(path).find((entry) => entry.id === result.entityId)!;
    expect(entity.classname).toBe("func_movelinear");
    expect(entity.solidCount).toBe(1);
    expect(entity.keyvalues["movedir"]).toBe("0 1 0");
    expect(entity.keyvalues["speed"]).toBe("150");
    expect(entity.keyvalues["startposition"]).toBe("1");
    expect(result.solidIds).toHaveLength(1);
  });

  it("writes a rotating mover and refuses a tracktrain with no path", async () => {
    const path = map();
    const rotating = (await writeMoverTool.handler(
      {
        path,
        kind: "rotating",
        bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
        maxSpeed: 90,
        angles: [0, 90, 0],
        keyvalues: {},
        outputs: [],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    expect(entities(path).find((entry) => entry.id === rotating.entityId)!.classname).toBe(
      "func_rotating",
    );
    await expect(
      writeMoverTool.handler(
        {
          path,
          kind: "tracktrain",
          bounds: { mins: [128, 0, 0], maxs: [192, 64, 64] },
          keyvalues: {},
          outputs: [],
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/path_track/);
  });
});

describe("write_logic", () => {
  it("writes a relay with its outputs in a connections block", async () => {
    const path = map();
    const result = (await writeLogicTool.handler(
      {
        path,
        kind: "relay",
        origin: [0, 0, 0],
        targetname: "relay",
        keyvalues: {},
        outputs: [
          { output: "OnTrigger", target: "door", input: "Open", parameter: "", delay: 0, times: 1 },
        ],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    const entity = entities(path).find((entry) => entry.id === result.entityId)!;
    expect(entity.classname).toBe("logic_relay");
    expect(readFileSync(path, "utf8")).toContain("OnTrigger");
  });

  it("writes timer, branch and counter keys", async () => {
    const path = map();
    const timer = (await writeLogicTool.handler(
      {
        path,
        kind: "timer",
        origin: [0, 0, 0],
        refireTime: 0.5,
        keyvalues: {},
        outputs: [],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    expect(entities(path).find((entry) => entry.id === timer.entityId)!.keyvalues["RefireTime"]).toBe(
      "0.5",
    );
    const branch = (await writeLogicTool.handler(
      {
        path,
        kind: "branch",
        origin: [0, 0, 0],
        initialValue: 3,
        keyvalues: {},
        outputs: [],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    expect(
      entities(path).find((entry) => entry.id === branch.entityId)!.keyvalues["InitialValue"],
    ).toBe("3");
    const counter = (await writeLogicTool.handler(
      {
        path,
        kind: "counter",
        origin: [0, 0, 0],
        startValue: 2,
        maxValue: 10,
        keyvalues: {},
        outputs: [],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number };
    const entity = entities(path).find((entry) => entry.id === counter.entityId)!;
    expect(entity.classname).toBe("math_counter");
    expect(entity.keyvalues["startvalue"]).toBe("2");
    expect(entity.keyvalues["max"]).toBe("10");
  });
});
