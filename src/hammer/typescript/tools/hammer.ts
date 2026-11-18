import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { gameExecutable, sleep } from "../../../scripts/typescript/game/launch.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { captureWindow } from "../../../maps/typescript/screenshot/window.js";
import { CONFIRM, resolveInput, resolveVmfInput } from "../../../core/typescript/tools/paths.js";

/**
 * Opens a VMF in Hammer++ and, optionally, captures the editor window.
 *
 * This is the one editor feature a file-level writer cannot reproduce: the viewport. It
 * does not drive the UI; it gives the agent (and the person at the desktop) a real picture
 * of the map as the editor loaded it, which is what the visual previews are for.
 */
export const openInHammerTool = defineTool({
  name: "open_in_hammer",
  description:
    "Launches Hammer++ on a .vmf and optionally captures its window as an image block. This " +
    "is for the editor's visual half — the 3D viewport, lighting preview, fog, sky, " +
    "particles, ropes and gizmos — which are mouse/editor features no file writer can " +
    "render. The tool does not drive the UI; it opens the map, waits for it to load, " +
    "captures the window with `method: 'screen'` (a 3D canvas needs the desktop), and closes " +
    "the editor again unless `close: false`. Use `render_vmf_view` for a deterministic " +
    "offline picture and `run_map_test` for the real game; use this when the editor's own " +
    "lighting or preview state is the question. Guarded and local.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    vmf: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    waitMs: z
      .number()
      .int()
      .min(1000)
      .max(120_000)
      .default(20_000)
      .describe(
        "How long to let the editor load the map before capture. A large VMF or a recovery " +
          "dialog can take 20–30 s.",
      ),
    screenshot: z.boolean().default(true),
    out: z
      .string()
      .optional()
      .describe("Screenshot path. Defaults to <stateDir>/screenshots/hammer-<time>.png."),
    method: z
      .enum(["screen", "window"])
      .default("screen")
      .describe("'screen' captures the 3D canvas; 'window' captures UI even when occluded."),
    close: z
      .boolean()
      .default(true)
      .describe("Close Hammer++ after the capture. Pass false to leave it open for a person."),
    confirm: CONFIRM,
  },
  outputSchema: {
    vmf: z.string(),
    editor: z.string(),
    pid: z.number(),
    waitedMs: z.number(),
    closed: z.boolean(),
    screenshotPath: z.string().nullable(),
    screenshotWidth: z.number().nullable(),
    screenshotHeight: z.number().nullable(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const vmf = resolveVmfInput(args.vmf, ctx.config);
    if (!existsSync(vmf)) throw new Error(`${vmf} does not exist`);
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const editor = join(dirname(gameExecutable(gameDir)), "bin", "hammerplusplus.exe");
    if (!existsSync(editor)) throw new Error(`Hammer++ is not at ${editor}; run health`);

    const child = spawn(editor, [vmf], {
      cwd: dirname(editor),
      stdio: "ignore",
      windowsHide: false,
      // `unref` is not enough on Windows: without `detached` the child is still in the
      // parent's job and dies when the short-lived MCP process exits. A `close:false`
      // launch is meant to leave the editor open for the next tool call.
      detached: !args.close,
    });
    const pid = child.pid;
    if (pid === undefined) throw new Error("Hammer++ started without a process id");
    // Leaving the editor open must not keep the MCP server's own process alive: a stdio
    // session would hang after the tool result. `unref` lets Node exit; the editor keeps
    // running for a person or for hammer_live_edit.
    if (!args.close) child.unref();

    await sleep(args.waitMs);
    let screenshotPath: string | null = null;
    let screenshotWidth: number | null = null;
    let screenshotHeight: number | null = null;
    let image: { data: string; mimeType: string } | null = null;
    if (args.screenshot) {
      try {
        const out = args.out
          ? resolveInput(args.out, ctx.config)
          : join(
              ctx.config.stateDir,
              "screenshots",
              `hammer-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
            );
        mkdirSync(dirname(out), { recursive: true });
        const captured = await captureWindow(pid, out, 5000, args.method);
        screenshotPath = captured.path;
        screenshotWidth = captured.width;
        screenshotHeight = captured.height;
        image = {
          data: readFileSync(captured.path).toString("base64"),
          mimeType: "image/png",
        };
      } catch (error) {
        // A capture failure is not a launch failure: the editor may still be loading, or
        // the desktop may be locked. Report it rather than pretending the tool did nothing.
        screenshotPath = null;
        screenshotWidth = null;
        screenshotHeight = null;
        ctx.audit.record({
          kind: "hammer_capture_failed",
          data: { vmf, message: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    let closed = false;
    if (args.close) {
      try {
        // Close the main window first: Hammer++ records a clean shutdown, and a forced
        // taskkill sets the "did not shut down correctly" recovery flag, which makes the
        // next launch open a modal recovery prompt instead of the map.
        execFileSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `$p = Get-Process -Id ${pid} -ErrorAction Stop; ` +
              `if (-not $p.CloseMainWindow()) { exit 1 }; ` +
              `if (-not $p.WaitForExit(5000)) { Stop-Process -Id ${pid} -Force }`,
          ],
          { stdio: "ignore", windowsHide: true, timeout: 15_000 },
        );
        closed = true;
      } catch {
        try {
          execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
          closed = true;
        } catch {
          // The editor already exited, or the process tree is gone.
        }
      }
      await sleep(800);
    }

    return {
      vmf,
      editor,
      pid,
      waitedMs: args.waitMs,
      closed,
      screenshotPath,
      screenshotWidth,
      screenshotHeight,
      note:
        screenshotPath === null
          ? "Hammer++ was opened, but the window could not be captured. Increase waitMs, " +
            "unlock the desktop, or use `method: 'window'` for the UI."
          : "The capture shows the editor's own viewport. Lighting/fog/sky previews are " +
            "editor state; `run_map_test` is the in-game oracle.",
      ...(image ? { _image: image } : {}),
    };
  },
});

export const hammerTools = [openInHammerTool];
