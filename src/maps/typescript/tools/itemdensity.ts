/**
 * Item density: how much of the random/specific item layer a chapter carries.
 *
 * The official maps use ~4,688 `weapon_item_spawn` (random layer) plus specific weapon,
 * health and throwable spawners; the three Milltown chapters carry 321 item spawns each.
 * This reads a VMF or a compiled BSP, so it works before a launch and on an official peer.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readNavFile } from "../../../nav/typescript/formats/navfile.js";
import { readEntityLump } from "../bsp/entities.js";
import { readEntities } from "../vmf/edit.js";

const COUNT = z.number();

const CATEGORIES: Array<{ category: string; test: (classname: string) => boolean }> = [
  { category: "random", test: (c) => c === "weapon_item_spawn" },
  { category: "melee", test: (c) => c === "weapon_melee_spawn" },
  { category: "health", test: (c) => /first_aid|pain_pills|adrenaline|defib/i.test(c) },
  { category: "throwable", test: (c) => /molotov|pipe_bomb|vomitjar/i.test(c) },
  { category: "ammo", test: (c) => /ammo|upgradepack/i.test(c) },
  { category: "scavenge", test: (c) => c === "weapon_scavenge_item_spawn" },
  { category: "specific", test: () => true },
];

export interface ItemDensity {
  path: string;
  source: "vmf" | "bsp";
  total: number;
  counts: Record<string, number>;
  categories: Record<string, number>;
  budget: { expected: number; status: "sparse" | "in-range" | "dense"; basis: string };
  navAreas: number | null;
  per1000NavAreas: number | null;
  peer: { path: string; total: number; counts: Record<string, number> } | null;
  note: string;
}

function classnames(path: string): { names: string[]; source: "vmf" | "bsp" } {
  if (extname(path).toLowerCase() === ".vmf") {
    const entities = readEntities(readFileSync(path, "utf8")).entities;
    return { names: entities.map((entity) => entity.classname), source: "vmf" };
  }
  const entities = readEntityLump(path).entities;
  return { names: entities.map((entity) => entity.classname), source: "bsp" };
}

function summarize(path: string, expected: number): Omit<ItemDensity, "peer" | "navAreas" | "per1000NavAreas"> {
  const { names, source } = classnames(path);
  const counts: Record<string, number> = {};
  const categories: Record<string, number> = {};
  let total = 0;
  for (const classname of names) {
    if (!/^weapon_.*_spawn$/.test(classname)) continue;
    counts[classname] = (counts[classname] ?? 0) + 1;
    total += 1;
    const category = CATEGORIES.find((entry) => entry.test(classname))!.category;
    categories[category] = (categories[category] ?? 0) + 1;
  }
  const status = total < expected * 0.5 ? "sparse" : total > expected * 1.5 ? "dense" : "in-range";
  return {
    path,
    source,
    total,
    counts,
    categories,
    budget: {
      expected,
      status,
      basis: "measured c2m1 187, c2m2 191, c2m3 152, c1m1 81, c5m1 96; 150 is a full chapter, below half is sparse",
    },
    note:
      "Counts spawners, not what the Director chose. `weapon_item_spawn` is the random layer; " +
      "a specific `weapon_*_spawn` is one candidate. The count is per map, so a short arena " +
      "cannot be compared to a full chapter without the nav-area ratio.",
  };
}

function officialPath(name: string, gameDir: string): string | null {
  if (existsSync(name)) return name;
  const relative = join(gameDir, "maps", name.endsWith(".bsp") ? name : `${name}.bsp`);
  return existsSync(relative) ? relative : null;
}

export const readItemDensityTool = defineTool({
  name: "read_item_density",
  description:
    "Counts a map's item/weapon spawners: total `weapon_*_spawn`, the random " +
    "`weapon_item_spawn` layer, and categories (random, melee, health, throwable, ammo, " +
    "scavenge, specific). Reads a .vmf or a compiled .bsp, so it works without launching the " +
    "game and on an official peer. The budget is 321 item spawns per full-size chapter (the " +
    "Milltown maps); `status` is sparse/in-range/dense by half/double that. Pass `nav` to " +
    "normalize per 1,000 nav areas and `peer` to compare with an official BSP. Counts what " +
    "the map offers, not what the Director spawns. Read-only.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Map .vmf or .bsp, absolute or relative to the repo root."),
    expected: z
      .number()
      .positive()
      .default(150)
      .describe("Item spawners expected for a full-size chapter; default 150 (measured full chapter)."),
    nav: z
      .string()
      .optional()
      .describe("Optional .nav; its area count normalizes density per 1,000 areas."),
    peer: z
      .string()
      .optional()
      .describe("Optional official map name or .bsp to compare against, e.g. c2m1_highway."),
  },
  outputSchema: {
    path: z.string(),
    source: z.enum(["vmf", "bsp"]),
    total: COUNT,
    counts: z.record(COUNT),
    categories: z.record(COUNT),
    budget: z.object({
      expected: z.number(),
      status: z.enum(["sparse", "in-range", "dense"]),
      basis: z.string(),
    }),
    navAreas: z.number().nullable(),
    per1000NavAreas: z.number().nullable(),
    peer: z
      .object({ path: z.string(), total: COUNT, counts: z.record(COUNT) })
      .nullable(),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const expected = args.expected ?? 321;
    const base = summarize(path, expected);

    let navAreas: number | null = null;
    let per1000NavAreas: number | null = null;
    if (args.nav !== undefined) {
      const nav = resolveInput(args.nav, ctx.config);
      if (!existsSync(nav)) throw new Error(`${nav} does not exist`);
      navAreas = readNavFile(readFileSync(nav), nav).areaCount;
      per1000NavAreas = navAreas > 0 ? (base.total / navAreas) * 1000 : null;
    }

    let peer: ItemDensity["peer"] = null;
    if (args.peer !== undefined) {
      const peerPath =
        officialPath(args.peer, ctx.config.gameDir ?? "") ??
        (existsSync(args.peer) ? args.peer : null);
      if (peerPath) {
        const summary = summarize(peerPath, expected);
        peer = { path: peerPath, total: summary.total, counts: summary.counts };
      }
    }

    return {
      ...base,
      navAreas,
      per1000NavAreas,
      peer,
      note: peer
        ? `${base.note} Peer ${basename(peer.path)} has ${peer.total} item spawners against ${base.total}.`
        : base.note,
    };
  },
});

export const itemDensityTools = [readItemDensityTool];
