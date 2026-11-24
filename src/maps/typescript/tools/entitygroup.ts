/**
 * Place a stock L4D2 entity group: the prefab plus the VScript that makes it a use target.
 *
 * The geometry alone is inert. `point_script_use_target`/`point_prop_use_target` names a
 * `vscripts` file under `scripts/vscripts/usetargets/...`; the SDK ships the `.nut` source,
 * so this copies it (and its `IncludeScript` chain) beside the map when a scripts directory
 * is given. A live activation still needs a player and is a play-test, not this tool.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { get, parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput, resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { insertPrefabTool } from "./prefab.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);
const USE_TARGETS = new Set(["point_script_use_target", "point_prop_use_target"]);

function groupCandidates(name: string, gameDir: string): string[] {
  const sdk = join(dirname(gameDir), "sdk_content");
  return [
    name,
    join(sdk, "scripting", "maps", "instance", "entitygroups", `${name}.vmf`),
    join(sdk, "mapsrc", "instance", "entitygroups", `${name}.vmf`),
    join(sdk, "scripting", "maps", "instance", `${name}.vmf`),
    join(sdk, "mapsrc", "instance", `${name}.vmf`),
  ];
}

function scriptRoots(gameDir: string): string[] {
  const sdk = join(dirname(gameDir), "sdk_content");
  return [
    join(sdk, "scripting", "scripts", "vscripts"),
    join(sdk, "mapsrc", "scripts", "vscripts"),
    join(gameDir, "scripts", "vscripts"),
  ];
}

function withoutNut(name: string): string {
  return name.replace(/\.nut$/i, "");
}

/** Centre of a prefab's solids and entity origins; groups are authored far from 0. */
function prefabCentre(text: string): [number, number, number] {
  const check = checkVmfSolids("(prefab)", text);
  let mins: [number, number, number] | null = null;
  let maxs: [number, number, number] | null = null;
  const include = (point: readonly number[]): void => {
    if (point.length !== 3 || point.some((n) => !Number.isFinite(n))) return;
    if (mins === null || maxs === null) {
      mins = [point[0]!, point[1]!, point[2]!];
      maxs = [point[0]!, point[1]!, point[2]!];
      return;
    }
    for (let i = 0; i < 3; i += 1) {
      if (point[i]! < mins[i]!) mins[i] = point[i]!;
      if (point[i]! > maxs[i]!) maxs[i] = point[i]!;
    }
  };
  for (const solid of check.solids) {
    include(solid.mins);
    include(solid.maxs);
  }
  for (const entity of parse(text).filter((n): n is KvBlock => n.kind === "block")) {
    const origin = get(entity, "origin");
    if (!origin) continue;
    const parsed = origin.trim().split(/\s+/).map(Number);
    if (parsed.length === 3 && parsed.every((n) => Number.isFinite(n))) include(parsed);
  }
  if (mins === null || maxs === null) return [0, 0, 0];
  return [(mins[0] + maxs[0]) / 2, (mins[1] + maxs[1]) / 2, (mins[2] + maxs[2]) / 2];
}

/** Copy one script and its IncludeScript chain; returns the relative names copied. */
function copyScript(
  name: string,
  destRoot: string,
  roots: readonly string[],
  seen: Set<string>,
  missing: string[],
): void {
  const clean = withoutNut(name);
  if (seen.has(clean)) return;
  seen.add(clean);
  const source = roots
    .map((root) => join(root, `${clean}.nut`))
    .find((path) => existsSync(path));
  if (!source) {
    missing.push(clean);
    return;
  }
  const dest = join(destRoot, `${clean}.nut`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  const text = readFileSync(source, "utf8");
  for (const match of text.matchAll(/IncludeScript\s*\(\s*["']([^"']+)["']/gi)) {
    copyScript(match[1]!, destRoot, roots, seen, missing);
  }
}

export const placeEntityGroupTool = defineTool({
  name: "place_entity_group",
  description:
    "Places an official `entitygroups` prefab (ammo/health/med/defib cabinet, ladder, " +
    "minigun, gascan/rescue/resupply helicopter, radio, searchlight, barricade, hintboard) " +
    "and copies the VScript it points at, including its `IncludeScript` chain, when " +
    "`scriptsDir` is given. The prefab alone is inert: `point_script_use_target` / " +
    "`point_prop_use_target` names `vscripts` under `scripts/vscripts/usetargets/...`. " +
    "Returns the use-target classes, targetnames, scripts copied and any missing script. " +
    "A player activation is a live play-test, not this tool. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Target .vmf, absolute or relative to the repo root."),
    group: z
      .string()
      .describe("Official group name, e.g. `ammo_cabinet`, `rescue_helicopter`, or a .vmf path."),
    origin: VEC3.default([0, 0, 0]).describe("World offset for the prefab."),
    rotate: z.number().default(0).describe("Yaw in degrees."),
    namePrefix: z
      .string()
      .default("")
      .describe("Prefix the group's targetnames, so two cabinets do not share `template_ammo`."),
    scriptsDir: z
      .string()
      .optional()
      .describe(
        "Destination `scripts/vscripts` directory. Omit to only report the scripts the map " +
          "must ship; relative paths resolve from the repo root.",
      ),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    group: z.string(),
    prefab: z.string(),
    center: VEC3,
    entities: z.number(),
    targetnames: z.array(z.string()),
    useTargets: z.array(
      z.object({ classname: z.string(), targetname: z.string(), vscripts: z.string().nullable() }),
    ),
    scripts: z.array(z.string()),
    copied: z.array(z.string()),
    missing: z.array(z.string()),
    duplicates: z.array(z.object({ name: z.string(), count: z.number() })),
    unresolvedOutputs: z.array(z.string()),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const prefab = groupCandidates(args.group, gameDir).find((candidate) => existsSync(candidate));
    if (!prefab) {
      throw new Error(
        `no entity group "${args.group}"; install the Authoring Tools and use a name under ` +
          `sdk_content/scripting/maps/instance/entitygroups`,
      );
    }
    const text = readFileSync(prefab, "utf8");
    const entities = parse(text).filter((n): n is KvBlock => n.kind === "block" && n.name === "entity");
    const scripts = new Set<string>();
    const useTargets: Array<{ classname: string; targetname: string; vscripts: string | null }> = [];
    for (const entity of entities) {
      const classname = get(entity, "classname") ?? "";
      const vscripts = get(entity, "vscripts");
      if (vscripts) scripts.add(withoutNut(vscripts));
      if (USE_TARGETS.has(classname)) {
        useTargets.push({
          classname,
          targetname: get(entity, "targetname") ?? "",
          vscripts: vscripts ? withoutNut(vscripts) : null,
        });
      }
    }

    const center = prefabCentre(text);
    const inserted = (await insertPrefabTool.handler(
      {
        path,
        prefab,
        move: [
          (args.origin ?? [0, 0, 0])[0] - center[0],
          (args.origin ?? [0, 0, 0])[1] - center[1],
          (args.origin ?? [0, 0, 0])[2] - center[2],
        ],
        rotate: args.rotate ?? 0,
        pivot: center,
        namePrefix: args.namePrefix ?? "",
        validate: true,
        confirm: true,
      } as never,
      ctx,
    )) as unknown as {
      entities: number;
      targetnames: string[];
      duplicates: Array<{ name: string; count: number }>;
      unresolvedOutputs: string[];
      warnings: string[];
    };

    const copied: string[] = [];
    const missing: string[] = [];
    const warnings = [...inserted.warnings];
    if (args.scriptsDir !== undefined) {
      const dest = isAbsolute(args.scriptsDir)
        ? args.scriptsDir
        : resolveInput(args.scriptsDir, ctx.config);
      if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
      const seen = new Set<string>();
      for (const script of scripts) copyScript(script, dest, scriptRoots(gameDir), seen, missing);
      copied.push(...seen);
    } else if (scripts.size > 0) {
      warnings.push(
        `the group needs ${[...scripts].join(", ")} under scripts/vscripts; pass scriptsDir ` +
          `to copy the SDK .nut sources`,
      );
    }
    if (useTargets.length === 0) {
      warnings.push("no point_script_use_target/point_prop_use_target in this group");
    }
    if (inserted.duplicates.length > 0) {
      warnings.push("duplicate targetnames; place with a namePrefix");
    }
    return {
      path,
      group: args.group,
      prefab,
      center,
      entities: inserted.entities,
      targetnames: inserted.targetnames,
      useTargets,
      scripts: [...scripts],
      copied,
      missing,
      duplicates: inserted.duplicates,
      unresolvedOutputs: inserted.unresolvedOutputs,
      warnings,
    };
  },
});

export const entityGroupTools = [placeEntityGroupTool];
