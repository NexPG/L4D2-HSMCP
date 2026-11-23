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
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const BACKUP_SUFFIX = ".hsmcp-backup";

/** The first line `run_map_test` writes into `cfg/listenserver.cfg`. */
const HARNESS_CFG_HEADER = "sv_cheats 1";
/** What a clean install has in that file; the game itself ships this comment. */
export const STOCK_CFG = "// PC listenserver cfg file - intentionally blank\n";

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
  testModels: string[];
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

/** True when `cfg/listenserver.cfg` is the file `run_map_test` wrote, not the user's. */
function isHarnessCfg(text: string): boolean {
  const first = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return first === HARNESS_CFG_HEADER;
}

/** Restores every interrupted-run backup and hidden archive. */
export function restoreGameState(gameDir: string): number {
  let restored = 0;
  for (const backup of backupFiles(gameDir)) {
    if (restoreBackup(backup)) restored += 1;
  }
  // The cfg may be left with no backup at all: the install had no file the harness could
  // copy, so a killed run leaves `sv_cheats 1` plus a map command behind and the next launch
  // would auto-load a test map. Only a file with the harness's own header is touched.
  const listenserver = join(gameDir, "cfg", "listenserver.cfg");
  if (!existsSync(listenserver)) {
    // A killed run whose install had no file to copy leaves nothing to restore, and the
    // next `run_map_test` fails on `copyFileSync(missing -> backup)`. Put the stock blank
    // file back; the game ships it, so its absence is not a user configuration.
    mkdirSync(dirname(listenserver), { recursive: true });
    writeFileSync(listenserver, STOCK_CFG, "utf8");
    restored += 1;
  } else if (!existsSync(`${listenserver}${BACKUP_SUFFIX}`)) {
    const text = readFileSync(listenserver, "utf8");
    if (isHarnessCfg(text)) {
      writeFileSync(listenserver, STOCK_CFG, "utf8");
      restored += 1;
    }
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
  if (!existsSync(listenserverPath)) {
    // Missing is not blank: `run_map_test` cannot snapshot it, and a killed run leaves no
    // backup. Restore creates the stock file.
    listenserverBlank = false;
    add(
      "warning",
      "listenserver-missing",
      "cfg/listenserver.cfg is absent; run_map_test cannot snapshot it. " +
        "check_game_state {restore: true} writes the stock blank file",
      listenserverPath,
    );
  } else {
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

  const testModels = entries(gameDir, ["models"]).filter((entry) =>
    /^(hmcp_|hsmcp_)/i.test(entry),
  );
  for (const entry of testModels) {
    add(
      "info",
      "test-model-present",
      `test model ${entry} is in models/; it is not stock content`,
      join(gameDir, "models", entry),
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
    testModels,
    findings,
    restorable:
      backups.length +
      hiddenArchives.length +
      (existsSync(listenserverPath) &&
      !existsSync(`${listenserverPath}${BACKUP_SUFFIX}`) &&
      isHarnessCfg(readFileSync(listenserverPath, "utf8"))
        ? 1
        : 0),
  };
}
