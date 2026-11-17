import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  flowWarnings,
  gameExecutable,
  navGenerateConfig,
  waitForFile,
  waitForLog,
} from "../../src/game/launch.js";

const scratch = mkdtempSync(join(tmpdir(), "hsmcp-game-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("gameExecutable", () => {
  it("puts left4dead2.exe beside the game directory, not inside it", () => {
    const exe = gameExecutable(join("D:", "SteamLibrary", "Left 4 Dead 2", "left4dead2"));
    expect(dirname(exe)).toBe(join("D:", "SteamLibrary", "Left 4 Dead 2"));
    expect(exe.endsWith("left4dead2.exe")).toBe(true);
  });
});

describe("navGenerateConfig", () => {
  it("contains the two commands nav_generate actually needs", () => {
    const lines = navGenerateConfig().trim().split("\n");
    expect(lines).toEqual(["sv_cheats 1", "nav_edit 1", "nav_mark_walkable", "nav_generate"]);
  });

  it("passes a slope limit before generation when one is given", () => {
    const lines = navGenerateConfig(0.5).trim().split("\n");
    expect(lines).toEqual([
      "sv_cheats 1",
      "nav_edit 1",
      "nav_slope_limit 0.5",
      "nav_mark_walkable",
      "nav_generate",
    ]);
  });
});

describe("flowWarnings", () => {
  it("keeps the lines that mean the Director found no goal", () => {
    const log = [
      "Generating Navigation Mesh...",
      "GetGoalArea: Cannot find end area - no checkpoint or finale located.",
      "Flow Warning: Checkpoint failed to locate nearby info_change_level!",
      "NAV ERRORS - Map is unplayable!",
      "nav file saved.",
    ].join("\r\n");
    const found = flowWarnings(log);
    expect(found).toHaveLength(3);
    expect(found[0]).toContain("GetGoalArea");
  });

  it("is quiet on a healthy log", () => {
    expect(flowWarnings("navigation areas connected\nnav file saved.")).toEqual([]);
  });
});

describe("waitForLog / waitForFile", () => {
  it("matches a pattern already in the file", async () => {
    const path = join(scratch, "console.log");
    writeFileSync(path, "Host_NewGame on map hsmcp_test_m2\n");
    await expect(waitForLog(path, /hsmcp_test_m2/, 1000, () => true, 10)).resolves.toBe(
      "matched",
    );
  });

  it("reports a process that exited before the pattern appeared", async () => {
    const path = join(scratch, "empty.log");
    writeFileSync(path, "still loading\n");
    await expect(waitForLog(path, /never/, 1000, () => false, 10)).resolves.toBe("exited");
  });

  it("times out when the file never appears", async () => {
    await expect(
      waitForFile(join(scratch, "missing.nav"), 50, () => true, 10),
    ).resolves.toBe("timeout");
  });

  it("matches an existing file", async () => {
    const path = join(scratch, "present.nav");
    writeFileSync(path, "");
    await expect(waitForFile(path, 1000, () => true, 10)).resolves.toBe("matched");
  });
});
