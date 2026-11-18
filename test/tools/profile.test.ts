import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Config } from "../../src/core/typescript/config.js";
import { loadConfig } from "../../src/core/typescript/config.js";
import { BUILTIN_PROFILES, resolveProfiles } from "../../src/core/typescript/games/profile.js";
import { UnknownGameError, gameFor } from "../../src/core/typescript/games/resolve.js";
import { readVmfLint } from "../../src/maps/typescript/tools/vmf.js";
import { FIXTURES, ctx, has } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "l4d2-profile-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * A repo root carrying nothing but the config file under test.
 *
 * `HAMMER_MCP_REPO` is cleared for the call: it outranks the argument by design, so with
 * it set every test below silently loaded some other tree's configuration and asserted
 * against it.
 */
function rootWith(name: string, config: Record<string, unknown>): Config {
  const root = join(scratch, name);
  mkdirSync(join(root, ".hammer-mcp"), { recursive: true });
  writeFileSync(join(root, ".hammer-mcp", "config.json"), JSON.stringify(config));

  const saved = process.env["HAMMER_MCP_REPO"];
  delete process.env["HAMMER_MCP_REPO"];
  try {
    return loadConfig(root);
  } finally {
    if (saved !== undefined) process.env["HAMMER_MCP_REPO"] = saved;
  }
}

describe("the built-in table says only what it can back", () => {
  it("has exactly one profile, Left 4 Dead 2", () => {
    expect(BUILTIN_PROFILES.map((b) => b.id)).toEqual(["l4d2"]);
    const l4d2 = BUILTIN_PROFILES[0]!;
    expect(l4d2.steamAppId).toBe(550);
    expect(l4d2.installDir).toBe("Left 4 Dead 2");
    expect(l4d2.modDir).toBe("left4dead2");
    expect(l4d2.branch).toBe("l4d2");
  });

  it("hard-codes no FGD name and no lump ceiling anywhere", () => {
    // `GameData` is in gameinfo.txt, so writing a per-game FGD name here would be an
    // assertion nobody verified -- and a wrong FGD makes a lint accuse correct maps
    // without ever saying it guessed.
    const text = JSON.stringify(BUILTIN_PROFILES);
    expect(text).not.toMatch(/\.fgd/);
    expect(text).not.toMatch(/MAX_MAP/);
  });

  it("claims no Tools++ directory: the binaries are standalone", () => {
    // Since October 2026 Tools++ lives wherever it was unpacked, so no built-in path
    // could be true. It comes from configuration, and null is the honest default.
    for (const b of BUILTIN_PROFILES) {
      expect("plusPlusSubdir" in b).toBe(false);
    }
  });

  it("marks the game as unusable for compiling when it was never found", () => {
    const games = resolveProfiles({}, []);
    expect(Object.keys(games)).toEqual(["l4d2"]);
    expect(games["l4d2"]!.binDir).toBeNull();
    expect(games["l4d2"]!.gameDir).toBeNull();
    expect(games["l4d2"]!.unusableForCompile).toMatch(/not found/i);
  });
});

describe("provenance separates what was read from what was assumed", () => {
  it.skipIf(!has.toolchain)("takes the FGD from gameinfo.txt", () => {
    const { game } = gameFor(loadConfig(process.cwd()));
    expect(game.fgd.length).toBeGreaterThan(0);
    expect(game.provenance["fgd"]).toEqual({ source: "gameinfo.txt:GameData", verified: true });
    // L4D2 does not declare `InstancePath`; absent is the answer, not an unverified guess.
    if (game.instancePath) {
      expect(game.provenance["instancePath"]?.verified).toBe(true);
    } else {
      expect(game.provenance["instancePath"]).toBeUndefined();
    }
  });

  it("never marks a built-in guess as verified", () => {
    const games = resolveProfiles({}, []);
    for (const g of Object.values(games)) {
      for (const [key, p] of Object.entries(g.provenance)) {
        if (p.source === "builtin table") {
          expect(p.verified, `${g.id}.${key} claims a built-in guess is verified`).toBe(false);
        }
      }
    }
  });
});

describe("configuration overrides discovery", () => {
  it("routes gameProfiles.l4d2 to the one profile", () => {
    const config = rootWith("override", {
      gameProfiles: { l4d2: { binDir: "/tmp/l4d2/bin", gameDir: "/tmp/l4d2/game" } },
    });
    expect(gameFor(config).game.binDir).toBe("/tmp/l4d2/bin");
    expect(gameFor(config).game.gameDir).toBe("/tmp/l4d2/game");
    expect(config.binDir).toBe("/tmp/l4d2/bin");
    expect(config.gameDir).toBe("/tmp/l4d2/game");
  });

  it("accepts a Tools++ directory of its own", () => {
    const config = rootWith("plusplus", {
      gameProfiles: { l4d2: { plusPlusBinDir: "/opt/tools_plusplus" } },
    });
    expect(gameFor(config).game.plusPlusBinDir).toBe("/opt/tools_plusplus");
    expect(config.plusPlusBinDir).toBe("/opt/tools_plusplus");
  });
});

describe("choosing the profile", () => {
  it("uses the one supported game when the caller names none", () => {
    const config = rootWith("from", {});
    expect(gameFor(config).from).toBe("config");
    expect(gameFor(config).game.id).toBe("l4d2");
    expect(gameFor(config, "l4d2").from).toBe("argument");
  });

  it("refuses another game rather than answering about L4D2", () => {
    // The failure this prevents: asking for Garry's Mod, getting a Left 4 Dead 2 answer,
    // and having nothing in the output that says so.
    const config = rootWith("unknown", {});
    expect(() => gameFor(config, "gmod")).toThrow(UnknownGameError);
    expect(() => gameFor(config, "gmod")).toThrow(/Left 4 Dead 2 only/);
    expect(() => gameFor(config, "gmod")).toThrow(/read_source_games/);
  });
});

describe("the tools say which game they answered about", () => {
  const ready = has.sidecar && has.fgd;

  it.skipIf(!ready)("carries the profile into read_vmf_lint's output", async () => {
    const r = (await readVmfLint.handler(
      { path: join(FIXTURES, "hmcp_probe.vmf"), limit: 5, collapseInstances: false },
      ctx as never,
    )) as { game: { id: string; from: string }; fgdsLoaded: string[] };

    expect(r.game.id).toBe("l4d2");
    expect(r.game.from).toBe("config");
    // This name was read out of gameinfo.txt's GameData line, not written here.
    expect(r.fgdsLoaded[0]).toBe("left4dead2.fgd");
  }, 60_000);

  it.skipIf(!ready)("refuses a game it does not know, from inside a tool", async () => {
    await expect(
      readVmfLint.handler(
        { path: join(FIXTURES, "hmcp_probe.vmf"), limit: 5, collapseInstances: false, game: "css" },
        ctx as never,
      ),
    ).rejects.toThrow(UnknownGameError);
  }, 60_000);
});
