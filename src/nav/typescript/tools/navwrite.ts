/**
 * Nav details that are records, not area flags: ladders and hiding spots.
 *
 * `write_nav_areas` changes the area bitfields. These records sit inside an area (hiding
 * spots) or in the table after the areas (ladders), and both are fixed-size, so a change is
 * an in-place patch: no other offset moves and the file length is unchanged.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import type { ToolContext } from "../../../core/typescript/mcp/registry.js";
import { BACKUP, BACKUP_PATH, CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";
import {
  HIDING_SPOT_FLAGS,
  patchNavHidingSpots,
  patchNavLadders,
  patchNavPlaces,
  readNavFile,
} from "../formats/navfile.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);

function commitNav(
  path: string,
  bytes: Buffer,
  backup: boolean,
  ctx: ToolContext,
): { target: string; backup: string | null } {
  const target = assertWritable(path, ctx.config);
  let backupPath: string | null = null;
  if (backup) {
    backupPath = assertWritable(`${target}.bak`, ctx.config);
    copyFileSync(target, backupPath);
  }
  writeFileSync(target, bytes);
  ctx.audit.record({ kind: "file_write", data: { path: target, backup: backupPath } });
  return { target, backup: backupPath };
}

export const readNavLaddersTool = defineTool({
  name: "read_nav_ladders",
  description:
    "Lists the ladder records in a .nav: id, width, top and bottom points, length, " +
    "direction and the four top areas plus the bottom area. This is the table that " +
    "`read_nav_areas` summarises only as ladder-connection ids; use it before " +
    "`write_nav_ladders`.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    limit: z.number().int().min(1).max(5000).default(500),
  },
  outputSchema: {
    path: z.string(),
    count: z.number(),
    returned: z.number(),
    ladders: z.array(
      z.object({
        id: z.number(),
        width: z.number(),
        top: z.tuple([z.number(), z.number(), z.number()]),
        bottom: z.tuple([z.number(), z.number(), z.number()]),
        length: z.number(),
        direction: z.number(),
        topForwardAreaId: z.number(),
        topLeftAreaId: z.number(),
        topRightAreaId: z.number(),
        topBehindAreaId: z.number(),
        bottomAreaId: z.number(),
      }),
    ),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const nav = readNavFile(readFileSync(path), path);
    return {
      path,
      count: nav.ladders.length,
      returned: Math.min(nav.ladders.length, args.limit),
      ladders: nav.ladders.slice(0, args.limit).map((ladder) => ({
        id: ladder.id,
        width: ladder.width,
        top: [ladder.top.x, ladder.top.y, ladder.top.z] as [number, number, number],
        bottom: [ladder.bottom.x, ladder.bottom.y, ladder.bottom.z] as [number, number, number],
        length: ladder.length,
        direction: ladder.direction,
        topForwardAreaId: ladder.topForwardAreaId,
        topLeftAreaId: ladder.topLeftAreaId,
        topRightAreaId: ladder.topRightAreaId,
        topBehindAreaId: ladder.topBehindAreaId,
        bottomAreaId: ladder.bottomAreaId,
      })),
    };
  },
});

const HIDING_UPDATE = z.object({
  areaId: z.number().int().describe("Area id from read_nav_areas."),
  spotId: z.number().int().describe("Hiding-spot id from read_nav_hiding_spots."),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
  flags: z
    .array(z.string())
    .optional()
    .describe("Hiding-spot flags to set, e.g. IN_COVER, GOOD_SNIPER_SPOT."),
  removeFlags: z.array(z.string()).optional(),
});

export const writeNavHidingSpotsTool = defineTool({
  name: "write_nav_hiding_spots",
  description:
    "Changes an existing hiding spot's position or flags in place. The record is 17 bytes " +
    "and stays that size, so no area, encounter or ladder offset moves. Named flags are " +
    "encoded from `HIDING_SPOT_FLAGS`; unknown bits are preserved. A backup is written and " +
    "the changed values are read back.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    updates: z.array(HIDING_UPDATE).min(1),
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    backup: BACKUP_PATH,
    updated: z.number(),
    verified: z.boolean(),
    bytes: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const nav = readNavFile(readFileSync(path), path);
    const before = nav.areas.flatMap((area) =>
      area.hidingSpotList.map((spot) => ({ areaId: area.id, spot })),
    );
    const updates = args.updates.map((update) => {
      const entry = before.find(
        (candidate) => candidate.areaId === update.areaId && candidate.spot.id === update.spotId,
      );
      if (!entry) {
        throw new Error(
          `area ${update.areaId} has no hiding spot ${update.spotId}; ` +
            `read_nav_hiding_spots lists them`,
        );
      }
      let flags: number | undefined;
      if (update.flags || update.removeFlags) {
        let value = entry.spot.flags;
        for (const name of update.flags ?? []) {
          const bit = Object.entries(HIDING_SPOT_FLAGS).find(([, n]) => n === name.toUpperCase());
          if (!bit) throw new Error(`unknown hiding-spot flag ${name}`);
          value |= Number(bit[0]);
        }
        for (const name of update.removeFlags ?? []) {
          const bit = Object.entries(HIDING_SPOT_FLAGS).find(([, n]) => n === name.toUpperCase());
          if (!bit) throw new Error(`unknown hiding-spot flag ${name}`);
          value &= ~Number(bit[0]);
        }
        flags = value & 0xff;
      }
      return {
        areaId: update.areaId,
        spotId: update.spotId,
        ...(update.x !== undefined ? { x: update.x } : {}),
        ...(update.y !== undefined ? { y: update.y } : {}),
        ...(update.z !== undefined ? { z: update.z } : {}),
        ...(flags !== undefined ? { flags } : {}),
      };
    });
    const next = patchNavHidingSpots(nav, updates);
    const written = commitNav(path, next, args.backup ?? true, ctx);
    const after = readNavFile(readFileSync(written.target), written.target);
    const verified = updates.every((update) => {
      const area = after.areas.find((candidate) => candidate.id === update.areaId);
      const spot = area?.hidingSpotList.find((candidate) => candidate.id === update.spotId);
      if (!spot) return false;
      return (
        (update.x === undefined || spot.x === update.x) &&
        (update.y === undefined || spot.y === update.y) &&
        (update.z === undefined || spot.z === update.z) &&
        (update.flags === undefined || spot.flags === update.flags)
      );
    });
    return {
      path: written.target,
      backup: written.backup,
      updated: updates.length,
      verified,
      bytes: next.length,
    };
  },
});

const LADDER_UPDATE = z.object({
  id: z.number().int().describe("Ladder id from read_nav_ladders."),
  width: z.number().optional(),
  top: VEC3.optional(),
  bottom: VEC3.optional(),
  length: z.number().optional(),
  direction: z.number().int().optional(),
  topForwardAreaId: z.number().int().optional(),
  topLeftAreaId: z.number().int().optional(),
  topRightAreaId: z.number().int().optional(),
  topBehindAreaId: z.number().int().optional(),
  bottomAreaId: z.number().int().optional(),
});

export const writeNavLaddersTool = defineTool({
  name: "write_nav_ladders",
  description:
    "Changes an existing ladder record in place: width, top/bottom points, length, direction " +
    "or the five area ids. The 60-byte record stays that size, so no area or hiding-spot " +
    "offset moves. A backup is written and every changed field is read back.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    updates: z.array(LADDER_UPDATE).min(1),
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    backup: BACKUP_PATH,
    updated: z.number(),
    verified: z.boolean(),
    bytes: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const nav = readNavFile(readFileSync(path), path);
    const next = patchNavLadders(nav, args.updates);
    const written = commitNav(path, next, args.backup ?? true, ctx);
    const after = readNavFile(readFileSync(written.target), written.target);
    const verified = args.updates.every((update) => {
      const ladder = after.ladders.find((candidate) => candidate.id === update.id);
      if (!ladder) return false;
      return (
        (update.width === undefined || ladder.width === update.width) &&
        (update.top === undefined || (ladder.top.x === update.top[0] && ladder.top.y === update.top[1] && ladder.top.z === update.top[2])) &&
        (update.bottom === undefined || (ladder.bottom.x === update.bottom[0] && ladder.bottom.y === update.bottom[1] && ladder.bottom.z === update.bottom[2])) &&
        (update.length === undefined || ladder.length === update.length) &&
        (update.direction === undefined || ladder.direction === update.direction) &&
        (update.topForwardAreaId === undefined || ladder.topForwardAreaId === update.topForwardAreaId) &&
        (update.topLeftAreaId === undefined || ladder.topLeftAreaId === update.topLeftAreaId) &&
        (update.topRightAreaId === undefined || ladder.topRightAreaId === update.topRightAreaId) &&
        (update.topBehindAreaId === undefined || ladder.topBehindAreaId === update.topBehindAreaId) &&
        (update.bottomAreaId === undefined || ladder.bottomAreaId === update.bottomAreaId)
      );
    });
    return {
      path: written.target,
      backup: written.backup,
      updated: args.updates.length,
      verified,
      bytes: next.length,
    };
  },
});

export const writeNavPlacesTool = defineTool({
  name: "write_nav_places",
  description:
    "Adds places to a .nav place table or renames existing ones without changing their ids, " +
    "so every area's place reference stays valid. The table is rebuilt and the rest of the " +
    "file shifted by the name length; no area id or record changes. Removal is refused " +
    "because it would renumber every following place. A backup is written and the table " +
    "and area count are read back.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .nav, absolute or relative to the repo root."),
    add: z.array(z.string().min(1)).optional().describe("New place names to append."),
    rename: z
      .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
      .optional()
      .describe("Rename an existing place, keeping its id."),
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    backup: BACKUP_PATH,
    placeCount: z.number(),
    added: z.number(),
    renamed: z.number(),
    verified: z.boolean(),
    bytes: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const nav = readNavFile(readFileSync(path), path);
    const beforeAreas = nav.areaCount;
    const next = patchNavPlaces(nav, {
      add: args.add,
      rename: args.rename,
    });
    const written = commitNav(path, next, args.backup ?? true, ctx);
    const after = readNavFile(readFileSync(written.target), written.target);
    const expectedPlaces = [...nav.places];
    for (const rename of args.rename ?? []) {
      const index = expectedPlaces.findIndex(
        (name) => name.toLowerCase() === rename.from.toLowerCase(),
      );
      expectedPlaces[index] = rename.to;
    }
    expectedPlaces.push(...(args.add ?? []));
    const verified =
      after.areaCount === beforeAreas &&
      after.places.length === expectedPlaces.length &&
      expectedPlaces.every((name, index) => after.places[index] === name);
    return {
      path: written.target,
      backup: written.backup,
      placeCount: after.places.length,
      added: args.add?.length ?? 0,
      renamed: args.rename?.length ?? 0,
      verified,
      bytes: next.length,
    };
  },
});

export const navWriteTools = [
  readNavLaddersTool,
  writeNavHidingSpotsTool,
  writeNavLaddersTool,
  writeNavPlacesTool,
];
