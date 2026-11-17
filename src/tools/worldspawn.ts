import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { editWorldspawn } from "../vmf/portals.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "./paths.js";

/**
 * The primitive under `set_map_properties`.
 *
 * `worldspawn` is the map's root entity but it is not an `entity` block, so `edit_vmf`
 * cannot address it. A fixed list of four keys is a menu, not a capability: whatever a
 * mapper can type into worldspawn's keyvalue list, an agent must be able to write too.
 */
export const setWorldspawnTool = defineTool({
  name: "set_worldspawn",
  description:
    "Sets or removes ANY keyvalue on worldspawn: sky, mapversion, message, detail sprites, " +
    "custom keys, whatever the engine or a mod reads. worldspawn is not an `entity` block, " +
    "so edit_vmf cannot reach it and set_map_properties only covers four common keys; this " +
    "is the general tool. Only `id` and `classname` are protected because they are the " +
    "block's identity. Reports each key's old and new value, and refuses a change that " +
    "alters the brush count. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    set: z
      .record(z.string())
      .optional()
      .describe("Keyvalues to set. A key already there is replaced; a new one is added."),
    remove: z.array(z.string()).optional().describe("Keys to remove."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    changed: z.record(
      z.string(),
      z.object({ from: z.string().nullable(), to: z.string() }),
    ),
    removed: z.array(z.string()),
    warnings: z.array(z.string()),
    solidsBefore: z.number(),
    solidsAfter: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = editWorldspawn(before, args.set ?? {}, args.remove ?? []);

    const b = checkVmfSolids(path, before);
    const a = checkVmfSolids(path, result.text);
    if (a.solidCount !== b.solidCount) {
      throw new Error(
        `refusing to write: worldspawn keys changed the brush count from ${b.solidCount} ` +
          `to ${a.solidCount}`,
      );
    }

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
      changed: result.changed,
      removed: result.removed,
      warnings: result.warnings,
      solidsBefore: b.solidCount,
      solidsAfter: a.solidCount,
    };
  },
});

export const worldspawnTools = [setWorldspawnTool];
