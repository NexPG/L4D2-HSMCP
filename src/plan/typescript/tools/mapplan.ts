/**
 * Map planning drawings: the pass-1 contract, not a VMF.
 *
 * A plan is a JSON document and five drawings: site plan, vertical/terrain plan, circulation
 * plan, building/height schedule, and floor plans/sections. The renderer is plain SVG so it
 * needs no CAD install; the validator is the part pass 2 can trust. The drawings are a
 * schematic for a game level, not a construction set: no dimensions are inferred from a
 * drawing, the JSON is the source.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { readNavFile } from "../../../nav/typescript/formats/navfile.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";

const XY = z.tuple([z.number(), z.number()]);
const XYZ = z.tuple([z.number(), z.number(), z.number()]);
const POSITIVE = z.number().positive();

const Rect = z.object({
  x: z.number().describe("Centre X."),
  y: z.number().describe("Centre Y."),
  width: POSITIVE,
  depth: POSITIVE,
  rotation: z.number().default(0).describe("Degrees, counter-clockwise in map coordinates."),
});

const Entrance = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  width: z.number().positive().default(64),
  face: z.enum(["north", "east", "south", "west"]).default("south"),
});

const Room = z.object({
  id: z.string().optional().describe("Stable id for door references; defaults to the name."),
  name: z.string(),
  x: z.number().describe("Building-local X from the footprint centre."),
  y: z.number(),
  width: POSITIVE,
  depth: POSITIVE,
});

const Door = z.object({
  id: z.string().optional(),
  x: z.number().describe("Building-local X from the footprint centre."),
  y: z.number(),
  width: POSITIVE.default(56).describe("Opening width."),
  depth: POSITIVE.default(16).describe("Wall thickness."),
  rotation: z.number().default(0).describe("Degrees relative to the building."),
  from: z.string().describe('Room id/name on one side, or "outside".'),
  to: z.string().describe('Room id/name on the other side, or "outside".'),
  kind: z.enum(["door", "opening", "gate"]).default("door"),
  locked: z.boolean().default(false),
});

const Stair = z.object({
  id: z.string().optional(),
  kind: z.enum(["stair", "ladder", "elevator", "ramp"]).default("stair"),
  x: z.number(),
  y: z.number(),
  width: POSITIVE,
  depth: POSITIVE,
  to: z.number().int(),
});

const Floor = z.object({
  level: z.number().int().min(-8).max(64).describe("Floor level; 0 and below are basements."),
  z: z.number(),
  height: z.number().min(96).default(128),
  rooms: z.array(Room).default([]),
  doors: z.array(Door).default([]),
  stairs: z.array(Stair).default([]),
});

const Building = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: POSITIVE,
  depth: POSITIVE,
  rotation: z.number().default(0),
  floors: z.number().int().min(1).max(64),
  floorHeight: z.number().min(96).default(128),
  baseZ: z.number(),
  excavated: z.boolean().default(false).describe("Base is below the terrain on purpose (subway, basement)."),
  roofZ: z.number().optional(),
  enterable: z.boolean().default(false),
  role: z
    .enum(["route", "context", "landmark", "facade", "safe-room"])
    .default("context")
    .describe("route/safe-room are on the critical path; context/facade/landmark are the surrounding streetscape."),
  entrances: z.array(Entrance).default([]),
  floorsPlan: z.array(Floor).default([]),
  purpose: z.string().optional(),
  palette: z.string().optional(),
});

const Stop = z.object({
  id: z.string(),
  label: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  kind: z.enum([
    "start",
    "checkpoint",
    "safe-room",
    "crescendo",
    "tank",
    "witch",
    "finale",
    "escape",
    "branch",
  ]),
});

const RouteNode = z.object({
  id: z.string(),
  label: z.string().default(""),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  floor: z.number().int().min(-8).max(64),
  buildingId: z.string().optional(),
  space: z.string().default("").describe("Named space; consecutive nodes in one space share it."),
  district: z.string().optional(),
  kind: z.enum([
    "start",
    "street",
    "door",
    "room",
    "stair",
    "ladder",
    "elevator",
    "ramp",
    "drop",
    "roof",
    "checkpoint",
    "finale",
    "escape",
  ]),
  enclosure: z.enum(["open", "covered", "tight", "vista"]).default("open"),
  intensity: z.number().int().min(0).max(5).default(2),
  landmark: z.string().default("").describe("What the player sees from here, or empty."),
  gate: z.enum(["none", "hard", "soft", "one-way", "lock"]).default("none"),
  beat: z.string().optional().describe("Beat id this node serves."),
});

const VERTICAL_KINDS = new Set(["stair", "ladder", "elevator", "ramp", "drop"]);

const Route = z.object({
  id: z.string(),
  kind: z.enum(["critical", "branch", "escape"]),
  typology: z
    .enum([
      "corridor",
      "switchback",
      "loop",
      "hub",
      "arena",
      "pass-through",
      "gauntlet",
      "string-of-pearls",
    ])
    .default("corridor"),
  width: z.number().positive().describe("Clear width in Hammer units; 64 is the hull."),
  points: z
    .array(z.union([XY, XYZ]))
    .min(2)
    .transform((points) =>
      points.map((point): [number, number, number] =>
        point.length === 3 ? [point[0], point[1], point[2]] : [point[0], point[1], 0],
      ),
    ),
  nodes: z.array(RouteNode).default([]),
  stops: z.array(Stop).default([]),
  from: z.string().optional().describe("Branch anchor: node id on the critical route where it leaves."),
  to: z.string().optional().describe("Branch anchor: node id where it rejoins; omit for a dead end."),
});

const Terrain = z
  .object({
    cell: z.number().positive().default(256),
    origin: XY,
    cols: z.number().int().min(2),
    rows: z.number().int().min(2),
    heights: z.array(z.number()),
  })
  .superRefine((value, ctx) => {
    if (value.heights.length !== value.cols * value.rows) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `terrain.heights has ${value.heights.length} values; cols*rows is ${value.cols * value.rows}`,
      });
    }
  });

const Area = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum([
    "spawn",
    "cover",
    "holdout",
    "crescendo",
    "tank",
    "witch",
    "one-way",
    "no-mob",
    "checkpoint",
    "safe-room",
    "finale",
    "battlefield",
    "item-cluster",
  ]),
  floor: z.number().int().min(-8).max(64).default(1).describe("Floor level; 0 and below are basements."),
  buildingId: z.string().optional().describe("Building this area belongs to, when interior."),
  x: z.number(),
  y: z.number(),
  width: POSITIVE,
  depth: POSITIVE,
  rotation: z.number().default(0),
  note: z.string().default(""),
});

const Beat = z.object({
  id: z.string(),
  chapter: z.number().int().min(1),
  type: z.string(),
  space: z.string(),
  what: z.string(),
  proof: z.string(),
  intensity: z.number().int().min(0).max(5).default(2),
});

const District = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string(),
  mood: z.string().default(""),
  motif: z.string().default(""),
  landmark: z.string().default(""),
});

const STAGES = [
  "brief",
  "skeleton",
  "site",
  "vertical",
  "schedule",
  "floors",
  "flow",
  "approved",
] as const;

const Plan = z.object({
  version: z.literal(1),
  name: z.string(),
  kind: z.enum(["campaign", "map"]),
  stage: z.enum(STAGES).default("approved"),
  origin: z
    .enum(["authored", "imported"])
    .default("authored")
    .describe("authored: a design to build. imported: a survey of an existing map; authoring prescriptions do not apply."),
  source: z
    .object({
      bsp: z.string(),
      nav: z.string().optional(),
      entities: z.number().int().optional(),
      navAreas: z.number().int().optional(),
      displacements: z.number().int().optional(),
    })
    .optional()
    .describe("Where an imported plan came from."),
  experience: z.string().default(""),
  pillars: z.array(z.string()).default([]),
  districts: z.array(District).default([]),
  site: z
    .object({
      bounds: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }),
      north: z.number().default(0),
      grid: z.number().positive().default(256),
      water: z.array(Rect).default([]),
      noBuild: z.array(Rect).default([]),
    })
    .default({
      bounds: { x0: -4096, y0: -4096, x1: 4096, y1: 4096 },
      north: 0,
      grid: 256,
      water: [],
      noBuild: [],
    }),
  terrain: Terrain.default({
    cell: 256,
    origin: [0, 0],
    cols: 3,
    rows: 3,
    heights: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  }),
  buildings: z.array(Building).default([]),
  routes: z.array(Route).default([]),
  areas: z.array(Area).default([]),
  beats: z.array(Beat).default([]),
  finale: z
    .object({
      type: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]),
      arena: z.string(),
      stages: z.array(z.string()).default([]),
      escape: z.string(),
    })
    .optional(),
  budget: z.record(z.number()).default({}),
  palette: z
    .object({
      sky: z.string().default(""),
      motifs: z.array(z.string()).default([]),
      materials: z.array(z.string()).default([]),
      models: z.array(z.string()).default([]),
    })
    .default({ sky: "", motifs: [], materials: [], models: [] }),
  variability: z.array(z.string()).default([]),
  acceptance: z.array(z.string()).default([]),
});

export const MapPlanSchema = Plan;
export type MapPlan = z.infer<typeof Plan>;
export type PlanBuilding = z.infer<typeof Building>;
export type PlanRoute = z.infer<typeof Route>;

type Vec2 = [number, number];

interface Finding {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

export interface PlanCheck {
  path: string;
  ok: boolean;
  findings: Finding[];
  counts: { buildings: number; enterable: number; routes: number; beats: number };
}

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

function corners(x: number, y: number, width: number, depth: number, rotation = 0): Vec2[] {
  const hw = width / 2;
  const hd = depth / 2;
  const c = Math.cos(rad(rotation));
  const s = Math.sin(rad(rotation));
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([px, py]) => [x + px! * c - py! * s, y + px! * s + py! * c]);
}

function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const hit = yi > point[1] !== yj > point[1];
    if (hit && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function project(polygon: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of polygon) {
    const value = x * axis[0] + y * axis[1];
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
}

/** Separating axis theorem for two convex polygons (rotated rectangles). */
function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i += 1) {
      const p = polygon[i]!;
      const q = polygon[(i + 1) % polygon.length]!;
      const axis: Vec2 = [-(q[1] - p[1]), q[0] - p[0]];
      const length = Math.hypot(axis[0], axis[1]);
      if (length === 0) continue;
      const unit: Vec2 = [axis[0] / length, axis[1] / length];
      const [minA, maxA] = project(a, unit);
      const [minB, maxB] = project(b, unit);
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

function terrainAt(plan: MapPlan, x: number, y: number): number {
  const { cell, origin, cols, rows, heights } = plan.terrain;
  const fx = (x - origin[0]) / cell;
  const fy = (y - origin[1]) / cell;
  const cx = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
  const cy = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - cx));
  const ty = Math.max(0, Math.min(1, fy - cy));
  const h = (col: number, row: number): number =>
    heights[Math.max(0, Math.min(rows - 1, row)) * cols + Math.max(0, Math.min(cols - 1, col))]!;
  const bottom = h(cx, cy) * (1 - tx) + h(cx + 1, cy) * tx;
  const top = h(cx, cy + 1) * (1 - tx) + h(cx + 1, cy + 1) * tx;
  return bottom * (1 - ty) + top * ty;
}

function routeSamples(route: PlanRoute, step = 32): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < route.points.length; i += 1) {
    const a = route.points[i]!;
    const b = route.points[i + 1]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / step));
    for (let t = 0; t <= count; t += 1) {
      const k = t / count;
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    }
  }
  return out;
}

type PlanNode = PlanRoute["nodes"][number];
type PlanFloor = PlanBuilding["floorsPlan"][number];
type PlanRoom = PlanFloor["rooms"][number];
type PlanDoor = PlanFloor["doors"][number];
type PlanStair = PlanFloor["stairs"][number];

function roomKey(room: PlanRoom): string {
  return room.id ?? room.name;
}

function localToWorld(building: PlanBuilding, x: number, y: number): Vec2 {
  const c = Math.cos(rad(building.rotation));
  const s = Math.sin(rad(building.rotation));
  return [building.x + x * c - y * s, building.y + x * s + y * c];
}

function distanceToRoom(door: PlanDoor, room: PlanRoom): number {
  const dx = Math.max(Math.abs(door.x - room.x) - room.width / 2, 0);
  const dy = Math.max(Math.abs(door.y - room.y) - room.depth / 2, 0);
  return Math.hypot(dx, dy);
}

function doorAtNode(building: PlanBuilding, floor: PlanFloor, node: PlanNode): PlanDoor | null {
  for (const door of floor.doors) {
    const [x, y] = localToWorld(building, door.x, door.y);
    if (Math.hypot(x - node.x, y - node.y) <= Math.max(64, door.width / 2 + 32)) return door;
  }
  return null;
}

function stairAtNode(
  building: PlanBuilding,
  floor: PlanFloor,
  node: PlanNode,
  kind: PlanStair["kind"],
  targetFloor?: number,
): PlanStair | null {
  for (const stair of floor.stairs) {
    if (stair.kind !== kind) continue;
    if (targetFloor !== undefined && stair.to !== targetFloor) continue;
    const [x, y] = localToWorld(building, stair.x, stair.y);
    if (Math.hypot(x - node.x, y - node.y) <= Math.max(96, stair.width / 2 + 32)) return stair;
  }
  return null;
}

function nodeLocal(building: PlanBuilding, node: PlanNode): Vec2 {
  const c = Math.cos(rad(building.rotation));
  const s = Math.sin(rad(building.rotation));
  const dx = node.x - building.x;
  const dy = node.y - building.y;
  return [dx * c + dy * s, -dx * s + dy * c];
}

function nodeInRoom(building: PlanBuilding, room: PlanRoom, node: PlanNode): boolean {
  const [lx, ly] = nodeLocal(building, node);
  return Math.abs(lx - room.x) <= room.width / 2 && Math.abs(ly - room.y) <= room.depth / 2;
}

function routeSpace(node: PlanNode): string {
  return node.space || node.buildingId || node.kind;
}

function countTurns(route: PlanRoute): number {
  let turns = 0;
  for (let index = 1; index + 1 < route.points.length; index += 1) {
    const a = route.points[index - 1]!;
    const b = route.points[index]!;
    const c = route.points[index + 1]!;
    const ab = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const bc = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let delta = Math.abs(bc - ab);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (delta > Math.PI / 6) turns += 1;
  }
  return turns;
}

/**
 * The mission/space graph checks. They are cumulative: once the brief exists, every later
 * stage is checked against the same route contract, so a plan cannot skip the skeleton gate by
 * setting `stage: "approved"`.
 */
function checkRouteGraph(
  plan: MapPlan,
  add: (severity: Finding["severity"], rule: string, message: string) => void,
): void {
  const criticalIds = new Set<string>();
  for (const route of plan.routes) {
    if (route.kind !== "critical") continue;
    for (const node of route.nodes) criticalIds.add(node.id);
  }

  const districtIds = new Set<string>();
  for (const district of plan.districts) {
    if (districtIds.has(district.id)) {
      add("error", "district-duplicate", `district id ${district.id} is repeated`);
    }
    districtIds.add(district.id);
    if (!district.landmark.trim()) {
      add("error", "district-no-landmark", `${district.id} has no landmark`);
    }
    if (!district.motif.trim()) {
      add("error", "district-no-motif", `${district.id} has no motif`);
    }
  }
  if (plan.districts.length < 2) {
    add("error", "district-few", "a chapter needs at least two districts");
  }

  const beatIds = new Set(plan.beats.map((beat) => beat.id));
  const usedDistricts = new Set<string>();
  const usedBeats = new Set<string>();
  const usedSpaces = new Set<string>();

  for (const route of plan.routes) {
    if (route.width < 64) {
      add("error", "route-too-narrow", `${route.id} is ${route.width} wide; the hull is 64`);
    }
    if (route.kind === "critical" && route.nodes.length < 2) {
      add("error", "route-nodes-too-short", `${route.id} needs at least two route nodes`);
    }
    if (route.kind === "critical" && route.width < 96) {
      add("warning", "route-narrow-critical", `${route.id} is ${route.width} wide; 96 is the comfortable critical width`);
    }
    if (route.kind === "branch") {
      if (!route.from) {
        add("error", "branch-no-anchor", `${route.id} is a branch but has no from node`);
      } else if (!criticalIds.has(route.from)) {
        add(
          "error",
          "branch-unknown-anchor",
          `${route.id} leaves from ${route.from}, which is not on a critical route`,
        );
      }
      if (route.to && !criticalIds.has(route.to)) {
        add(
          "error",
          "branch-unknown-anchor",
          `${route.id} rejoins at ${route.to}, which is not on a critical route`,
        );
      }
    }

    for (let index = 0; index < route.nodes.length; index += 1) {
      const node = route.nodes[index]!;
      if (node.district) {
        usedDistricts.add(node.district);
        if (!districtIds.has(node.district)) {
          add("error", "district-unknown", `${node.id} names district ${node.district}, which does not exist`);
        }
      } else {
        add("error", "node-no-district", `${node.id} has no district`);
      }
      if (!node.space.trim()) {
        add("error", "node-no-space", `${node.id} has no named space`);
      }
      if (node.space) {
        usedSpaces.add(node.space);
      }
      if (node.beat) {
        usedBeats.add(node.beat);
        if (!beatIds.has(node.beat)) {
          add("error", "node-unknown-beat", `${node.id} names beat ${node.beat}, which does not exist`);
        }
      }
      if (node.kind === "drop") {
        const next = route.nodes[index + 1];
        if (next && next.z >= node.z) {
          add("warning", "route-drop-up", `${node.id} is a drop but the next node is not lower`);
        }
      }
    }

    if (route.kind !== "critical") continue;

    const spaces = new Set(route.nodes.map(routeSpace));
    if (spaces.size < 3) {
      add("warning", "route-few-spaces", `${route.id} visits ${spaces.size} named space(s); three is the minimum`);
    }
    const vertical = route.nodes.filter((node) => VERTICAL_KINDS.has(node.kind));
    if (route.nodes.length >= 2 && vertical.length === 0) {
      add("warning", "route-no-verticality", `${route.id} has no floor change; a multi-level map needs at least one`);
    }
    if (countTurns(route) < 2) {
      add("warning", "route-straight", `${route.id} has fewer than two turns; it reads as a corridor`);
    }

    const intensities = route.nodes.map((node) => node.intensity);
    if (intensities.length > 0) {
      const min = Math.min(...intensities);
      const max = Math.max(...intensities);
      if (min === max) {
        add("warning", "route-flat-intensity", `${route.id} has one intensity (${min}); the Director has no curve`);
      }
      if (max < 4) {
        add("warning", "route-no-peak", `${route.id} has no node at intensity 4 or 5`);
      }
      if (intensities.filter((value) => value <= 2).length < 2) {
        add("warning", "route-no-rest", `${route.id} has fewer than two rest nodes (intensity 0-2)`);
      }
      let run = 0;
      for (const value of intensities) {
        run = value >= 4 ? run + 1 : 0;
        if (run >= 3) {
          add("warning", "route-high-run", `${route.id} has three high-intensity nodes in a row`);
          break;
        }
      }
    }

    let sameEnclosure = 0;
    let previousEnclosure = "";
    for (const node of route.nodes) {
      sameEnclosure = node.enclosure === previousEnclosure ? sameEnclosure + 1 : 1;
      previousEnclosure = node.enclosure;
      if (sameEnclosure >= 4) {
        add("warning", "route-monotone-enclosure", `${route.id} has four ${node.enclosure} nodes in a row`);
        break;
      }
    }
    if (!route.nodes.some((node) => node.enclosure === "vista")) {
      add("warning", "route-no-vista", `${route.id} has no vista; add one long view`);
    }
    let withoutLandmark = 0;
    for (const node of route.nodes) {
      withoutLandmark = node.landmark.trim() ? 0 : withoutLandmark + 1;
      if (withoutLandmark > 4) {
        add("warning", "route-landmark-gap", `${route.id} goes more than four nodes without a landmark`);
        break;
      }
    }
    if (!route.nodes.some((node) => node.landmark.trim())) {
      add("warning", "route-no-landmark", `${route.id} has no landmark; the player has nothing to aim at`);
    }
    if (!route.nodes.some((node) => node.gate !== "none")) {
      add("warning", "route-no-gate", `${route.id} has no gate; nothing gives the chapter a shape`);
    }
    if (route.nodes.length > 6 && route.typology === "corridor") {
      add(
        "warning",
        "route-corridor",
        `${route.id} has ${route.nodes.length} nodes and is still a corridor; use a typology`,
      );
    }

    const floorsBySpace = new Map<string, Set<number>>();
    for (const node of route.nodes) {
      const key = routeSpace(node);
      const floors = floorsBySpace.get(key) ?? new Set<number>();
      floors.add(node.floor);
      floorsBySpace.set(key, floors);
    }
    for (const [space, floors] of floorsBySpace) {
      if (floors.size > 3) {
        add(
          "warning",
          "route-too-many-floor-planes",
          `${space} spans ${floors.size} floor planes; three is the readable maximum`,
        );
      }
    }

    const samples = routeSamples(route);
    for (const node of route.nodes) {
      const nearest = Math.min(...samples.map((point) => Math.hypot(point[0] - node.x, point[1] - node.y)));
      if (Number.isFinite(nearest) && nearest > 160) {
        add("warning", "node-off-spline", `${node.id} is ${nearest.toFixed(0)} u from the route spline`);
      }
    }
  }

  for (const district of plan.districts) {
    if (!usedDistricts.has(district.id)) {
      add("error", "district-unused", `${district.id} is not visited by any route node`);
    }
  }
  for (const beat of plan.beats) {
    if (!usedBeats.has(beat.id) && !usedSpaces.has(beat.space)) {
      add("warning", "beat-not-on-route", `beat ${beat.id} is in space ${beat.space}, which no route node visits`);
    }
  }
}

export function checkMapPlan(path: string, plan: MapPlan): PlanCheck {
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], rule: string, message: string): void => {
    findings.push({ severity, rule, message });
  };
  const counts = {
    buildings: plan.buildings.length,
    enterable: plan.buildings.filter((building) => building.enterable).length,
    routes: plan.routes.length,
    beats: plan.beats.length,
    districts: plan.districts.length,
  };

  // The brief is cumulative too: an approved plan cannot drop the experience, the pillars or
  // the beats by jumping over the early stages.
  if (!plan.experience.trim()) {
    add("error", "brief-no-experience", "write the one-sentence experience");
  }
  if (plan.pillars.length < 3) {
    add("error", "brief-few-pillars", "write three pillars; they are the build pass's decision rules");
  }
  if (plan.beats.length === 0) {
    add("error", "brief-no-beats", "write at least one beat");
  } else if (plan.beats.length < 3) {
    add("error", "brief-few-beats", "a chapter needs at least three beats");
  }
  if (plan.acceptance.length === 0) {
    add("error", "brief-no-acceptance", "write at least one acceptance criterion");
  }
  if (plan.beats.length > 0) {
    const hasPeak = plan.beats.some((beat) => beat.intensity >= 4);
    const hasRest = plan.beats.some((beat) => beat.intensity <= 2);
    if (!hasPeak || !hasRest) {
      add("warning", "brief-flat-pacing", "the beats need at least one peak (4-5) and one rest (0-2)");
    }
  }

  // `brief` and `skeleton` intentionally run before geometry exists; the later stages run the
  // full geometric checks below.
  if (plan.stage === "brief" || plan.stage === "skeleton") {
    if (plan.stage === "skeleton") {
      if (plan.routes.length === 0) add("error", "skeleton-no-route", "the skeleton needs at least one route");
      for (const route of plan.routes) {
        if (route.kind === "critical" && route.nodes.length < 3) {
          add("error", "skeleton-route-too-short", `${route.id} needs at least three route nodes`);
        }
      }
      checkRouteGraph(plan, add);
    }
    return {
      path,
      ok: findings.every((finding) => finding.severity !== "error"),
      findings,
      counts,
    };
  }

  checkRouteGraph(plan, add);

  if (plan.stage === "site" && plan.buildings.length === 0) {
    add("error", "site-no-buildings", "the site stage needs at least one building footprint");
  }
  if (plan.stage === "flow" && plan.areas.length === 0) {
    add("warning", "flow-no-areas", "the flow stage needs spawn/cover/holdout/crescendo/finale areas");
  }
  const relief = plan.terrain.heights;
  const flatSite = relief.length > 0 && relief.every((value) => value === relief[0]);
  const groundZs = plan.buildings.map((building) => building.baseZ);
  const spread = groundZs.length > 1 ? Math.max(...groundZs) - Math.min(...groundZs) : 0;
  if (flatSite && spread > 128) {
    add(
      "warning",
      "terrain-flat-relief",
      `buildings stand on ${spread} u of height difference but the terrain is flat; give it a heightfield`,
    );
  }

  if (plan.stage === "flow" && plan.palette.motifs.length < 3) {    add("warning", "flow-few-motifs", "name at least three repeated motifs");
  }

  const ids = new Set<string>();
  for (const building of plan.buildings) {
    if (ids.has(building.id)) add("error", "duplicate-id", `building id ${building.id} is repeated`);
    ids.add(building.id);
    if (building.floorsPlan.length > 0 && building.floors !== building.floorsPlan.length) {
      add(
        "error",
        "floor-count-mismatch",
        `${building.id} declares ${building.floors} floors but the plan describes ${building.floorsPlan.length}`,
      );
    }
  }

  const site = plan.site.bounds;
  if (site.x1 <= site.x0 || site.y1 <= site.y0) {
    add("error", "site-bounds", "site.bounds must have x1>x0 and y1>y0");
  }
  for (const building of plan.buildings) {
    const shape = corners(building.x, building.y, building.width, building.depth, building.rotation);
    for (const [x, y] of shape) {
      if (x < site.x0 || x > site.x1 || y < site.y0 || y > site.y1) {
        add(
          "error",
          "building-outside-site",
          `${building.id} has a corner (${x.toFixed(0)}, ${y.toFixed(0)}) outside the site`,
        );
        break;
      }
    }
    const roof = building.roofZ ?? building.baseZ + building.floors * building.floorHeight;
    if (roof <= building.baseZ) {
      add("error", "roof-height", `${building.id} roof ${roof} is not above base ${building.baseZ}`);
    }
    const ground = terrainAt(plan, building.x, building.y);
    if (building.baseZ < ground - 16 && !building.excavated) {
      add("warning", "building-below-terrain", `${building.id} base ${building.baseZ} is below terrain ${ground.toFixed(0)}; mark it excavated`);
    }
    if (building.excavated && building.baseZ >= ground - 16) {
      add("warning", "excavation-not-below", `${building.id} is marked excavated but base ${building.baseZ} is not below terrain ${ground.toFixed(0)}`);
    }
    if (building.enterable && building.entrances.length === 0) {
      add("error", "enterable-no-entrance", `${building.id} is enterable but has no entrance`);
    }
    if (building.enterable && building.floorsPlan.length === 0) {
      const severity = ["floors", "flow", "approved"].includes(plan.stage) ? "error" : "warning";
      add(severity, "no-floor-plan", `${building.id} is enterable but has no floor plan`);
    }
    const floorSeverity = ["floors", "flow", "approved"].includes(plan.stage) ? "error" : "warning";
    const levels = new Set<number>();
    for (const floor of building.floorsPlan) {
      if (levels.has(floor.level)) {
        add("error", "duplicate-floor", `${building.id} has floor ${floor.level} twice`);
      }
      levels.add(floor.level);
      if (floor.z < building.baseZ || floor.z >= roof) {
        add("warning", "floor-outside-building", `${building.id} floor ${floor.level} z=${floor.z} is outside the massing`);
      }

      const rooms = new Map<string, PlanRoom>();
      for (const room of floor.rooms) {
        const key = roomKey(room);
        if (rooms.has(key)) {
          add("error", "duplicate-room", `${building.id} F${floor.level} has room ${key} twice`);
        }
        rooms.set(key, room);
        if (
          Math.abs(room.x) + room.width / 2 > building.width / 2 + 1 ||
          Math.abs(room.y) + room.depth / 2 > building.depth / 2 + 1
        ) {
          add("warning", "room-outside-building", `${building.id} F${floor.level} room ${key} leaves the footprint`);
        }
      }

      for (const door of floor.doors) {
        if (door.from === door.to) {
          add("error", "door-same-side", `${building.id} F${floor.level} door ${door.id ?? door.from} has the same room on both sides`);
        }
        if (door.from === "outside" && door.to === "outside") {
          add("error", "door-no-room", `${building.id} F${floor.level} door ${door.id ?? "?"} connects outside to outside`);
        }
        for (const side of [door.from, door.to]) {
          if (side !== "outside" && !rooms.has(side)) {
            add(floorSeverity, "door-unknown-room", `${building.id} F${floor.level} door ${door.id ?? "?"} names room ${side}, which does not exist`);
          }
        }
        if (Math.abs(door.x) > building.width / 2 + 48 || Math.abs(door.y) > building.depth / 2 + 48) {
          add("warning", "door-outside-building", `${building.id} F${floor.level} door ${door.id ?? "?"} is outside the footprint`);
        }
        for (const side of [door.from, door.to]) {
          if (side === "outside") continue;
          const room = rooms.get(side);
          if (room && distanceToRoom(door, room) > 64) {
            add("warning", "door-not-near-room", `${building.id} F${floor.level} door ${door.id ?? "?"} is ${distanceToRoom(door, room).toFixed(0)} u from ${side}`);
          }
        }
        if (door.from === "outside" || door.to === "outside") {
          const [wx, wy] = localToWorld(building, door.x, door.y);
          const nearEntrance = building.entrances.some(
            (entrance) => Math.hypot(entrance.x - wx, entrance.y - wy) <= 96,
          );
          if (!nearEntrance) {
            add("warning", "door-no-entrance", `${building.id} F${floor.level} door ${door.id ?? "?"} opens outside but has no entrance nearby`);
          }
        }
      }

      for (const stair of floor.stairs) {
        if (stair.to === floor.level) {
          add("error", "stair-same-floor", `${building.id} F${floor.level} stair ${stair.id ?? "?"} targets its own floor`);
        }
        if (Math.abs(stair.x) > building.width / 2 + 48 || Math.abs(stair.y) > building.depth / 2 + 48) {
          add("warning", "stair-outside-building", `${building.id} F${floor.level} stair ${stair.id ?? "?"} is outside the footprint`);
        }
        const target = building.floorsPlan.find((candidate) => candidate.level === stair.to);
        if (!target) {
          add(floorSeverity, "stair-target-missing", `${building.id} F${floor.level} ${stair.kind} targets F${stair.to}, which has no floor plan`);
        } else {
          const hasReturn = target.stairs.some(
            (candidate) =>
              candidate.to === floor.level &&
              Math.hypot(candidate.x - stair.x, candidate.y - stair.y) <= 128,
          );
          if (!hasReturn) {
            add(
              "warning",
              "stair-no-return",
              `${building.id} F${floor.level} ${stair.kind} at local (${stair.x}, ${stair.y}) has no landing on F${stair.to} within 128 u; add a matching ${stair.kind} there`,
            );
          }
        }
      }
    }
  }

  for (let i = 0; i < plan.buildings.length; i += 1) {
    for (let j = i + 1; j < plan.buildings.length; j += 1) {
      const a = plan.buildings[i]!;
      const b = plan.buildings[j]!;
      if (
        polygonsOverlap(
          corners(a.x, a.y, a.width, a.depth, a.rotation),
          corners(b.x, b.y, b.width, b.depth, b.rotation),
        )
      ) {
        add("warning", "footprints-overlap", `${a.id} and ${b.id} overlap; check the spacing`);
      }
    }
  }

  const routeSamplesAll: Vec2[] = [];
  for (const route of plan.routes) {
    for (const point of route.points) {
      if (point[0] < site.x0 || point[0] > site.x1 || point[1] < site.y0 || point[1] > site.y1) {
        add("error", "route-outside-site", `${route.id} leaves the site at (${point[0]}, ${point[1]})`);
        break;
      }
    }
    if (route.kind === "critical") {
      const first = route.stops[0];
      const last = route.stops[route.stops.length - 1];
      if (!first || first.kind !== "start") {
        add("error", "route-no-start", `${route.id} must start with a start stop`);
      }
      if (!last || !["safe-room", "finale", "escape", "checkpoint"].includes(last.kind)) {
        add("error", "route-no-goal", `${route.id} must end at a safe-room/finale/checkpoint stop`);
      }
    }
    const nodeIds = new Set<string>();
    for (let index = 0; index < route.nodes.length; index += 1) {
      const node = route.nodes[index]!;
      if (nodeIds.has(node.id)) add("error", "duplicate-node-id", `route ${route.id} repeats node ${node.id}`);
      nodeIds.add(node.id);
      const building = node.buildingId
        ? plan.buildings.find((candidate) => candidate.id === node.buildingId)
        : null;
      if (node.buildingId && !building) {
        add("error", "node-unknown-building", `${node.id} names building ${node.buildingId}, which does not exist`);
      }
      if (building) {
        if (building.enterable === false) {
          add("warning", "node-in-facade", `${node.id} is inside ${building.id}, which is not enterable`);
        }
        if (
          !pointInPolygon(
            [node.x, node.y],
            corners(building.x, building.y, building.width, building.depth, building.rotation),
          )
        ) {
          add("warning", "node-outside-building", `${node.id} is outside ${building.id}`);
        }
        if (building.enterable) {
          const floor = building.floorsPlan.find((candidate) => candidate.level === node.floor);
          const severity = ["floors", "flow", "approved"].includes(plan.stage) ? "error" : "warning";
          if (!floor) {
            add(severity, "node-no-floor-plan", `${building.id} has no floor plan for node ${node.id} at F${node.floor}`);
          } else {
            const atFloorLevel = !["stair", "ladder", "elevator", "ramp", "drop"].includes(node.kind);
            if (atFloorLevel && Math.abs(node.z - floor.z) > 32) {
              add("warning", "node-z-mismatch", `${node.id} z=${node.z} but ${building.id} F${node.floor} is z=${floor.z}`);
            }
            const verticalKind = ["stair", "ladder", "elevator", "ramp"].includes(node.kind);
            if (node.kind === "door") {
              const door = doorAtNode(building, floor, node);
              if (!door) {
                add(severity, "node-no-door", `${node.id} is a door on ${building.id} F${node.floor} but no door is within reach`);
              }
            } else if (verticalKind) {
              const target = [route.nodes[index - 1], route.nodes[index + 1]].find(
                (neighbour): neighbour is PlanNode => Boolean(neighbour) && neighbour!.floor !== node.floor,
              );
              const stair = stairAtNode(building, floor, node, node.kind as PlanStair["kind"], target?.floor);
              if (!stair) {
                const anyStair = stairAtNode(building, floor, node, node.kind as PlanStair["kind"]);
                if (target && anyStair) {
                  add(
                    ["floors", "flow", "approved"].includes(plan.stage) ? "error" : "warning",
                    "stair-target-mismatch",
                    `${node.id} uses a ${anyStair.kind} to F${anyStair.to} but the route continues on F${target.floor}`,
                  );
                } else {
                  add(
                    severity,
                    "node-no-stair",
                    `${node.id} is a ${node.kind} on ${building.id} F${node.floor} but no matching connection is within reach`,
                  );
                }
              }
            } else {
              const inRoom = floor.rooms.some((room) => nodeInRoom(building, room, node));
              if (!inRoom) {
                const local = nodeLocal(building, node);
                const rooms = floor.rooms
                  .map((room) => `${room.id ?? room.name} @ (${room.x}, ${room.y})`)
                  .join(", ");
                add(
                  "warning",
                  "node-not-in-room",
                  `${node.id} at local (${local[0].toFixed(0)}, ${local[1].toFixed(0)}) is not inside a room on ${building.id} F${node.floor}; rooms: ${rooms || "none"}`,
                );
              }
            }
          }
        }
      }
      if (VERTICAL_KINDS.has(node.kind)) {
        const prev = route.nodes[index - 1];
        const next = route.nodes[index + 1];
        if (
          prev &&
          next &&
          prev.floor === node.floor &&
          next.floor === node.floor &&
          Math.abs(next.z - node.z) <= 16
        ) {
          add(
            "warning",
            "vertical-no-change",
            `${node.id} is a ${node.kind} but neither the floor nor the height changes (F${node.floor}, z=${node.z})`,
          );
        }
      }
      const nextNode = route.nodes[index + 1];
      if (
        nextNode &&
        nextNode.floor !== node.floor &&
        Math.abs(nextNode.z - node.z) > 64 &&
        !VERTICAL_KINDS.has(node.kind) &&
        !VERTICAL_KINDS.has(nextNode.kind)
      ) {
        add(
          ["floors", "flow", "approved"].includes(plan.stage) ? "error" : "warning",
          "floor-jump-without-vertical",
          `${node.id} F${node.floor} z=${node.z} becomes ${nextNode.id} F${nextNode.floor} z=${nextNode.z} without a vertical node`,
        );
      }
    }
    const samples = routeSamples(route);
    const visitedBuildings = new Set(
      route.nodes.map((node) => node.buildingId).filter((id): id is string => Boolean(id)),
    );
    routeSamplesAll.push(...samples);
    const crossedBuildings = new Set<string>();
    for (const sample of samples) {
      for (const building of plan.buildings) {
        if (!pointInPolygon(sample, corners(building.x, building.y, building.width, building.depth, building.rotation))) {
          continue;
        }
        if (building.enterable && visitedBuildings.has(building.id)) continue;
        const nearEntrance = building.entrances.some(
          (entrance) => Math.hypot(entrance.x - sample[0], entrance.y - sample[1]) <= 96,
        );
        if (!nearEntrance && !crossedBuildings.has(building.id)) {
          crossedBuildings.add(building.id);
          add(
            "error",
            "route-through-building",
            `${route.id} crosses ${building.id} at (${sample[0].toFixed(0)}, ${sample[1].toFixed(0)}) away from an entrance; reroute it or add an entrance there`,
          );
        }
      }
      for (const zone of plan.site.noBuild) {
        if (pointInPolygon(sample, corners(zone.x, zone.y, zone.width, zone.depth, zone.rotation))) {
          add(
            "error",
            "route-in-no-build",
            `${route.id} enters a no-build zone at (${sample[0].toFixed(0)}, ${sample[1].toFixed(0)})`,
          );
          break;
        }
      }
      if (
        plan.site.water.some((water) =>
          pointInPolygon(sample, corners(water.x, water.y, water.width, water.depth, water.rotation)),
        )
      ) {
        add("warning", "route-over-water", `${route.id} crosses water at (${sample[0].toFixed(0)}, ${sample[1].toFixed(0)})`);
      }
    }
  }

  const routeBuildingIds = new Set(
    plan.routes.flatMap((route) => route.nodes.map((node) => node.buildingId)).filter((id): id is string => Boolean(id)),
  );
  const roleSeverity = plan.stage === "approved" ? "error" : "warning";
  for (const building of plan.buildings) {
    if (routeBuildingIds.has(building.id) && !["route", "safe-room"].includes(building.role)) {
      add(roleSeverity, "building-role-mismatch", `${building.id} carries route nodes but role is ${building.role}`);
    }
    if (!routeBuildingIds.has(building.id) && ["route", "safe-room"].includes(building.role)) {
      add(roleSeverity, "building-role-unused", `${building.id} is role ${building.role} but no route node visits it`);
    }
  }
  const contextCount = plan.buildings.filter(
    (building) => !["route", "safe-room"].includes(building.role),
  ).length;
  if (contextCount < 3) {
    add(
      plan.stage === "approved" ? "error" : "warning",
      "site-too-sparse",
      `only ${contextCount} context/facade building(s): map the surrounding streetscape, not just the route boxes`,
    );
  }

  const areaIds = new Set<string>();
  for (const area of plan.areas) {
    if (areaIds.has(area.id)) {
      add("error", "duplicate-area-id", `area id ${area.id} is repeated`);
    }
    areaIds.add(area.id);
    const areaBuilding = area.buildingId
      ? plan.buildings.find((candidate) => candidate.id === area.buildingId)
      : null;
    if (area.buildingId && !areaBuilding) {
      add("error", "area-unknown-building", `area ${area.id} names building ${area.buildingId}, which does not exist`);
    } else if (areaBuilding) {
      const areaFloor = areaBuilding.floorsPlan.find((candidate) => candidate.level === area.floor);
      if (!areaFloor) {
        add(
          ["floors", "flow", "approved"].includes(plan.stage) ? "error" : "warning",
          "area-no-floor",
          `${area.id} is on ${areaBuilding.id} F${area.floor}, which has no floor plan`,
        );
      }
      if (!areaBuilding.enterable) {
        add("warning", "area-in-facade", `${area.id} is inside ${areaBuilding.id}, which is not enterable`);
      }
    } else if (area.floor > 1) {
      add("warning", "area-floor-no-building", `${area.id} is on F${area.floor} but names no building`);
    }
    for (const [x, y] of corners(area.x, area.y, area.width, area.depth, area.rotation)) {
      if (x < site.x0 || x > site.x1 || y < site.y0 || y > site.y1) {
        add(
          "error",
          "area-outside-site",
          `area ${area.id} has a corner (${x.toFixed(0)}, ${y.toFixed(0)}) outside the site`,
        );
        break;
      }
    }
    if (
      ["crescendo", "holdout", "finale", "checkpoint", "safe-room", "battlefield"].includes(area.kind)
    ) {
      const routePoints = area.buildingId
        ? plan.routes
            .flatMap((route) => route.nodes)
            .filter((node) => node.buildingId === area.buildingId && node.floor === area.floor)
            .map((node) => [node.x, node.y] as Vec2)
        : routeSamplesAll;
      if (area.buildingId && routePoints.length === 0) {
        add("warning", "area-no-route-node", `${area.id} is on ${area.buildingId} F${area.floor} but no route node is there`);
      }
      const nearest = Math.min(...routePoints.map((point) => Math.hypot(point[0] - area.x, point[1] - area.y)));
      if (Number.isFinite(nearest) && nearest > 320) {
        add(
          "warning",
          "area-off-route",
          `${area.kind} area ${area.id} is ${nearest.toFixed(0)} units from the route`,
        );
      }
    }
  }
  if (plan.areas.length === 0) {
    add(
      "warning",
      "no-gameplay-areas",
      "no spawn/cover/holdout/crescendo/finale areas: the plan describes the street, not the fight",
    );
  }

  for (const building of plan.buildings) {
    if (!building.enterable) continue;
    for (const entrance of building.entrances) {
      const nearest = Math.min(
        ...routeSamplesAll.map((point) => Math.hypot(point[0] - entrance.x, point[1] - entrance.y)),
      );
      if (!Number.isFinite(nearest) || nearest > 160) {
        add(
          "error",
          "entrance-off-route",
          `${building.id} entrance (${entrance.x}, ${entrance.y}) is ${nearest.toFixed(0)} units from the route`,
        );
      }
      const ground = terrainAt(plan, entrance.x, entrance.y);
      const atBase = Math.abs(entrance.z - building.baseZ) <= 48;
      const atTerrain = Math.abs(entrance.z - ground) <= 48;
      if (!atBase && !atTerrain) {
        add(
          "warning",
          "entrance-z",
          `${building.id} entrance z=${entrance.z} matches neither the building base ${building.baseZ.toFixed(0)} nor the terrain ${ground.toFixed(0)}`,
        );
      }
    }
  }

  if (plan.palette.motifs.length < 3) {
    add("warning", "palette-motifs", "give at least three repeated motifs");
  }
  if (plan.kind === "campaign" && !plan.finale) {
    add("warning", "campaign-no-finale", "a campaign plan normally has a finale block");
  }

  // An imported plan is a survey of an existing map. Structural rules still apply; the
  // authoring prescriptions (pillars, pacing, landmarks, gates, streetscape) describe a map
  // being designed, and are wrong to demand from one being measured.
  const DESIGN_RULES = new Set([
    "brief-no-experience", "brief-few-pillars", "brief-no-beats", "brief-few-beats",
    "brief-no-acceptance", "brief-flat-pacing",
    "route-no-vista", "route-no-landmark", "route-landmark-gap", "route-no-gate",
    "route-no-peak", "route-no-rest", "route-flat-intensity", "route-high-run",
    "route-monotone-enclosure", "route-few-spaces", "route-straight", "route-no-verticality",
    "beat-not-on-route", "flow-few-motifs", "palette-motifs", "campaign-no-finale",
    "district-no-landmark", "district-no-motif", "district-few",
    "site-too-sparse", "flow-no-areas", "route-through-building", "entrance-z", "footprints-overlap",
    "building-below-terrain", "excavation-not-below", "terrain-flat-relief",
  ]);
  const reported =
    plan.origin === "imported" ? findings.filter((finding) => !DESIGN_RULES.has(finding.rule)) : findings;

  return {
    path,
    ok: reported.every((finding) => finding.severity !== "error"),
    findings: reported,
    counts,
  };
}

/* ------------------------------------------------------------------------------------ SVG */

interface Transform {
  sx: (x: number) => number;
  sy: (y: number) => number;
  scale: number;
  width: number;
  height: number;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function fitBounds(bounds: Bounds, width = 1200, height = 900, margin = 48): Transform {
  const { x0, y0, x1, y1 } = bounds;
  const scale = Math.min((width - 2 * margin) / Math.max(1, x1 - x0), (height - 2 * margin) / Math.max(1, y1 - y0));
  const ox = (width - (x1 - x0) * scale) / 2;
  const oy = (height - (y1 - y0) * scale) / 2;
  return {
    sx: (x) => ox + (x - x0) * scale,
    sy: (y) => height - oy - (y - y0) * scale,
    scale,
    width,
    height,
  };
}

function fit(plan: MapPlan, width = 1200, height = 900, margin = 48): Transform {
  return fitBounds(plan.site.bounds, width, height, margin);
}

function contentBounds(plan: MapPlan): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  const collect = (points: Vec2[]): void => {
    for (const [x, y] of points) {
      xs.push(x);
      ys.push(y);
    }
  };
  for (const building of plan.buildings) {
    collect(corners(building.x, building.y, building.width, building.depth, building.rotation));
  }
  for (const route of plan.routes) {
    for (const [x, y] of route.points) {
      xs.push(x);
      ys.push(y);
    }
  }
  for (const area of plan.areas) {
    collect(corners(area.x, area.y, area.width, area.depth, area.rotation));
  }
  if (xs.length === 0) return plan.site.bounds;
  const pad = 256;
  return {
    x0: Math.max(plan.site.bounds.x0, Math.min(...xs) - pad),
    y0: Math.max(plan.site.bounds.y0, Math.min(...ys) - pad),
    x1: Math.min(plan.site.bounds.x1, Math.max(...xs) + pad),
    y1: Math.min(plan.site.bounds.y1, Math.max(...ys) + pad),
  };
}

function buildingBounds(building: PlanBuilding): Bounds {
  const shape = corners(building.x, building.y, building.width, building.depth, building.rotation);
  const xs = shape.map(([x]) => x);
  const ys = shape.map(([, y]) => y);
  const pad = 192;
  return {
    x0: Math.min(...xs) - pad,
    y0: Math.min(...ys) - pad,
    x1: Math.max(...xs) + pad,
    y1: Math.max(...ys) + pad,
  };
}

function polygonPoints(points: Vec2[], t: Transform): string {
  return points.map(([x, y]) => `${t.sx(x).toFixed(1)},${t.sy(y).toFixed(1)}`).join(" ");
}

const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function svg(title: string, width: number, height: number, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>${esc(title)}</title>
<defs>
<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
<path d="M0,0 L0,6 L9,3 z" fill="#b03a2e"/>
</marker>
</defs>
${body}
</svg>`;
}

function wrapLegend(line: string, max = 38): string[] {
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      out.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out;
}

function nodeText(node: PlanNode, withFloor = false): string {
  const label = node.label || node.kind;
  return `${label}${withFloor ? ` F${node.floor}` : ""}${node.landmark ? " ★" : ""}`;
}

function frame(
  title: string,
  plan: MapPlan,
  t: Transform,
  body: string,
  legend: string[],
  bounds: Bounds = plan.site.bounds,
  border?: Bounds | null,
): string {
  const { x0, y0, x1, y1 } = bounds;
  const frameBorder = border === undefined ? bounds : border;
  const grid = plan.site.grid;
  const gridLines: string[] = [];
  for (let x = Math.ceil(x0 / grid) * grid; x <= x1; x += grid) {
    gridLines.push(
      `<line x1="${t.sx(x).toFixed(1)}" y1="${t.sy(y0).toFixed(1)}" x2="${t.sx(x).toFixed(1)}" y2="${t.sy(y1).toFixed(1)}" stroke="#e7e1d5" stroke-width="1"/>`,
    );
  }
  for (let y = Math.ceil(y0 / grid) * grid; y <= y1; y += grid) {
    gridLines.push(
      `<line x1="${t.sx(x0).toFixed(1)}" y1="${t.sy(y).toFixed(1)}" x2="${t.sx(x1).toFixed(1)}" y2="${t.sy(y).toFixed(1)}" stroke="#e7e1d5" stroke-width="1"/>`,
    );
  }
  const north = `<g transform="translate(${t.width - 70},70) rotate(${plan.site.north})">
<path d="M0,-34 L10,10 L0,3 L-10,10 Z" fill="#2c3e50"/>
<text x="0" y="28" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#2c3e50">N</text></g>`;
  const scaleBar = (() => {
    const unit = 512;
    const px = unit * t.scale;
    const x = 48;
    const y = t.height - 32;
    return `<g font-family="sans-serif" font-size="11" fill="#2c3e50">
<line x1="${x}" y1="${y}" x2="${x + px}" y2="${y}" stroke="#2c3e50" stroke-width="2"/>
<line x1="${x}" y1="${y - 5}" x2="${x}" y2="${y + 5}" stroke="#2c3e50"/>
<line x1="${x + px}" y1="${y - 5}" x2="${x + px}" y2="${y + 5}" stroke="#2c3e50"/>
<text x="${x}" y="${y - 9}">0</text><text x="${x + px - 18}" y="${y - 9}">${unit} u</text></g>`;
  })();
  const legendLines = legend.flatMap((line) => wrapLegend(line));
  const legendX = t.width - 320;
  const legendY = 110;
  const legendWidth = 312;
  const legendHeight = legendLines.length * 14 + 16;
  const legendText = legendLines
    .map(
      (line, index) =>
        `<text x="${legendX + 8}" y="${legendY + 18 + index * 14}" font-family="sans-serif" font-size="10" fill="#2c3e50">${esc(line)}</text>`,
    )
    .join("");
  const legendBox = `<rect x="${legendX}" y="${legendY}" width="${legendWidth}" height="${legendHeight}" fill="#fffdf7" stroke="#d5dbdb" opacity="0.94"/>`;
  return `<rect width="100%" height="100%" fill="#f8f5ee"/>
${gridLines.join("")}
${frameBorder ? `<rect x="${t.sx(frameBorder.x0).toFixed(1)}" y="${t.sy(frameBorder.y1).toFixed(1)}" width="${((frameBorder.x1 - frameBorder.x0) * t.scale).toFixed(1)}" height="${((frameBorder.y1 - frameBorder.y0) * t.scale).toFixed(1)}" fill="#fffdf7" stroke="#2c3e50" stroke-width="2"/>` : ""}
${body}
<text x="48" y="42" font-family="sans-serif" font-size="22" fill="#1b2631">${esc(title)}</text>
<text x="48" y="64" font-family="sans-serif" font-size="12" fill="#5d6d7e">${esc(plan.name)} · Hammer units · ${Math.round(t.scale * 100) / 100} px/u</text>
${north}
${scaleBar}
${legendBox}
${legendText}`;
}

function rectSvg(building: PlanBuilding, t: Transform, fill: string, stroke: string): string {
  return `<polygon points="${polygonPoints(corners(building.x, building.y, building.width, building.depth, building.rotation), t)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}


/** Real walkable layout of an imported plan, drawn under the schematic. */
function navLayer(plan: MapPlan, t: Transform): string {
  const source = plan.source?.nav;
  if (!source || !existsSync(source)) return "";
  const nav = readNavFile(readFileSync(source), source);
  const out: string[] = [];
  for (const area of nav.areas) {
    const w = Math.max(1, (area.maxX - area.minX) * t.scale);
    const h = Math.max(1, (area.maxY - area.minY) * t.scale);
    if (w < 1.5 || h < 1.5) continue;
    out.push(
      `<rect x="${t.sx(area.minX).toFixed(1)}" y="${t.sy(area.maxY).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#7f8c8d" fill-opacity="0.18" stroke="#95a5a6" stroke-width="0.3"/>`,
    );
  }
  return out.join("\n");
}

function sitePlan(plan: MapPlan): string {
  const t = fit(plan);
  const body: string[] = [navLayer(plan, t)];
  for (const water of plan.site.water) {
    body.push(
      `<polygon points="${polygonPoints(corners(water.x, water.y, water.width, water.depth, water.rotation), t)}" fill="#a9cce3" opacity="0.6"/>`,
    );
  }
  for (const zone of plan.site.noBuild) {
    body.push(
      `<polygon points="${polygonPoints(corners(zone.x, zone.y, zone.width, zone.depth, zone.rotation), t)}" fill="#e74c3c" opacity="0.12" stroke="#c0392b" stroke-dasharray="6 4"/>`,
    );
  }
  for (const building of plan.buildings) {
    const fill =
      building.role === "route" || building.role === "safe-room"
        ? "#d5c3a1"
        : building.role === "landmark"
          ? "#e8d5a8"
          : "#ded8cc";
    body.push(rectSvg(building, t, fill, "#5d6d7e"));
    const cx = t.sx(building.x);
    const cy = t.sy(building.y);
    body.push(
      `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#1b2631">${esc(building.id)}</text>`,
      `<text x="${cx.toFixed(1)}" y="${(cy + 15).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#5d6d7e">${building.width}×${building.depth} ${Math.round(building.rotation)}°</text>`,
      `<text x="${cx.toFixed(1)}" y="${(cy + 29).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#7f8c8d">${esc(building.role)}</text>`,
      `<circle cx="${t.sx(building.x).toFixed(1)}" cy="${t.sy(building.y).toFixed(1)}" r="2.5" fill="#2c3e50"/>`,
    );
  }
  return svg(
    "Site plan — footprints, coordinates and spacing",
    t.width,
    t.height,
    frame("1 · Site plan", plan, t, body.join("\n"), [
      "brown: route or safe-room building",
      "tan: landmark building",
      "grey: context / facade building",
      "dashed red: no-build zone",
      "blue: water",
    ]),
  );
}

function heightColor(z: number, min: number, max: number): string {
  const t = max === min ? 0.5 : (z - min) / (max - min);
  const low = [122, 169, 196];
  const high = [176, 142, 96];
  const rgb = low.map((value, index) => Math.round(value + (high[index]! - value) * t));
  return `rgb(${rgb.join(",")})`;
}

function terrainPlan(plan: MapPlan): string {
  const t = fit(plan);
  const { cell, origin, cols, rows, heights } = plan.terrain;
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const body: string[] = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const x = origin[0] + col * cell;
      const y = origin[1] + row * cell;
      const z = heights[row * cols + col]!;
      const px = t.sx(x);
      const py = t.sy(y + cell);
      body.push(
        `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${(cell * t.scale).toFixed(1)}" height="${(cell * t.scale).toFixed(1)}" fill="${heightColor(z, min, max)}" stroke="#ffffff" stroke-width="0.3" opacity="0.85"/>`,
      );
      if (col % 2 === 0 && row % 2 === 0) {
        body.push(
          `<text x="${(px + 4).toFixed(1)}" y="${(py + 12).toFixed(1)}" font-family="sans-serif" font-size="9" fill="#1b2631">${z.toFixed(0)}</text>`,
        );
      }
    }
  }
  for (const water of plan.site.water) {
    body.push(
      `<polygon points="${polygonPoints(corners(water.x, water.y, water.width, water.depth, water.rotation), t)}" fill="#5dade2" opacity="0.55"/>`,
    );
  }
  for (const building of plan.buildings) {
    const roof = building.roofZ ?? building.baseZ + building.floors * building.floorHeight;
    body.push(rectSvg(building, t, "none", "#1b2631"));
    body.push(
      `<text x="${t.sx(building.x).toFixed(1)}" y="${(t.sy(building.y) - 4).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#1b2631">${building.id} ${building.baseZ}/${roof}</text>`,
    );
  }
  return svg(
    "Vertical plan — terrain grid, water and building base/roof heights",
    t.width,
    t.height,
    frame("2 · Vertical plan (terrain)", plan, t, body.join("\n"), [
      `terrain ${min}…${max} u`,
      "label: base / roof z",
      "blue: water",
    ]),
  );
}

function intensityColor(value: number): string {
  const colors = ["#2471a3", "#5dade2", "#f4d03f", "#e67e22", "#c0392b", "#7b241c"];
  return colors[Math.max(0, Math.min(colors.length - 1, Math.round(value)))]!;
}

function rhythmStrip(plan: MapPlan, t: Transform): string {
  const route = plan.routes.find((candidate) => candidate.kind === "critical" && candidate.nodes.length > 1);
  if (!route) return "";
  const width = 240;
  const height = 88;
  const x = t.width - width - 48;
  const y = t.height - height - 24;
  const nodes = route.nodes;
  const step = width / Math.max(1, nodes.length - 1);
  const py = (value: number): number => y + 20 + (1 - value / 5) * (height - 42);
  const points = nodes
    .map((node, index) => `${(x + index * step).toFixed(1)},${py(node.intensity).toFixed(1)}`)
    .join(" ");
  const dots = nodes
    .map(
      (node, index) =>
        `<circle cx="${(x + index * step).toFixed(1)}" cy="${py(node.intensity).toFixed(1)}" r="3" fill="${intensityColor(node.intensity)}" stroke="#fffdf7"/>`,
    )
    .join("");
  return `<g>
<rect x="${(x - 12).toFixed(1)}" y="${y}" width="${width + 24}" height="${height}" fill="#fffdf7" stroke="#8a8175" stroke-width="1" opacity="0.94"/>
<text x="${x.toFixed(1)}" y="${(y + 14).toFixed(1)}" font-family="sans-serif" font-size="11" fill="#1b2631">Director rhythm · ${esc(route.id)}</text>
<line x1="${x.toFixed(1)}" y1="${py(0).toFixed(1)}" x2="${(x + width).toFixed(1)}" y2="${py(0).toFixed(1)}" stroke="#d5dbdb"/>
<line x1="${x.toFixed(1)}" y1="${py(5).toFixed(1)}" x2="${(x + width).toFixed(1)}" y2="${py(5).toFixed(1)}" stroke="#d5dbdb"/>
<polyline points="${points}" fill="none" stroke="#34495e" stroke-width="1.5"/>
${dots}
<text x="${(x - 9).toFixed(1)}" y="${(py(5) + 3).toFixed(1)}" font-family="sans-serif" font-size="9" fill="#5d6d7e">5</text>
<text x="${(x - 9).toFixed(1)}" y="${(py(0) + 3).toFixed(1)}" font-family="sans-serif" font-size="9" fill="#5d6d7e">0</text>
</g>`;
}

function circulationPlan(plan: MapPlan): string {
  const bounds = contentBounds(plan);
  const t = fitBounds(bounds);
  const body: string[] = [navLayer(plan, t)];
  for (const building of plan.buildings) {
    body.push(rectSvg(building, t, "#e8e2d6", "#8a8175"));
  }
  const districtNodes = new Map<string, PlanNode[]>();
  for (const route of plan.routes) {
    for (const node of route.nodes) {
      if (!node.district) continue;
      const list = districtNodes.get(node.district) ?? [];
      list.push(node);
      districtNodes.set(node.district, list);
    }
  }
  const districtColors = ["#8e44ad", "#16a085", "#d35400", "#2980b9", "#c0392b", "#7d6608"];
  plan.districts.forEach((district, index) => {
    const nodes = districtNodes.get(district.id) ?? [];
    if (nodes.length === 0) return;
    const color = districtColors[index % districtColors.length]!;
    const x0 = Math.min(...nodes.map((node) => node.x)) - 96;
    const x1 = Math.max(...nodes.map((node) => node.x)) + 96;
    const y0 = Math.min(...nodes.map((node) => node.y)) - 96;
    const y1 = Math.max(...nodes.map((node) => node.y)) + 96;
    body.push(
      `<rect x="${t.sx(x0).toFixed(1)}" y="${t.sy(y1).toFixed(1)}" width="${((x1 - x0) * t.scale).toFixed(1)}" height="${((y1 - y0) * t.scale).toFixed(1)}" fill="${color}" fill-opacity="0.05" stroke="${color}" stroke-width="1.2" stroke-dasharray="10 6"/>`,
      `<text x="${(t.sx(x0) + 6).toFixed(1)}" y="${(t.sy(y1) + 15).toFixed(1)}" font-family="sans-serif" font-size="11" fill="${color}">${esc(district.name || district.id)} · ${esc(district.landmark)}</text>`,
    );
  });
  const areaColor: Record<string, string> = {
    spawn: "#e67e22",
    cover: "#27ae60",
    holdout: "#8e44ad",
    crescendo: "#c0392b",
    tank: "#7f8c8d",
    witch: "#2c3e50",
    "one-way": "#d35400",
    "no-mob": "#95a5a6",
    checkpoint: "#2980b9",
    "safe-room": "#1e8449",
    finale: "#b03a2e",
    battlefield: "#f39c12",
    "item-cluster": "#16a085",
  };
  for (const area of plan.areas) {
    const color = areaColor[area.kind] ?? "#7f8c8d";
    const level = area.buildingId || area.floor > 1 ? ` F${area.floor}` : "";
    body.push(
      `<polygon points="${polygonPoints(corners(area.x, area.y, area.width, area.depth, area.rotation), t)}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
      `<text x="${t.sx(area.x).toFixed(1)}" y="${t.sy(area.y).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="${color}" stroke="#fffdf7" stroke-width="2.5" paint-order="stroke">${esc(area.kind)}${level}</text>`,
    );
  }
  for (const route of plan.routes) {
    const points = route.points.map(([x, y]) => `${t.sx(x).toFixed(1)},${t.sy(y).toFixed(1)}`).join(" ");
    body.push(
      `<polyline points="${points}" fill="none" stroke="${route.kind === "critical" ? "#b03a2e" : "#2471a3"}" stroke-width="${Math.max(3, route.width * t.scale)}" stroke-opacity="0.16" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<polyline points="${points}" fill="none" stroke="${route.kind === "critical" ? "#b03a2e" : "#2471a3"}" stroke-width="2.5" marker-mid="url(#arrow)" stroke-dasharray="${route.kind === "branch" ? "8 5" : ""}"/>`,
    );
    for (const stop of route.stops) {
      body.push(
        `<circle cx="${t.sx(stop.x).toFixed(1)}" cy="${t.sy(stop.y).toFixed(1)}" r="6" fill="#fff" stroke="#b03a2e" stroke-width="2"/>`,
        `<text x="${(t.sx(stop.x) + 9).toFixed(1)}" y="${(t.sy(stop.y) - 6).toFixed(1)}" font-family="sans-serif" font-size="11" fill="#1b2631">${esc(stop.label)}</text>`,
      );
    }
    for (let index = 0; index < route.nodes.length; index += 1) {
      const node = route.nodes[index]!;
      const vertical = VERTICAL_KINDS.has(node.kind);
      const fill = intensityColor(node.intensity);
      const stroke = vertical ? "#8e44ad" : "#ffffff";
      const cx = t.sx(node.x);
      const cy = t.sy(node.y);
      if (vertical) {
        body.push(
          `<polygon points="${cx.toFixed(1)},${(cy - 9).toFixed(1)} ${(cx + 9).toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${(cy + 9).toFixed(1)} ${(cx - 9).toFixed(1)},${cy.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
        );
      } else {
        body.push(
          `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`,
        );
      }
      if (node.gate !== "none") {
        body.push(
          `<rect x="${(cx + 6).toFixed(1)}" y="${(cy - 12).toFixed(1)}" width="7" height="7" fill="#f1c40f" stroke="#7d6608" stroke-width="0.8"/>`,
        );
      }
      body.push(
        `<text x="${cx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="8" font-weight="bold" fill="#ffffff" stroke="#1b2631" stroke-width="2" paint-order="stroke">${index + 1}</text>`,
      );
    }
    const first = route.points[0]!;
    body.push(
      `<text x="${t.sx(first[0]).toFixed(1)}" y="${(t.sy(first[1]) - 18).toFixed(1)}" font-family="sans-serif" font-size="11" fill="#b03a2e">${esc(route.id)} · ${esc(route.typology)} · ${route.width}u</text>`,
    );
  }
  for (const building of plan.buildings) {
    for (const entrance of building.entrances) {
      body.push(
        `<rect x="${(t.sx(entrance.x) - 4).toFixed(1)}" y="${(t.sy(entrance.y) - 4).toFixed(1)}" width="8" height="8" fill="#1e8449"/>`,
      );
    }
  }
  body.push(rhythmStrip(plan, t));
  const legend = [
    "red: critical path",
    "blue dashed: branch/escape",
    "green: building entrance",
    "band width = clear width",
    "coloured dashed: spawn/cover/holdout/crescendo/finale",
    "dashed boundary: district; label = landmark",
    "node fill: intensity (blue rest, red peak)",
    "diamond: stair/ladder/ramp/drop; ★ landmark",
    "gold square: gate; bottom right: rhythm",
  ];
  const critical = plan.routes.find((route) => route.kind === "critical");
  if (critical) {
    legend.push("route nodes:");
    critical.nodes.forEach((node, index) => {
      legend.push(`${index + 1}. ${node.label || node.kind} F${node.floor}${node.landmark ? " ★" : ""}`);
    });
  }
  return svg(
    "Circulation plan — critical path, branches, stops and entrances",
    t.width,
    t.height,
    frame("3 · Circulation plan", plan, t, body.join("\n"), legend, bounds),
  );
}

function buildingSchedule(plan: MapPlan): string {
  const rows = plan.buildings.map((building) => {
    const roof = building.roofZ ?? building.baseZ + building.floors * building.floorHeight;
    return {
      id: building.id,
      name: building.name,
      floors: building.floors,
      base: building.baseZ,
      roof,
      height: roof - building.baseZ,
      area: building.width * building.depth,
      enterable: building.enterable ? "yes" : "no",
      entrances: building.entrances.length,
      role: building.role,
    };
  });
  const width = 1360;
  const height = 160 + rows.length * 30;
  const cols = [60, 260, 420, 520, 620, 720, 820, 930, 1010, 1090];
  const headers = ["id", "name", "floors", "base", "roof", "height", "area", "enterable", "doors", "role"];
  const body: string[] = [];
  const t = fit(plan);
  body.push(`<rect width="100%" height="100%" fill="#f8f5ee"/>`);
  body.push(`<text x="48" y="42" font-family="sans-serif" font-size="22" fill="#1b2631">4 · Building and height schedule</text>`);
  body.push(`<text x="48" y="64" font-family="sans-serif" font-size="12" fill="#5d6d7e">${esc(plan.name)} · ${rows.length} buildings · Hammer units</text>`);
  headers.forEach((header, index) => {
    body.push(`<text x="${cols[index]}" y="104" font-family="sans-serif" font-size="12" font-weight="bold" fill="#1b2631">${header}</text>`);
  });
  rows.forEach((row, index) => {
    const y = 130 + index * 30;
    if (index % 2 === 0) body.push(`<rect x="48" y="${y - 18}" width="${width - 96}" height="28" fill="#efe9dd"/>`);
    const values = [
      row.id,
      row.name,
      String(row.floors),
      String(row.base),
      String(row.roof),
      String(row.height),
      row.area.toFixed(0),
      row.enterable,
      String(row.entrances),
      row.role,
    ];
    values.forEach((value, column) => {
      body.push(`<text x="${cols[column]}" y="${y}" font-family="sans-serif" font-size="11" fill="#1b2631">${esc(value)}</text>`);
    });
  });
  body.push(
    `<text x="48" y="${height - 28}" font-family="sans-serif" font-size="11" fill="#5d6d7e">scale ${Math.round(t.scale * 100) / 100} px/u · footprint area = width×depth before rotation</text>`,
  );
  return svg("Building and height schedule", width, height, body.join("\n"));
}

function floorPlan(
  plan: MapPlan,
  building: PlanBuilding,
  floor?: PlanBuilding["floorsPlan"][number],
): string {
  const bounds = buildingBounds(building);
  const t = fitBounds(bounds);
  const body: string[] = [];
  body.push(rectSvg(building, t, "#fdfbf6", "#1b2631"));
  const levels = floor ? [floor] : building.floorsPlan;
  for (const level of levels) {
    for (const room of level.rooms) {
      const [wx, wy] = localToWorld(building, room.x, room.y);
      const [tx, ty] = localToWorld(building, room.x - room.width / 2, room.y + room.depth / 2);
      body.push(
        `<polygon points="${polygonPoints(corners(wx, wy, room.width, room.depth, building.rotation), t)}" fill="#f5efe3" stroke="#8a8175"/>`,
        `<text x="${(t.sx(tx) + 5).toFixed(1)}" y="${(t.sy(ty) + 13).toFixed(1)}" font-family="sans-serif" font-size="10" fill="#5d6d7e">${esc(room.name)}</text>`,
      );
    }
    for (const door of level.doors) {
      const [wx, wy] = localToWorld(building, door.x, door.y);
      body.push(
        `<polygon points="${polygonPoints(corners(wx, wy, door.width, door.depth, building.rotation + door.rotation), t)}" fill="#f1c40f" stroke="#7d6608" stroke-width="1"/>`,
        `<text x="${t.sx(wx).toFixed(1)}" y="${(t.sy(wy) - 6).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#7d6608" stroke="#fffdf7" stroke-width="2.5" paint-order="stroke">${esc(door.from)}→${esc(door.to)}</text>`,
      );
    }
    for (const stair of level.stairs) {
      const [wx, wy] = localToWorld(building, stair.x, stair.y);
      body.push(
        `<polygon points="${polygonPoints(corners(wx, wy, stair.width, stair.depth, building.rotation), t)}" fill="#d5dbdb" stroke="#5d6d7e"/>`,
        `<text x="${t.sx(wx).toFixed(1)}" y="${(t.sy(wy) + 4).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#2c3e50" stroke="#f8f5ee" stroke-width="2.5" paint-order="stroke">${esc(stair.kind)} →F${stair.to}</text>`,
      );
    }
  }
  for (const route of plan.routes) {
    for (let index = 0; index < route.nodes.length; index += 1) {
      const node = route.nodes[index]!;
      if (node.buildingId !== building.id) continue;
      if (floor && node.floor !== floor.level) continue;
      const above = index % 2 === 0;
      body.push(
        `<circle cx="${t.sx(node.x).toFixed(1)}" cy="${t.sy(node.y).toFixed(1)}" r="5" fill="#b03a2e"/>`,
        `<text x="${(t.sx(node.x) + 8).toFixed(1)}" y="${(t.sy(node.y) + (above ? -6 : 14)).toFixed(1)}" font-family="sans-serif" font-size="8" fill="#b03a2e" stroke="#fffdf7" stroke-width="2.5" paint-order="stroke">${esc(nodeText(node))}</text>`,
      );
    }
  }
  for (const entrance of building.entrances) {
    body.push(
      `<rect x="${(t.sx(entrance.x) - 5).toFixed(1)}" y="${(t.sy(entrance.y) - 5).toFixed(1)}" width="10" height="10" fill="#1e8449"/>`,
    );
  }
  const title = floor
    ? `5 · Floor plan — ${building.id} F${floor.level} (z=${floor.z})`
    : `5 · Floor plan — ${building.id}`;
  return svg(
    title,
    t.width,
    t.height,
    frame(title, plan, t, body.join("\n"), [
      "rooms: this floor only",
      "gold: door/opening/gate (from→to)",
      "grey: stair/ladder/elevator/ramp with target floor",
      "red: route node on this floor",
      "green: entrance",
    ], bounds, null),
  );
}

function section(plan: MapPlan, building: PlanBuilding): string {
  const width = 900;
  const roof = building.roofZ ?? building.baseZ + building.floors * building.floorHeight;
  const top = roof + 32;
  const bottom = building.baseZ - 32;
  const sy = (z: number): number => 700 - ((z - bottom) / Math.max(1, top - bottom)) * 600;
  const xFor = (localX: number): number => 100 + ((localX + building.width / 2) / Math.max(1, building.width)) * 700;
  const body: string[] = [
    `<rect width="100%" height="100%" fill="#f8f5ee"/>`,
    `<text x="48" y="42" font-family="sans-serif" font-size="22" fill="#1b2631">Section — ${esc(building.name)}</text>`,
    `<text x="48" y="92" font-family="sans-serif" font-size="11" fill="#5d6d7e">dots: route nodes · purple dashed: stair/ladder/elevator/ramp</text>`,
    `<line x1="100" y1="${sy(building.baseZ)}" x2="800" y2="${sy(building.baseZ)}" stroke="#1b2631" stroke-width="3"/>`,
    `<line x1="100" y1="${sy(roof)}" x2="800" y2="${sy(roof)}" stroke="#1b2631" stroke-width="3"/>`,
    `<line x1="100" y1="${sy(building.baseZ)}" x2="100" y2="${sy(roof)}" stroke="#1b2631" stroke-width="2"/>`,
    `<line x1="800" y1="${sy(building.baseZ)}" x2="800" y2="${sy(roof)}" stroke="#1b2631" stroke-width="2"/>`,
  ];
  const seenConnections = new Set<string>();
  for (const floor of building.floorsPlan) {
    body.push(
      `<line x1="100" y1="${sy(floor.z)}" x2="800" y2="${sy(floor.z)}" stroke="#8a8175" stroke-width="1.5"/>`,
      `<text x="810" y="${sy(floor.z) + 4}" font-family="sans-serif" font-size="11" fill="#1b2631">F${floor.level} z=${floor.z}</text>`,
    );
    for (const stair of floor.stairs) {
      const target = building.floorsPlan.find((candidate) => candidate.level === stair.to);
      if (!target) continue;
      const low = Math.min(floor.level, stair.to);
      const high = Math.max(floor.level, stair.to);
      const key = `${low}-${high}-${Math.round(stair.x)}`;
      if (seenConnections.has(key)) continue;
      seenConnections.add(key);
      const x = xFor(stair.x);
      body.push(
        `<line x1="${x.toFixed(1)}" y1="${sy(floor.z).toFixed(1)}" x2="${x.toFixed(1)}" y2="${sy(target.z).toFixed(1)}" stroke="#8e44ad" stroke-width="3" stroke-dasharray="8 5"/>`,
        `<text x="${(x + 6).toFixed(1)}" y="${(sy((floor.z + target.z) / 2) + 4).toFixed(1)}" font-family="sans-serif" font-size="10" fill="#8e44ad">${esc(stair.kind)} F${low}-F${high}</text>`,
      );
    }
  }
  const c = Math.cos(rad(building.rotation));
  const s = Math.sin(rad(building.rotation));
  for (const route of plan.routes) {
    for (const node of route.nodes) {
      if (node.buildingId !== building.id) continue;
      const dx = node.x - building.x;
      const dy = node.y - building.y;
      const lx = dx * c + dy * s;
      if (lx < -building.width / 2 || lx > building.width / 2) continue;
      const vertical = VERTICAL_KINDS.has(node.kind);
      body.push(
        `<circle cx="${xFor(lx).toFixed(1)}" cy="${sy(node.z).toFixed(1)}" r="${vertical ? 5 : 4}" fill="${vertical ? "#8e44ad" : "#b03a2e"}" stroke="#fffdf7" stroke-width="1.5"/>`,
      );
    }
  }
  body.push(
    `<text x="48" y="70" font-family="sans-serif" font-size="12" fill="#5d6d7e">base ${building.baseZ} · roof ${roof} · ${building.floors} floors</text>`,
  );
  return svg(`Section — ${building.name}`, width, 760, body.join("\n"));
}

function planMarkdown(plan: MapPlan, check: PlanCheck, files: string[]): string {
  const critical = plan.routes.find((route) => route.kind === "critical" && route.nodes.length > 0);
  const connections = plan.buildings.flatMap((building) =>
    building.floorsPlan.flatMap((floor) => [
      ...floor.doors.map(
        (door) =>
          `| ${building.id} | F${floor.level} | ${door.kind}${door.locked ? " (locked)" : ""} | ${door.from} → ${door.to} | ${door.x}, ${door.y} | — |`,
      ),
      ...floor.stairs.map(
        (stair) =>
          `| ${building.id} | F${floor.level} | ${stair.kind} | F${floor.level} | ${stair.x}, ${stair.y} | F${stair.to} |`,
      ),
    ]),
  );
  const lines = [
    `# ${plan.name} — plan drawings`,
    "",
    `Source: \`plan.json\``,
    `Kind: ${plan.kind}`,
    `Stage: ${plan.stage}`,
    `Validation: **${check.ok ? "pass" : "fail"}** (${check.findings.length} findings)`,
    "",
    `Experience: ${plan.experience || "—"}`,
    "",
    "Pillars:",
    ...(plan.pillars.length === 0 ? ["- —"] : plan.pillars.map((pillar) => `- ${pillar}`)),
    "",
    "## Drawings",
    "",
    ...files.map((file) => `- [${basename(file)}](${basename(file)})`),
    "",
    "## Districts",
    "",
    "| id | name | mood | motif | landmark |",
    "|---|---|---|---|---|",
    ...plan.districts.map(
      (district) =>
        `| ${district.id} | ${district.name} | ${district.mood} | ${district.motif} | ${district.landmark} |`,
    ),
    "",
    "## Buildings",
    "",
    "| id | name | role | floors | base | roof | enterable | doors |",
    "|---|---|---|---:|---:|---:|---|---:|",
    ...plan.buildings.map((building) => {
      const roof = building.roofZ ?? building.baseZ + building.floors * building.floorHeight;
      return `| ${building.id} | ${building.name} | ${building.role} | ${building.floors} | ${building.baseZ} | ${roof} | ${building.enterable ? "yes" : "no"} | ${building.entrances.length} |`;
    }),
    "",
    "## Routes",
    "",
    "| id | kind | typology | width | from | to | stops |",
    "|---|---|---|---:|---|---|---|",
    ...plan.routes.map(
      (route) =>
        `| ${route.id} | ${route.kind} | ${route.typology} | ${route.width} | ${route.from ?? ""} | ${route.to ?? ""} | ${route.stops.map((stop) => stop.label).join(", ")} |`,
    ),
    "",
    ...(critical
      ? [
          "## Route rhythm",
          "",
          "| # | node | kind | space | floor | intensity | enclosure | landmark | gate |",
          "|---:|---|---|---|---:|---:|---|---|---|",
          ...critical.nodes.map(
            (node, index) =>
              `| ${index + 1} | ${node.label || node.id} | ${node.kind} | ${node.space || node.buildingId || "—"} | F${node.floor} | ${node.intensity} | ${node.enclosure} | ${node.landmark || "—"} | ${node.gate} |`,
          ),
          "",
        ]
      : []),
    ...(connections.length > 0
      ? [
          "## Floor connections",
          "",
          "| building | floor | kind | sides | at (local) | target |",
          "|---|---|---|---|---|---|",
          ...connections,
          "",
        ]
      : []),
    "## Gameplay and nav areas",
    "",
    "| id | kind | floor | building | label | note |",
    "|---|---|---:|---|---|---|",
    ...plan.areas.map(
      (area) =>
        `| ${area.id} | ${area.kind} | F${area.floor} | ${area.buildingId ?? "—"} | ${area.label} | ${area.note} |`,
    ),
    "",
    "## Findings",
    "",
    ...(check.findings.length === 0
      ? ["No findings."]
      : check.findings.map(
          (finding) => `- **${finding.severity}** \`${finding.rule}\`: ${finding.message}`,
        )),
    "",
    "The drawings are a schematic. The JSON is the source; do not measure a build from an SVG.",
    "",
  ];
  return lines.join("\n");
}

function buildSheet(plan: MapPlan, check: PlanCheck, files: string[]): string {
  const critical = plan.routes.find((route) => route.kind === "critical");
  const connectionFor = (route: PlanRoute, node: PlanNode, index: number): string => {
    if (!node.buildingId) return "—";
    const building = plan.buildings.find((candidate) => candidate.id === node.buildingId);
    if (!building?.enterable) return "—";
    const floor = building.floorsPlan.find((candidate) => candidate.level === node.floor);
    if (!floor) return "—";
    if (node.kind === "door") {
      const door = doorAtNode(building, floor, node);
      return door ? `door ${door.id ?? `${door.from}→${door.to}`}` : "MISSING";
    }
    if (["stair", "ladder", "elevator", "ramp"].includes(node.kind)) {
      const target = [route.nodes[index - 1], route.nodes[index + 1]].find(
        (neighbour): neighbour is PlanNode => Boolean(neighbour) && neighbour!.floor !== node.floor,
      );
      const stair = stairAtNode(building, floor, node, node.kind as PlanStair["kind"], target?.floor);
      return stair ? `${stair.kind} ${stair.id ?? `F${floor.level}→F${stair.to}`}` : "MISSING";
    }
    if (node.kind === "drop") return "drop";
    return "—";
  };
  const nodesForBeat = (beatId: string): string =>
    plan.routes
      .flatMap((route) => route.nodes.filter((node) => node.beat === beatId).map((node) => node.id))
      .join(", ") || "—";
  const lines: string[] = [
    `# ${plan.name} — build sheet`,
    "",
    "Generated from `plan.json`. Do not edit; edit the JSON and re-render.",
    `Stage: ${plan.stage}`,
    `Validation: **${check.ok ? "pass" : "fail"}** (${check.findings.length} findings)`,
    "",
    `Experience: ${plan.experience || "—"}`,
    "",
    "Pillars:",
    ...(plan.pillars.length === 0 ? ["1. —"] : plan.pillars.map((pillar, index) => `${index + 1}. ${pillar}`)),
    "",
    "## Read this first",
    "",
    "1. `plan.json` is the source of truth. If this sheet and the JSON disagree, the JSON wins and this sheet is stale: re-render.",
    "2. Build the critical route in the table order. A row is a decision, threshold or floor change, not a distance.",
    "3. The SVGs are views for a human/visual check. Never measure a build from an SVG.",
    "4. `MISSING` in a connection column means the route claims a door or stair that the floor plan does not contain. Fix the JSON before building.",
    "",
    "## Districts",
    "",
    "| id | name | mood | motif | landmark |",
    "|---|---|---|---|---|",
    ...plan.districts.map(
      (district) =>
        `| ${district.id} | ${district.name} | ${district.mood} | ${district.motif} | ${district.landmark} |`,
    ),
    "",
    "## Critical route",
    "",
    "| # | node | kind | space | district | F | building | x | y | z | connection | intensity | enclosure | landmark | gate | beat |",
    "|---:|---|---|---|---|---:|---|---:|---:|---:|---|---:|---|---|---|---|",
    ...(critical
      ? critical.nodes.map(
          (node, index) =>
            `| ${index + 1} | ${node.label || node.id} (${node.id}) | ${node.kind} | ${node.space || "—"} | ${node.district ?? "—"} | F${node.floor} | ${node.buildingId ?? "—"} | ${node.x} | ${node.y} | ${node.z} | ${connectionFor(critical, node, index)} | ${node.intensity} | ${node.enclosure} | ${node.landmark || "—"} | ${node.gate} | ${node.beat ?? "—"} |`,
        )
      : ["| — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |"]),
    "",
    "## Branches",
    "",
    "| route | typology | width | from | to | nodes |",
    "|---|---|---:|---|---|---|",
    ...plan.routes
      .filter((route) => route.kind !== "critical")
      .map(
        (route) =>
          `| ${route.id} | ${route.typology} | ${route.width} | ${route.from ?? "—"} | ${route.to ?? "dead end"} | ${route.nodes.map((node) => node.id).join(", ") || "—"} |`,
      ),
    "",
    "## Buildings",
    "",
  ];

  for (const building of plan.buildings) {
    const roof = building.roofZ ?? building.baseZ + building.floors * building.floorHeight;
    lines.push(
      `### ${building.id} — ${building.name}`,
      "",
      `- role: ${building.role} · enterable: ${building.enterable ? "yes" : "no"} · excavated: ${building.excavated ? "yes" : "no"} · floors: ${building.floors} · base: ${building.baseZ} · roof: ${roof} · floor height: ${building.floorHeight}`,
      `- purpose: ${building.purpose ?? "—"}`,
      "",
      "| entrance x | y | z | width | face | door | floor |",
      "|---:|---:|---:|---:|---|---|---|",
      ...building.entrances.map((entrance) => {
        const door = building.floorsPlan
          .flatMap((floor) => floor.doors.map((candidate) => ({ floor, door: candidate })))
          .find(({ door: candidate }) => {
            if (candidate.from !== "outside" && candidate.to !== "outside") return false;
            const [x, y] = localToWorld(building, candidate.x, candidate.y);
            return Math.hypot(x - entrance.x, y - entrance.y) <= 96;
          });
        return `| ${entrance.x} | ${entrance.y} | ${entrance.z} | ${entrance.width} | ${entrance.face} | ${door?.door.id ?? "—"} | ${door ? `F${door.floor.level}` : "—"} |`;
      }),
      "",
    );

    for (const floor of building.floorsPlan) {
      lines.push(
        `#### ${building.id} F${floor.level} (z=${floor.z}, height=${floor.height})`,
        "",
        "| room | x | y | width | depth | route nodes |",
        "|---|---:|---:|---:|---:|---|",
        ...floor.rooms.map((room) => {
          const nodes = plan.routes
            .flatMap((route) => route.nodes)
            .filter(
              (node) =>
                node.buildingId === building.id &&
                node.floor === floor.level &&
                nodeInRoom(building, room, node),
            )
            .map((node) => node.id);
          return `| ${roomKey(room)} | ${room.x} | ${room.y} | ${room.width} | ${room.depth} | ${nodes.join(", ") || "—"} |`;
        }),
        "",
        "| door | kind | from → to | x | y | width | depth | rot | locked | route node |",
        "|---|---|---|---:|---:|---:|---:|---:|---|---|",
        ...floor.doors.map((door) => {
          const nodes = plan.routes
            .flatMap((route) => route.nodes)
            .filter(
              (node) =>
                node.buildingId === building.id &&
                node.floor === floor.level &&
                doorAtNode(building, floor, node) === door,
            )
            .map((node) => node.id);
          return `| ${door.id ?? "—"} | ${door.kind} | ${door.from} → ${door.to} | ${door.x} | ${door.y} | ${door.width} | ${door.depth} | ${door.rotation} | ${door.locked ? "yes" : "no"} | ${nodes.join(", ") || "—"} |`;
        }),
        "",
        "| vertical | kind | to | x | y | width | depth | route node |",
        "|---|---|---:|---:|---:|---:|---:|---|",
        ...floor.stairs.map((stair) => {
          const nodes = plan.routes
            .flatMap((route) => route.nodes.map((node, index) => ({ route, node, index })))
            .filter(({ route, node, index }) => {
              if (node.buildingId !== building.id || node.floor !== floor.level) return false;
              if (!["stair", "ladder", "elevator", "ramp"].includes(node.kind)) return false;
              if (node.kind !== stair.kind) return false;
              const target = [route.nodes[index - 1], route.nodes[index + 1]].find(
                (neighbour) => neighbour && neighbour.floor !== node.floor,
              );
              return stairAtNode(building, floor, node, stair.kind, target?.floor) === stair;
            })
            .map(({ node }) => node.id);
          return `| ${stair.id ?? "—"} | ${stair.kind} | F${stair.to} | ${stair.x} | ${stair.y} | ${stair.width} | ${stair.depth} | ${nodes.join(", ") || "—"} |`;
        }),
        "",
      );
    }
  }

  lines.push(
    "## Gameplay and nav areas",
    "",
    "| id | kind | floor | building | label | x | y | width | depth | rotation | note |",
    "|---|---|---:|---|---|---:|---:|---:|---:|---:|---|",
    ...plan.areas.map(
      (area) =>
        `| ${area.id} | ${area.kind} | F${area.floor} | ${area.buildingId ?? "—"} | ${area.label} | ${area.x} | ${area.y} | ${area.width} | ${area.depth} | ${area.rotation} | ${area.note} |`,
    ),
    "",
    "## Beats",
    "",
    "| id | chapter | type | space | intensity | what | nodes | proof |",
    "|---|---:|---|---|---:|---|---|---|",
    ...plan.beats.map(
      (beat) =>
        `| ${beat.id} | ${beat.chapter} | ${beat.type} | ${beat.space} | ${beat.intensity} | ${beat.what} | ${nodesForBeat(beat.id)} | ${beat.proof} |`,
    ),
    "",
    "## Finale and budget",
    "",
    ...(plan.finale
      ? [
          `- finale type: ${plan.finale.type}`,
          `- arena: ${plan.finale.arena}`,
          `- stages: ${plan.finale.stages.join(", ") || "—"}`,
          `- escape: ${plan.finale.escape}`,
        ]
      : ["- finale: none"]),
    ...(Object.keys(plan.budget).length === 0
      ? ["- budget: —"]
      : Object.entries(plan.budget).map(([key, value]) => `- ${key}: ${value}`)),
    "",
    "## Palette and variability",
    "",
    `- sky: ${plan.palette.sky || "—"}`,
    `- motifs: ${plan.palette.motifs.join(", ") || "—"}`,
    `- materials: ${plan.palette.materials.join(", ") || "—"}`,
    `- models: ${plan.palette.models.join(", ") || "—"}`,
    `- variability: ${plan.variability.join("; ") || "—"}`,
    "",
    "## Acceptance",
    "",
    ...(plan.acceptance.length === 0 ? ["- —"] : plan.acceptance.map((item, index) => `${index + 1}. ${item}`)),
    "",
    "## Drawings",
    "",
    ...files.map((file) => `- ${basename(file)}`),
    "",
    "## Findings",
    "",
    ...(check.findings.length === 0
      ? ["No findings."]
      : check.findings.map((finding) => `- **${finding.severity}** \`${finding.rule}\`: ${finding.message}`)),
    "",
  );

  return lines.join("\n");
}

export interface RenderResult {
  path: string;
  outDir: string;
  files: string[];
  check: PlanCheck;
}

export function renderMapPlan(path: string, plan: MapPlan, outDir?: string): RenderResult {
  const check = checkMapPlan(path, plan);
  const dir = outDir ?? join(dirname(path), "drawings");
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, content: string): void => {
    const file = join(dir, name);
    writeFileSync(file, content, "utf8");
    files.push(file);
  };
  write("01-site-plan.svg", sitePlan(plan));
  write("02-vertical-plan.svg", terrainPlan(plan));
  write("03-circulation-plan.svg", circulationPlan(plan));
  write("04-building-schedule.svg", buildingSchedule(plan));
  for (const building of plan.buildings) {
    if (!building.enterable) continue;
    const floors = building.floorsPlan.length > 0 ? building.floorsPlan : [undefined];
    for (const floor of floors) {
      const suffix = floor ? `-f${floor.level}` : "";
      write(`05-floor-${building.id}${suffix}.svg`, floorPlan(plan, building, floor));
    }
    write(`06-section-${building.id}.svg`, section(plan, building));
  }
  write("plan.md", planMarkdown(plan, check, files));
  write("build-sheet.md", buildSheet(plan, check, files));
  return { path, outDir: dir, files, check };
}

function loadPlan(path: string): MapPlan {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return Plan.parse(JSON.parse(readFileSync(path, "utf8")));
}

export const checkMapPlanTool = defineTool({
  name: "check_map_plan",
  description:
    "Validates a five-drawing map plan (JSON) without building: the brief (experience, pillars, " +
    "beats), the route skeleton (districts, named spaces, intensity, landmarks, gates, branch " +
    "anchors), the floor graph (rooms, doors with two sides, stairs with a target floor), " +
    "footprints inside the site, building overlaps, route width and " +
    "route-through-building, entrances near the route and their terrain height, floors, palette " +
    "and acceptance. The JSON is the contract; the drawings are its view. Read-only.",
  realm: "local",
  inputSchema: { path: z.string().describe("Path to plan.json, absolute or repo-relative.") },
  outputSchema: {
    path: z.string(),
    ok: z.boolean(),
    findings: z.array(
      z.object({ severity: z.enum(["error", "warning", "info"]), rule: z.string(), message: z.string() }),
    ),
    counts: z.object({
      buildings: z.number(),
      enterable: z.number(),
      routes: z.number(),
      beats: z.number(),
      districts: z.number(),
    }),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const plan = loadPlan(path);
    return checkMapPlan(path, plan) as unknown as Record<string, unknown>;
  },
});

export const renderMapPlanTool = defineTool({
  name: "render_map_plan",
  description:
    "Renders a map plan JSON as the five pass-1 drawings: site plan, vertical/terrain plan, " +
    "circulation plan with districts, intensity-coloured route nodes, landmarks, gates and a " +
    "Director rhythm strip, building/height schedule, and floor plans/sections for every " +
    "enterable building, plus plan.md and a build-sheet.md ordered handoff for pass 2. Validates " +
    "first and reports the same findings. Plain SVG, no CAD install; writes only under the plan " +
    "directory. Guarded.",
  realm: "local",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Path to plan.json, absolute or repo-relative."),
    outDir: z
      .string()
      .optional()
      .describe("Output directory; default `<plan dir>/drawings`."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    outDir: z.string(),
    files: z.array(z.string()),
    check: z.object({
      path: z.string(),
      ok: z.boolean(),
      findings: z.array(
        z.object({ severity: z.enum(["error", "warning", "info"]), rule: z.string(), message: z.string() }),
      ),
      counts: z.object({
        buildings: z.number(),
        enterable: z.number(),
        routes: z.number(),
        beats: z.number(),
        districts: z.number(),
      }),
    }),
  },
  handler: (args, ctx) => {
    if (!args.confirm) throw new Error("confirm:true is required: this writes drawing files");
    const path = resolveInput(args.path, ctx.config);
    const plan = loadPlan(path);
    const outDir = args.outDir ? resolveInput(args.outDir, ctx.config) : undefined;
    return renderMapPlan(path, plan, outDir) as unknown as Record<string, unknown>;
  },
});

export const mapPlanTools = [checkMapPlanTool, renderMapPlanTool];
