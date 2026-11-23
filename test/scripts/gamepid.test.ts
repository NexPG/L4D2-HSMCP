import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  clearRecordedGamePid,
  readRecordedGamePid,
  recordGamePid,
} from "../../src/scripts/typescript/game/launch.js";

const scratch = mkdtempSync(join(tmpdir(), "hsmcp-gamepid-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the game pid record", () => {
  it("round-trips the pid a run must close next time", () => {
    const file = join(scratch, "running-game.json");
    expect(readRecordedGamePid(file)).toBeNull();
    recordGamePid(file, 4242);
    expect(readRecordedGamePid(file)).toBe(4242);
    clearRecordedGamePid(file);
    expect(readRecordedGamePid(file)).toBeNull();
  });

  it("ignores a corrupt record instead of failing a run", () => {
    const file = join(scratch, "broken.json");
    writeFileSync(file, "{not json", "utf8");
    expect(readRecordedGamePid(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ pid: "nope" }), "utf8");
    expect(readRecordedGamePid(file)).toBeNull();
  });
});
