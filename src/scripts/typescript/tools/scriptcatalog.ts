/**
 * VScript catalogue: the `.nut` sources and `.nuc` files the game and SDK carry.
 *
 * A script can exist as source (`.nut`), compiled (`.nuc`) or both; the engine loads the
 * `.nuc` and falls back to the source. This is a file inventory, not a compiler.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";

interface ScriptEntry {
  name: string;
  path: string;
  relative: string;
  category: string;
  hasNut: boolean;
  hasNuc: boolean;
  bytes: number;
  includes: string[];
  note: string;
}

function roots(gameDir: string): Array<{ root: string; source: string }> {
  const sdk = join(dirname(gameDir), "sdk_content");
  return [
    { root: join(sdk, "scripting", "scripts", "vscripts"), source: "sdk/scripting" },
    { root: join(sdk, "mapsrc", "scripts", "vscripts"), source: "sdk/mapsrc" },
    { root: join(gameDir, "scripts", "vscripts"), source: "game" },
  ].filter((entry) => existsSync(entry.root));
}

function scriptsUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(nut|nuc)$/i.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

function categoryOf(root: string, path: string): string {
  const rel = relative(root, path).replace(/\\/g, "/");
  const first = rel.split("/")[0] ?? "";
  return rel.includes("/") ? first : "root";
}

function includesOf(path: string): string[] {
  if (extname(path).toLowerCase() !== ".nut") return [];
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(/IncludeScript\s*\(\s*["']([^"']+)["']/gi)].map((m) => m[1]!);
}

function entries(gameDir: string): ScriptEntry[] {
  const all = new Map<string, ScriptEntry>();
  for (const { root } of roots(gameDir)) {
    for (const path of scriptsUnder(root)) {
      const relativePath = relative(root, path).replace(/\\/g, "/");
      const key = `${root}|${relativePath.replace(/\.(nut|nuc)$/i, "")}`;
      const existing = all.get(key);
      const isNut = extname(path).toLowerCase() === ".nut";
      if (existing) {
        if (isNut) {
          existing.hasNut = true;
          existing.includes = includesOf(path);
        } else existing.hasNuc = true;
        existing.bytes += statSync(path).size;
        continue;
      }
      all.set(key, {
        name: basename(relativePath).replace(/\.(nut|nuc)$/i, ""),
        path,
        relative: relativePath,
        category: categoryOf(root, path),
        hasNut: isNut,
        hasNuc: !isNut,
        bytes: statSync(path).size,
        includes: isNut ? includesOf(path) : [],
        note: isNut
          ? "source; the engine prefers a .nuc of the same name"
          : "compiled only; no readable source in this tree",
      });
    }
  }
  return [...all.values()].sort((a, b) => a.relative.localeCompare(b.relative));
}

export const readScriptCatalogTool = defineTool({
  name: "read_script_catalog",
  description:
    "Lists the VScript files the SDK and game carry: `.nut` source, `.nuc` compiled, or both, " +
    "by category (`usetargets`, `entitygroups`, `mutations`, `anv*`, `director`, `root`) with " +
    "bytes, `IncludeScript` edges and whether only the compiled file exists. It is a file " +
    "inventory, not a compiler or a loader map; use `read_vscript`/`check_vscript_contract` for " +
    "the content contract. Read-only.",
  realm: "map",
  inputSchema: {
    search: z.string().optional().describe("Case-insensitive substring on name or relative path."),
    category: z.string().optional().describe("Exact category, e.g. `usetargets`."),
    details: z.boolean().default(false).describe("Include every entry; default is a summary."),
    limit: z.number().int().min(1).max(1000).default(200),
  },
  outputSchema: {
    roots: z.array(z.object({ root: z.string(), source: z.string() })),
    total: z.number(),
    shown: z.number(),
    categories: z.record(z.number()),
    entries: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        relative: z.string(),
        category: z.string(),
        hasNut: z.boolean(),
        hasNuc: z.boolean(),
        bytes: z.number(),
        includes: z.array(z.string()),
        note: z.string(),
      }),
    ),
  },
  handler: (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const rootsList = roots(gameDir);
    if (rootsList.length === 0) throw new Error("no scripts/vscripts directory in the SDK or game");
    const search = args.search?.toLowerCase();
    const all = entries(gameDir).filter((entry) => {
      if (search && !`${entry.name} ${entry.relative}`.toLowerCase().includes(search)) return false;
      if (args.category !== undefined && entry.category !== args.category) return false;
      return true;
    });
    const categories: Record<string, number> = {};
    for (const entry of all) categories[entry.category] = (categories[entry.category] ?? 0) + 1;
    return {
      roots: rootsList,
      total: all.length,
      shown: Math.min(all.length, args.limit ?? 200),
      categories,
      entries: args.details ? all.slice(0, args.limit ?? 200) : all.slice(0, args.limit ?? 200),
    };
  },
});

export const scriptCatalogTools = [readScriptCatalogTool];
