/**
 * Nav places, hiding spots and visibility: the Director's data, read as data.
 *
 * `read_nav_areas` reports the place of each area; these tools answer the three questions that
 * need the records the area view only counted:
 *
 * - **Places** (`read_nav_places`): a place is 1-based (`PlaceToName` uses `place - 1`; 0 is
 *   `UNDEFINED_PLACE`). A place groups areas, so this summarises area count, bounds, centre and
 *   the spawn attributes its areas carry.
 * - **Hiding spots** (`read_nav_hiding_spots`): each spot is a 17-byte `CNavHidingSpot`
 *   (`id`, position, flag byte). The flags are `IN_COVER`, `GOOD_SNIPER_SPOT`,
 *   `IDEAL_SNIPER_SPOT` and `EXPOSED`; this resolves the area and place for each spot.
 * - **Visibility** (`read_nav_visibility`): a list entry stores the target area's *index*, not
 *   its hash id (a stock `c1m1_hotel.nav` lists 0..1581 for 1582 areas). The attribute is
 *   `NOT_VISIBLE` 0, `POTENTIALLY_VISIBLE` 1, `COMPLETELY_VISIBLE` 2, or both. An area may
 *   inherit another area's list; `effective` merges the two the way `nav_area.h` does.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import {
  HIDING_SPOT_FLAGS,
  SPAWN_FLAGS,
  VISIBILITY_FLAGS,
  decodeFlags,
  navAreaCenter,
  navPlaceName,
  readNavFile,
} from "../formats/navfile.js";
import type { NavArea, NavFile } from "../formats/navfile.js";

const POINT = z.tuple([z.number(), z.number(), z.number()]);

const KNOWN_SPAWN_MASK =
  Object.keys(SPAWN_FLAGS).reduce((mask, bit) => mask | Number(bit), 0) >>> 0;
const KNOWN_HIDING_MASK =
  Object.keys(HIDING_SPOT_FLAGS).reduce((mask, bit) => mask | Number(bit), 0) >>> 0;

function load(pathArg: string, config: Parameters<typeof resolveInput>[1]): { path: string; nav: NavFile } {
  const path = resolveInput(pathArg, config);
  return { path, nav: readNavFile(readFileSync(path), path) };
}

function countBits(values: readonly number[], table: Record<number, string>): Array<{ name: string; count: number }> {
  return Object.entries(table)
    .map(([bit, name]) => ({
      name,
      count: values.filter((value) => (value & Number(bit)) !== 0).length,
    }))
    .filter((entry) => entry.count > 0);
}

/** Unknown bits, grouped by their hex value, so a new game build is visible rather than guessed. */
function unknownBits(values: readonly number[], knownMask: number): Array<{ bits: string; count: number }> {
  const counts = new Map<number, number>();
  for (const value of values) {
    const unknown = (value & ~knownMask) >>> 0;
    if (unknown !== 0) counts.set(unknown, (counts.get(unknown) ?? 0) + 1);
  }
  return [...counts.entries()].map(([bits, count]) => ({
    bits: `0x${bits.toString(16)}`,
    count,
  }));
}

function boundsOf(areas: readonly NavArea[]): {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
} | null {
  if (areas.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const area of areas) {
    minX = Math.min(minX, area.minX);
    minY = Math.min(minY, area.minY);
    minZ = Math.min(minZ, area.minZ);
    maxX = Math.max(maxX, area.maxX);
    maxY = Math.max(maxY, area.maxY);
    maxZ = Math.max(maxZ, area.maxZ);
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

const PLACE_ENTRY = z.object({
  id: z.number(),
  name: z.string().nullable(),
  areaCount: z.number(),
  areaIds: z.array(z.number()),
  bounds: z.object({ min: POINT, max: POINT }).nullable(),
  center: POINT.nullable(),
  spawn: z.array(z.object({ name: z.string(), count: z.number() })),
  unknownSpawn: z.array(z.object({ bits: z.string(), count: z.number() })),
});

export const readNavPlacesTool = defineTool({
  name: "read_nav_places",
  description:
    "Summarises a .nav's place table: each place with its 1-based id (0 = no place), area " +
    "count, first area ids, bounds, centre and the spawn attributes its areas carry. A place " +
    "is how the Director and the rescue/checkpoint logic group areas; this is the map-wide " +
    "view, while read_nav_areas shows one area at a time.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    includeUnplaced: z
      .boolean()
      .default(true)
      .describe("Include place id 0, the areas with no place assigned."),
    sortBy: z.enum(["id", "areas", "name"]).default("areas"),
    limit: z.number().int().min(1).max(5000).default(200),
  },
  outputSchema: {
    path: z.string(),
    version: z.number(),
    subVersion: z.number(),
    population: z.string().nullable(),
    areaCount: z.number(),
    placeCount: z.number(),
    unnamedAreas: z.boolean(),
    returned: z.number(),
    entries: z.array(PLACE_ENTRY),
  },
  handler: (args, ctx) => {
    const { path, nav } = load(args.path, ctx.config);
    const limit = args.limit ?? 200;
    const sortBy = args.sortBy ?? "areas";
    const includeUnplaced = args.includeUnplaced !== false;
    const entries = [];
    for (let id = 0; id <= nav.places.length; id += 1) {
      if (id === 0 && !includeUnplaced) continue;
      const areas = nav.areas.filter((area) => area.placeId === id);
      const bounds = boundsOf(areas);
      entries.push({
        id,
        name: id === 0 ? null : (nav.places[id - 1] ?? null),
        areaCount: areas.length,
        areaIds: areas.slice(0, 10).map((area) => area.id),
        bounds: bounds ? { min: bounds.min, max: bounds.max } : null,
        center: bounds?.center ?? null,
        spawn: countBits(
          areas.map((area) => area.spawnAttributes),
          SPAWN_FLAGS,
        ),
        unknownSpawn: unknownBits(
          areas.map((area) => area.spawnAttributes),
          KNOWN_SPAWN_MASK,
        ),
      });
    }
    entries.sort((a, b) => {
      if (sortBy === "name") {
        return (a.name ?? "").localeCompare(b.name ?? "") || a.id - b.id;
      }
      if (sortBy === "areas") return b.areaCount - a.areaCount || a.id - b.id;
      return a.id - b.id;
    });
    return {
      path,
      version: nav.version,
      subVersion: nav.subVersion,
      population: nav.zombiePopulation,
      areaCount: nav.areaCount,
      placeCount: nav.places.length,
      unnamedAreas: nav.hasUnnamedAreas,
      returned: Math.min(entries.length, limit),
      entries: entries.slice(0, limit),
    };
  },
});

const SPOT = z.object({
  id: z.number(),
  areaId: z.number(),
  areaIndex: z.number(),
  place: z.string().nullable(),
  position: POINT,
  flags: z.number(),
  attributes: z.array(z.string()),
  unknownBits: z.string().nullable(),
});

export const readNavHidingSpotsTool = defineTool({
  name: "read_nav_hiding_spots",
  description:
    "Lists a .nav's hiding spots: id, world position, raw flag byte decoded as IN_COVER, " +
    "GOOD_SNIPER_SPOT, IDEAL_SNIPER_SPOT and EXPOSED, and the area and place each belongs to. " +
    "Filters by area, place or flag. Also reports how many spots each flag and place has, and " +
    "duplicate ids, because a bot uses these spots to wait for the player.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    area: z.number().int().optional().describe("Only spots in this area id."),
    place: z
      .string()
      .optional()
      .describe('Only spots in this place name, or "no place" for place id 0.'),
    flag: z
      .string()
      .optional()
      .describe("Only spots carrying this flag, e.g. IN_COVER, EXPOSED, IDEAL_SNIPER_SPOT."),
    sortBy: z.enum(["area", "id", "z"]).default("area"),
    limit: z.number().int().min(1).max(20_000).default(500),
  },
  outputSchema: {
    path: z.string(),
    version: z.number(),
    subVersion: z.number(),
    areaCount: z.number(),
    spotCount: z.number(),
    areasWithSpots: z.number(),
    byFlag: z.array(z.object({ name: z.string(), count: z.number() })),
    unknownFlags: z.array(z.object({ bits: z.string(), count: z.number() })),
    byPlace: z.array(
      z.object({ placeId: z.number(), place: z.string().nullable(), count: z.number() }),
    ),
    returned: z.number(),
    spots: z.array(SPOT),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const { path, nav } = load(args.path, ctx.config);
    const limit = args.limit ?? 500;
    const sortBy = args.sortBy ?? "area";
    const all = nav.areas.flatMap((area) =>
      area.hidingSpotList.map((spot) => ({ area, spot })),
    );
    const byFlag = countBits(
      all.map((entry) => entry.spot.flags),
      HIDING_SPOT_FLAGS,
    );
    const unknownFlags = unknownBits(
      all.map((entry) => entry.spot.flags),
      KNOWN_HIDING_MASK,
    );
    const placeCounts = new Map<number, number>();
    for (const entry of all) {
      placeCounts.set(entry.area.placeId, (placeCounts.get(entry.area.placeId) ?? 0) + 1);
    }
    const byPlace = [...placeCounts.entries()]
      .map(([placeId, count]) => ({
        placeId,
        place: navPlaceName(nav, placeId),
        count,
      }))
      .sort((a, b) => b.count - a.count || a.placeId - b.placeId);

    let selected = all;
    if (args.area !== undefined) {
      const area = nav.areas.find((candidate) => candidate.id === args.area);
      if (!area) throw new Error(`area ${args.area} is not in ${path}; read_nav_areas lists the ids`);
      selected = selected.filter((entry) => entry.area.id === args.area);
    }
    if (args.place !== undefined) {
      const wanted = args.place.toLowerCase();
      selected = selected.filter((entry) => {
        const name = entry.area.placeId === 0 ? "no place" : (navPlaceName(nav, entry.area.placeId) ?? "");
        return name.toLowerCase() === wanted;
      });
    }
    if (args.flag !== undefined) {
      const wanted = args.flag.toUpperCase();
      selected = selected.filter((entry) =>
        decodeFlags(entry.spot.flags, HIDING_SPOT_FLAGS).includes(wanted),
      );
    }

    selected.sort((a, b) => {
      if (sortBy === "id") return a.spot.id - b.spot.id;
      if (sortBy === "z") return a.spot.z - b.spot.z || a.spot.id - b.spot.id;
      return a.area.id - b.area.id || a.spot.id - b.spot.id;
    });

    const warnings: string[] = [];
    const ids = new Map<number, number>();
    for (const entry of all) ids.set(entry.spot.id, (ids.get(entry.spot.id) ?? 0) + 1);
    const duplicates = [...ids.entries()].filter(([, count]) => count > 1);
    if (duplicates.length > 0) {
      warnings.push(
        `${duplicates.length} hiding-spot id(s) repeat (${duplicates
          .slice(0, 10)
          .map(([id]) => id)
          .join(", ")}).`,
      );
    }
    const unknownSpotCount = all.filter(
      (entry) => (entry.spot.flags & ~KNOWN_HIDING_MASK) !== 0,
    ).length;
    if (unknownSpotCount > 0) {
      warnings.push(`${unknownSpotCount} spot(s) carry flag bits this table does not name.`);
    }

    return {
      path,
      version: nav.version,
      subVersion: nav.subVersion,
      areaCount: nav.areaCount,
      spotCount: all.length,
      areasWithSpots: nav.areas.filter((area) => area.hidingSpots > 0).length,
      byFlag,
      unknownFlags,
      byPlace,
      returned: Math.min(selected.length, limit),
      spots: selected.slice(0, limit).map((entry) => ({
        id: entry.spot.id,
        areaId: entry.area.id,
        areaIndex: entry.area.index,
        place: navPlaceName(nav, entry.area.placeId),
        position: [entry.spot.x, entry.spot.y, entry.spot.z] as [number, number, number],
        flags: entry.spot.flags,
        attributes: decodeFlags(entry.spot.flags, HIDING_SPOT_FLAGS),
        unknownBits:
          (entry.spot.flags & ~KNOWN_HIDING_MASK) === 0
            ? null
            : `0x${((entry.spot.flags & ~KNOWN_HIDING_MASK) >>> 0).toString(16)}`,
      })),
      warnings,
    };
  },
});

const VISIBLE = z.object({
  areaIndex: z.number(),
  areaId: z.number().nullable(),
  attributes: z.number(),
  flags: z.array(z.string()),
  notVisible: z.boolean(),
});

const VISIBILITY_AREA = z.object({
  id: z.number(),
  index: z.number(),
  place: z.string().nullable(),
  center: POINT,
  visibleCount: z.number(),
  inheritVisibilityFrom: z.number().nullable(),
  inheritVisibilityFromIndex: z.number().nullable(),
  inheritVisibilityFound: z.boolean(),
  visible: z.array(VISIBLE),
  /** Merged own + inherited list, when `effective` and a single `area` are given. */
  effective: z
    .array(
      VISIBLE.extend({
        source: z.enum(["own", "inherited"]),
      }),
    )
    .nullable(),
  targetVisible: z.boolean().nullable(),
  targetSource: z.enum(["own", "inherited"]).nullable(),
});

export const readNavVisibilityTool = defineTool({
  name: "read_nav_visibility",
  description:
    "Reads nav visibility: each list entry stores the target area index, not its hash id, " +
    "with NOT_VISIBLE 0, POTENTIALLY_VISIBLE 1, COMPLETELY_VISIBLE 2 or both. Reports the " +
    "map-wide summary, per-area lists, the area each list inherits from, and with `effective` " +
    "merges an inherited list the way nav_area.h does. Filter by owner `area`, by `target` " +
    "(who lists this area as visible), or neither for the areas with the largest lists.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    area: z.number().int().optional().describe("Owner area id whose list to report."),
    target: z
      .number()
      .int()
      .optional()
      .describe(
        "Target area id; with `area`, checks the pair; alone, finds owners whose own list names it.",
      ),
    effective: z
      .boolean()
      .default(false)
      .describe("With `area`, merge the inherited visibility list into the effective one."),
    edgeLimit: z.number().int().min(1).max(20_000).default(100),
    areaLimit: z.number().int().min(1).max(5000).default(50),
  },
  outputSchema: {
    path: z.string(),
    version: z.number(),
    subVersion: z.number(),
    areaCount: z.number(),
    summary: z.object({
      areasWithVisibility: z.number(),
      areasInheriting: z.number(),
      edges: z.number(),
      completelyVisible: z.number(),
      potentiallyVisible: z.number(),
      notVisible: z.number(),
      maxVisible: z.number(),
      invalidIndexes: z.number(),
      brokenInheritance: z.number(),
      selfEdges: z.number(),
    }),
    returned: z.number(),
    areas: z.array(VISIBILITY_AREA),
    warnings: z.array(z.string()),
    note: z.string().optional(),
  },
  handler: (args, ctx) => {
    const { path, nav } = load(args.path, ctx.config);
    const effectiveEnabled = args.effective === true;
    const edgeLimit = args.edgeLimit ?? 100;
    const areaLimit = args.areaLimit ?? 50;
    const indexById = new Map(nav.areas.map((area) => [area.id, area.index]));
    const byId = new Map(nav.areas.map((area) => [area.id, area]));

    let edges = 0;
    let completelyVisible = 0;
    let potentiallyVisible = 0;
    let notVisible = 0;
    let invalidIndexes = 0;
    let brokenInheritance = 0;
    let selfEdges = 0;
    let maxVisible = 0;
    for (const area of nav.areas) {
      edges += area.visibleAreaList.length;
      maxVisible = Math.max(maxVisible, area.visibleAreaList.length);
      if (area.inheritVisibilityFrom !== 0 && !indexById.has(area.inheritVisibilityFrom)) {
        brokenInheritance += 1;
      }
      for (const entry of area.visibleAreaList) {
        if (entry.areaId === null) invalidIndexes += 1;
        if (entry.areaId === area.id) selfEdges += 1;
        if (entry.attributes === 0) notVisible += 1;
        if ((entry.attributes & 0x01) !== 0) potentiallyVisible += 1;
        if ((entry.attributes & 0x02) !== 0) completelyVisible += 1;
      }
    }
    const summary = {
      areasWithVisibility: nav.areas.filter((area) => area.visibleAreas > 0).length,
      areasInheriting: nav.areas.filter((area) => area.inheritVisibilityFrom !== 0).length,
      edges,
      completelyVisible,
      potentiallyVisible,
      notVisible,
      maxVisible,
      invalidIndexes,
      brokenInheritance,
      selfEdges,
    };

    const warnings: string[] = [];
    if (invalidIndexes > 0) {
      warnings.push(
        `${invalidIndexes} visibility entry/entries point outside the ${nav.areaCount}-area table.`,
      );
    }
    if (brokenInheritance > 0) {
      warnings.push(
        `${brokenInheritance} area(s) inherit visibility from an area id that is not in the file.`,
      );
    }
    let note: string | undefined;
    if (effectiveEnabled && args.area === undefined) {
      note = "`effective` needs a single `area`; the inherited list was not merged.";
    }

    const targetArea = args.target === undefined ? undefined : byId.get(args.target);
    if (args.target !== undefined && !targetArea) {
      warnings.push(`target area ${args.target} is not in ${path}.`);
    }

    let owners: NavArea[];
    if (args.area !== undefined) {
      const area = byId.get(args.area);
      if (!area) throw new Error(`area ${args.area} is not in ${path}; read_nav_areas lists the ids`);
      owners = [area];
    } else if (targetArea) {
      owners = nav.areas.filter((area) =>
        area.visibleAreaList.some((entry) => entry.areaId === targetArea.id),
      );
    } else {
      owners = [...nav.areas].sort(
        (a, b) => b.visibleAreaList.length - a.visibleAreaList.length || a.id - b.id,
      );
    }

    const effectiveFor = (area: NavArea): Array<{
      areaIndex: number;
      areaId: number | null;
      attributes: number;
      flags: string[];
      notVisible: boolean;
      source: "own" | "inherited";
    }> => {
      const own = new Map<number, number>();
      for (const entry of area.visibleAreaList) {
        if (entry.areaId !== null) own.set(entry.areaId, entry.attributes);
      }
      const source =
        area.inheritVisibilityFrom !== 0 ? byId.get(area.inheritVisibilityFrom) : undefined;
      const merged = new Map<number, number>();
      if (source) {
        for (const entry of source.visibleAreaList) {
          if (entry.areaId !== null && entry.attributes !== 0) {
            merged.set(entry.areaId, entry.attributes);
          }
        }
      }
      for (const [id, attributes] of own) {
        if (attributes === 0) merged.delete(id);
        else merged.set(id, attributes);
      }
      return [...merged.entries()]
        .map(([areaId, attributes]) => {
          const target = byId.get(areaId);
          return {
            areaIndex: target?.index ?? -1,
            areaId,
            attributes,
            flags: decodeFlags(attributes, VISIBILITY_FLAGS),
            notVisible: false,
            source: own.has(areaId) ? ("own" as const) : ("inherited" as const),
          };
        })
        .sort((a, b) => a.areaIndex - b.areaIndex || a.areaId - b.areaId);
    };

    const selected = owners.slice(0, args.area !== undefined ? 1 : areaLimit);
    return {
      path,
      version: nav.version,
      subVersion: nav.subVersion,
      areaCount: nav.areaCount,
      summary,
      returned: selected.length,
      areas: selected.map((area) => {
        const own = args.target
          ? area.visibleAreaList.filter((entry) => entry.areaId === args.target)
          : area.visibleAreaList;
        const effective = effectiveEnabled && args.area !== undefined ? effectiveFor(area) : null;
        let targetVisible: boolean | null = null;
        let targetSource: "own" | "inherited" | null = null;
        if (args.target !== undefined) {
          const direct = area.visibleAreaList.find((entry) => entry.areaId === args.target);
          if (direct) {
            targetVisible = direct.attributes !== 0;
            targetSource = "own";
          } else if (effective) {
            const inherited = effective.find((entry) => entry.areaId === args.target);
            targetVisible = inherited !== undefined;
            targetSource = inherited ? "inherited" : null;
          } else if (area.inheritVisibilityFrom === 0) {
            targetVisible = false;
          } else {
            // Absence from the own list says nothing when the area inherits another list.
            targetVisible = null;
          }
        }
        const center = navAreaCenter(area);
        return {
          id: area.id,
          index: area.index,
          place: navPlaceName(nav, area.placeId),
          center,
          visibleCount: area.visibleAreaList.length,
          inheritVisibilityFrom: area.inheritVisibilityFrom === 0 ? null : area.inheritVisibilityFrom,
          inheritVisibilityFromIndex: indexById.get(area.inheritVisibilityFrom) ?? null,
          inheritVisibilityFound:
            area.inheritVisibilityFrom === 0 || indexById.has(area.inheritVisibilityFrom),
          visible: own.slice(0, edgeLimit).map((entry) => ({
            areaIndex: entry.areaIndex,
            areaId: entry.areaId,
            attributes: entry.attributes,
            flags: decodeFlags(entry.attributes, VISIBILITY_FLAGS),
            notVisible: entry.attributes === 0,
          })),
          effective,
          targetVisible,
          targetSource,
        };
      }),
      warnings,
      ...(note ? { note } : {}),
    };
  },
});

export const navDetailsTools = [
  readNavPlacesTool,
  readNavHidingSpotsTool,
  readNavVisibilityTool,
];
