import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import {
  BACKUP,
  BACKUP_PATH,
  CONFIRM,
  DRY_RUN,
  GAME,
  GAME_BLOCK,
  resolveInput,
  resolveVmfInput,
} from "../../../core/typescript/tools/paths.js";
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import { collapseInstances, VmfCollapseError } from "../vmf/collapse.js";
import { checkVmfSolids } from "../vmf/solid.js";

export const collapseInstancesTool = defineTool({
  name: "collapse_instances",
  description:
    "Expands every `func_instance` the way vbsp does and writes an ordinary VMF: world " +
    "brushes and entities are inserted with fresh ids, rotated and translated by the " +
    "instance's origin/angles, and renamed by its fixup style (prefix, postfix or none). " +
    "Nested instances are expanded recursively, with cycle and depth checks. Outputs whose " +
    "target is a classname or `!self`/`@` are left alone; a `func_instance_io_proxy` is " +
    "removed with a warning because its input/output bridge is not reconstructed. Guarded, " +
    "with an optional backup and dry run.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Map .vmf to collapse."),
    out: z
      .string()
      .optional()
      .describe("Output .vmf. Default: rewrite `path` in place."),
    instancePath: z
      .string()
      .optional()
      .describe(
        "Directory instances resolve from when they are not beside the map. Default: the " +
          "game's `InstancePath` from gameinfo.txt.",
      ),
    maxDepth: z.number().int().min(1).max(100).default(20),
    overwrite: z.boolean().default(false).describe("Allow replacing an existing different `out`."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
    game: GAME,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    game: GAME_BLOCK,
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    collapsed: z.number(),
    files: z.array(z.string()),
    solidCount: z.number(),
    entityCount: z.number(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const out = args.out ? resolveInput(args.out, ctx.config) : path;
    if (out !== path && existsSync(out) && !args.overwrite && !args.dryRun) {
      throw new Error(`${out} already exists; pass overwrite:true to replace it`);
    }
    const { game, from } = gameFor(ctx.config, args.game);
    const declared = args.instancePath ?? game.instancePath ?? null;
    const instancePath =
      declared === null
        ? null
        : isAbsolute(declared)
          ? declared
          : game.gameDir
            ? join(game.gameDir, declared.replace(/\\/g, "/"))
            : resolve(declared);

    const before = readFileSync(path, "utf8");
    let result;
    try {
      result = collapseInstances(before, path, {
        instancePath,
        maxDepth: args.maxDepth,
      });
    } catch (error) {
      if (error instanceof VmfCollapseError) throw error;
      throw error;
    }
    const roots = parse(result.text).filter((node): node is KvBlock => node.kind === "block");
    const entityCount = roots.filter((block) => block.name === "entity").length;
    const solidCount = checkVmfSolids(path, result.text).solidCount;
    const write = writeGuarded(out, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.text === before,
    });
    ctx.audit.record({
      kind: "file_write",
      data: { path: out, backup: write.backupPath, instances: result.collapsed },
    });
    return {
      path,
      out,
      game: gameBlock(game, from),
      written: write.written,
      backupPath: write.backupPath,
      collapsed: result.collapsed,
      files: result.files,
      solidCount,
      entityCount,
      warnings: result.warnings,
    };
  },
});

export const instanceCollapseTools = [collapseInstancesTool];
