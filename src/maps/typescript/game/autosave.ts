/**
 * Hammer's autosaves: where they are, and which one is newer than the file on disk.
 *
 * This is the one feature that turns "the editor crashed" from a lost evening into a copy.
 * Hammer writes `<map>_NNN.vmf_autosave` into a folder the *user* chose, in one of three
 * places depending on the editor:
 *
 * * Hammer++ — `[General] AutosaveDir` and `AutosaveEnabled` in
 *   `bin\hammerplusplus\hammerplusplus_settings.ini` next to the executable;
 * * stock Hammer — `Autosave Dir` / `Autosaves Enabled` under
 *   `HKCU\Software\Valve\Hammer\General`;
 * * nothing configured — no folder, and saying so is more useful than guessing one.
 *
 * Each autosave carries a `versioninfo` block whose `originalname` is the map it came from.
 * That is the only reliable link: two maps in different folders can share a base name, and
 * matching on the name alone would offer a mapper the wrong file.
 *
 * Behaviour and file layout ported from EpicMorg/Hammer-MCP `Maps/Autosaves.cs` (MIT,
 * Copyright (c) 2026 EpicMorg), which found the three locations by testing them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

export type AutosaveSource = "argument" | "hammer++ settings" | "registry" | "unknown";

export interface AutosaveFolder {
  /** Absolute folder when one is configured. Null means "not configured", not "empty". */
  folder: string | null;
  enabled: boolean;
  source: AutosaveSource;
  /** What to tell a caller when the folder is unknown or disabled. */
  detail: string;
}

export interface Autosave {
  path: string;
  file: string;
  /** ISO timestamp of the file's last write. */
  written: string;
  mapVersion: number | null;
  /** The map path recorded in `versioninfo`; null when the file has none. */
  originalName: string | null;
  /** True when this autosave is newer than the saved map it belongs to. */
  newerThanMap: boolean;
}

/** `[General] AutosaveDir` / `AutosaveEnabled` from Hammer++'s settings file. */
export function hammerPlusPlusAutosaveFolder(iniPath: string): { folder: string | null; enabled: boolean } | null {
  if (!existsSync(iniPath)) return null;
  let folder: string | null = null;
  let enabled = true;
  let section = "";
  for (const raw of readFileSync(iniPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      section = line.replace(/^\[|\]$/g, "");
      continue;
    }
    if (section.toLowerCase() !== "general" || !line.includes("=")) continue;
    const at = line.indexOf("=");
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (key === "autosavedir") folder = value || null;
    if (key === "autosaveenabled") enabled = value !== "0";
  }
  return { folder, enabled };
}

/** True for `C:\x` or `\\server\share`; Hammer rejects a relative autosave folder. */
export function isAbsoluteWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * `Autosave Dir` / `Autosaves Enabled` from the registry, for stock Hammer.
 *
 * `reg.exe` rather than a Win32 binding: this project has no native dependency, and the
 * tool is present on every Windows install. A machine without it (or a non-Windows CI run)
 * gets `null`, which is reported as "not found", never as "no autosaves".
 */
export function registryAutosaveFolder(): { folder: string | null; enabled: boolean } | null {
  const query = (name: string): string | null => {
    try {
      const out = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Hammer\\General", "/v", name], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      });
      // The value is the last whitespace-separated field: `    Autosave Dir    REG_SZ    C:\maps`
      const match = out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`, "i"));
      return match?.[1]?.trim() ?? null;
    } catch {
      return null;
    }
  };

  const folder = query("Autosave Dir");
  const enabledRaw = query("Autosaves Enabled");
  if (folder === null && enabledRaw === null) return null;
  return {
    folder: folder === null || folder === "" ? null : folder,
    // `REG_DWORD    0x1` is enabled; absent defaults to enabled, as Hammer does.
    enabled: enabledRaw === null || !/0x0|^0$/i.test(enabledRaw),
  };
}

/** Reads the first few kB of a file: `versioninfo` is always near the top. */
function readHead(path: string, bytes = 4096): string {
  return readFileSync(path).subarray(0, bytes).toString("utf8");
}

function normalisePath(path: string): string {
  return path.replace(/\\/g, "/").trim().toLowerCase();
}

/**
 * Autosaves of one map in one folder, newest first.
 *
 * The `originalname` check is what keeps two maps called `c1m1_hotel.vmf` in different
 * folders apart. An autosave that names no original is kept: it is more likely to be a
 * truncated file than a different map.
 */
export function autosavesForMap(folder: string, mapPath: string): Autosave[] {
  if (!existsSync(folder)) return [];
  const mapStat = existsSync(mapPath) ? statSync(mapPath) : null;
  const mapName = basename(mapPath, extname(mapPath));
  const wanted = normalisePath(mapPath);
  const out: Autosave[] = [];

  for (const file of readdirSync(folder)) {
    if (!file.toLowerCase().endsWith(".vmf_autosave")) continue;
    if (!file.toLowerCase().startsWith(`${mapName.toLowerCase()}_`)) continue;

    const path = join(folder, file);
    const head = readHead(path);
    const original = head.match(/"originalname"\s+"([^"]+)"/i)?.[1] ?? null;
    if (original !== null && normalisePath(original) !== wanted) continue;

    const version = head.match(/"mapversion"\s+"(\d+)"/i)?.[1];
    const written = statSync(path).mtime;
    out.push({
      path,
      file,
      written: written.toISOString(),
      mapVersion: version === undefined ? null : Number(version),
      originalName: original,
      newerThanMap: mapStat !== null && written.getTime() > mapStat.mtime.getTime(),
    });
  }

  return out.sort((a, b) => (a.written < b.written ? 1 : a.written > b.written ? -1 : 0));
}

/** Where to look, in the order the editors themselves use. */
export function resolveAutosaveFolder(options: {
  explicit?: string;
  plusPlusBinDir?: string | null;
  binDir?: string | null;
}): AutosaveFolder {
  if (options.explicit) {
    return {
      folder: options.explicit,
      enabled: true,
      source: "argument",
      detail: "the folder was given by the caller",
    };
  }

  for (const bin of [options.plusPlusBinDir, options.binDir]) {
    if (!bin) continue;
    const ini = join(bin, "hammerplusplus", "hammerplusplus_settings.ini");
    const settings = hammerPlusPlusAutosaveFolder(ini);
    if (settings === null) continue;
    if (settings.folder === null) {
      return {
        folder: null,
        enabled: settings.enabled,
        source: "hammer++ settings",
        detail: `${ini} has no AutosaveDir; set one in Hammer++'s Options, or pass \`folder\``,
      };
    }
    if (!isAbsoluteWindowsPath(settings.folder)) {
      return {
        folder: null,
        enabled: false,
        source: "hammer++ settings",
        detail:
          `${ini} sets AutosaveDir to "${settings.folder}", which is not an absolute path. ` +
          `Hammer rejects it, so autosaves are off until it is fixed`,
      };
    }
    return {
      folder: settings.folder,
      enabled: settings.enabled,
      source: "hammer++ settings",
      detail: `read from ${ini}`,
    };
  }

  const registry = registryAutosaveFolder();
  if (registry !== null) {
    if (registry.folder === null) {
      return {
        folder: null,
        enabled: registry.enabled,
        source: "registry",
        detail:
          "HKCU\\Software\\Valve\\Hammer\\General has no `Autosave Dir`; set one in Hammer's " +
          "Options, or pass `folder`",
      };
    }
    return {
      folder: registry.folder,
      enabled: registry.enabled,
      source: "registry",
      detail: "read from HKCU\\Software\\Valve\\Hammer\\General",
    };
  }

  return {
    folder: null,
    enabled: false,
    source: "unknown",
    detail:
      "no Hammer++ settings file and no `HKCU\\Software\\Valve\\Hammer\\General` autosave " +
      "keys; pass `folder` if the editor stores them elsewhere",
  };
}
