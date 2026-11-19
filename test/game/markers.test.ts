/**
 * The ordered log matcher behind `run_map_test`'s `markers`.
 *
 * The property that matters is order: `Loading:` appears once per map, and a finale test
 * that greps the whole log would accept an earlier map's line. The matcher searches from
 * the end of the previous hit, so a pattern that occurs twice must be satisfied by the
 * second occurrence for the second step.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { waitForMarkers } from "../../src/scripts/typescript/game/launch.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-markers-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("waitForMarkers", () => {
  it("matches each step from the end of the previous one", async () => {
    const log = join(scratch, "ordered.log");
    writeFileSync(log, "Loading: 1\nFinale started\nLoading: 2\nMission credits\n");
    const result = await waitForMarkers(
      log,
      [
        { name: "load", pattern: "Loading: \\d" },
        { name: "finale", pattern: "Finale started" },
        { name: "next-load", pattern: "Loading: \\d" },
        { name: "credits", pattern: "Mission credits" },
      ],
      2000,
      () => true,
      50,
    );
    expect(result.reason).toBe("matched");
    expect(result.missing).toEqual([]);
    expect(result.hits.map((hit) => hit.name)).toEqual([
      "load",
      "finale",
      "next-load",
      "credits",
    ]);
    // The second `Loading:` is the one the third step matched, not the first.
    expect(result.hits[2]!.line).toBe("Loading: 2");
    expect(result.hits[3]!.line).toBe("Mission credits");
  });

  it("reports the step that never came, and everything after it", async () => {
    const log = join(scratch, "missing.log");
    writeFileSync(log, "Loading: 1\n");
    const result = await waitForMarkers(
      log,
      [
        { name: "load", pattern: "Loading" },
        { name: "escape", pattern: "FinaleEscapeStarted", withinSeconds: 1 },
        { name: "credits", pattern: "Mission credits" },
      ],
      1500,
      () => true,
      50,
    );
    expect(result.reason).toBe("timeout");
    expect(result.hits.map((hit) => hit.name)).toEqual(["load"]);
    expect(result.missing).toEqual(["escape", "credits"]);
  });

  it("stops when the game exits", async () => {
    const log = join(scratch, "exited.log");
    writeFileSync(log, "");
    const result = await waitForMarkers(
      log,
      [{ name: "load", pattern: "Loading" }],
      5000,
      () => false,
      50,
    );
    expect(result.reason).toBe("exited");
    expect(result.missing).toEqual(["load"]);
  });
});
