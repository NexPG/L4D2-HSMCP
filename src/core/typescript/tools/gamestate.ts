/**
 * What a run leaves behind in the game install, and the one command that puts it back.
 *
 * The incident this exists for: a killed map test left a backup and a modified config, and
 * the next launch read them. `health` says whether the toolchain is installed; this says
 * whether the install is in a state a player would recognise.
 */
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { CONFIRM } from "./paths.js";
import { restoreGameState, scanGameState } from "../../../scripts/typescript/game/state.js";

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  path: z.string(),
});

export const checkGameStateTool = defineTool({
  name: "check_game_state",
  description:
    "Reports leftovers from a game run: `*.hsmcp-backup` in cfg/maps/scripts, a " +
    "`listenserver.cfg` with content (or one that is missing), hidden `*.vpk.off` add-ons, " +
    "and test maps/scripts/add-ons " +
    "with the `hmcp_`/`hsmcp_` prefix. Read-only by default. `restore: true` restores the " +
    "backups and hidden archives (the same sweep `run_map_test` runs before a launch), but " +
    "does not delete test maps or a file it has no backup for. Use it after any interrupted " +
    "run, before blaming the game for not loading.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    restore: z
      .boolean()
      .default(false)
      .describe("Restore backups and hidden archives after reporting. Requires confirm."),
    confirm: CONFIRM,
  },
  outputSchema: {
    gameDir: z.string(),
    clean: z.boolean(),
    listenserverPath: z.string(),
    listenserverBlank: z.boolean(),
    backups: z.array(z.string()),
    hiddenArchives: z.array(z.string()),
    testMaps: z.array(z.string()),
    testScripts: z.array(z.string()),
    testAddons: z.array(z.string()),
    findings: z.array(FINDING),
    restorable: z.number(),
    restored: z.number(),
  },
  handler: (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    if (args.restore && !args.confirm) {
      throw new Error("restore changes the game install; pass confirm:true");
    }
    const restored = args.restore ? restoreGameState(gameDir) : 0;
    if (restored > 0) {
      ctx.audit.record({ kind: "file_write", data: { path: gameDir, restored } });
    }
    const report = scanGameState(gameDir);
    return {
      ...report,
      restored,
    };
  },
});

export const gameStateTools = [checkGameStateTool];
