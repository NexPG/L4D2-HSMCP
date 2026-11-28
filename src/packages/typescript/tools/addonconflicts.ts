/**
 * Audit the installed add-ons for the conflicts the Add-ons menu shows.
 *
 * The menu's red highlight is a **file-path collision**: two enabled add-ons that ship the same
 * resource path. The engine also has softer collisions the menu does not show: two plugins with
 * the same class, two add-ons that assign the same top-level global, or two that write the same
 * `ems/` settings file. This tool reads the installed VPKs and reports all four.
 *
 * It is read-only and does not launch the game. `addoninfo.txt`, `addonimage.jpg` and the three
 * shared `*_addon.nut` entry points are per-add-on/engine entry points, not conflicts; they are
 * excluded from the path check.
 */
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readVpkEntry } from "../../../formats/typescript/formats/vpk.js";
import { openVpk } from "../../../formats/typescript/formats/vpkio.js";

const KIND = z.enum(["path", "class", "global", "settings"]);

const SHARED_PATHS = new Set([
  "addoninfo.txt",
  "addonimage.jpg",
  "scripts/vscripts/mapspawn_addon.nut",
  "scripts/vscripts/director_base_addon.nut",
  "scripts/vscripts/scriptedmode_addon.nut",
]);

interface ScannedAddon {
  path: string;
  title: string;
  entries: string[];
  scripts: Array<{ path: string; text: string }>;
}

interface Conflict {
  kind: z.infer<typeof KIND>;
  key: string;
  providers: string[];
}

function addonTitle(opened: ReturnType<typeof openVpk>): string {
  const entry = opened.archive.entries.find(
    (candidate) => candidate.path.toLowerCase() === "addoninfo.txt",
  );
  if (!entry) return "";
  try {
    const text = readVpkEntry(opened.archive, entry, opened.openArchive).toString("utf8");
    // A targeted read, not a full KeyValues parse: some published add-ons put literal newlines
    // in `addondescription`, which makes the whole file unterminated even though the scanner
    // still reads the title. The title itself is one quoted line.
    const match = /"?addontitle"?\s+"([^"]*)"/i.exec(text);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function scanVpk(path: string): ScannedAddon {
  const opened = openVpk(path);
  const title = addonTitle(opened);
  const entries = opened.archive.entries.map((entry) => entry.path);
  const scripts: ScannedAddon["scripts"] = [];
  for (const entry of opened.archive.entries) {
    if (!entry.path.toLowerCase().endsWith(".nut")) continue;
    try {
      scripts.push({
        path: entry.path,
        text: readVpkEntry(opened.archive, entry, opened.openArchive).toString("utf8"),
      });
    } catch {
      // A damaged entry is a warning at the caller; the path list still contributes.
    }
  }
  return { path, title, entries, scripts };
}

/** Remove line and block comments so a commented-out class is not a conflict. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function collect(
  map: Map<string, Set<string>>,
  key: string,
  provider: string,
): void {
  const trimmed = key.trim();
  if (trimmed.length === 0) return;
  const set = map.get(trimmed) ?? new Set<string>();
  set.add(provider);
  map.set(trimmed, set);
}

function conflictsFrom(map: Map<string, Set<string>>, kind: z.infer<typeof KIND>): Conflict[] {
  return [...map.entries()]
    .filter(([, providers]) => providers.size > 1)
    .map(([key, providers]) => ({ kind, key, providers: [...providers].sort() }));
}

export const checkAddonConflictsTool = defineTool({
  name: "check_addon_conflicts",
  description:
    "Audits installed L4D2 add-ons for the four collisions that matter: the same resource path " +
    "(the Add-ons menu's red conflict), the same plugin class, the same top-level global, and " +
    "the same `ems/` settings path. `addoninfo.txt`, `addonimage.jpg` and the three shared " +
    "`*_addon.nut` entry points are per-add-on/engine files and are not reported. Pass explicit " +
    "VPK paths, or scan the game's `addons/` and `addons/workshop/` folders. Read-only; it does " +
    "not launch the game or change an add-on.",
  realm: "map",
  inputSchema: {
    paths: z
      .array(z.string())
      .default([])
      .describe("VPK paths to scan. Empty means the installed add-on folders."),
    addonsDir: z
      .string()
      .optional()
      .describe("Add-on directory. Defaults to the game's left4dead2/addons."),
    includeWorkshop: z
      .boolean()
      .default(true)
      .describe("Also scan addons/workshop when the installed folders are used."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(500)
      .describe("Maximum VPKs to scan."),
  },
  outputSchema: {
    scanned: z.array(
      z.object({
        path: z.string(),
        title: z.string(),
        entries: z.number(),
        scripts: z.number(),
      }),
    ),
    conflicts: z.array(
      z.object({ kind: KIND, key: z.string(), providers: z.array(z.string()) }),
    ),
    summary: z.object({
      addons: z.number(),
      entries: z.number(),
      scripts: z.number(),
      conflicts: z.number(),
      byKind: z.record(z.number()),
    }),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const warnings: string[] = [];
    let paths: string[] = args.paths.map((path) => resolveInput(path, ctx.config));
    if (paths.length === 0) {
      const dir = args.addonsDir
        ? resolveInput(args.addonsDir, ctx.config)
        : ctx.config.gameDir
          ? join(ctx.config.gameDir, "addons")
          : null;
      if (dir === null) {
        throw new Error(
          "the game directory is not resolved; pass `paths` or `addonsDir` explicitly",
        );
      }
      const scan = (folder: string): void => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          if (!entry.name.toLowerCase().endsWith(".vpk")) continue;
          paths.push(join(folder, entry.name));
        }
      };
      try {
        scan(dir);
      } catch {
        warnings.push(`${dir} could not be read`);
      }
      if (args.includeWorkshop) {
        try {
          scan(join(dir, "workshop"));
        } catch {
          warnings.push(`${join(dir, "workshop")} could not be read`);
        }
      }
    }

    paths = [...new Set(paths)].slice(0, args.limit);
    const addons: ScannedAddon[] = [];
    const pathMap = new Map<string, Set<string>>();
    const classMap = new Map<string, Set<string>>();
    const globalMap = new Map<string, Set<string>>();
    const settingsMap = new Map<string, Set<string>>();

    for (const path of paths) {
      let addon: ScannedAddon;
      try {
        addon = scanVpk(path);
      } catch (error) {
        warnings.push(
          `${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (addon.title.length === 0) warnings.push(`${path}: no addoninfo title`);
      if (addon.scripts.length === 0) warnings.push(`${path}: no .nut scripts`);
      const provider = `${addon.title || basename(path, ".vpk")} [${basename(path)}]`;
      addons.push(addon);

      for (const entry of addon.entries) {
        const key = entry.toLowerCase();
        if (SHARED_PATHS.has(key)) continue;
        collect(pathMap, key, provider);
      }

      for (const script of addon.scripts) {
        const text = stripComments(script.text);
        for (const match of text.matchAll(/\bclass\s+([A-Za-z_]\w*)/g)) {
          collect(classMap, match[1]!, provider);
        }
        // Top-level assignments only: these scripts put them at column 0 or behind `::`.
        for (const match of text.matchAll(/^(?:::)?([A-Za-z_]\w*)\s*(?:<-|=)/gm)) {
          collect(globalMap, match[1]!, provider);
        }
        for (const pattern of [/StringToFile\(\s*"([^"]+)"/g, /FileToString\(\s*"([^"]+)"/g]) {
          for (const match of text.matchAll(pattern)) {
            collect(settingsMap, match[1]!, provider);
          }
        }
      }
    }

    const conflicts = [
      ...conflictsFrom(pathMap, "path"),
      ...conflictsFrom(classMap, "class"),
      ...conflictsFrom(globalMap, "global"),
      ...conflictsFrom(settingsMap, "settings"),
    ].sort((left, right) => left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key));

    const byKind: Record<string, number> = {};
    for (const conflict of conflicts) {
      byKind[conflict.kind] = (byKind[conflict.kind] ?? 0) + 1;
    }

    return {
      scanned: addons.map((addon) => ({
        path: addon.path,
        title: addon.title,
        entries: addon.entries.length,
        scripts: addon.scripts.length,
      })),
      conflicts,
      summary: {
        addons: addons.length,
        entries: addons.reduce((sum, addon) => sum + addon.entries.length, 0),
        scripts: addons.reduce((sum, addon) => sum + addon.scripts.length, 0),
        conflicts: conflicts.length,
        byKind,
      },
      warnings,
    };
  },
});

export const addonConflictTools = [checkAddonConflictsTool];
