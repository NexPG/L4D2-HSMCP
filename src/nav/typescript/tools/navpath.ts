/**
 * `nav_path`, `nav_reachable`, `nav_los`: questions about the mesh as a graph.
 *
 * These answer before a compile and before a playtest: is the far side of this map reachable
 * from the spawn, does the route need a ladder, is there a straight nav-level sight line for
 * a sniper spot. They read the same `.nav` the bots read; they do not simulate a player and
 * they do not trace brushes (the note on each result says so where it matters).
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readNavFile } from "../formats/navfile.js";
import type { NavArea } from "../formats/navfile.js";
import { NavGraph, areaCenter } from "../formats/navpath.js";

const POINT = z.tuple([z.number(), z.number(), z.number()]);

const AREA_VIEW = z.object({
  index: z.number(),
  id: z.number(),
  center: z.tuple([z.number(), z.number(), z.number()]),
});

function loadGraph(args: { nav: string }, config: Parameters<typeof resolveInput>[1]): NavGraph {
  const path = resolveInput(args.nav, config);
  return new NavGraph(readNavFile(readFileSync(path), path));
}

function describe(area: NavArea): {
  index: number;
  id: number;
  center: [number, number, number];
} {
  const center = areaCenter(area);
  return { index: area.index, id: area.id, center: [center.x, center.y, center.z] };
}

export const navPathTool = defineTool({
  name: "nav_path",
  description:
    "Finds a walking route between two points through the nav mesh with A*, resolving " +
    "connections by area id and ladders by ladder id. Returns the areas in order with their " +
    "centres, the route length, the straight-line distance, and how many ladder transitions " +
    "it uses. `allowBlocked` includes `NAV_BLOCKER`/`OUTSIDE_WORLD` areas, which a walker " +
    "normally cannot use. This is nav-mesh routing, not a smoothed player path.",
  realm: "map",
  inputSchema: {
    nav: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    from: POINT.describe("Start point in Source units."),
    to: POINT.describe("End point in Source units."),
    allowBlocked: z.boolean().default(false),
    limit: z.number().int().min(2).max(20_000).default(5000),
  },
  outputSchema: {
    path: z.string(),
    found: z.boolean(),
    fromArea: AREA_VIEW.nullable(),
    toArea: AREA_VIEW.nullable(),
    steps: z.array(
      z.object({
        areaIndex: z.number().nullable(),
        areaId: z.number(),
        center: z.tuple([z.number(), z.number(), z.number()]),
        kind: z.enum(["walk", "ladder-up", "ladder-down"]),
      }),
    ),
    length: z.number(),
    directDistance: z.number(),
    ladders: z.number(),
    note: z.string().optional(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.nav, ctx.config);
    const graph = loadGraph(args, ctx.config);
    const start = graph.nearestArea({ x: args.from[0], y: args.from[1], z: args.from[2] });
    const end = graph.nearestArea({ x: args.to[0], y: args.to[1], z: args.to[2] });
    if (!start || !end) {
      return {
        path,
        found: false,
        fromArea: null,
        toArea: null,
        steps: [],
        length: 0,
        directDistance: 0,
        ladders: 0,
        note: "The nav file has no areas.",
      };
    }
    const result = graph.findPath(start, end, { allowBlocked: args.allowBlocked });
    return {
      path,
      found: result.found,
      fromArea: describe(start),
      toArea: describe(end),
      steps: result.steps.slice(0, args.limit),
      length: Math.round(result.length * 100) / 100,
      directDistance: Math.round(result.directDistance * 100) / 100,
      ladders: result.ladders,
      ...(result.note ? { note: result.note } : {}),
      ...(result.steps.length > args.limit
        ? { note: `Showing ${args.limit} of ${result.steps.length} steps.` }
        : {}),
    };
  },
});

export const navReachableTool = defineTool({
  name: "nav_reachable",
  description:
    "Answers whether a walker can get from one point to another on the nav mesh, and how " +
    "many areas the connected region contains. Uses the same id resolution and ladder edges " +
    "as `nav_path`, but does not compute a route. `allowBlocked` includes " +
    "`NAV_BLOCKER`/`OUTSIDE_WORLD` areas.",
  realm: "map",
  inputSchema: {
    nav: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    from: POINT.describe("Start point in Source units."),
    to: POINT.describe("End point in Source units."),
    allowBlocked: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    reachable: z.boolean(),
    fromArea: AREA_VIEW.nullable(),
    toArea: AREA_VIEW.nullable(),
    visited: z.number(),
    note: z.string().optional(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.nav, ctx.config);
    const graph = loadGraph(args, ctx.config);
    const start = graph.nearestArea({ x: args.from[0], y: args.from[1], z: args.from[2] });
    const end = graph.nearestArea({ x: args.to[0], y: args.to[1], z: args.to[2] });
    if (!start || !end) {
      return {
        path,
        reachable: false,
        fromArea: null,
        toArea: null,
        visited: 0,
        note: "The nav file has no areas.",
      };
    }
    const result = graph.reachable(start, end, { allowBlocked: args.allowBlocked });
    return {
      path,
      reachable: result.reachable,
      fromArea: describe(start),
      toArea: describe(end),
      visited: result.visited,
    };
  },
});

export const navLosTool = defineTool({
  name: "nav_los",
  description:
    "Checks a nav-level line of sight: samples the segment and requires every sample to lie " +
    "inside some nav area (with a vertical tolerance). This is what the Director's visibility " +
    "is built on, not a brush trace: a wall inside one area is invisible to it. Use " +
    "`trace_ray` when the question is about geometry.",
  realm: "map",
  inputSchema: {
    nav: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    from: POINT.describe("Start point in Source units."),
    to: POINT.describe("End point in Source units."),
    step: z.number().min(4).max(256).default(16).describe("Sampling step, in units."),
    verticalTolerance: z.number().min(0).max(256).default(24),
  },
  outputSchema: {
    path: z.string(),
    clear: z.boolean(),
    checked: z.number(),
    blockedAt: POINT.nullable(),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.nav, ctx.config);
    const graph = loadGraph(args, ctx.config);
    const result = graph.lineOfSight(
      { x: args.from[0], y: args.from[1], z: args.from[2] },
      { x: args.to[0], y: args.to[1], z: args.to[2] },
      { step: args.step, verticalTolerance: args.verticalTolerance },
    );
    return {
      path,
      clear: result.clear,
      checked: result.checked,
      blockedAt: result.blockedAt
        ? [result.blockedAt.x, result.blockedAt.y, result.blockedAt.z]
        : null,
      note:
        "Nav-level visibility: a point outside every area ends the line. Walls inside one " +
        "area are not seen; use trace_ray for geometry.",
    };
  },
});

export const navPathTools = [navPathTool, navReachableTool, navLosTool];
