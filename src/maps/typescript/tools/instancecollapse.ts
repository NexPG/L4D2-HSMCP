import { z } from "zod";
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
import { runSidecarVmf } from "./sidecarvmf.js";

/**
 * `collapse_instances` is a thin wrapper around the sidecar's `vmf_collapse`, which delegates
 * the expansion to `srctools.instancing` — the same library-backed implementation already
 * used by `read_vmf`'s `collapseInstances` option. There is no second instance expander in
 * this repository: writing one would be a duplicate of a tested library, and the fixup rules
 * are exactly where a hand-written copy goes subtly wrong.
 *
 * The scratch file, the guarded write and the counts come from `runSidecarVmf`; this tool
 * only supplies the verb, the game directory and the depth limit.
 */
export const collapseInstancesTool = defineTool({
  name: "collapse_instances",
  description:
    "Expands every `func_instance` the way vbsp does and writes an ordinary VMF. The " +
    "expansion is delegated to the Python sidecar's `vmf_collapse` (srctools.instancing): " +
    "fresh ids, full origin/angles transform, prefix/postfix/none name fixup, nested " +
    "instances, cycle and depth checks. Requires the sidecar; see health. Guarded, with an " +
    "optional backup and dry run.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Map .vmf to collapse."),
    out: z.string().optional().describe("Output .vmf. Default: rewrite `path` in place."),
    instancePath: z
      .string()
      .optional()
      .describe(
        "Directory instances resolve from when they are not beside the map. Default: the " +
          "game's `InstancePath` from gameinfo.txt.",
      ),
    maxDepth: z.number().int().min(1).max(100).default(16),
    overwrite: z
      .boolean()
      .optional()
      .describe("Allow replacing an existing different `out`."),
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
    depthLimit: z.number().nullable(),
    solidCount: z.number(),
    entityCount: z.number(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const out = args.out ? resolveInput(args.out, ctx.config) : path;
    const { game, from } = gameFor(ctx.config, args.game);
    const run = await runSidecarVmf<{
      collapsed: number;
      files: string[];
      depthLimit: number | null;
    }>({
      config: ctx.config,
      verb: "vmf_collapse",
      path,
      out,
      overwrite: args.overwrite ?? false,
      dryRun: args.dryRun,
      backup: args.backup,
      label: "collapse",
      params: {
        gameDir: game.gameDir ?? ctx.config.gameDir,
        recurLimit: args.maxDepth,
        ...(args.instancePath ? { instancePath: args.instancePath } : {}),
      },
    });
    ctx.audit.record({
      kind: "file_write",
      data: { path: out, backup: run.write.backupPath, instances: run.reply.collapsed },
    });
    return {
      path,
      out,
      game: gameBlock(game, from),
      written: run.write.written,
      backupPath: run.write.backupPath,
      collapsed: run.reply.collapsed,
      files: run.reply.files,
      depthLimit: run.reply.depthLimit ?? null,
      solidCount: run.solidCount,
      entityCount: run.entityCount,
    };
  },
});

export const instanceCollapseTools = [collapseInstancesTool];
