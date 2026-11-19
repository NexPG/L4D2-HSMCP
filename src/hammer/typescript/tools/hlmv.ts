import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameFor } from "../../../core/typescript/games/resolve.js";
import { captureWindow } from "../../../maps/typescript/screenshot/window.js";
import { GAME, CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

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
    "id. HLMV closes by default after a short look, so repeated calls do not leave windows " +
    "behind; pass close:false to leave it open, and use close_windows to clear old ones. " +
    "HLMV is a GUI, so there is no screenshot and no machine-readable result without the " +
    "screenshot option: use read_model_info for bounds, sequences and materials. Guarded.",
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
        "Close HLMV when the call is done. Defaults to true for every call, so repeated looks " +
          "cannot pile up windows; false leaves it open for a person.",
      ),
    game: GAME,
    confirm: CONFIRM,
  },
  outputSchema: {
    model: z.string(),
    /** True when the file is loose on disk; false when HLMV must resolve it from a VPK. */
    loose: z.boolean(),
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

    const relative = `models/${model.replace(/^\/+/, "")}`;
    // Stock models live in the game's VPKs, not on disk. HLMV resolves them through
    // VPROJECT; refusing every non-loose path made the model preview unusable for exactly
    // the assets a mapper wants to look at. A genuinely missing custom model still shows
    // as HLMV's error window, which the capture preserves.
    const loose = existsSync(path);
    const child = spawn(exe, [loose ? path : relative], {
      cwd: gameDir,
      env: { ...process.env, VPROJECT: gameDir },
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    const processId = child.pid ?? null;
    const close = args.close ?? true;
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
      // Without a screenshot there is nothing to capture, but a person may still be
      // looking at the window. Give it a moment, then close; `close:false` is the
      // explicit "leave it open" path.
      if (close && !args.screenshot) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
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
      model: loose ? path : relative,
      loose,
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
