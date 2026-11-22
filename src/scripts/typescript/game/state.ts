/**
 * The game install's own state, separate from a map: backups an interrupted run left,
 * hidden archives, a non-blank listen-server config, and test files.
 *
 * `run_map_test` has a `finally`, but a killed process never reaches it. This module is the
 * one place that knows the suffixes and the restore rule, so the runner and the
 * `check_game_state` tool cannot disagree about what "clean" means.
 */
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

export const BACKUP_SUFFIX = ".hsmcp-backup";

export type GameStateSeverity = "error" | "warning" | "info";

export interface GameStateFinding {
  severity: GameStateSeverity;
  rule: string;
  message: string;
  path: string;
}

export interface GameStateReport {
  gameDir: string;
  clean: boolean;
  listenserverPath: string;
  listenserverBlank: boolean;
  backups: string[];
  hiddenArchives: string[];
  testMaps: string[];
  testScripts: string[];
  testAddons: string[];
  findings: GameStateFinding[];
  restorable: number;
}

/** Restores one `<file>.hsmcp-backup`, leaving the backup removed on success. */
export function restoreBackup(backup: string): boolean {
  if (!existsSync(backup)) return false;
  const target = backup.slice(0, -BACKUP_SUFFIX.length);
  try {
    copyFileSync(backup, target);
    rmSync(backup, { force: true });
    return true;
  } catch {
    return false;
  }
}

function backupFiles(gameDir: string): string[] {
  const found: string[] = [];
  for (const relative of [["cfg"], ["maps"], ["scripts", "vscripts"]]) {
    const dir = join(gameDir, ...relative);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(BACKUP_SUFFIX)) found.push(join(dir, entry));
    }
  }
  return found;
}

function entries(gameDir: string, relative: string[]): string[] {
  const dir = join(gameDir, ...relative);
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** Restores every interrupted-run backup and hidden archive. */
export function restoreGameState(gameDir: string): number {
  let restored = 0;
  for (const backup of backupFiles(gameDir)) {
    if (restoreBackup(backup)) restored += 1;
  }
  const addons = join(gameDir, "addons");
  if (existsSync(addons)) {
    for (const entry of readdirSync(addons)) {
      if (!entry.toLowerCase().endsWith(".vpk.off")) continue;
      const target = join(addons, entry.slice(0, -4));
      if (!existsSync(target)) {
        renameSync(join(addons, entry), target);
        restored += 1;
      }
    }
  }
  return restored;
}

/** Sweeps only the restorable files, for a run that is about to start. */
export function sweepInterruptedState(gameDir: string): number {
  return restoreGameState(gameDir);
}

/** Reports what is left in the game install, without changing anything. */
export function scanGameState(gameDir: string): GameStateReport {
  const findings: GameStateFinding[] = [];
  const add = (severity: GameStateSeverity, rule: string, message: string, path: string): void => {
    findings.push({ severity, rule, message, path });
  };

  const listenserverPath = join(gameDir, "cfg", "listenserver.cfg");
  let listenserverBlank = true;
  if (existsSync(listenserverPath)) {
    const text = readFileSync(listenserverPath, "utf8");
    listenserverBlank = text
      .split(/\r?\n/)
      .every((line) => line.trim() === "" || line.trimStart().startsWith("//"));
    if (!listenserverBlank) {
      add(
        "warning",
        "listenserver-not-blank",
        "cfg/listenserver.cfg has content; a test run may have left a map or sv_cheats behind",
        listenserverPath,
      );
    }
  }

  const backups = backupFiles(gameDir);
  for (const backup of backups) {
    add(
      "warning",
      "state-backup-left",
      `${backup.slice(gameDir.length + 1)} is a backup from an interrupted run`,
      backup,
    );
  }

  const addonsDir = join(gameDir, "addons");
  const hiddenArchives = existsSync(addonsDir)
    ? readdirSync(addonsDir)
        .filter((entry) => entry.toLowerCase().endsWith(".vpk.off"))
        .map((entry) => join(addonsDir, entry))
    : [];
  for (const hidden of hiddenArchives) {
    add(
      "warning",
      "addon-left-hidden",
      `${hidden.slice(gameDir.length + 1)} is still hidden; run_map_test would restore it`,
      hidden,
    );
  }

  const testMaps = entries(gameDir, ["maps"]).filter((entry) =>
    /^(hmcp_|hsmcp_)/i.test(entry),
  );
  for (const entry of testMaps) {
    add(
      "info",
      "test-map-present",
      `test map ${entry} is in maps/; it is not a stock map`,
      join(gameDir, "maps", entry),
    );
  }

  const testScripts = entries(gameDir, ["scripts", "vscripts"]).filter((entry) =>
    /^(hmcp_|hsmcp_)/i.test(entry),
  );
  for (const entry of testScripts) {
    add(
      "info",
      "test-script-present",
      `test script ${entry} is in scripts/vscripts`,
      join(gameDir, "scripts", "vscripts", entry),
    );
  }

  const testAddons = entries(gameDir, ["addons"]).filter((entry) =>
    /^(hmcp_|hsmcp_)/i.test(entry),
  );
  for (const entry of testAddons) {
    add(
      "info",
      "test-addon-present",
      `add-on ${entry} matches the test prefix; confirm whether it is yours`,
      join(gameDir, "addons", entry),
    );
  }

  return {
    gameDir,
    clean: !findings.some((finding) => finding.severity !== "info"),
    listenserverPath,
    listenserverBlank,
    backups,
    hiddenArchives,
    testMaps,
    testScripts,
    testAddons,
    findings,
    restorable: backups.length + hiddenArchives.length,
  };
}
