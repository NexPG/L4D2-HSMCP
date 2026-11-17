import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { gameFor } from "../games/resolve.js";
import { captureWindow } from "../screenshot/window.js";
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
    screenshot: z
      .boolean()
      .optional()
      .describe(
        "Capture the HLMV window as a PNG and return it as a real image block. Needs an " +
          "interactive desktop; the window is brought to the foreground.",
      ),
    out: z
      .string()
      .optional()
      .describe("Screenshot path. Defaults to <stateDir>/screenshots/<model>.png."),
    waitMs: z
      .number()
      .int()
      .min(200)
      .max(30_000)
      .optional()
      .describe("How long HLMV gets to open the model before capture. Default 2500 ms."),
    method: z
      .enum(["window", "screen"])
      .optional()
      .describe(
        "'window' captures the HLMV window with PrintWindow, even when occluded; 'screen' " +
          "brings it forward and copies the desktop, which can be needed for a 3D canvas. " +
          "Default 'window'.",
      ),
    close: z
      .boolean()
      .optional()
      .describe(
        "Close HLMV after the screenshot. Defaults to true when screenshot is set, so the " +
          "agent's view does not leave a window behind; false leaves it for a person.",
      ),
    game: GAME,
    confirm: CONFIRM,
  },
  outputSchema: {
    model: z.string(),
    exe: z.string(),
    launched: z.boolean(),
    processId: z.number().nullable(),
    screenshotPath: z.string().nullable(),
    screenshotWidth: z.number().nullable(),
    screenshotHeight: z.number().nullable(),
    closed: z.boolean(),
  },
  handler: async (args, ctx) => {
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

    const relative = `models/${model.replace(/^\/+/, "")}`;
    const child = spawn(exe, [relative], {
      cwd: gameDir,
      env: { ...process.env, VPROJECT: gameDir },
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    const processId = child.pid ?? null;
    const close = args.close ?? args.screenshot === true;
    let screenshotPath: string | null = null;
    let screenshotWidth: number | null = null;
    let screenshotHeight: number | null = null;
    let image: { data: string; mimeType: string } | null = null;
    let closed = false;

    try {
      if (args.screenshot) {
        if (processId === null) throw new Error("HLMV did not return a process id");
        const out = args.out
          ? resolveInput(args.out, ctx.config)
          : join(ctx.config.stateDir, "screenshots", `${basename(model, ".mdl")}.png`);
        mkdirSync(dirname(out), { recursive: true });
        const captured = await captureWindow(
          processId,
          out,
          args.waitMs ?? 2500,
          args.method ?? "window",
        );
        screenshotPath = captured.path;
        screenshotWidth = captured.width;
        screenshotHeight = captured.height;
        image = {
          data: readFileSync(captured.path).toString("base64"),
          mimeType: "image/png",
        };
      }
    } finally {
      if (close && processId !== null) {
        try {
          spawn("taskkill", ["/PID", String(processId), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
          closed = true;
        } catch {
          // HLMV may have been closed already.
        }
      }
    }

    return {
      model: path,
      exe,
      launched: processId !== null,
      processId,
      screenshotPath,
      screenshotWidth,
      screenshotHeight,
      closed,
      ...(image ? { _image: image } : {}),
    };
  },
});

export const hlmvTools = [runHlmvTool];
