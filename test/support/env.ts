/**
 * What the machine running the tests actually has.
 *
 * Most of this suite is not a unit test: it drives the real Source toolchain, the real
 * Python sidecar, and real maps. None of that ships with the repo, so nearly
 * every file guarded itself with its own `existsSync` against its own hand-built path.
 * Six of them also computed the repo root as `test/fixtures/../../..` -- three levels up,
 * which lands OUTSIDE this repository and only resolves to anything meaningful when the
 * checkout happens to sit inside the private workspace it was written in.
 *
 * One place decides all of it now, and `HAMMER_MCP_REPO` overrides the guess, so a
 * contributor with a different layout points the suite at their tree instead of editing
 * six files.
 *
 * The other half of the job is being loud. A skipped test and a passing test look the
 * same in a green summary, and a contributor who runs `pnpm test` on a bare machine
 * deserves to know that the compiler tests never ran rather than to conclude the
 * toolchain works. `announceMissing()` says what is absent, once per process.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../../src/core/typescript/config.js";
import { loadConfig } from "../../src/core/typescript/config.js";
import { pythonPath } from "../../src/core/typescript/sidecar/client.js";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/**
 * The tree the server anchors its state and its game content to.
 *
 * `HAMMER_MCP_REPO` wins. Otherwise the repository root itself: `test/fixtures` is two
 * levels below it. (It used to be three, the private workspace layout this project was
 * born in, which made every game-content predicate false on a normal checkout.)
 */
export function repoRoot(): string {
  return process.env.HAMMER_MCP_REPO ?? join(FIXTURES, "..", "..");
}

export const REPO = repoRoot();
export const config: Config = loadConfig(REPO);

/** A minimal ToolContext. The audit log is a sink: no test asserts on it. */
export const ctx = {
  config,
  audit: { record: () => undefined },
} as unknown as { config: Config; audit: { record: () => void } };

const GAME_CONTENT = {
  /** The production map: 1.13 GB, never committed, the only oracle at real scale. */
  prodMap: join(REPO, "srcds/garrysmod/addons/rp_nycity_day/maps/rp_nycity_day.bsp"),
  /** The only large Hammer-written VMF around, shipped inside the TTT gamemode. */
  tttSource: join(REPO, "srcds/garrysmod/gamemodes/terrortown/mapexamples/ttt_traps.vmf"),
  mapsDir: join(REPO, "srcds/garrysmod/maps"),
} as const;

export const paths = GAME_CONTENT;

export const has = {
  /** The stock compilers, which ship with the game client. */
  toolchain: config.binDir !== null && existsSync(join(config.binDir, "vbsp.exe")),
  /** ficool2's rebuild, installed separately. Absent is the normal case. */
  plusplus:
    config.plusPlusBinDir !== null &&
    [`vbsp++.exe`, `vbspplusplus.exe`].some((n) => existsSync(join(config.plusPlusBinDir as string, n))),
  /** The game's own addon packer. */
  vpk: config.binDir !== null && existsSync(join(config.binDir, "vpk.exe")),
  /** The srctools venv built by src/core/python/setup.ps1. */
  sidecar: existsSync(pythonPath(config)),
  /** The .fgd files, which live beside the compilers. */
  fgd: config.binDir !== null && existsSync(join(config.binDir, "left4dead2.fgd")),
  plusFgd:
    config.plusPlusBinDir !== null &&
    existsSync(join(config.plusPlusBinDir, "toolsplusplus.fgd")),
  prodMap: existsSync(GAME_CONTENT.prodMap),
  tttSource: existsSync(GAME_CONTENT.tttSource),
  navPair:
    existsSync(join(GAME_CONTENT.mapsDir, "gm_construct.nav")) &&
    existsSync(join(GAME_CONTENT.mapsDir, "gm_construct.bsp")),
  /**
   * The game's own content, as srctools mounts it: `gameinfo.txt` is the honest predicate.
   */
  gameContent: config.gameDir !== null && existsSync(join(config.gameDir, "gameinfo.txt")),
  /**
   * ficool2's bsp_rename, a standalone download that belongs to no game install.
   *
   * Absent is the normal case, here as on any fresh clone: it is not ours to
   * redistribute, so it cannot be committed and cannot be discovered either.
   */
  bspRename: existsSync(
    join(config.externalToolsDir ?? join(config.stateDir, "tools"), "bsp_rename.exe"),
  ),
  /** ficool2's tga2skybox, same story as bsp_rename: a separate download. */
  tga2skybox: existsSync(
    join(config.externalToolsDir ?? join(config.stateDir, "tools"), "tga2skybox.exe"),
  ),
  /** ficool2's cubemap2hdr. Its input has to come out of a map, so it also needs navPair. */
  cubemap2hdr: existsSync(
    join(config.externalToolsDir ?? join(config.stateDir, "tools"), "cubemap2hdr.exe"),
  ),
  /** VTFCmd, the command-line half of VTFEdit++. Needs DevIL.dll beside it. */
  vtfcmd: existsSync(join(config.externalToolsDir ?? join(config.stateDir, "tools"), "VTFCmd.exe")),
} as const;

const LABELS: Record<keyof typeof has, string> = {
  toolchain: `the Left 4 Dead 2 compilers (${config.binDir ?? "no bin directory found"})`,
  plusplus: "the Tools++ compilers (optional)",
  vpk: "the game's vpk.exe",
  sidecar: "the Python sidecar venv (run src/core/python/setup.ps1)",
  fgd: "the game's .fgd files",
  plusFgd: "the Tools++ .fgd (optional)",
  prodMap: "a large production .bsp",
  tttSource: "a large Hammer-written .vmf",
  navPair: "a .nav / .bsp pair",
  gameContent: `the game's own content (${config.gameDir ?? "not found"})`,
  bspRename: `ficool2's bsp_rename.exe in ${config.externalToolsDir} (optional)`,
  tga2skybox: `ficool2's tga2skybox.exe in ${config.externalToolsDir} (optional)`,
  cubemap2hdr: `ficool2's cubemap2hdr.exe in ${config.externalToolsDir} (optional)`,
  vtfcmd: `VTFCmd.exe and DevIL.dll in ${config.externalToolsDir} (optional)`,
};

let announced = false;

/**
 * Prints, once, everything the machine does not have. Called from the setup file so it
 * runs whatever subset of the suite is invoked.
 */
export function announceMissing(): void {
  if (announced) return;
  announced = true;
  const missing = (Object.keys(has) as Array<keyof typeof has>).filter((k) => !has[k]);
  if (missing.length === 0) return;
  console.warn(
    `\n[hammer-mcp] Tests needing these are SKIPPED, not passing:\n` +
      missing.map((k) => `  - ${LABELS[k]}`).join("\n") +
      `\n  Repo root: ${REPO}${process.env.HAMMER_MCP_REPO ? " (HAMMER_MCP_REPO)" : ""}\n`,
  );
}
