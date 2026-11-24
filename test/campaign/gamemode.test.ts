import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { checkGamemodeContractTool } from "../../src/campaigns/typescript/tools/gamemode.js";
import { config, ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-gamemode-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function entity(id: number, classname: string, extra: string, connections = ""): string {
  return (
    `entity\n{\n\t"id" "${id}"\n\t"classname" "${classname}"\n` +
    extra +
    (connections ? `\tconnections\n\t{\n${connections}\t}\n` : "") +
    "}\n"
  );
}

describe("check_gamemode_contract", () => {
  it("resolves mode outputs and flags a dangling target, an unknown density and a bad value", async () => {
    const path = join(scratch, "mode.vmf");
    writeFileSync(
      path,
      "versioninfo\n{\n\t\"editorversion\" \"400\"\n}\nworld\n{\n\t\"id\" \"1\"\n\t\"classname\" \"worldspawn\"\n}\n" +
        entity(2, "info_gamemode", '\t"targetname" "gm"\n', [
          '\t\t"OnCoop" "relay_coop,Trigger,,0,-1"\n',
          '\t\t"OnVersus" "missing_relay,Trigger,,0,-1"\n',
          '\t\t"OnSurvivalPostIO" "relay_coop,Trigger,,0,-1"\n',
        ].join("")) +
        entity(3, "logic_relay", '\t"targetname" "relay_coop"\n') +
        entity(4, "weapon_scavenge_item_spawn", '\t"targetname" "can"\n') +
        entity(
          5,
          "info_map_parameters",
          '\t"PistolDensity" "3"\n\t"BogusDensity" "2"\n\t"AmmoDensity" "lots"\n',
        ),
    );
    const r = (await checkGamemodeContractTool.handler({ path } as never, ctx)) as unknown as {
      source: string;
      gamemodeEntities: number;
      modes: Record<string, { wired: boolean; dangling: string[] }>;
      mapParameters: { unknownKeys: string[]; densities: Record<string, number> } | null;
      findings: Array<{ severity: string; rule: string }>;
      verdict: string;
    };
    expect(r.source).toBe("vmf");
    expect(r.gamemodeEntities).toBe(1);
    expect(r.modes.coop!).toMatchObject({ wired: true, dangling: [] });
    expect(r.modes.versus!.dangling).toEqual(["missing_relay"]);
    expect(r.mapParameters!.densities).toMatchObject({ PistolDensity: 3 });
    expect(r.mapParameters!.unknownKeys).toContain("BogusDensity");
    expect(r.findings.map((f) => f.rule)).toEqual(
      expect.arrayContaining([
        "mode-target-missing",
        "map-parameter-unknown",
        "map-parameter-not-a-number",
        "scavenge-cans-unswitched",
      ]),
    );
    expect(r.verdict).toBe("fail");
  });
});

describe.skipIf(!has.gameContent)("check_gamemode_contract on official maps", () => {
  it("reads the two c2m1 mode switches and resolves every target", async () => {
    const path = join(config.gameDir!, "maps", "c2m1_highway.bsp");
    const r = (await checkGamemodeContractTool.handler({ path } as never, ctx)) as unknown as {
      gamemodeEntities: number;
      modes: Record<string, { wired: boolean; dangling: string[] }>;
      mapParameters: { unknownKeys: string[] } | null;
      verdict: string;
    };
    expect(r.gamemodeEntities).toBe(2);
    expect(r.modes.coop!.wired).toBe(true);
    expect(r.modes.survival!.wired).toBe(true);
    expect(r.modes.coop!.dangling).toEqual([]);
    expect(r.mapParameters!.unknownKeys).toEqual([]);
    expect(r.verdict).toBe("pass");
  });

  it("passes a chapter with no info_gamemode and says so", async () => {
    const path = join(config.gameDir!, "maps", "c1m1_hotel.bsp");
    const r = (await checkGamemodeContractTool.handler({ path } as never, ctx)) as unknown as {
      gamemodeEntities: number;
      findings: Array<{ rule: string }>;
      verdict: string;
    };
    expect(r.gamemodeEntities).toBe(0);
    expect(r.findings.map((f) => f.rule)).toContain("no-gamemode-entity");
    expect(r.verdict).toBe("pass");
  });
});
