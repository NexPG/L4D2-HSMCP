import { readFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../fs/guard.js";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { insertPrefab } from "../vmf/prefab.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "./paths.js";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const insertPrefabTool = defineTool({
  name: "insert_prefab",
  description:
    "Pastes a saved Hammer prefab -- a `.vmf` fragment -- into a map. World brushes and " +
    "root entities are inserted, every solid/entity id is remapped to a free one, and the " +
    "fragment can be moved by an offset. A prefab is a one-time paste, unlike func_instance; " +
    "brush-entity solids are inserted but the move is not applied inside them, and the tool " +
    "says so. Every inserted world brush is checked as a solid before the write. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Target .vmf."),
    prefab: z.string().describe("Prefab .vmf to paste."),
    move: Vec3.optional().describe("Offset for the pasted fragment. Default 0 0 0."),
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
    };
  },
});

export const prefabTools = [insertPrefabTool];
