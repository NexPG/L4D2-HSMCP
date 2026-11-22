import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { checkVmfSolids } from "../vmf/solid.js";

/**
 * `collapse_instances` is a thin wrapper around the sidecar's `vmf_collapse`, which delegates
 * the expansion to `srctools.instancing` — the same library-backed implementation already
 * used by `read_vmf`'s `collapseInstances` option. There is no second instance expander in
 * this repository: writing one would be a duplicate of a tested library, and the fixup rules
 * are exactly where a hand-written copy goes subtly wrong.
 *
 * The sidecar writes its result to a temporary file; this tool reads it back and lets the
 * normal guarded write path handle `out`, backups and dry runs.
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
    depthLimit: z.number().nullable(),
    solidCount: z.number(),
    entityCount: z.number(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const out = args.out ? resolveInput(args.out, ctx.config) : path;
    if (out !== path && existsSync(out) && !args.overwrite && !args.dryRun) {
      throw new Error(`${out} already exists; pass overwrite:true to replace it`);
    }
    const { game, from } = gameFor(ctx.config, args.game);
    const scratch = mkdtempSync(join(tmpdir(), "hammer-collapse-"));
    const tempOut = join(scratch, "collapsed.vmf");
    try {
      const reply = (await callSidecar(
        "vmf_collapse",
        {
          path,
          out: tempOut,
          gameDir: game.gameDir ?? ctx.config.gameDir,
          recurLimit: args.maxDepth,
          ...(args.instancePath ? { instancePath: args.instancePath } : {}),
        },
        ctx.config,
        300_000,
      )) as { collapsed: number; files: string[]; depthLimit: number | null };
      const text = readFileSync(tempOut, "utf8");
      const write = writeGuarded(out, text, ctx.config, {
        dryRun: args.dryRun,
        backup: args.backup,
        unchanged: false,
      });
      const roots = parse(text).filter((node): node is KvBlock => node.kind === "block");
      const entityCount = roots.filter((block) => block.name === "entity").length;
      const solidCount = checkVmfSolids(path, text).solidCount;
      ctx.audit.record({
        kind: "file_write",
        data: { path: out, backup: write.backupPath, instances: reply.collapsed },
      });
      return {
        path,
        out,
        game: gameBlock(game, from),
        written: write.written,
        backupPath: write.backupPath,
        collapsed: reply.collapsed,
        files: reply.files,
        depthLimit: reply.depthLimit ?? null,
        solidCount,
        entityCount,
      };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
});

export const instanceCollapseTools = [collapseInstancesTool];
