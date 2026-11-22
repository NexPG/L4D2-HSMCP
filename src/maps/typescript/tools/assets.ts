/**
 * `check_assets`: a source `.vmf`'s asset references, resolved against the game's mount
 * chain before a compile.
 *
 * The other half of `map_dependencies`, which reads a compiled BSP. Both go through the
 * sidecar's `Resolver`, `_walk_material` and `_walk_model`, so "missing" means the same
 * thing on both sides: not in any mounted VPK, not loose in the game tree.
 */
import { z } from "zod";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import {
  GAME,
  GAME_BLOCK,
  resolveVmfInput,
} from "../../../core/typescript/tools/paths.js";

export const checkAssetsTool = defineTool({
  name: "check_assets",
  description:
    "Checks a source .vmf's references against the game's mounted content before compiling: " +
    "solid materials (following `patch`/`include` and their textures), `prop_*` models " +
    "(with `.vvd`/`.dx90.vtx` and the model's own materials), decals and overlays, sounds " +
    "with an audio extension, `info_particle_system` effects, `logic_script` VScripts and the " +
    "worldspawn skybox's six materials. Reports `game-vpk` and `game-loose` separately: a " +
    "loose file resolves at home and is a checkerboard for everyone else. Read-only. Needs " +
    "the sidecar and a game directory to answer; without a mount it says so rather than " +
    "reporting everything missing.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe("Maximum missing entries to return. Default 200."),
    collapseInstances: z
      .boolean()
      .optional()
      .describe("Expand `func_instance` first, so an instance's own assets are checked."),
    game: GAME,
  },
  outputSchema: {
    path: z.string(),
    game: GAME_BLOCK,
    collapsed: z.number(),
    gameMounted: z.boolean(),
    gameError: z.string().nullable(),
    materialCount: z.number(),
    modelCount: z.number(),
    soundCount: z.number(),
    particleCount: z.number(),
    scriptCount: z.number(),
    skyCount: z.number(),
    checked: z.number(),
    resolved: z.number(),
    bySource: z.record(z.number()),
    missing: z.array(
      z.object({
        path: z.string(),
        kind: z.string(),
        referencedBy: z.string(),
      }),
    ),
    missingCount: z.number(),
    missingTruncated: z.boolean(),
    optionalAbsent: z.array(z.string()),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const { game, from } = gameFor(ctx.config, args.game);
    const reply = await callSidecar(
      "check_assets",
      {
        path,
        gameDir: game.gameDir ?? ctx.config.gameDir,
        limit: args.limit ?? 200,
        collapseInstances: args.collapseInstances ?? false,
      },
      ctx.config,
      120_000,
    );
    return { ...(reply as Record<string, unknown>), game: gameBlock(game, from) };
  },
});

export const assetCheckTools = [checkAssetsTool];
