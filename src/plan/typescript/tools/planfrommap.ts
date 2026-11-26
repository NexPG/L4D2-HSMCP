/**
 * Build a plan from an existing map: BSP entities + NAV mesh -> plan.json.
 *
 * The plan is a *survey*, not a design: every coordinate comes from the map, the route is the
 * nav mesh's own shortest path, and the areas are the nav/entity flags. `origin: "imported"`
 * tells the checker to keep structural rules and skip authoring prescriptions (pillars, pacing,
 * landmarks), because those describe a map being designed, not one being measured.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { readEntityLump } from "../../../maps/typescript/bsp/entities.js";
import type { MapEntity } from "../../../maps/typescript/entity/model.js";
import { readNavFile } from "../../../nav/typescript/formats/navfile.js";
import { NavGraph, areaCenter } from "../../../nav/typescript/formats/navpath.js";
import { MapPlanSchema } from "./mapplan.js";

const PLAYER_START = 0x80;
const CHECKPOINT = 0x800;

function origin(entity: MapEntity): [number, number, number] {
  const point = entity.origin;
  return point ? [point[0], point[1], point[2]] : [0, 0, 0];
}

function simplify<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  const out: T[] = [];
  for (let i = 0; i < limit; i += 1) out.push(items[Math.round(i * step)]!);
  return out;
}

export interface PlanFromMapResult {
  path: string;
  name: string;
  areas: number;
  nodes: number;
  buildings: number;
  districts: number;
}

export function planFromMap(bspPath: string, outPath?: string, name?: string): PlanFromMapResult {
  const destination = outPath ?? bspPath.replace(/\.bsp$/i, ".plan.json");
  const navPath = join(dirname(bspPath), `${bspPath.replace(/\\/g, "/").split("/").pop()!.replace(/\.bsp$/i, "")}.nav`);
  if (!existsSync(navPath)) throw new Error(`nav mesh not found beside ${bspPath}: ${navPath}`);
  const nav = readNavFile(readFileSync(navPath), navPath);
  const lump = readEntityLump(bspPath);
  const entities = lump.entities;
  const graph = new NavGraph(nav);

  const startArea = nav.areas.find((area) => (area.spawnAttributes & PLAYER_START) !== 0);
  if (!startArea) throw new Error("the nav mesh has no PLAYER_START area");
  const startCenter = areaCenter(startArea);
  const checkpoints = nav.areas.filter((area) => (area.spawnAttributes & CHECKPOINT) !== 0);
  const goalArea = checkpoints
    .map((area) => ({ area, c: areaCenter(area) }))
    .sort((a, b) =>
      Math.hypot(b.c.x - startCenter.x, b.c.y - startCenter.y) -
      Math.hypot(a.c.x - startCenter.x, a.c.y - startCenter.y))[0]?.area;
  if (!goalArea) throw new Error("the nav mesh has no second CHECKPOINT area to aim at");
  const path = graph.findPath(startArea, goalArea);
  if (!path.found) throw new Error("no nav path from PLAYER_START to the far CHECKPOINT");

  const steps = simplify(path.steps.map((step) => ({ ...step.center, flags: (graph.byId.get(step.areaId)?.spawnAttributes ?? 0) })), 14);
  const zs = steps.map((step) => step.z);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const bands = [zMin + (zMax - zMin) / 3, zMin + (2 * (zMax - zMin)) / 3];
  const bandOf = (z: number) => (z < bands[0]! ? "lower" : z < bands[1]! ? "middle" : "upper");

  const districts = ["lower", "middle", "upper"].map((id) => ({
    id,
    name: id === "lower" ? "Lower level" : id === "middle" ? "Middle level" : "Upper level",
    mood: "",
    motif: "",
    landmark: "",
  }));

  const routeNodes = steps.map((step, index) => {
    const next = steps[index + 1];
    const dz = next ? next.z - step.z : 0;
    const kind =
      index === 0 ? "start"
      : index === steps.length - 1 ? "checkpoint"
      : dz <= -64 ? "drop"
      : dz <= -16 ? "stair"
      : "street";
    return {
      id: `n${index}`,
      label: kind === "start" ? "Start" : kind === "checkpoint" ? "Safe room" : `Node ${index}`,
      x: Math.round(step.x),
      y: Math.round(step.y),
      z: Math.round(step.z),
      floor: 1,
      district: bandOf(step.z),
      space: `space_${bandOf(step.z)}`,
      kind,
      enclosure: "open",
      intensity: 2,
      landmark: "",
      gate: "none",
    };
  });

  const xs = nav.areas.flatMap((area) => [area.minX, area.maxX]);
  const ys = nav.areas.flatMap((area) => [area.minY, area.maxY]);
  const pad = 512;
  const site = {
    bounds: {
      x0: Math.floor(Math.min(...xs) - pad), y0: Math.floor(Math.min(...ys) - pad),
      x1: Math.ceil(Math.max(...xs) + pad), y1: Math.ceil(Math.max(...ys) + pad),
    },
    north: 0, grid: 256, water: [], noBuild: [],
  };

  const areas: Array<Record<string, unknown>> = [
    { id: "spawn", label: "Player start", kind: "spawn", floor: 1,
      x: Math.round(startCenter.x), y: Math.round(startCenter.y), width: 256, depth: 256 },
    { id: "safe", label: "Safe room", kind: "safe-room", floor: 1,
      x: Math.round(areaCenter(goalArea).x), y: Math.round(areaCenter(goalArea).y), width: 256, depth: 256 },
  ];
  let checkpointIndex = 0;
  for (const area of checkpoints) {
    const c = areaCenter(area);
    if (Math.hypot(c.x - areaCenter(goalArea).x, c.y - areaCenter(goalArea).y) < 64) continue;
    if (Math.hypot(c.x - startCenter.x, c.y - startCenter.y) < 64) continue;
    areas.push({ id: `checkpoint_${checkpointIndex++}`, label: "Checkpoint", kind: "checkpoint", floor: 1,
      x: Math.round(c.x), y: Math.round(c.y), width: 256, depth: 256 });
    if (checkpointIndex >= 4) break;
  }

  let itemIndex = 0;
  for (const entity of entities) {
    if (!/^weapon_|^item_/.test(entity.classname ?? "")) continue;
    const [x, y, z] = origin(entity);
    areas.push({ id: `item_${itemIndex++}`, label: entity.classname ?? "item", kind: "item-cluster", floor: 1,
      x: Math.round(x), y: Math.round(y), width: 96, depth: 96, note: `z ${Math.round(z)}` });
    if (itemIndex >= 8) break;
  }

  const spawnEntity = entities.find((entity) => entity.classname === "info_player_start");
  const spawnZ = spawnEntity ? Math.round(origin(spawnEntity)[2]) : Math.round(startCenter.z);

  const plan = {
    version: 1 as const,
    name: name ?? bspPath.replace(/\\/g, "/").split("/").pop()!.replace(/\.bsp$/i, ""),
    kind: "map" as const,
    stage: "approved" as const,
    origin: "imported" as const,
    source: { bsp: bspPath, nav: navPath, entities: entities.length, navAreas: nav.areas.length },
    experience: `survey of ${bspPath}`,
    pillars: [],
    districts,
    site,
    terrain: { cell: 1024, origin: [site.bounds.x0, site.bounds.y0], cols: 2, rows: 2, heights: [0, 0, 0, 0] },
    buildings: [],
    routes: [{
      id: "critical", kind: "critical" as const, typology: "string-of-pearls" as const, width: 128,
      points: steps.map((step) => [Math.round(step.x), Math.round(step.y), Math.round(step.z)]),
      nodes: routeNodes,
      stops: [
        { id: "s-start", label: "Start", x: Math.round(startCenter.x), y: Math.round(startCenter.y), z: spawnZ, kind: "start" as const },
        { id: "s-safe", label: "Safe room", x: Math.round(areaCenter(goalArea).x), y: Math.round(areaCenter(goalArea).y), z: Math.round(areaCenter(goalArea).z), kind: "safe-room" as const },
      ],
    }],
    areas,
    beats: [],
    budget: {},
    palette: { sky: "", motifs: [], materials: [], models: [] },
    variability: [],
    acceptance: [],
  };

  const parsed = MapPlanSchema.parse(plan);
  writeFileSync(destination, JSON.stringify(parsed, null, 2), "utf8");
  return {
    path: destination, name: plan.name, areas: areas.length, nodes: routeNodes.length,
    buildings: 0, districts: districts.length,
  };
}

export const planFromMapTool = defineTool({
  name: "plan_from_map",
  description:
    "Builds a plan.json survey from an existing map: reads the BSP entity lump and the NAV " +
    "mesh beside it, takes the nav mesh's own path from PLAYER_START to the far CHECKPOINT, " +
    "and records the player start, safe room, checkpoints and item spawns as areas. The plan " +
    "is marked origin=imported, so the checker keeps structural rules and skips authoring " +
    "prescriptions. This is the inverse of check_map_plan: a map first, a plan second.",
  realm: "map",
  guarded: true,
  inputSchema: {
    bsp: z.string().describe("Source .bsp; its .nav is read from the same folder."),
    out: z.string().optional().describe("Destination plan.json; defaults to <map>.plan.json beside the bsp."),
    name: z.string().optional().describe("Plan name; defaults to the map file name."),
    confirm: z.boolean().default(false).describe("Must be true: this writes a plan file."),
  },
  outputSchema: {
    path: z.string(), name: z.string(), areas: z.number(), nodes: z.number(),
    buildings: z.number(), districts: z.number(),
  },
  handler: async (args) => {
    if (!args.confirm) throw new Error("confirm:true is required: this writes a plan file");
    return { ...planFromMap(args.bsp, args.out, args.name) };
  },
});
