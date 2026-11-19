/**
 * The process diff behind every "close what I opened" path.
 *
 * A tool must not kill a person's HLMV or Hammer. The snapshot taken immediately before the
 * spawn is the boundary, and `newPids` is the only thing that decides which pids are ours.
 * It is pure, so this runs without starting a process.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  forgetWindow,
  newPids,
  readWindowLedger,
  rememberWindow,
} from "../../src/core/typescript/process/windows.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-windows-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("newPids", () => {
  it("returns only pids that were not in the before snapshot", () => {
    expect(newPids([10, 20, 30], new Set([10, 30]))).toEqual([20]);
    expect(newPids([10, 20], new Set([10, 20]))).toEqual([]);
    expect(newPids([], new Set([1]))).toEqual([]);
  });

  it("keeps duplicate pids out of the result", () => {
    // A process list can transiently report the same pid twice; the caller kills a set.
    expect(newPids([7, 7, 8], new Set())).toEqual([7, 8]);
  });
});

describe("window ledger", () => {
  it("records a window, replaces the same pid and forgets it on a verified close", () => {
    rememberWindow(scratch, "hlmv", 1234);
    rememberWindow(scratch, "hlmv", 1234);
    expect(readWindowLedger(scratch)).toEqual([
      expect.objectContaining({ name: "hlmv", pid: 1234 }),
    ]);
    forgetWindow(scratch, 1234);
    expect(readWindowLedger(scratch)).toEqual([]);
  });

  it("ignores a malformed ledger instead of failing server start", () => {
    // A truncated write from a killed process must not stop the next run.
    const path = join(scratch, "windows.json");
    writeFileSync(path, "{not json", "utf8");
    expect(readWindowLedger(scratch)).toEqual([]);
    rememberWindow(scratch, "hammer", 4321);
    expect(readWindowLedger(scratch)).toEqual([
      expect.objectContaining({ name: "hammer", pid: 4321 }),
    ]);
  });
});
