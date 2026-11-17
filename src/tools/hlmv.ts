import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { gameFor } from "../games/resolve.js";
import { GAME, CONFIRM, resolveInput } from "./paths.js";

/**
 * HLMV is a GUI: this launches it on a real model and returns. It does not wait, screenshot
 * or pretend to see the viewport. The agent can ask a person to look, and `read_model_info`
 * remains the machine-readable answer for bounds, sequences and materials.
 */
export const runHlmvTool = defineTool({
  name: "run_hlmv",
  description:
    "Launches the game's HLMV on one compiled model, for a person to inspect. The model is " +
    "resolved against the game's models/ tree and must exist; the tool returns the process " +
    "id immediately and does not wait for the window to close. HLMV is a GUI, so there is " +
    "no screenshot and no machine-readable result: use read_model_info for bounds, " +
    "sequences and materials. Guarded.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    model: z
      .string()
      .describe("Model path or name. The models/ prefix and .mdl suffix are added if missing."),
    game: GAME,
    confirm: CONFIRM,
  },
  outputSchema: {
    model: z.string(),
    exe: z.string(),
    launched: z.boolean(),
    processId: z.number().nullable(),
  },
  handler: (args, ctx) => {
    const { game: profile } = gameFor(ctx.config, args.game);
    const gameDir = profile.gameDir ?? ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const binDir = profile.binDir ?? join(dirname(gameDir), "bin");
    const exe = join(binDir, "hlmv.exe");
    if (!existsSync(exe)) {
      throw new Error(
        `${exe} does not exist. Install the Left 4 Dead 2 Authoring Tools (Steam app 563).`,
      );
    }

    let model = args.model.replace(/\\/g, "/").replace(/^models\//i, "");
    if (!model.toLowerCase().endsWith(".mdl")) model += ".mdl";
    const path = isAbsolute(model)
      ? model
      : join(gameDir, "models", model.replace(/^\/+/, ""));
    if (!existsSync(path)) {
      throw new Error(
        `${path} does not exist. Compile the QC with run_studiomdl first, or check the ` +
          `model name with read_game_content(kind: "model").`,
      );
    }

    const child = spawn(exe, ["-game", gameDir, path], {
      cwd: dirname(exe),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();

    return {
      model: path,
      exe,
      launched: child.pid !== undefined,
      processId: child.pid ?? null,
    };
  },
});

export const hlmvTools = [runHlmvTool];
