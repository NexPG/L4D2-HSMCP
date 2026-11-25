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
  name: z.string(),
  x: z.number().describe("Building-local X from the footprint centre."),
  y: z.number(),
  width: POSITIVE,
  depth: POSITIVE,
});

const Stair = z.object({
  x: z.number(),
  y: z.number(),
  width: POSITIVE,
  depth: POSITIVE,
  to: z.number().int(),
});

const Floor = z.object({
  level: z.number().int().min(1),
  z: z.number(),
  height: z.number().min(96).default(128),
  rooms: z.array(Room).default([]),
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
  roofZ: z.number().optional(),
  enterable: z.boolean().default(false),
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

const Route = z.object({
  id: z.string(),
  kind: z.enum(["critical", "branch", "escape"]),
  width: z.number().positive().describe("Clear width in Hammer units; 64 is the hull."),
  points: z.array(XYZ).min(2),
  stops: z.array(Stop).default([]),
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

const Beat = z.object({
  id: z.string(),
  chapter: z.number().int().min(1),
  type: z.string(),
  space: z.string(),
  what: z.string(),
  proof: z.string(),
});

const Plan = z.object({
  version: z.literal(1),
  name: z.string(),
  kind: z.enum(["campaign", "map"]),
  site: z.object({
    bounds: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }),
    north: z.number().default(0),
    grid: z.number().positive().default(256),
    water: z.array(Rect).default([]),
    noBuild: z.array(Rect).default([]),
  }),
  terrain: Terrain,
  buildings: z.array(Building).min(1),
  routes: z.array(Route).min(1),
  beats: z.array(Beat).min(1),
  finale: z
    .object({
      type: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]),
      arena: z.string(),
      stages: z.array(z.string()).default([]),
      escape: z.string(),
    })
    .optional(),
  budget: z.record(z.number()).default({}),
  palette: z.object({
    sky: z.string(),
    motifs: z.array(z.string()).min(3),
    materials: z.array(z.string()).default([]),
    models: z.array(z.string()).default([]),
  }),
  variability: z.array(z.string()).default([]),
  acceptance: z.array(z.string()).min(1),
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

export function checkMapPlan(path: string, plan: MapPlan): PlanCheck {
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], rule: string, message: string): void => {
    findings.push({ severity, rule, message });
  };
  const ids = new Set<string>();
  for (const building of plan.buildings) {
    if (ids.has(building.id)) add("error", "duplicate-id", `building id ${building.id} is repeated`);
    ids.add(building.id);
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
    if (building.enterable && building.entrances.length === 0) {
      add("error", "enterable-no-entrance", `${building.id} is enterable but has no entrance`);
    }
    if (building.enterable && building.floorsPlan.length === 0) {
      add("warning", "no-floor-plan", `${building.id} is enterable but has no floor plan`);
    }
    const levels = new Set<number>();
    for (const floor of building.floorsPlan) {
      if (levels.has(floor.level)) {
        add("error", "duplicate-floor", `${building.id} has floor ${floor.level} twice`);
      }
      levels.add(floor.level);
      if (floor.z < building.baseZ || floor.z >= roof) {
        add("warning", "floor-outside-building", `${building.id} floor ${floor.level} z=${floor.z} is outside the massing`);
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
    if (route.width < 64) {
      add("error", "route-too-narrow", `${route.id} is ${route.width} wide; the hull is 64`);
    }
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
    const samples = routeSamples(route);
    routeSamplesAll.push(...samples);
    for (const sample of samples) {
      for (const building of plan.buildings) {
        if (!pointInPolygon(sample, corners(building.x, building.y, building.width, building.depth, building.rotation))) {
          continue;
        }
        const nearEntrance = building.entrances.some(
          (entrance) => Math.hypot(entrance.x - sample[0], entrance.y - sample[1]) <= 96,
        );
        if (!nearEntrance) {
          add(
            "error",
            "route-through-building",
            `${route.id} crosses ${building.id} at (${sample[0].toFixed(0)}, ${sample[1].toFixed(0)}) away from an entrance`,
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
      if (Math.abs(ground - entrance.z) > 48) {
        add(
          "warning",
          "entrance-z",
          `${building.id} entrance z=${entrance.z} but the terrain is ${ground.toFixed(0)}`,
        );
      }
    }
  }

  if (plan.beats.length === 0) add("error", "no-beats", "the plan has no beats");
  if (plan.acceptance.length === 0) add("error", "no-acceptance", "the plan has no acceptance criteria");
  if (plan.palette.motifs.length < 3) {
    add("warning", "palette-motifs", "give at least three repeated motifs");
  }
  if (plan.kind === "campaign" && !plan.finale) {
    add("warning", "campaign-no-finale", "a campaign plan normally has a finale block");
  }

  return {
    path,
    ok: findings.every((finding) => finding.severity !== "error"),
    findings,
    counts: {
      buildings: plan.buildings.length,
      enterable: plan.buildings.filter((building) => building.enterable).length,
      routes: plan.routes.length,
      beats: plan.beats.length,
    },
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

function fit(plan: MapPlan, width = 1200, height = 900, margin = 48): Transform {
  const { x0, y0, x1, y1 } = plan.site.bounds;
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

function frame(title: string, plan: MapPlan, t: Transform, body: string, legend: string[]): string {
  const { x0, y0, x1, y1 } = plan.site.bounds;
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
  const legendText = legend
    .map((line, index) => `<text x="${t.width - 260}" y="${110 + index * 18}" font-family="sans-serif" font-size="12" fill="#2c3e50">${esc(line)}</text>`)
    .join("");
  return `<rect width="100%" height="100%" fill="#f8f5ee"/>
${gridLines.join("")}
<rect x="${t.sx(x0).toFixed(1)}" y="${t.sy(y1).toFixed(1)}" width="${((x1 - x0) * t.scale).toFixed(1)}" height="${((y1 - y0) * t.scale).toFixed(1)}" fill="#fffdf7" stroke="#2c3e50" stroke-width="2"/>
${body}
<text x="48" y="42" font-family="sans-serif" font-size="22" fill="#1b2631">${esc(title)}</text>
<text x="48" y="64" font-family="sans-serif" font-size="12" fill="#5d6d7e">${esc(plan.name)} · Hammer units · ${Math.round(t.scale * 100) / 100} px/u</text>
${north}
${scaleBar}
${legendText}`;
}

function rectSvg(building: PlanBuilding, t: Transform, fill: string, stroke: string): string {
  return `<polygon points="${polygonPoints(corners(building.x, building.y, building.width, building.depth, building.rotation), t)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}

function sitePlan(plan: MapPlan): string {
  const t = fit(plan);
  const body: string[] = [];
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
    body.push(rectSvg(building, t, building.enterable ? "#d5c3a1" : "#ded8cc", "#5d6d7e"));
    const cx = t.sx(building.x);
    const cy = t.sy(building.y);
    body.push(
      `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#1b2631">${esc(building.id)}</text>`,
      `<text x="${cx.toFixed(1)}" y="${(cy + 15).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#5d6d7e">${building.width}×${building.depth} ${Math.round(building.rotation)}°</text>`,
      `<circle cx="${t.sx(building.x).toFixed(1)}" cy="${t.sy(building.y).toFixed(1)}" r="2.5" fill="#2c3e50"/>`,
    );
  }
  return svg(
    "Site plan — footprints, coordinates and spacing",
    t.width,
    t.height,
    frame("1 · Site plan", plan, t, body.join("\n"), [
      "brown fill: enterable building",
      "grey fill: block / scenery",
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

function circulationPlan(plan: MapPlan): string {
  const t = fit(plan);
  const body: string[] = [];
  for (const building of plan.buildings) {
    body.push(rectSvg(building, t, "#e8e2d6", "#8a8175"));
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
    const first = route.points[0]!;
    body.push(
      `<text x="${t.sx(first[0]).toFixed(1)}" y="${(t.sy(first[1]) - 18).toFixed(1)}" font-family="sans-serif" font-size="11" fill="#b03a2e">${esc(route.id)} · ${route.width}u</text>`,
    );
  }
  for (const building of plan.buildings) {
    for (const entrance of building.entrances) {
      body.push(
        `<rect x="${(t.sx(entrance.x) - 4).toFixed(1)}" y="${(t.sy(entrance.y) - 4).toFixed(1)}" width="8" height="8" fill="#1e8449"/>`,
      );
    }
  }
  return svg(
    "Circulation plan — critical path, branches, stops and entrances",
    t.width,
    t.height,
    frame("3 · Circulation plan", plan, t, body.join("\n"), [
      "red: critical path",
      "blue dashed: branch/escape",
      "green: building entrance",
      "band width = clear width",
    ]),
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
    };
  });
  const width = 1200;
  const height = 160 + rows.length * 30;
  const cols = [60, 260, 420, 520, 620, 720, 820, 930, 1030];
  const headers = ["id", "name", "floors", "base", "roof", "height", "area", "enterable", "doors"];
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

function floorPlan(plan: MapPlan, building: PlanBuilding): string {
  const t = fit(plan);
  const body: string[] = [];
  body.push(rectSvg(building, t, "#fdfbf6", "#1b2631"));
  for (const floor of building.floorsPlan) {
    for (const room of floor.rooms) {
      const wx = building.x + room.x * Math.cos(rad(building.rotation)) - room.y * Math.sin(rad(building.rotation));
      const wy = building.y + room.x * Math.sin(rad(building.rotation)) + room.y * Math.cos(rad(building.rotation));
      body.push(
        `<polygon points="${polygonPoints(corners(wx, wy, room.width, room.depth, building.rotation), t)}" fill="#f5efe3" stroke="#8a8175"/>`,
        `<text x="${t.sx(wx).toFixed(1)}" y="${t.sy(wy).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#1b2631">${esc(room.name)}</text>`,
      );
    }
    for (const stair of floor.stairs) {
      const wx = building.x + stair.x * Math.cos(rad(building.rotation)) - stair.y * Math.sin(rad(building.rotation));
      const wy = building.y + stair.x * Math.sin(rad(building.rotation)) + stair.y * Math.cos(rad(building.rotation));
      body.push(
        `<polygon points="${polygonPoints(corners(wx, wy, stair.width, stair.depth, building.rotation), t)}" fill="#d5dbdb" stroke="#5d6d7e"/>`,
      );
    }
  }
  for (const entrance of building.entrances) {
    body.push(
      `<rect x="${(t.sx(entrance.x) - 5).toFixed(1)}" y="${(t.sy(entrance.y) - 5).toFixed(1)}" width="10" height="10" fill="#1e8449"/>`,
    );
  }
  return svg(
    `Floor plan — ${building.name}`,
    t.width,
    t.height,
    frame(`5 · Floor plan — ${building.id}`, plan, t, body.join("\n"), [
      "rooms: floor plan, local coordinates",
      "grey: stair",
      "green: entrance",
    ]),
  );
}

function section(building: PlanBuilding): string {
  const width = 900;
  const roof = building.roofZ ?? building.baseZ + building.floors * building.floorHeight;
  const top = roof + 32;
  const bottom = building.baseZ - 32;
  const sy = (z: number): number => 700 - ((z - bottom) / Math.max(1, top - bottom)) * 600;
  const body: string[] = [
    `<rect width="100%" height="100%" fill="#f8f5ee"/>`,
    `<text x="48" y="42" font-family="sans-serif" font-size="22" fill="#1b2631">Section — ${esc(building.name)}</text>`,
    `<line x1="100" y1="${sy(building.baseZ)}" x2="800" y2="${sy(building.baseZ)}" stroke="#1b2631" stroke-width="3"/>`,
    `<line x1="100" y1="${sy(roof)}" x2="800" y2="${sy(roof)}" stroke="#1b2631" stroke-width="3"/>`,
    `<line x1="100" y1="${sy(building.baseZ)}" x2="100" y2="${sy(roof)}" stroke="#1b2631" stroke-width="2"/>`,
    `<line x1="800" y1="${sy(building.baseZ)}" x2="800" y2="${sy(roof)}" stroke="#1b2631" stroke-width="2"/>`,
  ];
  for (const floor of building.floorsPlan) {
    body.push(
      `<line x1="100" y1="${sy(floor.z)}" x2="800" y2="${sy(floor.z)}" stroke="#8a8175" stroke-width="1.5"/>`,
      `<text x="810" y="${sy(floor.z) + 4}" font-family="sans-serif" font-size="11" fill="#1b2631">F${floor.level} z=${floor.z}</text>`,
    );
  }
  body.push(
    `<text x="48" y="70" font-family="sans-serif" font-size="12" fill="#5d6d7e">base ${building.baseZ} · roof ${roof} · ${building.floors} floors</text>`,
  );
  return svg(`Section — ${building.name}`, width, 760, body.join("\n"));
}

function planMarkdown(plan: MapPlan, check: PlanCheck, files: string[]): string {
  const lines = [
    `# ${plan.name} — plan drawings`,
    "",
    `Source: \`plan.json\``,
    `Kind: ${plan.kind}`,
    `Validation: **${check.ok ? "pass" : "fail"}** (${check.findings.length} findings)`,
    "",
    "## Drawings",
    "",
    ...files.map((file) => `- [${basename(file)}](${basename(file)})`),
    "",
    "## Buildings",
    "",
    "| id | name | floors | base | roof | enterable | doors |",
    "|---|---|---:|---:|---:|---|---:|",
    ...plan.buildings.map((building) => {
      const roof = building.roofZ ?? building.baseZ + building.floors * building.floorHeight;
      return `| ${building.id} | ${building.name} | ${building.floors} | ${building.baseZ} | ${roof} | ${building.enterable ? "yes" : "no"} | ${building.entrances.length} |`;
    }),
    "",
    "## Routes",
    "",
    "| id | kind | width | stops |",
    "|---|---|---:|---|",
    ...plan.routes.map(
      (route) => `| ${route.id} | ${route.kind} | ${route.width} | ${route.stops.map((stop) => stop.label).join(", ")} |`,
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
    write(`05-floor-${building.id}.svg`, floorPlan(plan, building));
    write(`06-section-${building.id}.svg`, section(building));
  }
  write("plan.md", planMarkdown(plan, check, files));
  return { path, outDir: dir, files, check };
}

function loadPlan(path: string): MapPlan {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return Plan.parse(JSON.parse(readFileSync(path, "utf8")));
}

export const checkMapPlanTool = defineTool({
  name: "check_map_plan",
  description:
    "Validates a five-drawing map plan (JSON) without building: footprints inside the site, " +
    "building overlaps, route width and route-through-building, entrances near the route and " +
    "their terrain height, floors, beats, palette and acceptance. The JSON is the contract; " +
    "the drawings are its view. Read-only.",
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
    "circulation plan, building/height schedule, and floor plans/sections for every enterable " +
    "building, plus plan.md. Validates first and reports the same findings. Plain SVG, no CAD " +
    "install; writes only under the plan directory. Guarded.",
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
