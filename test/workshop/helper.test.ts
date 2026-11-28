import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/core/typescript/config.js";
import { steamApiDllPath } from "../../src/packages/typescript/workshop/client.js";
import { legacyHelperStatus } from "../../src/packages/typescript/workshop/legacy.js";
import { REPO } from "../support/env.js";

describe("Workshop helper paths", () => {
  it("resolves the Steam API DLL bundled with the binding", () => {
    const dll = steamApiDllPath();
    expect(dll).not.toBeNull();
    expect(dll!.toLowerCase()).toContain("steam_api64.dll");
    expect(existsSync(dll!)).toBe(true);
  });

  it("reports the helper source, compiler and cache without building", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "l4d2-hsmcp-workshop-"));
    const status = legacyHelperStatus({ repoRoot: REPO, stateDir } as Config);
    const cacheDir = join(stateDir, "workshop", "legacy");
    expect(status.source).toContain("WorkshopLegacy.cs");
    expect(status.cacheDir).toBe(cacheDir);
    expect(status.exe).toBe(join(cacheDir, "WorkshopLegacy.exe"));
    expect(status.csc === null || existsSync(status.csc)).toBe(true);
    expect(status.dll === null || existsSync(status.dll)).toBe(true);
    expect(status.built).toBe(false);
    expect(status.stale).toBe(true);
  });
});
