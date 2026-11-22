import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  checkCampaignWiringTool,
  writeChangelevelTool,
  writeFinaleSetupTool,
  writeMapParametersTool,
  writeSafeRoomTool,
  writeSpawnPointsTool,
} from "../../src/campaigns/typescript/tools/campaignbuild.js";
import { editVmf } from "../../src/maps/typescript/tools/vmfedit.js";
import { readEntities } from "../../src/maps/typescript/vmf/edit.js";
import { ctx as sharedCtx, FIXTURES, has } from "../support/env.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-campaign-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

let counter = 0;
function map(name?: string): string {
  counter += 1;
  const path = join(scratch, `${name ?? `map-${counter}`}.vmf`);
  writeFileSync(path, SEED);
  return path;
}

const entities = (path: string) => readEntities(readFileSync(path, "utf8")).entities;
const key = (path: string, id: number, name: string) =>
  entities(path).find((e) => e.id === id)!.keyvalues[name];

async function textEntity(path: string, keyvalues: Record<string, string>): Promise<number> {
  const reply = (await editVmf.handler(
    {
      path,
      ops: [{ op: "add", keyvalues }],
      backup: false,
      dryRun: false,
      confirm: true,
    } as never,
    ctx as never,
  )) as { outcomes: Array<{ ids: number[] }> };
  return reply.outcomes[0]!.ids[0]!;
}

describe("write_spawn_points", () => {
  it("writes player, survivor, zombie and rescue spawns with the keys each reads", async () => {
    const path = map();
    const player = (await writeSpawnPointsTool.handler(
      { path, kind: "player", origin: [0, 0, 16], angles: [0, 90, 0], confirm: true } as never,
      ctx,
    )) as unknown as { ids: number[] };
    expect(entities(path).find((e) => e.id === player.ids[0])?.classname).toBe(
      "info_player_start",
    );
    expect(key(path, player.ids[0]!, "angles")).toBe("0 90 0");

    const survivor = (await writeSpawnPointsTool.handler(
      {
        path,
        kind: "survivor",
        gameMode: "coop",
        positions: [
          { origin: [0, 0, 16], angles: [0, 0, 0] },
          { origin: [32, 0, 16], angles: [0, 0, 0] },
          { origin: [0, 32, 16], angles: [0, 0, 0] },
          { origin: [32, 32, 16], angles: [0, 0, 0] },
        ],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { ids: number[] };
    const orders = survivor.ids.map((id) => key(path, id!, "Order"));
    expect(orders).toEqual(["1", "2", "3", "4"]);
    expect(key(path, survivor.ids[0]!, "GameMode")).toBe("coop");

    const zombie = (await writeSpawnPointsTool.handler(
      {
        path,
        kind: "zombie",
        spawns: [{ origin: [64, 0, 16], population: "2", offerTank: true }],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { ids: number[] };
    expect(key(path, zombie.ids[0]!, "population")).toBe("2");
    expect(key(path, zombie.ids[0]!, "offer_tank")).toBe("1");

    const rescue = (await writeSpawnPointsTool.handler(
      { path, kind: "rescue", origin: [96, 0, 16], confirm: true } as never,
      ctx,
    )) as unknown as { ids: number[] };
    expect(entities(path).find((e) => e.id === rescue.ids[0])?.classname).toBe(
      "info_survivor_rescue",
    );
    expect(key(path, rescue.ids[0]!, "model")).toContain("playerstart");
  });

  it("refuses a second info_player_start and a fifth survivor", async () => {
    const path = map();
    await writeSpawnPointsTool.handler(
      { path, kind: "player", origin: [0, 0, 16], confirm: true } as never,
      ctx,
    );
    await expect(
      writeSpawnPointsTool.handler(
        { path, kind: "player", origin: [64, 0, 16], confirm: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/already has/);
    await expect(
      writeSpawnPointsTool.handler(
        {
          path,
          kind: "survivor",
          positions: [0, 1, 2, 3, 4].map((n) => ({ origin: [n * 32, 0, 16] })),
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/four/);
  });
});

describe("write_changelevel", () => {
  it("writes a brush volume and its landmark, and checks the pair", async () => {
    const path = map("chapter1");
    const result = (await writeChangelevelTool.handler(
      {
        path,
        role: "departure",
        map: "chapter2",
        landmark: "m1_m2_landmark",
        bounds: { mins: [0, 0, 0], maxs: [128, 128, 64] },
        confirm: true,
      } as never,
      ctx,
    )) as unknown as {
      changelevelId: number;
      landmarkId: number;
      solidIds: number[];
    };
    const changelevel = entities(path).find((e) => e.id === result.changelevelId)!;
    expect(changelevel.classname).toBe("info_changelevel");
    expect(changelevel.solidCount).toBe(1);
    expect(changelevel.keyvalues["map"]).toBe("chapter2");
    expect(changelevel.keyvalues["landmark"]).toBe("m1_m2_landmark");
    expect(result.solidIds).toHaveLength(1);
    const landmark = entities(path).find((e) => e.id === result.landmarkId)!;
    expect(landmark.classname).toBe("info_landmark");
    expect(landmark.keyvalues["targetname"]).toBe("m1_m2_landmark");
  });

  it("writes the arrival volume with spawnflags 2 and this map's name", async () => {
    const path = map("chapter2");
    const result = (await writeChangelevelTool.handler(
      {
        path,
        role: "arrival",
        map: "chapter2",
        landmark: "m1_m2_landmark",
        bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { changelevelId: number };
    expect(key(path, result.changelevelId, "spawnflags")).toBe("2");
    expect(key(path, result.changelevelId, "map")).toBe("chapter2");
  });

  it("refuses a departure that names its own map and an arrival that names another", async () => {
    const path = map("chapter3");
    await expect(
      writeChangelevelTool.handler(
        {
          path,
          role: "departure",
          map: "chapter3",
          landmark: "x",
          bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/next map/);
    await expect(
      writeChangelevelTool.handler(
        {
          path,
          role: "arrival",
          map: "chapter2",
          landmark: "x",
          bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
          confirm: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/must name/);
  });
});

describe("write_finale_setup", () => {
  it("writes a custom finale disabled, with its script and four escape positions", async () => {
    const path = map();
    const result = (await writeFinaleSetupTool.handler(
      {
        path,
        type: "custom",
        origin: [0, 0, 32],
        scriptFile: "finale_mycampaign",
        escapePositions: [0, 1, 2, 3].map((n) => ({
          origin: [n * 32, 0, 32],
          angles: [0, 0, 0],
        })),
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { finaleId: number; escapeIds: number[] };
    expect(key(path, result.finaleId, "type")).toBe("2");
    expect(key(path, result.finaleId, "StartDisabled")).toBe("1");
    expect(key(path, result.finaleId, "ScriptFile")).toBe("finale_mycampaign");
    expect(result.escapeIds).toHaveLength(4);
    expect(key(path, result.escapeIds[0]!, "Order")).toBe("1");
  });

  it("writes a scavenge finale as type 4 and refuses custom without a script", async () => {
    const path = map();
    const result = (await writeFinaleSetupTool.handler(
      { path, type: "scavenge", origin: [0, 0, 32], confirm: true } as never,
      ctx,
    )) as unknown as { finaleId: number };
    expect(key(path, result.finaleId, "type")).toBe("4");
    const other = map();
    await expect(
      writeFinaleSetupTool.handler(
        { path: other, type: "custom", origin: [0, 0, 32], confirm: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/scriptFile/);
  });
});

describe("write_map_parameters", () => {
  it("writes only the densities given, under the FGD's key names", async () => {
    const path = map();
    const result = (await writeMapParametersTool.handler(
      {
        path,
        densities: { pistol: 4, gasCan: 0, magnum: -1, finaleItemClusterCount: 2 },
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { entityId: number; keyvalues: Record<string, string> };
    const kv = entities(path).find((e) => e.id === result.entityId)!.keyvalues;
    expect(kv["PistolDensity"]).toBe("4");
    expect(kv["GasCanDensity"]).toBe("0");
    expect(kv["MagnumDensity"]).toBe("-1");
    expect(kv["FinaleItemClusterCount"]).toBe("2");
    expect(kv["AmmoDensity"]).toBeUndefined();
  });

  it("refuses an entity with no densities", async () => {
    const path = map();
    await expect(
      writeMapParametersTool.handler({ path, confirm: true } as never, ctx),
    ).rejects.toThrow(/at least one/);
  });
});

describe.skipIf(!has.toolchain || !has.sidecar)("write_safe_room", () => {
  it("places the checkpoint door, player start, four positions and a director", async () => {
    const path = map();
    const result = (await writeSafeRoomTool.handler(
      {
        path,
        role: "exit",
        opening: { axis: "x", min: -32, max: 32, at: 0, floorZ: 0 },
        yaw: 90,
        playerStart: { origin: [0, 0, 16], angles: [0, 0, 0] },
        confirm: true,
      } as never,
      ctx,
    )) as unknown as {
      doorId: number;
      playerStartId: number;
      survivorIds: number[];
      directorId: number | null;
      warnings: string[];
    };
    expect(entities(path).find((e) => e.id === result.doorId)?.classname).toBe(
      "prop_door_rotating_checkpoint",
    );
    expect(key(path, result.doorId, "targetname")).toBe("checkpoint_exit");
    expect(result.survivorIds).toHaveLength(4);
    expect(result.directorId).not.toBeNull();
    expect(result.warnings.some((w) => w.includes("48-unit square"))).toBe(true);
  });
});

describe("check_campaign_wiring", () => {
  it("passes a two-chapter chain that links both ways", async () => {
    const first = map("chain_a");
    const second = map("chain_b");
    const secondName = basename(second, ".vmf");

    for (const path of [first, second]) {
      await writeSpawnPointsTool.handler(
        { path, kind: "player", origin: [0, 0, 16], confirm: true } as never,
        ctx,
      );
      await textEntity(path, { classname: "info_director", origin: "0 0 32" });
    }
    await textEntity(first, {
      classname: "prop_door_rotating_checkpoint",
      targetname: "checkpoint_exit",
      origin: "0 0 16",
      model: "models/props_doors/checkpoint_door_-02.mdl",
    });
    await textEntity(second, {
      classname: "prop_door_rotating_checkpoint",
      targetname: "checkpoint_entrance",
      origin: "0 0 16",
      model: "models/props_doors/checkpoint_door_-02.mdl",
    });
    await writeChangelevelTool.handler(
      {
        path: first,
        role: "departure",
        map: secondName,
        landmark: "chain_landmark",
        bounds: { mins: [-64, -64, 0], maxs: [64, 64, 64] },
        confirm: true,
      } as never,
      ctx,
    );
    await writeChangelevelTool.handler(
      {
        path: second,
        role: "arrival",
        map: secondName,
        landmark: "chain_landmark",
        bounds: { mins: [-64, -64, 0], maxs: [64, 64, 64] },
        confirm: true,
      } as never,
      ctx,
    );
    await writeFinaleSetupTool.handler(
      { path: second, type: "gauntlet", origin: [0, 0, 32], confirm: true } as never,
      ctx,
    );

    const result = (await checkCampaignWiringTool.handler(
      { maps: [first, second] } as never,
      ctx,
    )) as unknown as {
      overall: string;
      findings: Array<{ severity: string; rule: string; message: string }>;
      counts: { error: number; warning: number; info: number };
    };
    expect(result.counts.error, JSON.stringify(result.findings, null, 2)).toBe(0);
    expect(result.overall).not.toBe("fail");
    expect(result.findings.every((f) => f.rule !== "transition-missing")).toBe(true);
  });

  it("reports a transition that leads somewhere else and a missing landmark", async () => {
    const first = map("broken_a");
    const second = map("broken_b");
    const third = map("broken_c");
    for (const path of [first, second, third]) {
      await writeSpawnPointsTool.handler(
        { path, kind: "player", origin: [0, 0, 16], confirm: true } as never,
        ctx,
      );
      await textEntity(path, { classname: "info_director", origin: "0 0 32" });
    }
    await writeChangelevelTool.handler(
      {
        path: first,
        role: "departure",
        map: "some_other_map",
        landmark: "missing_landmark",
        bounds: { mins: [0, 0, 0], maxs: [64, 64, 64] },
        confirm: true,
      } as never,
      ctx,
    );

    const result = (await checkCampaignWiringTool.handler(
      { maps: [first, second], names: ["broken_a", "broken_b"] } as never,
      ctx,
    )) as unknown as {
      overall: string;
      findings: Array<{ severity: string; rule: string; message: string }>;
    };
    expect(result.overall).toBe("fail");
    expect(result.findings.some((f) => f.rule === "transition-missing")).toBe(true);
    expect(result.findings.some((f) => f.rule === "finale-missing")).toBe(true);
  });
});

const TEST_CAMPAIGN = join(
  import.meta.dirname,
  "..",
  "..",
  "campaigns",
  "001-hsmcp-test",
  "src",
);

describe.skipIf(!existsSync(join(TEST_CAMPAIGN, "hsmcp_test_m1.vmf")))(
  "check_campaign_wiring on the test campaign",
  () => {
    it("finds the real chain sound and reports only naming and script advice", async () => {
      const result = (await checkCampaignWiringTool.handler(
        {
          maps: [
            join(TEST_CAMPAIGN, "hsmcp_test_m1.vmf"),
            join(TEST_CAMPAIGN, "hsmcp_test_m2.vmf"),
          ],
        } as never,
        ctx,
      )) as unknown as {
        overall: string;
        counts: { error: number; warning: number; info: number };
        findings: Array<{ severity: string; rule: string }>;
      };
      expect(result.counts.error, JSON.stringify(result.findings, null, 2)).toBe(0);
      expect(result.findings.some((f) => f.rule === "transition-missing")).toBe(false);
      expect(result.findings.some((f) => f.rule === "landmark-missing")).toBe(false);
    });
  },
);
describe("check_campaign_wiring on a compiled map", () => {
  it("reads the entity lump rather than refusing the .bsp", async () => {
    const result = (await checkCampaignWiringTool.handler(
      { maps: [join(FIXTURES, "hmcp_probe.bsp")], mode: "survival" } as never,
      ctx,
    )) as unknown as {
      overall: string;
      chapters: Array<{ source: string; path: string }>;
      findings: Array<{ severity: string; rule: string }>;
    };
    expect(result.chapters[0]?.source).toBe("bsp");
    expect(result.chapters[0]?.path.toLowerCase().endsWith(".bsp")).toBe(true);
    expect(result.findings.some((f) => f.rule === "map-missing")).toBe(false);
  });
});