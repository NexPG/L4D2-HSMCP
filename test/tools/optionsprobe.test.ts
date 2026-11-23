/**
 * The options probe is the runtime counterpart of `read_special_infected`: it reads the
 * merged `SessionOptions` from a live `logic_script` after `MutationOptions` has been applied.
 * The event-hook shape is what produced a line on a real map; the test keeps that shape.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeOptionsProbeTool } from "../../src/scripts/typescript/tools/optionsprobe.js";
import { ctx as sharedCtx, FIXTURES } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-options-probe-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("write_options_probe", () => {
  it("adds a logic_script and an event-hook script that reads SessionOptions", async () => {
    const vmf = join(scratch, "probe.vmf");
    copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), vmf);

    const result = (await writeOptionsProbeTool.handler(
      {
        path: vmf,
        keys: ["BoomerLimit", "MaxSpecials"],
        scriptName: "hsmcp_options_probe",
        confirm: true,
      } as never,
      ctx,
    )) as {
      scriptPath: string;
      logicScriptId: number | null;
      entity: { classname: string; vscripts: string };
      markers: Array<{ name: string; pattern: string }>;
    };

    expect(result.logicScriptId).not.toBeNull();
    const script = readFileSync(result.scriptPath, "utf8");
    expect(script).toContain('HSMCP_OPTIONS_KEYS <- ["BoomerLimit", "MaxSpecials"]');
    expect(script).toContain("function OnGameEvent_round_start");
    expect(script).toContain("function OnGameEvent_player_spawn");
    expect(script).toContain('printl( "[HSMCP_OPTIONS] " + key + "=" + SessionOptions[key] )');
    // A plain `+map` run has no SessionOptions global; touching it throws. The probe must
    // test for the name before reading it.
    expect(script).toContain('"SessionOptions" in getroottable()');
    expect(script).toContain("SessionOptions=absent");
    expect(script).toContain("HSMCP_OPTIONS_DONE");

    const text = readFileSync(vmf, "utf8");
    expect(text).toContain('"classname" "logic_script"');
    expect(text).toContain('"vscripts" "hsmcp_options_probe"');
    expect(result.entity).toEqual({
      classname: "logic_script",
      vscripts: "hsmcp_options_probe",
    });
    expect(result.markers.map((marker) => marker.name)).toEqual([
      "first_option",
      "options_done",
    ]);
    expect(result.markers[0]!.pattern).toContain("BoomerLimit=");
  });

  it("refuses a key that cannot index SessionOptions", async () => {
    const vmf = join(scratch, "bad.vmf");
    copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), vmf);
    await expect(
      writeOptionsProbeTool.handler(
        { path: vmf, keys: ["Boomer Limit"], confirm: true } as never,
        ctx,
      ),
    ).rejects.toThrow(/not an identifier/);
  });
});
