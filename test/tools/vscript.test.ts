import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  checkVscriptContractTool,
  readVscriptApiTool,
  readVscriptTool,
  writeVscript,
} from "../../src/scripts/typescript/tools/vscript.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-vscript-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const GOOD = `// test script
printl( "[TEST] loaded" );

function OnGameplayStart()
{
	printl( "[TEST] start" );
}
`;

describe("write_vscript", () => {
  it("writes a .nut and reads its size back", async () => {
    const path = join(scratch, "good.nut");
    const out = (await writeVscript.handler(
      { path, content: GOOD, confirm: true },
      ctx,
    )) as { bytes: number; attached: boolean; warnings: string[] };
    expect(readFileSync(path, "utf8")).toContain("OnGameplayStart");
    expect(out.bytes).toBeGreaterThan(0);
    expect(out.attached).toBe(false);
    expect(out.warnings).toEqual([]);
  });

  it("refuses unbalanced braces", async () => {
    await expect(
      writeVscript.handler(
        { path: join(scratch, "broken.nut"), content: "function X() {\n", confirm: true },
        ctx,
      ),
    ).rejects.toThrow(/would not compile|never closed/);
  });

  it("refuses Lua syntax instead of silently writing it", async () => {
    const path = join(scratch, "lua.nut");
    await expect(
      writeVscript.handler(
        { path, content: "printl(\"x\")\nif x then\nend\n", confirm: true },
        ctx,
      ),
    ).rejects.toThrow(/then|end/);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a file that is not .nut", async () => {
    await expect(
      writeVscript.handler({ path: join(scratch, "x.lua"), content: GOOD, confirm: true }, ctx),
    ).rejects.toThrow(/\.nut/);
  });
});

describe("read_vscript", () => {
  it("returns the DirectorOptions stage list and the diagnostics", async () => {
    const path = join(scratch, "finale.nut");
    writeFileSync(
      path,
      [
        'printl( "[TEST] loaded" );',
        "PANIC <- 0",
        "DELAY <- 2",
        "DirectorOptions <-",
        "{",
        "  A_CustomFinale_StageCount = 2",
        "  A_CustomFinale1 = PANIC",
        "  A_CustomFinaleValue1 = 1",
        "  A_CustomFinale2 = DELAY",
        "  A_CustomFinaleValue2 = 5",
        "}",
        "function OnBeginCustomFinaleStage( num, type )",
        "{",
        '  printl( "[TEST] stage " + num );',
        "}",
      ].join("\n"),
    );
    const out = (await readVscriptTool.handler({ path }, ctx)) as {
      ok: boolean;
      stageCount: number;
      stages: Array<{ type: string }>;
      functions: string[];
      diagnostics: Array<{ severity: string }>;
    };
    expect(out.ok).toBe(true);
    expect(out.stageCount).toBe(2);
    expect(out.stages.map((stage) => stage.type)).toEqual(["PANIC", "DELAY"]);
    expect(out.functions).toContain("OnBeginCustomFinaleStage");
    expect(out.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  });
});

describe.skipIf(!has.sidecar || !has.gameContent)("VScript API contract", () => {
  it("lists the engine's game events and their typed fields", async () => {
    const api = (await readVscriptApiTool.handler(
      { section: "events", search: "player_death", details: true, limit: 20 } as never,
      ctx,
    )) as unknown as {
      eventCount: number;
      events: Array<{ name: string; fields?: Array<{ name: string; type: string }> }>;
    };
    expect(api.eventCount).toBeGreaterThan(300);
    const death = api.events.find((event) => event.name === "player_death")!;
    expect(death.fields!.find((field) => field.name === "userid")!.type).toBe("short");
  }, 120_000);

  it("checks a hook name and event_data fields against modevents.res", async () => {
    const path = join(scratch, "contract.nut");
    writeFileSync(
      path,
      [
        'printl("contract")',
        'IncludeScript("director_base")',
        'IncludeScript("hsmcp_missing_include")',
        "function OnGameEvent_player_death(params)",
        "{",
        "  local id = event_data.userid;",
        "  printl(id);",
        "}",
        "function OnGameEvent_player_deth(params)",
        "{",
        "}",
        "function OnGameEvent_player_hurt(params)",
        "{",
        "  local wrong = event_data.userd;",
        "}",
        "DirectorOptions <- { TankLimit = \"2\" }",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = (await checkVscriptContractTool.handler(
      { path },
      ctx,
    )) as unknown as {
      ok: boolean;
      hooks: Array<{ name: string; known: boolean; unknownFields: string[] }>;
      findings: Array<{ rule: string }>;
      warnings: number;
      includes: Array<{ name: string; found: boolean; path: string | null }>;
    };
    const hooks = new Map(result.hooks.map((hook) => [hook.name, hook]));
    expect(hooks.get("OnGameEvent_player_death")!.known).toBe(true);
    expect(hooks.get("OnGameEvent_player_death")!.unknownFields).toEqual([]);
    expect(hooks.get("OnGameEvent_player_deth")!.known).toBe(false);
    expect(hooks.get("OnGameEvent_player_hurt")!.unknownFields).toEqual(["userd"]);
    const rules = result.findings.map((finding) => finding.rule);
    expect(rules).toContain("vscript-event-unknown");
    expect(rules).toContain("vscript-event-field");
    expect(rules).toContain("vscript-option-quoted");
    const includes = new Map(result.includes.map((entry) => [entry.name, entry]));
    expect(includes.get("director_base")!.found).toBe(true);
    expect(includes.get("hsmcp_missing_include")!.found).toBe(false);
    expect(rules).toContain("vscript-include-missing");
    expect(result.warnings).toBeGreaterThanOrEqual(4);
  }, 120_000);
});
