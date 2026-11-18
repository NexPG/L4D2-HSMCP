/**
 * Staging files into the game directory, and putting it back afterwards.
 *
 * Both the map test and the nav tools need the same three things: a loose BSP, its nav
 * beside it, and any add-on archive that carries the same map moved out of the way. They
 * used to each keep their own copy of that logic, which is how one of them ended up
 * restoring a file the other had already removed. The helpers here own the whole
 * lifecycle, and every caller gets the same behaviour: a backup only when something was
 * really there, nothing deleted that the tool did not install, and archives restored even
 * when the launch failed.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Config } from "../../../core/typescript/config.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";

const BACKUP_SUFFIX = ".hsmcp-backup";

export interface HiddenFile {
  path: string;
  off: string;
}

/**
 * Moves archives aside.
 *
 * A `.off` file left by a crashed run was previously renamed over, which failed on
 * Windows. Removing the stale marker first makes the operation idempotent.
 */
export function hideFiles(paths: readonly string[]): HiddenFile[] {
  const hidden: HiddenFile[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const off = `${path}.off`;
    rmSync(off, { force: true });
    renameSync(path, off);
    hidden.push({ path, off });
  }
  return hidden;
}

export function restoreFiles(hidden: readonly HiddenFile[]): void {
  for (const entry of hidden) {
    if (existsSync(entry.off)) renameSync(entry.off, entry.path);
  }
}

/**
 * Resolves an archive the caller named as a bare file name against the game's `addons/`.
 * `resolveInput` is the caller's job for paths; this only adds the place a bare VPK name
 * means in this game.
 */
export function resolveAddonPath(
  pathOrName: string,
  resolve: (p: string) => string,
  gameDir: string,
): string {
  const direct = resolve(pathOrName);
  if (existsSync(direct)) return direct;
  const inAddons = join(gameDir, "addons", basename(pathOrName));
  if (existsSync(inAddons)) return inAddons;
  return direct;
}

/**
 * Installed VPKs whose index contains `maps/<name>.bsp`.
 *
 * An archive mounted in `addons/` wins over a loose map in this engine. A nav generated
 * while one is present describes the archive's BSP while the build ships the loose one:
 * a stale pair that reads in game as "Map is unplayable".
 */
export async function findShadowingVpks(
  name: string,
  gameDir: string,
  config: Config,
): Promise<string[]> {
  const addons = join(gameDir, "addons");
  if (!existsSync(addons)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(addons)) {
    if (!entry.toLowerCase().endsWith(".vpk")) continue;
    const path = join(addons, entry);
    try {
      const listed = (await callSidecar(
        "vpk_list",
        { path, prefix: `maps/${name}.bsp`, limit: 10 },
        config,
        60_000,
      )) as { entries?: string[] };
      if ((listed.entries ?? []).some((p) => p.toLowerCase() === `maps/${name}.bsp`)) {
        found.push(path);
      }
    } catch {
      // A malformed or unreadable archive is not evidence of a shadow; leave it mounted.
    }
  }
  return found;
}

export interface StageOptions {
  gameDir: string;
  map: string;
  /** Absolute path to install as `maps/<map>.bsp`. */
  bsp?: string;
  /** Absolute path to install as `maps/<map>.nav`. */
  nav?: string;
}

export interface StagedMap {
  map: string;
  bspInstalled: boolean;
  navInstalled: boolean;
  /** Removes what this call installed and restores what was there before. */
  restore: () => void;
}

/**
 * Installs a BSP/nav pair into the game's `maps/`.
 *
 * Installing over the same path is a no-op rather than a copy onto itself: a caller that
 * already placed the map there (a gate reusing its nav output) should not have the tool
 * delete it on restore.
 */
export function stageMapPair(options: StageOptions): StagedMap {
  const targetBsp = join(options.gameDir, "maps", `${options.map}.bsp`);
  const targetNav = join(options.gameDir, "maps", `${options.map}.nav`);
  mkdirSync(dirname(targetBsp), { recursive: true });

  const backup = (target: string): boolean => {
    const file = `${target}${BACKUP_SUFFIX}`;
    if (!existsSync(target)) return false;
    rmSync(file, { force: true });
    copyFileSync(target, file);
    return true;
  };

  let bspInstalled = false;
  let navInstalled = false;
  let hadBsp = false;
  let hadNav = false;

  if (options.bsp && options.bsp !== targetBsp) {
    if (!existsSync(options.bsp)) throw new Error(`${options.bsp} does not exist`);
    hadBsp = backup(targetBsp);
    copyFileSync(options.bsp, targetBsp);
    bspInstalled = true;
  }
  if (options.nav && options.nav !== targetNav) {
    if (!existsSync(options.nav)) throw new Error(`${options.nav} does not exist`);
    hadNav = backup(targetNav);
    copyFileSync(options.nav, targetNav);
    navInstalled = true;
  }

  return {
    map: options.map,
    bspInstalled,
    navInstalled,
    restore: () => {
      if (bspInstalled) {
        rmSync(targetBsp, { force: true });
        if (hadBsp && existsSync(`${targetBsp}${BACKUP_SUFFIX}`)) {
          renameSync(`${targetBsp}${BACKUP_SUFFIX}`, targetBsp);
        }
      }
      if (navInstalled) {
        rmSync(targetNav, { force: true });
        if (hadNav && existsSync(`${targetNav}${BACKUP_SUFFIX}`)) {
          renameSync(`${targetNav}${BACKUP_SUFFIX}`, targetNav);
        }
      }
    },
  };
}
