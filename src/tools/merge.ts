import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { mergeSolids } from "../vmf/merge.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "./paths.js";

export const mergeSolidsTool = defineTool({
  name: "merge_solids",
  description:
    "Hammer's merge tool: replaces two or more selected convex brushes with the one convex " +
    "brush around them. Refuses unless the union really is convex and its volume equals the " +
    "selected brushes together, so a hollow or an overlap is not silently filled. Each hull " +
    "face copies its material, texture axes, lightmap scale and smoothing groups from the " +
    "original face on the same plane. Brushes must share one owner: the world or one brush " +
    "entity. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z
      .array(z.number())
      .min(2)
      .describe("Hammer ids of the brushes to merge, from read_vmf_solids or read_vmf."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    mergedId: z.number(),
    sourceIds: z.array(z.number()),
    volume: z.number(),
    facesCopied: z.number(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = mergeSolids(before, args.solidIds);
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
      mergedId: result.mergedId,
      sourceIds: result.sourceIds,
      volume: result.volume,
      facesCopied: result.facesCopied,
      warnings: result.warnings,
    };
  },
});

export const mergeTools = [mergeSolidsTool];
