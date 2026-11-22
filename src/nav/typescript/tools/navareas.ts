/**
 * Nav areas as data: what each area is, and how to change it.
 *
 * The reason this exists is L4D2's Director. `NAV_MOB_ONLY`, `NAV_TANK_ONLY`,
 * `SPAWN_NO_MOBS` and the compass spawn attributes are how a mapper says "the tank may come
 * from here, the horde may not" — and until now the toolkit could generate a mesh, report
 * its header and diagnose a `_nav.txt`, but not look at the areas or change one.
 *
 * Editing is a patch, never a rewrite: `write_nav_areas` copies the file and changes the
 * fields it was asked to change, so the other ten megabytes stay byte-identical and a bad
 * edit is one `.bak` away from undone.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";
import {
  NAV_FLAGS,
  SPAWN_FLAGS,
  decodeFlags,
  encodeFlags,
  navAreaCenter,
  navPlaceName,
  patchNavAreas,
  readNavFile,
} from "../formats/navfile.js";
import type { NavFile } from "../formats/navfile.js";

/** Bits this project has a name for; anything else is reported as hex, never guessed. */
const KNOWN_NAV_MASK = Object.keys(NAV_FLAGS).reduce((mask, bit) => mask | Number(bit), 0) >>> 0;
const KNOWN_SPAWN_MASK = Object.keys(SPAWN_FLAGS).reduce((mask, bit) => mask | Number(bit), 0) >>> 0;

interface AreaView {
  id: number;
  flags: number;
  flagsHex: string;
  attributes: string[];
  unknownAttributeBits: string | null;
  spawn: number;
  spawnHex: string;
  spawnAttributes: string[];
  unknownSpawnBits: string | null;
  placeId: number;
  place: string | null;
  center: [number, number, number];
  size: [number, number, number];
  connections: { north: number; east: number; south: number; west: number; total: number };
  hidingSpots: number;
  visibleAreas: number;
}

function view(nav: NavFile, area: NavFile["areas"][number]): AreaView {
  const center = navAreaCenter(area);
  const connections = {
    north: area.connections.north.length,
    east: area.connections.east.length,
    south: area.connections.south.length,
    west: area.connections.west.length,
    total:
      area.connections.north.length +
      area.connections.east.length +
      area.connections.south.length +
      area.connections.west.length,
  };
  const unknownAttributes = (area.flags & ~KNOWN_NAV_MASK) >>> 0;
  const unknownSpawn = (area.spawnAttributes & ~KNOWN_SPAWN_MASK) >>> 0;
  return {
    id: area.id,
    flags: area.flags,
    flagsHex: `0x${area.flags.toString(16).padStart(8, "0")}`,
    attributes: decodeFlags(area.flags, NAV_FLAGS),
    unknownAttributeBits: unknownAttributes === 0 ? null : `0x${unknownAttributes.toString(16)}`,
    spawn: area.spawnAttributes,
    spawnHex: `0x${area.spawnAttributes.toString(16).padStart(8, "0")}`,
    spawnAttributes: decodeFlags(area.spawnAttributes, SPAWN_FLAGS),
    unknownSpawnBits: unknownSpawn === 0 ? null : `0x${unknownSpawn.toString(16)}`,
    placeId: area.placeId,
    place: navPlaceName(nav, area.placeId),
    center,
    size: [area.maxX - area.minX, area.maxY - area.minY, area.maxZ - area.minZ],
    connections,
    hidingSpots: area.hidingSpots,
    visibleAreas: area.visibleAreas,
  };
}

export const readNavAreasTool = defineTool({
  name: "read_nav_areas",
  description:
    "Lists the areas of a .nav with their attributes, L4D2 spawn attributes, place, centre, " +
    "size and connection counts. This is the layer below read_nav: read_nav says whether the " +
    "mesh matches the map, this says what the Director is allowed to do with each area. " +
    "Filters by attribute name (`MOB_ONLY`, `SPAWN_NO_MOBS` ...) or place. Unknown bits are " +
    "reported as hex rather than guessed.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    attribute: z
      .string()
      .optional()
      .describe("Keep only areas carrying this attribute name, e.g. MOB_ONLY or SPAWN_NO_MOBS."),
    place: z.string().optional().describe("Keep only areas in this place."),
    limit: z.number().int().min(1).max(5000).default(200),
    sortBy: z
      .enum(["id", "size", "connections"])
      .default("id")
      .describe("size: largest area first. connections: most connected first."),
  },
  outputSchema: {
    path: z.string(),
    version: z.number(),
    subVersion: z.number(),
    population: z.string().nullable(),
    places: z.array(z.string()),
    areaCount: z.number(),
    returned: z.number(),
    areas: z.array(
      z.object({
        id: z.number(),
        flags: z.number(),
        flagsHex: z.string(),
        attributes: z.array(z.string()),
        unknownAttributeBits: z.string().nullable(),
        spawn: z.number(),
        spawnHex: z.string(),
        spawnAttributes: z.array(z.string()),
        unknownSpawnBits: z.string().nullable(),
        placeId: z.number(),
        place: z.string().nullable(),
        center: z.array(z.number()),
        size: z.array(z.number()),
        connections: z.object({
          north: z.number(),
          east: z.number(),
          south: z.number(),
          west: z.number(),
          total: z.number(),
        }),
        hidingSpots: z.number(),
        visibleAreas: z.number(),
      }),
    ),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const nav = readNavFile(readFileSync(path), path);

    const attribute = args.attribute?.toUpperCase();
    let areas = nav.areas.map((area) => view(nav, area));
    if (attribute) {
      areas = areas.filter(
        (area) => area.attributes.includes(attribute) || area.spawnAttributes.includes(attribute),
      );
    }
    if (args.place !== undefined) {
      const wanted = args.place.toLowerCase();
      areas = areas.filter((area) =>
        wanted === "no place"
          ? area.placeId === 0
          : (area.place ?? "").toLowerCase() === wanted,
      );
    }

    areas.sort((a, b) => {
      if (args.sortBy === "size") {
        const volume = (x: typeof a): number => x.size[0] * x.size[1];
        return volume(b) - volume(a) || a.id - b.id;
      }
      if (args.sortBy === "connections") return b.connections.total - a.connections.total || a.id - b.id;
      return a.id - b.id;
    });

    return {
      path,
      version: nav.version,
      subVersion: nav.subVersion,
      population: nav.zombiePopulation,
      places: nav.places,
      areaCount: nav.areaCount,
      returned: Math.min(areas.length, args.limit),
      areas: areas.slice(0, args.limit),
    };
  },
});

const UPDATE = z.object({
  id: z.number().int().describe("Area id from read_nav_areas."),
  addFlags: z.array(z.string()).optional().describe("Attribute names to set, e.g. MOB_ONLY."),
  removeFlags: z.array(z.string()).optional(),
  addSpawnFlags: z
    .array(z.string())
    .optional()
    .describe("L4D2 spawn attributes to set, e.g. NO_MOBS, COMPASS_NORTH."),
  removeSpawnFlags: z.array(z.string()).optional(),
  place: z
    .string()
    .optional()
    .describe("Place name from the file's own place table; the table is never rewritten."),
});

export const writeNavAreasTool = defineTool({
  name: "write_nav_areas",
  description:
    "Changes nav area attributes, L4D2 spawn attributes and place names in place. Only the " +
    "named bits change: bits this project has no name for are preserved, so an edit cannot " +
    "corrupt a mesh's unknown flags. A `.bak` is written first, and the file is read back to " +
    "prove the change landed. Refuses a place that is not already in the file's place table, " +
    "because adding one means rewriting the table.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    updates: z.array(UPDATE).min(1),
    backup: z.boolean().default(true).describe("Write <path>.bak before changing the file."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    backup: z.string().nullable(),
    changed: z.array(
      z.object({
        id: z.number(),
        before: z.object({ flagsHex: z.string(), spawnHex: z.string(), place: z.string().nullable() }),
        after: z.object({ flagsHex: z.string(), spawnHex: z.string(), place: z.string().nullable() }),
      }),
    ),
    verified: z.boolean(),
    bytes: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const nav = readNavFile(readFileSync(path), path);

    const patch: Array<{
      id: number;
      setFlags?: number;
      clearFlags?: number;
      setSpawn?: number;
      clearSpawn?: number;
      placeId?: number;
    }> = [];

    for (const update of args.updates) {
      const area = nav.areas.find((candidate) => candidate.id === update.id);
      if (!area) {
        throw new Error(`area ${update.id} is not in ${path}; read_nav_areas lists the ids`);
      }
      const entry: (typeof patch)[number] = { id: update.id };
      if (update.addFlags && update.addFlags.length > 0) entry.setFlags = encodeFlags(update.addFlags, NAV_FLAGS);
      if (update.removeFlags && update.removeFlags.length > 0) {
        entry.clearFlags = encodeFlags(update.removeFlags, NAV_FLAGS);
      }
      if (update.addSpawnFlags && update.addSpawnFlags.length > 0) {
        entry.setSpawn = encodeFlags(update.addSpawnFlags, SPAWN_FLAGS);
      }
      if (update.removeSpawnFlags && update.removeSpawnFlags.length > 0) {
        entry.clearSpawn = encodeFlags(update.removeSpawnFlags, SPAWN_FLAGS);
      }
      if (update.place !== undefined) {
        const index = nav.places.findIndex(
          (name) => name.toLowerCase() === update.place!.toLowerCase(),
        );
        if (index === -1) {
          throw new Error(
            `"${update.place}" is not in ${path}'s place table ` +
              `(${nav.places.length === 0 ? "the table is empty" : nav.places.join(", ")}). ` +
              `Adding a place means rewriting the table, which this tool does not do.`,
          );
        }
        // Place ids are 1-based; 0 means no place.
        entry.placeId = index + 1;
      }
      patch.push(entry);
    }

    const before = new Map(
      args.updates.map((update) => {
        const area = nav.areas.find((candidate) => candidate.id === update.id)!;
        return [
          update.id,
          {
            flagsHex: `0x${area.flags.toString(16).padStart(8, "0")}`,
            spawnHex: `0x${area.spawnAttributes.toString(16).padStart(8, "0")}`,
            place: navPlaceName(nav, area.placeId),
          },
        ];
      }),
    );

    const next = patchNavAreas(nav, patch);
    const target = assertWritable(path, ctx.config);

    let backup: string | null = null;
    if (args.backup) {
      backup = assertWritable(`${target}.bak`, ctx.config);
      copyFileSync(target, backup);
    }
    writeFileSync(target, next);
    ctx.audit.record({ kind: "file_write", data: { path: target, backup, areas: patch.length } });

    // Read the bytes back rather than trusting the write: a patched field that did not land
    // is exactly the failure a nav edit must not hide.
    const after = readNavFile(readFileSync(target), target);
    const changed = args.updates.map((update) => {
      const area = after.areas.find((candidate) => candidate.id === update.id)!;
      const was = before.get(update.id)!;
      const now = {
        flagsHex: `0x${area.flags.toString(16).padStart(8, "0")}`,
        spawnHex: `0x${area.spawnAttributes.toString(16).padStart(8, "0")}`,
        place: navPlaceName(after, area.placeId),
      };
      return { id: update.id, before: was, after: now };
    });

    const verified = changed.every((entry) => {
      const update = args.updates.find((candidate) => candidate.id === entry.id)!;
      const expectsChange =
        (update.addFlags?.length ?? 0) +
          (update.removeFlags?.length ?? 0) +
          (update.addSpawnFlags?.length ?? 0) +
          (update.removeSpawnFlags?.length ?? 0) +
          (update.place === undefined ? 0 : 1) >
        0;
      if (!expectsChange) return true;
      return (
        entry.before.flagsHex !== entry.after.flagsHex ||
        entry.before.spawnHex !== entry.after.spawnHex ||
        entry.before.place !== entry.after.place
      );
    });

    return {
      path: target,
      backup,
      changed,
      verified,
      bytes: next.length,
    };
  },
});

export const navAreasTools = [readNavAreasTool, writeNavAreasTool];
