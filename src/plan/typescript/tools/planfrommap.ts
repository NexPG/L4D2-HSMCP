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
import { readDisplacements } from "../../../maps/typescript/bsp/displacements.js";
import { readMaterials } from "../../../maps/typescript/bsp/materials.js";
import { readStaticProps } from "../../../maps/typescript/bsp/staticprops.js";
import { groundSample, readTree } from "../../../maps/typescript/bsp/trace.js";
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
      buildingId: undefined as string | undefined,
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

  // Doors are entities in the map; a survey records where they are, the build pass decides
  // which two rooms they join.
  let doorIndex = 0;
  for (const entity of entities) {
    const cls = entity.classname ?? "";
    if (!/door/i.test(cls) || /door_area/i.test(cls)) continue;
    const [x, y, z] = origin(entity);
    areas.push({ id: `door_${doorIndex++}`, label: cls, kind: "door", floor: 1,
      x: Math.round(x), y: Math.round(y), width: 64, depth: 16, note: `z ${Math.round(z)}` });
    if (doorIndex >= 96) break;
  }

  // Stairs are the route's short drops: bigger ones are drops, not stairs.
  let stairIndex = 0;
  for (let index = 1; index < steps.length; index += 1) {
    const dz = steps[index]!.z - steps[index - 1]!.z;
    if (dz <= -16 && dz > -64) {
      areas.push({ id: `stair_${stairIndex++}`, label: "Stair", kind: "stair", floor: 1,
        x: Math.round(steps[index - 1]!.x), y: Math.round(steps[index - 1]!.y),
        width: 96, depth: 96, note: `drop ${Math.round(dz)}` });
    }
  }

  // Director zones live in the nav flags; a survey can read them back.
  const ZONES: Array<[number, string]> = [[0x100, "battlefield"], [0x40, "finale"], [0x2000, "no-mob"]];
  for (const [bit, kind] of ZONES) {
    let count = 0;
    for (const area of nav.areas) {
      if ((area.spawnAttributes & bit) === 0) continue;
      const centre = areaCenter(area);
      areas.push({
        id: `${kind}_${count++}`, label: kind, kind: kind as "battlefield" | "finale" | "no-mob", floor: 1,
        x: Math.round(centre.x), y: Math.round(centre.y),
        width: Math.max(64, Math.round((area.maxX - area.minX) / 64) * 64),
        depth: Math.max(64, Math.round((area.maxY - area.minY) / 64) * 64),
      });
      if (count >= 12) break;
    }
  }

  // Palette from the map: skybox from worldspawn, prop models from the static props.
  const world = entities.find((entity) => entity.classname === "worldspawn");
  const skyName = world?.keyvalues?.find(([key]) => key.toLowerCase() === "skyname")?.[1] ?? "";
  let materials: string[] = [];
  try {
    const report = readMaterials(bspPath);
    materials = report.materials
      .slice()
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 16)
      .map((material) => material.name);
  } catch {
    materials = [];
  }
  // Water and no-build volumes are entities in an L4D2 map; a survey records their footprint.
  const water: Array<Record<string, unknown>> = [];
  const noBuild: Array<Record<string, unknown>> = [];
  for (const entity of entities) {
    const cls = entity.classname ?? "";
    if (/water/i.test(cls)) {
      const [x, y] = origin(entity);
      water.push({ x: Math.round(x), y: Math.round(y), width: 512, depth: 512, rotation: 0 });
    } else if (/nav_blocker|navblocker/i.test(cls)) {
      const [x, y] = origin(entity);
      noBuild.push({ x: Math.round(x), y: Math.round(y), width: 256, depth: 256, rotation: 0 });
    }
    if (water.length >= 12 && noBuild.length >= 12) break;
  }
  // Props near the route become `prop` areas; a survey cannot guess cover quality.
  const propsNearRoute: Array<Record<string, unknown>> = [];
  let propCount = 0;
  let propModels: string[] = [];
  try {
    const lumpProps = readStaticProps(bspPath);
    propCount = lumpProps.props.length;
    propModels = [...new Set(lumpProps.props.map((prop) => prop.model))].sort().slice(0, 32);
    let propIndex = 0;
    for (const prop of lumpProps.props) {
      const near = steps.some((step) => Math.hypot(step.x - prop.origin[0], step.y - prop.origin[1]) <= 320);
      if (!near) continue;
      propsNearRoute.push({
        id: `prop_${propIndex++}`, label: prop.model.split("/").pop() ?? "prop", kind: "prop", floor: 1,
        x: Math.round(prop.origin[0]), y: Math.round(prop.origin[1]), width: 64, depth: 64,
        note: prop.model,
      });
      if (propIndex >= 40) break;
    }
  } catch {
    propsNearRoute.length = 0;
    propCount = 0;
  }

  const spawnEntity = entities.find((entity) => entity.classname === "info_player_start");
  const spawnZ = spawnEntity ? Math.round(origin(spawnEntity)[2]) : Math.round(startCenter.z);

  // ---- rooms and buildings from the nav graph ---------------------------------
  // A room is a connected group of nav areas that does not cross a door area; a building is a
  // spatial cluster of rooms whose heights overlap. This is the level of detail the nav mesh
  // actually carries; brush-perfect architecture needs the BSP solids, which is a later layer.
  const DOOR_TAG = 0x40000;
  const BLOCKED = 0x80000000 | 0x10000000;
  type Box = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; areas: number };
  const boxOf = (list: typeof nav.areas): Box => {
    const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, areas: list.length };
    for (const a of list) {
      b.minX = Math.min(b.minX, a.minX); b.minY = Math.min(b.minY, a.minY); b.minZ = Math.min(b.minZ, a.minZ);
      b.maxX = Math.max(b.maxX, a.maxX); b.maxY = Math.max(b.maxY, a.maxY); b.maxZ = Math.max(b.maxZ, a.maxZ);
    }
    return b;
  };
  const seenAreas = new Set<number>();
  const rooms: Array<{ box: Box; areaIds: number[] }> = [];
  const areaRoom = new Map<number, number>();
  for (const start of nav.areas) {
    if (seenAreas.has(start.id)) continue;
    if ((start.spawnAttributes & DOOR_TAG) !== 0) continue;
    if ((start.flags & BLOCKED) !== 0) continue;
    const stack = [start.id];
    const component: typeof nav.areas = [];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seenAreas.has(id)) continue;
      const area = graph.byId.get(id);
      if (!area) continue;
      if ((area.spawnAttributes & DOOR_TAG) !== 0) continue;
      if ((area.flags & BLOCKED) !== 0) continue;
      seenAreas.add(id);
      component.push(area);
      for (const neighbour of graph.neighbors.get(id) ?? []) {
        if (!seenAreas.has(neighbour)) stack.push(neighbour);
      }
    }
    if (component.length < 3) continue;
    const index = rooms.length;
    rooms.push({ box: boxOf(component), areaIds: component.map((area) => area.id) });
    for (const area of component) areaRoom.set(area.id, index);
  }
  // Two rooms belong to the same building when a door area joins them. Space alone is not
  // enough: a street touches every facade, a building is what you can walk into.
  const parent: number[] = rooms.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const area of nav.areas) {
    if ((area.spawnAttributes & DOOR_TAG) === 0) continue;
    const joined = (graph.neighbors.get(area.id) ?? [])
      .map((id) => areaRoom.get(id))
      .filter((room): room is number => room !== undefined);
    for (const room of joined.slice(1)) parent[find(room)] = find(joined[0]!);
  }
  // A room with no door neighbour is still a space (the street): keep it only when it is large.
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < rooms.length; i += 1) {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), i]);
  }
  const buildings = [...clusters.values()]
    .filter((indices) => indices.length >= 2 || indices.reduce((n, i) => n + rooms[i]!.areaIds.length, 0) >= 20)
    .slice(0, 24)
    .map((indices, index) => {
      const group = indices.map((i) => rooms[i]!.box);
      // bounding box of the group
      const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
      for (const r of group) {
        box.minX = Math.min(box.minX, r.minX); box.minY = Math.min(box.minY, r.minY); box.minZ = Math.min(box.minZ, r.minZ);
        box.maxX = Math.max(box.maxX, r.maxX); box.maxY = Math.max(box.maxY, r.maxY); box.maxZ = Math.max(box.maxZ, r.maxZ);
      }
      const width = Math.max(128, Math.ceil((box.maxX - box.minX) / 64) * 64);
      const depth = Math.max(128, Math.ceil((box.maxY - box.minY) / 64) * 64);
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      // floors: rooms grouped by 64 u height bands
      const bands = new Map<number, number[]>();
      for (const r of group) {
        const band = Math.round((r.minZ + r.maxZ) / 2 / 64);
        bands.set(band, [...(bands.get(band) ?? []), group.indexOf(r)]);
      }
      const levels = [...bands.entries()].sort((a, b) => a[0] - b[0]);
      const floorZ = levels.map(([, members]) => Math.round(Math.min(...members.map((m) => group[m]!.minZ))));
      return {
        id: `b${index}`,
        name: `Building ${index + 1}`,
        x: Math.round(cx),
        y: Math.round(cy),
        width,
        depth,
        rotation: 0,
        floors: levels.length,
        floorHeight: 128,
        baseZ: Math.round(box.minZ),
        roofZ: Math.max(Math.round(box.maxZ), Math.round(box.minZ) + 128),
        excavated: box.minZ < -16,
        enterable: false,
        role: (Math.abs(startCenter.x - cx) <= width / 2 && Math.abs(startCenter.y - cy) <= depth / 2)
          ? "route" as const
          : (Math.abs(areaCenter(goalArea).x - cx) <= width / 2 && Math.abs(areaCenter(goalArea).y - cy) <= depth / 2)
            ? "safe-room" as const
            : "context" as const,

        floorsPlan: levels.map(([, members], level) => ({
          level: level + 1,
          z: floorZ[level]!,
          height: 128,
          rooms: members.map((member, roomIndex) => {
            const r = group[member]!;
            return {
              id: `r${member}_${roomIndex}`,
              name: `Room ${roomIndex + 1}`,
              x: Math.round((r.minX + r.maxX) / 2 - cx),
              y: Math.round((r.minY + r.maxY) / 2 - cy),
              width: Math.max(64, Math.round((r.maxX - r.minX) / 64) * 64),
              depth: Math.max(64, Math.round((r.maxY - r.minY) / 64) * 64),
            };
          }),
        })),
      };
    });

  // ---- heightfield from the map's own collision ---------------------------------
  // A 128 u grid, each cell sampled by a downward column trace: the lowest standable surface
  // is the ground, so bumps, kerbs and pits survive. The nav surface is only the fallback for
  // cells the trace cannot reach, and displacement patches fill the rest.
  const CELL = 128;
  const cols = Math.ceil((site.bounds.x1 - site.bounds.x0) / CELL) + 1;
  const rows = Math.ceil((site.bounds.y1 - site.bounds.y0) / CELL) + 1;
  const heights = new Array<number>(cols * rows).fill(Number.POSITIVE_INFINITY);
  for (const area of nav.areas) {
    const z = (area.minZ + area.maxZ) / 2;
    const c0 = Math.max(0, Math.floor((area.minX - site.bounds.x0) / CELL));
    const c1 = Math.min(cols - 1, Math.ceil((area.maxX - site.bounds.x0) / CELL));
    const r0 = Math.max(0, Math.floor((area.minY - site.bounds.y0) / CELL));
    const r1 = Math.min(rows - 1, Math.ceil((area.maxY - site.bounds.y0) / CELL));
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const cx = site.bounds.x0 + (col + 0.5) * CELL;
        const cy = site.bounds.y0 + (row + 0.5) * CELL;
        if (cx < area.minX || cx > area.maxX || cy < area.minY || cy > area.maxY) continue;
        const index = row * cols + col;
        if (z < heights[index]!) heights[index] = z;
      }
    }
  }

  let sampled = 0;
  let displacementCount = 0;
  try {
    const tree = readTree(bspPath);
    const topZ = Math.ceil(Math.max(...nav.areas.map((area) => area.maxZ))) + 512;
    const bottomZ = Math.floor(Math.min(...nav.areas.map((area) => area.minZ))) - 512;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const cx = site.bounds.x0 + (col + 0.5) * CELL;
        const cy = site.bounds.y0 + (row + 0.5) * CELL;
        const ground = groundSample(tree, cx, cy, topZ, bottomZ, 36, 32);
        if (!ground) continue;
        heights[row * cols + col] = ground.groundZ;
        sampled += 1;
      }
    }
  } catch {
    sampled = 0;
  }
  // Displacement patches carry designed banks and hills the column trace may miss at power 2.
  try {
    const displacements = readDisplacements(bspPath, 4096);
    displacementCount = displacements.count;
    for (const patch of displacements.displacements) {
      const z = Math.round(patch.start[2]);
      const col = Math.max(0, Math.min(cols - 1, Math.floor((patch.start[0] - site.bounds.x0) / CELL)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor((patch.start[1] - site.bounds.y0) / CELL)));
      const index = row * cols + col;
      if (!Number.isFinite(heights[index]!) || z > heights[index]!) heights[index] = z;
    }
  } catch {
    displacementCount = 0;
  }
  const terrain = {
    cell: CELL,
    origin: [site.bounds.x0, site.bounds.y0] as [number, number],
    cols,
    rows,
    heights: heights.map((value) => (Number.isFinite(value) ? Math.round(value) : 0)),
  };
  for (const node of routeNodes) {
    const host = buildings.find(
      (building) =>
        Math.abs(node.x - building.x) <= building.width / 2 &&
        Math.abs(node.y - building.y) <= building.depth / 2,
    );
    if (host) node.buildingId = host.id;
    if (host) host.enterable = true;
  }
  for (const building of buildings) {
    const col = Math.max(0, Math.min(cols - 1, Math.floor((building.x - site.bounds.x0) / CELL)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((building.y - site.bounds.y0) / CELL)));
    const ground = terrain.heights[row * cols + col]!;
    if (building.baseZ < ground - 16) building.excavated = true;
  }

  // ---- side branches ----------------------------------------------------------
  // Rooms the critical route never enters become branch routes anchored at the nearest node.
  const branches: Array<Record<string, unknown>> = [];
  let branchIndex = 0;
  for (const room of rooms) {
    const cx = Math.round((room.box.minX + room.box.maxX) / 2);
    const cy = Math.round((room.box.minY + room.box.maxY) / 2);
    const cz = Math.round((room.box.minZ + room.box.maxZ) / 2);
    const onRoute = steps.some((step) => Math.hypot(step.x - cx, step.y - cy) <= 256);
    if (onRoute) continue;
    const nearest = routeNodes
      .map((node) => ({ node, distance: Math.hypot(node.x - cx, node.y - cy) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || nearest.distance < 256) continue;
    branchIndex += 1;
    const anchor = nearest.node;
    branches.push({
      id: `branch_${branchIndex}`,
      kind: "branch",
      typology: "pass-through",
      width: 96,
      from: anchor.id,
      points: [[anchor.x, anchor.y, anchor.z], [cx, cy, cz]],
      nodes: [
        { id: `branch_${branchIndex}_a`, label: "Branch", x: anchor.x, y: anchor.y, z: anchor.z,
          floor: 1, district: anchor.district, space: anchor.space, kind: "street",
          enclosure: "tight", intensity: 2, landmark: "", gate: "none" },
        { id: `branch_${branchIndex}_end`, label: `Side room ${branchIndex}`, x: cx, y: cy, z: cz,
          floor: 1, district: bandOf(cz), space: `side_${bandOf(cz)}`, kind: "room",
          enclosure: "tight", intensity: 2, landmark: "", gate: "none" },
      ],
      stops: [],
    });
    if (branchIndex >= 6) break;
  }

  const plan = {
    version: 1 as const,
    name: name ?? bspPath.replace(/\\/g, "/").split("/").pop()!.replace(/\.bsp$/i, ""),
    kind: "map" as const,
    stage: "approved" as const,
    origin: "imported" as const,
    source: { bsp: bspPath, nav: navPath, entities: entities.length, navAreas: nav.areas.length, displacements: displacementCount, props: propCount },
    experience: `survey of ${bspPath}`,
    pillars: [],
    districts,
    site,
    terrain,
    buildings,
    routes: [{
      id: "critical", kind: "critical" as const, typology: "string-of-pearls" as const, width: 128,
      points: steps.map((step) => [Math.round(step.x), Math.round(step.y), Math.round(step.z)]),
      nodes: routeNodes,
      stops: [
        { id: "s-start", label: "Start", x: Math.round(startCenter.x), y: Math.round(startCenter.y), z: spawnZ, kind: "start" as const },
        { id: "s-safe", label: "Safe room", x: Math.round(areaCenter(goalArea).x), y: Math.round(areaCenter(goalArea).y), z: Math.round(areaCenter(goalArea).z), kind: "safe-room" as const },
      ],
    }, ...branches],
    areas: [...areas, ...propsNearRoute],
    beats: [],
    budget: {},
    palette: { sky: skyName, motifs: [], materials, models: propModels },
    variability: [],
    acceptance: [],
  };

  const parsed = MapPlanSchema.parse(plan);
  writeFileSync(destination, JSON.stringify(parsed, null, 2), "utf8");
  return {
    path: destination, name: plan.name, areas: areas.length, nodes: routeNodes.length,
    buildings: buildings.length, districts: districts.length,
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
