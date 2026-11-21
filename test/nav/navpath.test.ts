/**
 * Nav mesh as a graph: A*, reachability and nav-level sight.
 *
 * The fixtures are stock L4D2 maps: `c2m1_highway` has 29 ladders, and the route across it
 * uses one, which is the only way to prove the ladder records and the ladder ids in the
 * area lists are read correctly. `c1m1_hotel` is the control: its spawn area is a one-area
 * strongly connected component (a saferoom with one-way exits), so directed reachability is
 * expected to be asymmetric there and must not be "fixed" by pretending the graph is
 * undirected.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readNavFile } from "../../src/nav/typescript/formats/navfile.js";
import { NavGraph, areaCenter } from "../../src/nav/typescript/formats/navpath.js";
import { navLosTool, navPathTool, navReachableTool } from "../../src/nav/typescript/tools/navpath.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const maps = has.gameContent ? join(ctx.config.gameDir!, "maps") : null;
const highway = maps ? join(maps, "c2m1_highway.nav") : "";
const available = Boolean(maps && existsSync(highway));

describe.skipIf(!available)("nav graph", () => {
  const load = () => readNavFile(readFileSync(highway), highway);

  it("reads the ladder table and the ladder ids in the area lists", () => {
    const nav = load();
    expect(nav.areaCount).toBe(6461);
    expect(nav.ladders).toHaveLength(29);
    const ladder = nav.ladders[0]!;
    expect(ladder.id).toBeGreaterThan(0);
    expect(ladder.width).toBeGreaterThan(0);
    expect(Math.hypot(ladder.top.x, ladder.top.y, ladder.top.z)).toBeGreaterThan(0);
    expect(ladder.length).toBeGreaterThan(0);
    expect(nav.ladderTableOffset).toBeGreaterThan(0);
    const withLadder = nav.areas.filter((area) =>
      area.ladderConnections.some((ids) => ids.length > 0),
    );
    expect(withLadder.length).toBeGreaterThan(0);
  });

  it("uses a ladder to reach its top area", () => {
    const graph = new NavGraph(load());
    const edge = graph.ladderEdges[0]!;
    const bottom = graph.byId.get(edge.from)!;
    const top = graph.byId.get(edge.to)!;
    const path = graph.findPath(bottom, top);
    expect(path.found).toBe(true);
    expect(path.ladders).toBeGreaterThan(0);
    expect(path.steps.some((step) => step.kind !== "walk")).toBe(true);
  });

  it("finds a long route and every walk edge exists in the file", () => {
    const nav = load();
    const graph = new NavGraph(nav);
    const left = nav.areas.slice().sort((a, b) => a.minX - b.minX)[0]!;
    const right = nav.areas.slice().sort((a, b) => b.maxX - a.maxX)[0]!;
    const path = graph.findPath(left, right);
    expect(path.found).toBe(true);
    expect(path.steps.length).toBeGreaterThan(50);
    expect(path.length).toBeGreaterThanOrEqual(path.directDistance);
    for (let index = 1; index < path.steps.length; index += 1) {
      const previous = path.steps[index - 1]!;
      const step = path.steps[index]!;
      if (step.kind !== "walk") continue;
      expect(graph.neighbors.get(previous.areaId) ?? []).toContain(step.areaId);
    }
  });

  it("treats NAV_BLOCKER as impassable unless asked otherwise", () => {
    const nav = load();
    const graph = new NavGraph(nav);
    const edge = graph.ladderEdges[0]!;
    const bottom = graph.byId.get(edge.from)!;
    const top = graph.byId.get(edge.to)!;
    const saved = top.flags;
    top.flags |= 0x80000000;
    try {
      const blocked = graph.findPath(bottom, top);
      const allowed = graph.findPath(bottom, top, { allowBlocked: true });
      // The blocked area is the goal itself; it cannot be entered without `allowBlocked`.
      expect(allowed.found).toBe(true);
      expect(blocked.found).toBe(false);
    } finally {
      top.flags = saved;
    }
  });

  it("checks a nav-level sight line and reports where it leaves the mesh", () => {
    const graph = new NavGraph(load());
    const area = graph.nav.areas[0]!;
    const center = areaCenter(area);
    expect(graph.lineOfSight(center, center).clear).toBe(true);
    const high = { ...center, z: center.z + 10_000 };
    const lost = graph.lineOfSight(center, high);
    expect(lost.clear).toBe(false);
    expect(lost.blockedAt).not.toBeNull();
  });
});

describe.skipIf(!available)("nav tools", () => {
  it("answers nav_path, nav_reachable and nav_los through the tool handlers", async () => {
    const nav = readNavFile(readFileSync(highway), highway);
    const graph = new NavGraph(nav);
    const edge = graph.ladderEdges[0]!;
    const bottom = graph.byId.get(edge.from)!;
    const top = graph.byId.get(edge.to)!;
    const from = areaCenter(bottom);
    const to = areaCenter(top);
    const fromTuple = [from.x, from.y, from.z] as [number, number, number];
    const toTuple = [to.x, to.y, to.z] as [number, number, number];

    const path = (await navPathTool.handler(
      { nav: highway, from: fromTuple, to: toTuple } as never,
      ctx,
    )) as { found: boolean; ladders: number; steps: unknown[]; fromArea: { id: number } };
    expect(path.found).toBe(true);
    expect(path.ladders).toBeGreaterThan(0);
    expect(path.steps.length).toBeGreaterThan(1);
    expect(path.fromArea.id).toBe(bottom.id);

    const reachable = (await navReachableTool.handler(
      { nav: highway, from: fromTuple, to: toTuple } as never,
      ctx,
    )) as { reachable: boolean; visited: number };
    expect(reachable.reachable).toBe(true);
    expect(reachable.visited).toBeGreaterThan(1);

    const los = (await navLosTool.handler(
      { nav: highway, from: fromTuple, to: fromTuple } as never,
      ctx,
    )) as { clear: boolean; checked: number; note: string };
    expect(los.clear).toBe(true);
    expect(los.checked).toBeGreaterThan(0);
    expect(los.note).toMatch(/Nav-level visibility/);
  });
});
