import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { captureWindow } from "../../../maps/typescript/screenshot/window.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

function pidsFor(name: string): number[] {
  const image = name.toLowerCase().endsWith(".exe") ? name : `${name}.exe`;
  try {
    const out = execFileSync(
      "tasklist",
      ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"],
      { encoding: "utf8", windowsHide: true },
    );
    return out
      .split(/\r?\n/)
      .map((line) => new RegExp(`^"${image.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}","(\\d+)"`, "i").exec(line.trim())?.[1])
      .filter((v): v is string => Boolean(v))
      .map(Number);
  } catch {
    return [];
  }
}

/**
 * The agent's eyes for a GUI: a real image block, not base64 in a text field.
 *
 * It captures one window by pid or process name. `PrintWindow` works while the window is
 * occluded, but a 3D canvas may still come out empty under a headless/non-interactive
 * desktop; the result says which window it saw, and callers must not treat a blank canvas
 * as a model that is not there.
 */
export const captureWindowTool = defineTool({
  name: "capture_window",
  description:
    "Captures one Windows window as a PNG and returns it as a real image block the agent " +
    "can see. Use it after run_hlmv, run_map_test or another GUI launch. Find the window by " +
    "process id or process name. PrintWindow captures an occluded window, so it does not " +
    "steal focus; a 3D viewport can still be blank on a headless/non-interactive desktop, " +
    "and the result warns when the image looks uniform. Guarded.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    processId: z.number().int().positive().optional().describe("Window owner process id."),
    processName: z
      .string()
      .optional()
      .describe("Executable name, e.g. hlmv or left4dead2. Exactly one instance must run."),
    out: z
      .string()
      .optional()
      .describe("PNG path. Defaults to <stateDir>/screenshots/<process>-<pid>.png."),
    waitMs: z
      .number()
      .int()
      .min(200)
      .max(30_000)
      .optional()
      .describe("How long to wait for a main window. Default 2500 ms."),
    method: z
      .enum(["window", "screen"])
      .optional()
      .describe(
        "'window' uses PrintWindow and captures an occluded window; 'screen' brings it to " +
          "the front and copies the desktop, which is the fallback when a 3D canvas is " +
          "blank. Default 'window'.",
      ),
    confirm: CONFIRM,
  },
  outputSchema: {
    processId: z.number(),
    processName: z.string(),
    path: z.string(),
    width: z.number(),
    height: z.number(),
  },
  handler: async (args, ctx) => {
    let pid = args.processId ?? null;
    let name = args.processName ?? "";
    if (pid === null && name) {
      const pids = pidsFor(name);
      if (pids.length === 0) throw new Error(`no running process matches ${name}`);
      if (pids.length > 1) {
        throw new Error(
          `${name} has ${pids.length} running instances (${pids.join(", ")}); pass processId`,
        );
      }
      pid = pids[0]!;
    }
    if (pid === null) throw new Error("pass processId or processName");
    if (!name) name = `process-${pid}`;

    const out = args.out
      ? resolveInput(args.out, ctx.config)
      : join(ctx.config.stateDir, "screenshots", `${name.replace(/[^\w.-]/g, "_")}-${pid}.png`);
    mkdirSync(dirname(out), { recursive: true });
    const shot = await captureWindow(pid, out, args.waitMs ?? 2500, args.method ?? "window");

    return {
      processId: pid,
      processName: name,
      path: shot.path,
      width: shot.width,
      height: shot.height,
      _image: {
        data: readFileSync(shot.path).toString("base64"),
        mimeType: "image/png",
      },
    };
  },
});

export const captureTools = [captureWindowTool];
