/**
 * Configuration, loaded from `<repoRoot>/.hammer-mcp/config.json` when present, otherwise
 * defaults. Every field in the file is optional and gets filled in.
 *
 * This fork targets **Left 4 Dead 2 only**. There is therefore no `game` selector and no
 * per-game table of paths here: the one profile is resolved by discovery
 * (`src/games/profile.ts`) and may be overridden through `gameProfiles.l4d2`.
 *
 * The Source toolchain lives OUTSIDE the repo, in the Steam library, so its paths are
 * machine-specific by nature. Nothing here may be assumed to exist: every tool that
 * depends on `binDir` degrades to a reported reason rather than throwing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig as coreLoadConfig } from "@projectsociety/mcp-core";
import { z } from "zod";
import { GameProfileOverride } from "./games/profile.js";
import type { ResolvedGame } from "./games/profile.js";
import { gameFor } from "./games/resolve.js";

export const ConfigFile = z.object({
  /** Root of the repository this server treats as its working tree. */
  repoRoot: z.string().optional(),
  /**
   * Directory holding the standalone tools this server can drive, beyond the compilers.
   *
   * These are separate downloads that belong to no game install -- ficool2's
   * `bsp_rename.exe` is the first, the Tools++ compilers are another -- so they cannot be
   * discovered the way `bin/` is.
   *
   * Defaults to `<stateDir>/tools`, i.e. `.hammer-mcp/tools`. Not `<repoRoot>/tools`,
   * which is the repository's own scripts, not ours.
   */
  externalToolsDir: z.string().optional(),
  /**
   * Overrides for the `l4d2` profile. Anything discovery gets wrong or cannot see goes
   * here -- a game installed outside Steam, compilers in a separate app, an unusual
   * `-game` directory.
   */
  gameProfiles: z.record(GameProfileOverride).default({}),
  /**
   * Interpreter for the Python sidecar. Defaults to the venv `src/core/python/setup.ps1` builds
   * under the state directory. Set it only to point at an interpreter you manage.
   */
  sidecarPython: z.string().optional(),
  /** Tools allowed without confirmation. Empty means the default policy. */
  toolAllowlist: z.array(z.string()).default([]),
  /**
   * The name written as `addonauthor` in addoninfo.txt and `Author` in a campaign mission.
   *
   * This is a person, not the toolkit's author. It is asked once and stored here; there is
   * deliberately no built-in default, because a default would put the wrong name on someone
   * else's addon. A generation tool refuses until this is set.
   */
  addonAuthor: z.string().optional(),
});
export type ConfigFile = z.infer<typeof ConfigFile>;

export interface Config extends ConfigFile {
  repoRoot: string;
  /** Runtime state directory: `<repoRoot>/.hammer-mcp`. */
  stateDir: string;
  /** The compilers and `.fgd` files of the resolved game. Null when the game is absent. */
  binDir: string | null;
  /** The `-game` argument. Null when the game is absent. */
  gameDir: string | null;
  /** The Tools++ compilers, when they are installed. Null is the normal case. */
  plusPlusBinDir: string | null;
}

/** Defines a property computed on first read and remembered afterwards. */
function lazy<T>(target: object, key: string, compute: () => T): void {
  let done = false;
  let value: T;
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get(): T {
      if (!done) {
        value = compute();
        done = true;
      }
      return value;
    },
  });
}

/**
 * Loads the effective configuration. The root is resolved in this order:
 * 1. `HAMMER_MCP_REPO` (env)  2. the file's `repoRoot` field  3. walking up from cwd.
 *
 * `binDir`, `gameDir` and `plusPlusBinDir` are resolved **lazily**: reading them scans
 * the Steam libraries, and loading a configuration must stay a file read. A machine with
 * no Left 4 Dead 2 gets null, which every tool reports rather than guessing a path.
 */
export function loadConfig(cwd: string = process.cwd()): Config {
  const config = coreLoadConfig(
    { envVar: "HAMMER_MCP_REPO", stateDirName: ".hammer-mcp", schema: ConfigFile },
    cwd,
  ) as Config;

  const active = (): ResolvedGame | null => {
    try {
      return gameFor(config).game;
    } catch {
      // An unusable profile is reported by the tools that use it, not by throwing out of
      // the config loader -- health has to stay callable to say what is wrong.
      return null;
    }
  };

  if (config.externalToolsDir === undefined) {
    config.externalToolsDir = join(config.stateDir, "tools");
  }

  lazy(config, "binDir", () => active()?.binDir ?? null);
  lazy(config, "gameDir", () => active()?.gameDir ?? null);
  lazy(config, "plusPlusBinDir", () => active()?.plusPlusBinDir ?? null);

  return config;
}

/** The local configuration file: `<repoRoot>/.hammer-mcp/config.json`. */
export function configFilePath(repoRoot: string): string {
  return join(repoRoot, ".hammer-mcp", "config.json");
}

/**
 * Writes one configuration value, preserving every other field in the file.
 *
 * The file is local (`<repoRoot>/.hammer-mcp/config.json`, gitignored), not the example at
 * the repository root. It is rewritten as JSON, which is the format the loader reads; a
 * person's existing fields and unknown fields survive.
 */
export function writeConfigValue(
  repoRoot: string,
  key: string,
  value: unknown,
): { path: string; previous: unknown } {
  const path = configFilePath(repoRoot);
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed local file must not be silently replaced by a one-key object: the
      // person would lose their paths. Refuse and name the file instead.
      throw new Error(`${path} is not valid JSON; fix or move it before changing ${key}`);
    }
  }
  const previous = existing[key];
  existing[key] = value;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  return { path, previous };
}

export { findRepoRoot } from "@projectsociety/mcp-core";
