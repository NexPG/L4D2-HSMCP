/**
 * The Squirrel/DirectorOptions checker.
 *
 * The value of this reader is that it does not run the engine: a missing stage in a custom
 * finale or a Lua `end` can be caught before a map test. The false-positive cases matter as
 * much as the true ones, so `end` inside a string or a comment must stay silent.
 */
import { describe, expect, it } from "vitest";
import { checkNut, stripNut } from "../../src/scripts/typescript/vscript/check.js";

const FINALE = `printl( "[TEST] loaded" );
PANIC <- 0
TANK <- 1
DELAY <- 2
DirectorOptions <-
{
	A_CustomFinale_StageCount = 3
	A_CustomFinale1 = PANIC
	A_CustomFinaleValue1 = 1
	A_CustomFinale2 = DELAY
	A_CustomFinaleValue2 = 5
	A_CustomFinale3 = TANK
	A_CustomFinaleValue3 = 1
	TankLimit = 1
}
function OnBeginCustomFinaleStage( num, type )
{
	printl( "[TEST] stage " + num + " type " + type );
}
`;

describe("checkNut", () => {
  it("reads a valid custom finale's stage list", () => {
    const report = checkNut(FINALE, "finale.nut");
    expect(report.ok).toBe(true);
    expect(report.stageCount).toBe(3);
    expect(report.stages.map((stage) => stage.type)).toEqual(["PANIC", "DELAY", "TANK"]);
    expect(report.stages[1]!.value).toBe("5");
    expect(report.functions).toContain("OnBeginCustomFinaleStage");
    expect(report.hasBanner).toBe(true);
  });

  it("reports a stage the count promises but the table omits", () => {
    const broken = FINALE.replace("\tA_CustomFinale3 = TANK\n", "");
    const report = checkNut(broken);
    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((entry) => entry.rule)).toContain("director-stage-missing");
  });

  it("reports a stage beyond the count, and an undefined stage value", () => {
    const extra = FINALE.replace("A_CustomFinale_StageCount = 3", "A_CustomFinale_StageCount = 2");
    expect(checkNut(extra).diagnostics.map((entry) => entry.rule)).toContain(
      "director-stage-extra",
    );
    const undefinedType = FINALE.replace("A_CustomFinale1 = PANIC", "A_CustomFinale1 = EXPLODE");
    expect(checkNut(undefinedType).diagnostics.map((entry) => entry.rule)).toContain(
      "director-stage-undefined",
    );
  });

  it("refuses Lua syntax that Squirrel cannot compile", () => {
    const report = checkNut(
      ["printl( \"x\" )", "if x then", "  nil", "end", "y ~= 1"].join("\n"),
    );
    expect(report.ok).toBe(false);
    const rules = report.diagnostics.map((entry) => entry.rule);
    expect(rules).toContain("nut-lua-then");
    expect(rules).toContain("nut-lua-nil");
    expect(rules).toContain("nut-lua-end");
    expect(rules).toContain("nut-lua-ne");
  });

  it("does not read `end` inside a string or a comment as Lua", () => {
    const source = '// end is mentioned here\nprintl( "the end" )\nfunction f() { return 1 }\n';
    const report = checkNut(source);
    expect(report.diagnostics.map((entry) => entry.rule)).not.toContain("nut-lua-end");
    expect(report.ok).toBe(true);
    expect(stripNut(source)).not.toContain("the end");
  });

  it("warns about IncludeScript with the extension or the root prefix", () => {
    const report = checkNut(
      'printl( "x" )\nIncludeScript( "scripts/vscripts/lib.nut" )\n',
    );
    const rules = report.diagnostics.map((entry) => entry.rule);
    expect(rules).toContain("nut-include-extension");
    expect(rules).toContain("nut-include-root");
    expect(report.ok).toBe(true);
  });

  it("does not treat a pre-decrement statement as a Lua comment", () => {
    // `--length;` is Squirrel's pre-decrement, not a comment. The checker used to warn on
    // every line starting with `--`, which made a valid script fail validate_addon.
    const code = "local n = 3\n--n;\nprintl( n )\n";
    const report = checkNut(code);
    expect(report.diagnostics.map((entry) => entry.rule)).not.toContain(
      "nut-lua-line-comment",
    );
    expect(report.ok).toBe(true);

    const comment = checkNut("printl( 1 )\n-- this is a Lua comment\n");
    expect(comment.diagnostics.map((entry) => entry.rule)).toContain("nut-lua-line-comment");
  });

  it("reports an unbalanced delimiter with the line it opened on", () => {
    const report = checkNut('printl( "x" )\nfunction f()\n{\n\tif (1) {\n}\n');
    expect(report.ok).toBe(false);
    const entry = report.diagnostics.find((item) => item.rule === "nut-unbalanced");
    expect(entry?.line).toBe(3);
  });

  it("calls an unknown DirectorOptions key information, not an error", () => {
    const report = checkNut(FINALE.replace("TankLimit = 1", "SomeFutureKey = 1"));
    const entry = report.diagnostics.find((item) => item.rule === "director-unknown-key");
    expect(entry?.severity).toBe("info");
    expect(report.ok).toBe(true);
  });

  it("says an event hook needs a logic_script entity", () => {
    const report = checkNut(
      'printl( "hooks" )\n\nfunction OnGameEvent_player_spawn( params )\n{\n\tprintl( "spawn " + params.userid );\n}\n',
    );
    const entry = report.diagnostics.find((item) => item.rule === "nut-event-hook-needs-entity");
    expect(entry?.severity).toBe("info");
    expect(entry?.message).toContain("OnGameEvent_player_spawn");
    expect(report.ok).toBe(true);
  });

  it("knows mapspawn_addon is a global script, not an orphaned include", () => {
    const report = checkNut(
      'printl( "hooks" )\n\nfunction OnGameEvent_player_spawn( params )\n{\n}\n',
      "scripts/vscripts/mapspawn_addon.nut",
    );
    const entry = report.diagnostics.find((item) => item.rule === "nut-event-hook-needs-entity");
    expect(entry?.message).toContain("global addon script");
    expect(entry?.message).not.toContain("logic_script entity");
  });
});
