/**
 * Adding and removing nav connections.
 *
 * `write_nav_areas` edits attributes, which are fixed-width bits. Connections are
 * length-variable lists, so they need a record rewrite: this replaces only the four
 * count+id lists of each area and copies every other byte of the area record verbatim.
 *
 * A connection is directional. By default an `add`/`remove` also changes the opposite
 * direction on the target area (north↔south, east↔west), because a one-way link is often
 * a repair mistake rather than an intention. `symmetric: false` edits only the named side;
 * `set` is always exact and never mirrored.
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";
import { patchNavConnections, readNavFile } from "../formats/navfile.js";

const IDS = z.array(z.number().int().positive());
const DIRECTIONS = z.object({
  north: IDS.optional(),
  east: IDS.optional(),
  south: IDS.optional(),
  west: IDS.optional(),
});

const EDIT = z.object({
  id: z.number().int().positive().describe("Area whose connections change."),
  add: DIRECTIONS.optional().describe("Area ids to append."),
  remove: DIRECTIONS.optional().describe("Area ids to remove."),
  set: DIRECTIONS.optional().describe("Exact list to store; never mirrored."),
  symmetric: z
    .boolean()
    .default(true)
    .describe("Also change the opposite direction on the target area."),
});

export const editNavConnectionsTool = defineTool({
  name: "edit_nav_connections",
  description:
    "Adds, removes or replaces nav-mesh connections by area id, without touching any other " +
    "byte of the area record. Connections are directional and length-variable, so this " +
    "rewrites the four count+id lists and copies hiding spots, encounters, ladders, places " +
    "and L4D2 spawn/visibility data verbatim. By default an add/remove is mirrored on the " +
    "target (north↔south, east↔west); pass symmetric:false for a one-way link. Refuses a " +
    "self-link or a target that is not in the nav. Writes in place by default or to `out`, " +
    "with a .bak, and reads the result back to prove every edited list.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Path to the .nav."),
    edits: z.array(EDIT).min(1),
    out: z.string().optional().describe("Write a new file instead of changing the nav."),
    backup: z.boolean().default(true),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    backup: z.string().nullable(),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    areaCount: z.number(),
    areas: z.array(
      z.object({
        id: z.number(),
        north: z.array(z.number()),
        east: z.array(z.number()),
        south: z.array(z.number()),
        west: z.array(z.number()),
      }),
    ),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const before = readFileSync(path);
    const nav = readNavFile(before, path);
    const next = patchNavConnections(nav, args.edits);

    const out = args.out ? assertWritable(resolveInput(args.out, ctx.config), ctx.config) : assertWritable(path, ctx.config);
    let backup: string | null = null;
    if (args.out === undefined && args.backup) {
      backup = assertWritable(`${out}.bak`, ctx.config);
      copyFileSync(out, backup);
    }
    writeFileSync(out, next);
    ctx.audit.record({
      kind: "file_write",
      data: { path: out, edited: args.edits.length, backup },
    });

    const after = readNavFile(readFileSync(out), out);
    const ids = [...new Set(args.edits.map((edit) => edit.id))];
    const areas = ids.map((id) => {
      const area = after.areas.find((candidate) => candidate.id === id);
      if (!area) throw new Error(`area ${id} disappeared after the rewrite`);
      return {
        id,
        north: area.connections.north,
        east: area.connections.east,
        south: area.connections.south,
        west: area.connections.west,
      };
    });
    if (after.areaCount !== nav.areaCount) {
      throw new Error(
        `refusing to report success: ${nav.areaCount} areas before, ${after.areaCount} after`,
      );
    }
    return {
      path,
      out,
      backup,
      bytesBefore: before.length,
      bytesAfter: statSync(out).size,
      areaCount: after.areaCount,
      areas,
    };
  },
});

export const navConnectionTools = [editNavConnectionsTool];
