/**
 * Pathfinding over a nav mesh: A*, reachability and a coarse nav-level line of sight.
 *
 * The mesh is a graph, but not a simple one: connections are stored as **area ids**, not
 * indices, and a ladder is a separate record whose id appears in an area's ladder list.
 * The algorithms here resolve ids first, then search. They do not know about geometry: a
 * "line of sight" is a walk along the nav mesh, not a trace against brushes, and a path is
 * a sequence of area centres, not a smoothed route. That is the same information the
 * Director and the bots start from.
 */
import { navAreaCenter } from "./navfile.js";
import type { NavArea, NavFile, NavLadder } from "./navfile.js";

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

export interface NavStep {
  /** Area index in the file, or null when the step is a ladder. */
  areaIndex: number | null;
  areaId: number;
  center: NavPoint;
  /** `walk`, `ladder-up`, `ladder-down`. */
  kind: "walk" | "ladder-up" | "ladder-down";
}

export interface NavPathResult {
  found: boolean;
  fromArea: NavArea | null;
  toArea: NavArea | null;
  steps: NavStep[];
  /** Sum of the centre-to-centre segments, in Source units. */
  length: number;
  directDistance: number;
  ladders: number;
  note?: string;
}

/** The representative point of an area: the middle of its box, at its reported centre. */
export function areaCenter(area: NavArea): NavPoint {
  const [x, y, z] = navAreaCenter(area);
  return { x, y, z };
}

function distance(a: NavPoint, b: NavPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** `NAV_BLOCKER` and `OUTSIDE_WORLD`: areas a walker cannot use. */
const WALK_BLOCKED = 0x80000000 | 0x10000000;

export class NavGraph {
  readonly byId = new Map<number, NavArea>();
  /** Direct area edges, resolved from the four directional lists. */
  readonly neighbors = new Map<number, number[]>();
  /** Ladder id to record. */
  readonly ladders = new Map<number, NavLadder>();
  /** Bottom/top area ids a ladder connects, for the coarse graph. */
  readonly ladderEdges: Array<{ ladder: NavLadder; from: number; to: number }> = [];

  constructor(readonly nav: NavFile) {
    for (const area of nav.areas) this.byId.set(area.id, area);
    for (const area of nav.areas) {
      const ids = new Set<number>();
      for (const direction of ["north", "east", "south", "west"] as const) {
        for (const id of area.connections[direction]) {
          if (this.byId.has(id) && id !== area.id) ids.add(id);
        }
      }
      this.neighbors.set(area.id, [...ids]);
    }
    for (const ladder of nav.ladders) {
      this.ladders.set(ladder.id, ladder);
      const tops = [
        ladder.topForwardAreaId,
        ladder.topLeftAreaId,
        ladder.topRightAreaId,
        ladder.topBehindAreaId,
      ];
      if (ladder.bottomAreaId && this.byId.has(ladder.bottomAreaId)) {
        for (const top of tops) {
          if (top && this.byId.has(top)) {
            this.ladderEdges.push({ ladder, from: ladder.bottomAreaId, to: top });
          }
        }
      }
    }
  }

  private blocked(area: NavArea, allowBlocked: boolean): boolean {
    return !allowBlocked && (area.flags & WALK_BLOCKED) !== 0;
  }

  /** Nearest area to a point: horizontal box distance first, then Z, then index. */
  nearestArea(point: NavPoint): NavArea | null {
    let best: NavArea | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const area of this.nav.areas) {
      const dx = Math.max(area.minX - point.x, 0, point.x - area.maxX);
      const dy = Math.max(area.minY - point.y, 0, point.y - area.maxY);
      const horizontal = Math.hypot(dx, dy);
      const dz = Math.max(area.minZ - point.z, 0, point.z - area.maxZ);
      // Height matters, but a point on a balcony should still prefer the balcony over the
      // floor below a corridor: horizontal distance weighs more than a floor's thickness.
      const score = horizontal + dz * 3;
      if (score < bestScore) {
        best = area;
        bestScore = score;
      }
    }
    return best;
  }

  /** Edges out of an area: walk edges plus the coarse ladder edges. */
  edgesOf(
    area: NavArea,
    allowBlocked: boolean,
  ): Array<{ to: NavArea; cost: number; ladder: NavLadder | null; down: boolean }> {
    const out: Array<{ to: NavArea; cost: number; ladder: NavLadder | null; down: boolean }> = [];
    const center = areaCenter(area);
    for (const id of this.neighbors.get(area.id) ?? []) {
      const to = this.byId.get(id);
      if (!to || this.blocked(to, allowBlocked)) continue;
      out.push({ to, cost: distance(center, areaCenter(to)), ladder: null, down: false });
    }
    for (const edge of this.ladderEdges) {
      if (edge.from !== area.id) continue;
      const to = this.byId.get(edge.to);
      if (!to || this.blocked(to, allowBlocked)) continue;
      const cost = Math.max(edge.ladder.length, distance(center, areaCenter(to)));
      out.push({ to, cost, ladder: edge.ladder, down: false });
    }
    for (const edge of this.ladderEdges) {
      if (edge.to !== area.id) continue;
      const to = this.byId.get(edge.from);
      if (!to || this.blocked(to, allowBlocked)) continue;
      const cost = Math.max(edge.ladder.length, distance(center, areaCenter(to)));
      out.push({ to, cost, ladder: edge.ladder, down: true });
    }
    return out;
  }

  /**
   * A* between two areas. The heuristic is the straight-line distance to the target's
   * centre, which is admissible because every edge costs at least that segment.
   */
  findPath(
    start: NavArea,
    goal: NavArea,
    options: { allowBlocked?: boolean } = {},
  ): NavPathResult {
    const allowBlocked = options.allowBlocked === true;
    const startCenter = areaCenter(start);
    const goalCenter = areaCenter(goal);
    const open: Array<{ id: number; f: number }> = [{ id: start.id, f: 0 }];
    const cameFrom = new Map<number, { id: number; ladder: NavLadder | null; down: boolean }>();
    const cost = new Map<number, number>([[start.id, 0]]);
    let expanded = 0;

    while (open.length > 0) {
      open.sort((a, b) => a.f - b.f);
      const current = open.shift()!;
      if (current.id === goal.id) break;
      expanded += 1;
      if (expanded > 20_000) break;
      const area = this.byId.get(current.id);
      if (!area) continue;
      const base = cost.get(current.id) ?? 0;
      for (const edge of this.edgesOf(area, allowBlocked)) {
        const next = base + edge.cost;
        if (next < (cost.get(edge.to.id) ?? Number.POSITIVE_INFINITY)) {
          cost.set(edge.to.id, next);
          cameFrom.set(edge.to.id, { id: current.id, ladder: edge.ladder, down: edge.down });
          const f = next + distance(areaCenter(edge.to), goalCenter);
          open.push({ id: edge.to.id, f });
        }
      }
    }

    if (!cameFrom.has(goal.id) && start.id !== goal.id) {
      return {
        found: false,
        fromArea: start,
        toArea: goal,
        steps: [],
        length: 0,
        directDistance: distance(startCenter, goalCenter),
        ladders: 0,
        note: "No walking route in the nav mesh. A ladder or a connection the reader skipped would be the first thing to check.",
      };
    }

    const chain: number[] = [goal.id];
    while (chain[0] !== start.id) {
      const previous = cameFrom.get(chain[0]!);
      if (!previous) break;
      chain.unshift(previous.id);
    }
    let ladders = 0;
    let length = 0;
    const steps: NavStep[] = [];
    for (let index = 0; index < chain.length; index += 1) {
      const area = this.byId.get(chain[index]!)!;
      const edge = index > 0 ? cameFrom.get(area.id) : undefined;
      const kind: NavStep["kind"] = edge?.ladder ? (edge.down ? "ladder-down" : "ladder-up") : "walk";
      if (edge?.ladder) ladders += 1;
      steps.push({ areaIndex: area.index, areaId: area.id, center: areaCenter(area), kind });
      if (index > 0) length += distance(areaCenter(this.byId.get(chain[index - 1]!)!), areaCenter(area));
    }
    return {
      found: true,
      fromArea: start,
      toArea: goal,
      steps,
      length,
      directDistance: distance(startCenter, goalCenter),
      ladders,
    };
  }

  /** BFS: can a walker get from one area to another, and how many areas are in the region. */
  reachable(
    start: NavArea,
    goal: NavArea,
    options: { allowBlocked?: boolean } = {},
  ): { reachable: boolean; visited: number; areas: number[] } {
    const allowBlocked = options.allowBlocked === true;
    const seen = new Set<number>([start.id]);
    const queue: number[] = [start.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (id === goal.id) break;
      const area = this.byId.get(id);
      if (!area) continue;
      for (const edge of this.edgesOf(area, allowBlocked)) {
        if (seen.has(edge.to.id)) continue;
        seen.add(edge.to.id);
        queue.push(edge.to.id);
      }
    }
    return { reachable: seen.has(goal.id), visited: seen.size, areas: [...seen] };
  }

  /**
   * A nav-level line of sight: walk the segment and require every sample to lie in some
   * area's box (with a small vertical tolerance). This is not a trace against brushes; a
   * wall that cuts an area in half is invisible to it. Use `trace_ray`/`read_map_geometry`
   * when the question is about geometry.
   */
  lineOfSight(
    from: NavPoint,
    to: NavPoint,
    options: { step?: number; verticalTolerance?: number } = {},
  ): { clear: boolean; checked: number; blockedAt: NavPoint | null } {
    const step = Math.max(4, options.step ?? 16);
    const tolerance = options.verticalTolerance ?? 24;
    const total = distance(from, to);
    const count = Math.max(2, Math.ceil(total / step));
    for (let index = 1; index <= count; index += 1) {
      const t = index / count;
      const point = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      };
      let inside = false;
      for (const area of this.nav.areas) {
        if (
          point.x >= area.minX - 1 &&
          point.x <= area.maxX + 1 &&
          point.y >= area.minY - 1 &&
          point.y <= area.maxY + 1 &&
          point.z >= area.minZ - tolerance &&
          point.z <= area.maxZ + tolerance
        ) {
          inside = true;
          break;
        }
      }
      if (!inside) return { clear: false, checked: index, blockedAt: point };
    }
    return { clear: true, checked: count, blockedAt: null };
  }
}
