/**
 * `scripts/surfaceproperties_*.txt`: the game's own material table.
 *
 * A QC's `$surfaceprop` and a VMT's `$surfaceprop` are free text as far as the compiler is
 * concerned; the engine looks the name up at runtime for friction, density, impact sounds
 * and the `gamematerial` letter. This parses the game's table so a typo is reported before
 * a model or a map ships with the default material.
 *
 * The file is KeyValues with one non-standard detail: a block name is followed by a prose
 * comment on the same line (`"metal" is sheet metal`). A strict KeyValues parser rejects
 * that token, so this reader keeps the quoted name and ignores the rest of the line. `base`
 * names another block; resolving a name follows that chain, with a cycle guard.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openGameVpk } from "../game/vpkcontent.js";

export interface SurfaceProperties {
  /** Path of the file the entry came from, relative to the game directory. */
  file: string;
  /** Block name as written, e.g. `Metal_Box`. */
  name: string;
  /** Lower-case lookup key. */
  key: string;
  values: Record<string, string>;
}

export interface SurfacePropsTable {
  files: string[];
  entries: Map<string, SurfaceProperties>;
}

/** Reads a file from the game directory, loose first and then from `pak01`. */
export function readGameFile(gameDir: string, path: string): Buffer | null {
  const loose = join(gameDir, path);
  if (existsSync(loose)) return readFileSync(loose);
  return openGameVpk(gameDir)?.read(path) ?? null;
}

/** Parses one surfaceproperties file, tolerating the `"name" prose comment` form. */
export function parseSurfaceProperties(text: string, file: string): SurfaceProperties[] {
  const entries: SurfaceProperties[] = [];
  let current: { name: string; values: Record<string, string> } | null = null;
  for (const raw of text.replace(/^\ufeff/, "").split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (line === "") continue;
    if (line === "}") {
      if (current) {
        entries.push({
          file,
          name: current.name,
          key: current.name.toLowerCase(),
          values: current.values,
        });
        current = null;
      }
      continue;
    }
    if (line === "{") continue;
    const first = /^"([^"]+)"\s*(.*)$/.exec(line);
    if (!first) continue;
    const name = first[1]!;
    const rest = first[2]!.trim();
    if (current === null) {
      // A block name. Anything after it on the line is a prose comment, not a value.
      current = { name, values: {} };
      continue;
    }
    if (rest.startsWith('"')) {
      const value = /^"([^"]*)"/.exec(rest);
      if (value) current.values[name.toLowerCase()] = value[1]!;
    }
  }
  return entries;
}

/** Reads the manifest and every file it lists. Missing files are skipped, not fatal. */
export function readSurfaceProps(gameDir: string): SurfacePropsTable {
  const manifestPath = "scripts/surfaceproperties_manifest.txt";
  const manifest = readGameFile(gameDir, manifestPath);
  const files: string[] = [];
  if (manifest) {
    const text = manifest.toString("latin1");
    // Only the `"file" "scripts/..."` pairs matter; block names are ignored.
    for (const match of text.matchAll(/"file"\s+"([^"]+)"/gi)) files.push(match[1]!);
  }
  if (files.length === 0) files.push("scripts/surfaceproperties_left4dead.txt");

  const entries = new Map<string, SurfaceProperties>();
  for (const file of files) {
    const bytes = readGameFile(gameDir, file);
    if (!bytes) continue;
    for (const entry of parseSurfaceProperties(bytes.toString("latin1"), file)) {
      // A later file overrides an earlier one, as the manifest comment says.
      entries.set(entry.key, entry);
    }
  }
  return { files, entries };
}

export interface ResolvedSurface {
  known: boolean;
  name: string;
  /** The chain from the requested property up through `base`, child first. */
  chain: string[];
  values: Record<string, string>;
  /** `gamematerial`, the letter the engine's physics uses. */
  gameMaterial: string | null;
}

/** Resolves `base` inheritance. A cycle is reported by stopping, not by looping. */
export function resolveSurfaceProp(table: SurfacePropsTable, name: string): ResolvedSurface {
  const chain: string[] = [];
  const values: Record<string, string> = {};
  let current = name.toLowerCase();
  const seen = new Set<string>();
  while (current !== "" && !seen.has(current)) {
    seen.add(current);
    const entry = table.entries.get(current);
    if (!entry) break;
    chain.push(entry.name);
    // The child wins: only fill keys that a more specific block has not set.
    for (const [key, value] of Object.entries(entry.values)) {
      if (!(key in values)) values[key] = value;
    }
    current = (entry.values.base ?? "").toLowerCase();
  }
  const known = table.entries.has(name.toLowerCase());
  return {
    known,
    name,
    chain,
    values,
    gameMaterial: values.gamematerial ?? null,
  };
}
