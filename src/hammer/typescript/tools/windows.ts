/**
 * Closing the windows earlier calls opened.
 *
 * `run_hlmv` now closes by default, but a tool cannot repair a window a previous run left
 * behind, and a person may have asked for `close:false`. This is the cleanup primitive:
 * it lists HLMV/Hammer/game windows, closes the requested kinds and reports what is left.
 *
 * Hammer is **not** force-killed by default. It can hold an unsaved map and a modal save
 * dialog; `force` is the explicit choice to discard that, never a timeout's decision.
 */
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { CONFIRM } from "../../../core/typescript/tools/paths.js";

const KIND = z.enum(["hlmv", "hammer", "game"]);

/** Process names as `Get-Process` spells them (no `.exe`). */
const NAMES: Record<z.infer<typeof KIND>, string[]> = {
  hlmv: ["hlmv"],
  hammer: ["hammerplusplus", "hammer", "wc"],
  game: ["left4dead2"],
};

interface WindowInfo {
  pid: number;
  name: string;
  title: string;
}

function powershell(script: string): string {
  return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  }).trim();
}

function listWindows(kinds: readonly z.infer<typeof KIND>[]): WindowInfo[] {
  const names = kinds.flatMap((kind) => NAMES[kind]);
  if (names.length === 0) return [];
  const quoted = names.map((name) => `'${name}'`).join(",");
  const script =
    `$names = @(${quoted}); ` +
    `$items = @(Get-Process -Name $names -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.MainWindowHandle -ne 0 } | ` +
    `ForEach-Object { [pscustomobject]@{ pid = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle } }); ` +
    `if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress }`;
  const raw = powershell(script);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as WindowInfo | WindowInfo[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function closeWindow(info: WindowInfo, force: boolean): { closed: boolean; forced: boolean } {
  // HLMV and the game have no unsaved document. Hammer does, so it is closed through
  // WM_CLOSE and only a second explicit call with force kills it.
  if (info.name.toLowerCase().startsWith("hammer") || info.name.toLowerCase() === "wc") {
    const script =
      `$p = Get-Process -Id ${info.pid} -ErrorAction SilentlyContinue; ` +
      `if (-not $p) { 'gone' } else { ` +
      `$ok = $p.CloseMainWindow(); ` +
      `if ($p.WaitForExit(5000)) { 'closed' } ` +
      `elseif (${force ? "$true" : "$false"}) { Stop-Process -Id ${info.pid} -Force; 'forced' } ` +
      `else { 'waiting' } }`;
    const result = powershell(script);
    return { closed: result !== "waiting", forced: result === "forced" };
  }

  try {
    execFileSync("taskkill", ["/PID", String(info.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 15_000,
    });
    return { closed: true, forced: true };
  } catch {
    return { closed: false, forced: false };
  }
}

export const closeWindowsTool = defineTool({
  name: "close_windows",
  description:
    "Closes HLMV, Hammer or the game when they are no longer needed, so repeated looks do " +
    "not pile up windows. Defaults to HLMV only. `dryRun: true` lists what would close. " +
    "HLMV and the game are terminated (they hold no document); Hammer is asked to close " +
    "through its window and is only force-killed when `force: true`, because it can have an " +
    "unsaved map. A processId outside those three names is refused. Use it after a visual " +
    "check or when a previous run left a window behind; `run_hlmv` already closes by default.",
  realm: "local",
  guarded: true,
  inputSchema: {
    kinds: z.array(KIND).min(1).default(["hlmv"]),
    processId: z.number().int().positive().optional().describe("Close only this window."),
    dryRun: z.boolean().default(false).describe("List the windows without closing them."),
    force: z
      .boolean()
      .default(false)
      .describe("Force-kill Hammer when a graceful close does not finish. Discards unsaved work."),
    confirm: CONFIRM,
  },
  outputSchema: {
    dryRun: z.boolean(),
    closed: z.array(
      z.object({ pid: z.number(), name: z.string(), title: z.string(), forced: z.boolean() }),
    ),
    remaining: z.array(z.object({ pid: z.number(), name: z.string(), title: z.string() })),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const kinds = args.kinds;
    let windows = listWindows(kinds);
    if (args.processId !== undefined) {
      windows = windows.filter((window) => window.pid === args.processId);
      if (windows.length === 0) {
        throw new Error(
          `process ${args.processId} is not an HLMV/Hammer/game window. ` +
            "This tool does not close arbitrary processes.",
        );
      }
    }

    if (args.dryRun) {
      return {
        dryRun: true,
        closed: [],
        remaining: windows,
        note: "Nothing was closed; run again with dryRun: false.",
      };
    }

    const closed: Array<{ pid: number; name: string; title: string; forced: boolean }> = [];
    for (const window of windows) {
      const result = closeWindow(window, args.force);
      if (result.closed) {
        closed.push({ ...window, forced: result.forced });
        ctx.audit.record({
          kind: "process_kill",
          data: { pid: window.pid, process: window.name, forced: result.forced },
        });
      }
    }
    const remaining = listWindows(kinds);
    return {
      dryRun: false,
      closed,
      remaining,
      note:
        remaining.length === 0
          ? "No requested windows remain."
          : "Some windows are still open; Hammer may be waiting on a save dialog.",
    };
  },
});

export const windowTools = [closeWindowsTool];
