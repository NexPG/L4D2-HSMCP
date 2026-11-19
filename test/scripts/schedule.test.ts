/**
 * The schedule generator: timed server commands for `run_map_test`.
 *
 * The output has to be Squirrel the engine can compile, and it has to keep the one limit of
 * `AddOutput` in view -- its parameter is comma-separated, so a command carrying a comma,
 * a quote or a newline cannot travel through it.
 */
import { describe, expect, it } from "vitest";
import { checkNut } from "../../src/scripts/typescript/vscript/check.js";
import { scheduleScript } from "../../src/scripts/typescript/vscript/schedule.js";

describe("scheduleScript", () => {
  it("writes nothing when there is nothing to schedule", () => {
    expect(scheduleScript([])).toBe("");
  });

  it("produces a script the checker accepts, with one timer per entry", () => {
    const text = scheduleScript([
      { atSeconds: 60, command: "echo HSMCP_TICK_60" },
      { atSeconds: 240, command: "director_stop 1" },
    ]);
    expect(checkNut(text).ok).toBe(true);
    expect(text).toContain('SpawnEntityFromTable( "point_servercommand"');
    expect(text).toContain('hsmcp_schedule_timer( "hsmcp_sched_1", 60.0, "echo HSMCP_TICK_60" );');
    expect(text).toContain('hsmcp_schedule_timer( "hsmcp_sched_2", 240.0, "director_stop 1" );');
    expect(text).toContain("RefireTime = seconds");
    expect(text).toContain("OnTimer hsmcp_sched_cmd,Command,");
  });

  it("refuses what AddOutput cannot carry", () => {
    for (const command of ["echo a,b", 'echo "quoted"', "echo line\nbreak"]) {
      expect(() => scheduleScript([{ atSeconds: 10, command }])).toThrow(/comma|quote|newline/);
    }
  });

  it("refuses a non-positive time and an empty command", () => {
    expect(() => scheduleScript([{ atSeconds: 0, command: "echo x" }])).toThrow(/positive/);
    expect(() => scheduleScript([{ atSeconds: 5, command: "   " }])).toThrow(/empty/);
  });
});
