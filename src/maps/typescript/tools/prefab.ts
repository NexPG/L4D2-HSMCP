import { readFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { insertPrefab } from "../vmf/prefab.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const insertPrefabTool = defineTool({
  name: "insert_prefab",
  description:
    "Pastes a saved Hammer prefab -- a `.vmf` fragment -- into a map. Every world brush and " +
    "brush-entity solid plus every root entity is inserted, all ids are remapped to free " +
    "ones, and the whole fragment can be moved and yaw-rotated about a pivot. Point " +
    "entities have their origin and yaw turned with the geometry, not left behind. A prefab " +
    "is a one-time paste, unlike func_instance; a nested func_instance is inserted but not " +
    "expanded, and the tool says so. Every inserted brush is checked as a solid before the " +
    "write. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Target .vmf."),
    prefab: z.string().describe("Prefab .vmf to paste."),
    move: Vec3.optional().describe("Offset for the pasted fragment. Default 0 0 0."),
    rotate: z
      .number()
      .optional()
      .describe("Yaw rotation in degrees about Z through `pivot`. Default 0."),
    pivot: Vec3.optional().describe("Point the rotation turns around. Default 0 0 0."),
    namePrefix: z
      .string()
      .optional()
      .describe(
        "Prefix every inserted targetname and the prefab's own output targets, so placing " +
          "the same house twice does not produce two `door_button` entities.",
      ),
    remap: z
      .record(z.string())
      .optional()
      .describe("Explicit old targetname -> new targetname, applied before namePrefix."),
    validate: z
      .boolean()
      .optional()
      .describe(
        "Check duplicate targetnames and unresolved outputs after the paste (default true).",
      ),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    prefab: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    solids: z.number(),
    entities: z.number(),
    newSolidIds: z.array(z.number()),
    warnings: z.array(z.string()),
    solidsBefore: z.number(),
    solidsAfter: z.number(),
    targetnames: z.array(z.string()),
    duplicates: z.array(z.object({ name: z.string(), count: z.number() })),
    unresolvedOutputs: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const prefabPath = resolveVmfInput(args.prefab, ctx.config);
    assertWritable(path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = insertPrefab(
      before,
      readFileSync(prefabPath, "utf8"),
      (args.move ?? [0, 0, 0]) as [number, number, number],
      {
        ...(args.rotate !== undefined ? { rotate: args.rotate } : {}),
        ...(args.pivot !== undefined ? { pivot: args.pivot as [number, number, number] } : {}),
        ...(args.namePrefix !== undefined ? { namePrefix: args.namePrefix } : {}),
        ...(args.remap !== undefined ? { remap: args.remap } : {}),
        ...(args.validate !== undefined ? { validate: args.validate } : {}),
      },
    );

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    const after = result.unchanged ? before : result.text;
    const solidsBefore = before.match(/\bsolid\s*\{/g)?.length ?? 0;
    const solidsAfter = after.match(/\bsolid\s*\{/g)?.length ?? 0;

    return {
      path,
      prefab: prefabPath,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      solids: result.solids,
      entities: result.entities,
      newSolidIds: result.newSolidIds,
      warnings: result.warnings,
      solidsBefore,
      solidsAfter,
      targetnames: result.targetnames,
      duplicates: result.duplicates,
      unresolvedOutputs: result.unresolvedOutputs,
    };
  },
});

export const prefabTools = [insertPrefabTool];
