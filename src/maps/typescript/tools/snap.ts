import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { moveToSurface } from "../vmf/snap.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

export const moveToSurfaceTool = defineTool({
  name: "move_to_surface",
  description:
    "Hammer++'s Move Objects tool: drops or raises selected brushes to the first floor or " +
    "ceiling under them. The map is traced as a .vmf, without a compile; the selected " +
    "brushes are removed from the scene so a ray cannot hit the object it is moving. With " +
    "`alignToNormal` the brush is also turned about its contact point to follow a slope. A " +
    "vertical surface is reported and not rotated onto. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z.array(z.number()).min(1).describe("Hammer ids of the brushes to move."),
    direction: z
      .enum(["down", "up"])
      .describe("'down' finds the floor, 'up' the ceiling above the brush."),
    maxDistance: z
      .number()
      .positive()
      .default(1024)
      .describe("How far to search, in Hammer units."),
    alignToNormal: z
      .boolean()
      .default(false)
      .describe("Turn the brush so its up axis follows the surface normal."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    moved: z.array(
      z.object({
        id: z.number(),
        delta: z.array(z.number()),
        hit: z.array(z.number()),
        normal: z.array(z.number()).nullable(),
        rotated: z.boolean(),
      }),
    ),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = moveToSurface(before, args.solidIds, {
      direction: args.direction,
      maxDistance: args.maxDistance,
      alignToNormal: args.alignToNormal,
    });
    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      moved: result.moved,
      warnings: result.warnings,
    };
  },
});

export const snapTools = [moveToSurfaceTool];
