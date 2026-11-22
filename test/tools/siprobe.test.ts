import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { editVmf } from "../../src/maps/typescript/tools/vmfedit.js";
import { writeSpecialInfectedProbeTool } from "../../src/scripts/typescript/tools/siprobe.js";
import { ctx as sharedCtx, FIXTURES } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-si-probe-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const source = join(FIXTURES, "hmcp_probe.vmf");

describe("write_special_infected_probe", () => {
  it("adds a logic_script that spawns and counts SI through SendToConsole", async () => {
    const vmf = join(scratch, "map.vmf");
    copyFileSync(source, vmf);
    const result = (await writeSpecialInfectedProbeTool.handler(
      { path: vmf, spawn: ["boomer", "smoker"], keys: ["BoomerLimit"], confirm: true } as never,
      ctx,
    )) as {
      scriptPath: string;
      logicScriptId: number | null;
      markers: Array<{ name: string; pattern: string }>;
    };
    expect(result.logicScriptId).not.toBeNull();
    const script = readFileSync(result.scriptPath, "utf8");
    expect(script).toContain('HSMCP_SI_SPAWN <- ["boomer", "smoker"]');
    expect(script).toContain('SendToConsole( "z_spawn " + classname )');
    expect(script).toContain("OnGameEvent_player_team");
    expect(script).toContain("SessionOptions[key]");

    const text = readFileSync(vmf, "utf8");
    expect(text).toContain('"classname" "logic_script"');
    expect(text).toContain('"vscripts" "hsmcp_si_probe"');
    expect(result.markers.map((marker) => marker.name)).toEqual(["si_done", "si_spawn"]);
  }, 30_000);

  it("refuses a live chapter exit and strips it on request", async () => {
    const vmf = join(scratch, "exit.vmf");
    copyFileSync(source, vmf);
    await editVmf.handler(
      {
        path: vmf,
        ops: [
          {
            op: "add",
            keyvalues: { classname: "info_changelevel", targetname: "to_m2", map: "next" },
          },
          { op: "add", keyvalues: { classname: "logic_timer", targetname: "selftest_warp" } },
        ],
        confirm: true,
      } as never,
      ctx,
    );
    // A second call, because every op in one call is matched against the original text:
    // `addOutput` cannot target an entity that the same call adds.
    await editVmf.handler(
      {
        path: vmf,
        ops: [
          {
            op: "addOutput",
            match: { targetname: "selftest_warp" },
            output: "OnTimer",
            value: "director,RunScriptCode,Director.WarpAllSurvivorsToCheckpoint(),,0,-1",
          },
        ],
        confirm: true,
      } as never,
      ctx,
    );

    await expect(
      writeSpecialInfectedProbeTool.handler({ path: vmf, confirm: true } as never, ctx),
    ).rejects.toThrow(/live chapter exit/);

    const result = (await writeSpecialInfectedProbeTool.handler(
      { path: vmf, stripExit: true, confirm: true } as never,
      ctx,
    )) as { strippedExits: Array<{ classname: string; targetname: string | null }> };
    expect(result.strippedExits.map((entity) => entity.targetname)).toEqual([
      "to_m2",
      "selftest_warp",
    ]);

    const text = readFileSync(vmf, "utf8");
    expect(text).not.toContain("info_changelevel");
    expect(text).not.toContain("WarpAllSurvivorsToCheckpoint");
    expect(text).toContain('"classname" "logic_script"');
  }, 30_000);
});
