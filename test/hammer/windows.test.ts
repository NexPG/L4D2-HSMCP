/**
 * `close_windows` is a process tool, so the tests are about what it refuses as much as what
 * it closes.
 *
 * A dry run must list without touching anything. An arbitrary PID must be refused: the tool
 * is for the three GUI programs this server can launch, not a general task killer. A real
 * close is exercised in the diary against seven leftover HLMV windows; a CI runner has no
 * HLMV, and spawning GUIs in a test would make the suite depend on a desktop.
 */
import { describe, expect, it } from "vitest";
import { closeWindowsTool } from "../../src/hammer/typescript/tools/windows.js";
import { ctx } from "../support/env.js";

describe("close_windows", () => {
  it("lists HLMV windows without closing them on a dry run", () => {
    const result = closeWindowsTool.handler(
      { kinds: ["hlmv"], dryRun: true, force: false, confirm: true } as never,
      ctx as never,
    ) as { dryRun: boolean; closed: unknown[]; remaining: unknown[]; note: string };

    expect(result.dryRun).toBe(true);
    expect(result.closed).toEqual([]);
    expect(Array.isArray(result.remaining)).toBe(true);
    expect(result.note).toMatch(/Nothing was closed/);
  });

  it("refuses a process that is not HLMV, Hammer or the game", () => {
    expect(() =>
      closeWindowsTool.handler(
        { kinds: ["hlmv"], processId: process.pid, dryRun: true, force: false, confirm: true } as never,
        ctx as never,
      ),
    ).toThrow(/does not close arbitrary processes/);
  });
});
