/**
 * Official prefab catalogue: the `.vmf` instances the stock game ships.
 *
 * L4D2 keeps them under `sdk_content/mapsrc/instance`, `sdk_content/scripting/maps/instance`
 * and the DeadLine2 add-on source. They are ordinary VMF fragments, so this reads them with
 * the same KV parser as a map; it does not copy or compile anything. `insert_prefab` places
 * one, and `write_instance` keeps a live `func_instance` link.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { children, get, parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { findSolids } from "../vmf/select.js";

interface PrefabSummary {
  name: string;
  path: string;
  relative: string;
  family: string;
  bytes: number;
  solids: number;
  entities: number;
  classes: Record<string, number>;
  targetnames: string[];
  outputs: string[];
  scripts: string[];
  useTargets: Array<{ classname: string; targetname: string; vscripts: string | null }>;
  nestedInstances: number;
  warnings: string[];
}

function libraryRoots(gameDir: string): string[] {
  const base = join(dirname(gameDir), "sdk_content");
  return [
    join(base, "mapsrc", "instance"),
    join(base, "scripting", "maps", "instance"),
    join(base, "DeadLine2", "mapsrc", "instance"),
  ].filter((p) => existsSync(p));
}

function vmfFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".vmf")) out.push(full);
    }
  };
  walk(root);
  return out;
}

function familyOf(root: string, path: string): string {
  const rel = relative(root, path).replace(/\\/g, "/");
  const first = rel.split("/")[0] ?? "";
  if (first === "entitygroups" || first === "usetargets") return first;
  return basename(root) === "instance" ? "mapsrc" : first || "mapsrc";
}

function summarize(root: string, path: string, details: boolean): PrefabSummary {
  const text = readFileSync(path, "utf8");
  const roots = parse(text).filter((n): n is KvBlock => n.kind === "block");
  const world = roots.find((b) => b.name === "world");
  const entities = roots.filter((b) => b.name === "entity");
  const classes: Record<string, number> = {};
  const targetnames: string[] = [];
  const outputs: string[] = [];
  const scripts = new Set<string>();
  const useTargets: PrefabSummary["useTargets"] = [];
  let nestedInstances = 0;
  const warnings: string[] = [];
  for (const entity of entities) {
    const classname = get(entity, "classname") ?? "(none)";
    classes[classname] = (classes[classname] ?? 0) + 1;
    if (classname === "func_instance") nestedInstances += 1;
    const targetname = get(entity, "targetname");
    if (targetname) targetnames.push(targetname);
    const vscripts = get(entity, "vscripts");
    if (vscripts) scripts.add(vscripts);
    if (classname === "point_script_use_target" || classname === "point_prop_use_target") {
      useTargets.push({
        classname,
        targetname: targetname ?? "",
        vscripts: vscripts ?? null,
      });
    }
    if (details) {
      for (const conn of children(entity, "connections")) {
        for (const entry of conn.entries) {
          if (entry.kind !== "pair") continue;
          outputs.push(
            `${classname}.${entry.key} -> ${entry.value.split(/[,\u001b]/)[0] ?? ""}`,
          );
        }
      }
    }
  }
  if (entities.length === 0 && (world ? findSolids([world]).length : 0) === 0) {
    warnings.push("no world solids and no entities: this file is not a prefab");
  }
  if (nestedInstances > 0) {
    warnings.push(`${nestedInstances} nested func_instance file(s); insert_prefab does not expand them`);
  }
  return {
    name: basename(path, ".vmf"),
    path,
    relative: relative(root, path).replace(/\\/g, "/"),
    family: familyOf(root, path),
    bytes: statSync(path).size,
    solids: world ? findSolids([world]).length : 0,
    entities: entities.length,
    classes,
    targetnames,
    outputs,
    scripts: [...scripts],
    useTargets,
    nestedInstances,
    warnings,
  };
}

export const readOfficialPrefabTool = defineTool({
  name: "read_official_prefab",
  description:
    "Lists and inspects the official prefabs the stock game ships: `sdk_content/mapsrc/instance` " +
    "and `sdk_content/scripting/maps/instance` (house/safe-room, car, environment, entitygroups, " +
    "usetargets). Each entry reports its family, bytes, world solids, entity count, class " +
    "histogram and nested-instance count; details adds targetnames and outputs. A prefab is a " +
    "one-time paste (`insert_prefab`) or a live `func_instance` (`write_instance`), not a " +
    "compiled map. Read-only.",
  realm: "map",
  inputSchema: {
    path: z
      .string()
      .optional()
      .describe("One prefab by absolute path, sdk_content-relative path, or repo-relative path."),
    search: z
      .string()
      .optional()
      .describe("Case-insensitive substring on the name or relative path."),
    family: z
      .enum(["mapsrc", "entitygroups", "usetargets"])
      .optional()
      .describe("Restrict the catalogue to one family."),
    details: z
      .boolean()
      .default(false)
      .describe("Include targetnames and outputs for each entry."),
    limit: z.number().int().min(1).max(500).default(200),
  },
  outputSchema: {
    roots: z.array(z.string()),
    total: z.number(),
    shown: z.number(),
    prefabs: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        relative: z.string(),
        family: z.string(),
        bytes: z.number(),
        solids: z.number(),
        entities: z.number(),
        classes: z.record(z.number()),
        targetnames: z.array(z.string()),
        outputs: z.array(z.string()),
        scripts: z.array(z.string()),
        useTargets: z.array(
          z.object({
            classname: z.string(),
            targetname: z.string(),
            vscripts: z.string().nullable(),
          }),
        ),
        nestedInstances: z.number(),
        warnings: z.array(z.string()),
      }),
    ),
  },
  handler: (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const roots = libraryRoots(gameDir);
    if (roots.length === 0) {
      throw new Error(
        "no SDK instance directory found; install the L4D2 Authoring Tools " +
          "(sdk_content/mapsrc/instance)",
      );
    }
    if (args.path !== undefined) {
      const sdk = join(dirname(gameDir), "sdk_content");
      const candidates = isAbsolute(args.path)
        ? [args.path]
        : [join(sdk, args.path), join(sdk, "mapsrc", "instance", args.path), resolveInput(args.path, ctx.config)];
      const found = candidates.find((p) => existsSync(p));
      if (!found) throw new Error(`no prefab at ${args.path}`);
      const root = roots.find((r) => found.startsWith(r)) ?? dirname(found);
      return {
        roots,
        total: 1,
        shown: 1,
        prefabs: [summarize(root, found, true)],
      };
    }
    const search = args.search?.toLowerCase();
    const all: PrefabSummary[] = [];
    for (const root of roots) {
      for (const path of vmfFiles(root)) {
        const rel = relative(root, path).replace(/\\/g, "/");
        if (search && !`${basename(path)} ${rel}`.toLowerCase().includes(search)) continue;
        if (args.family !== undefined && familyOf(root, path) !== args.family) continue;
        all.push(summarize(root, path, args.details ?? false));
      }
    }
    all.sort((a, b) => a.relative.localeCompare(b.relative));
    return {
      roots,
      total: all.length,
      shown: Math.min(all.length, args.limit ?? 200),
      prefabs: all.slice(0, args.limit ?? 200),
    };
  },
});

export const prefabCatalogTools = [readOfficialPrefabTool];
