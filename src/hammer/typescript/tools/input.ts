/**
 * Synthetic keyboard input for a real game window.
 *
 * `SendKeys` goes through the foreground window's message queue; a Source game reads raw
 * input and often ignores it, especially in a borderless window. This tool focuses the window
 * with `SetForegroundWindow` (attaching the input thread when Windows refuses), then sends
 * virtual-key down/up events with `keybd_event`. It reports whether the window actually became
 * foreground, because a silent "sent" is the failure mode this replaces.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { processIds, windowPids } from "../../../core/typescript/process/windows.js";
import { CONFIRM } from "../../../core/typescript/tools/paths.js";

const run = promisify(execFile);

function script(): string {
  return `
param([int]$ProcessId, [string]$Keys, [int]$Repeat, [int]$IntervalMs, [int]$WaitMs, [string]$Focus)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HsmcpInput {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fUnknown);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
}
"@
$p = Get-Process -Id $ProcessId -ErrorAction Stop
$h = $p.MainWindowHandle
if ($h -eq 0) { throw "process $ProcessId has no main window" }
[void][HsmcpInput]::ShowWindow($h, 9)
[void][HsmcpInput]::BringWindowToTop($h)
[void][HsmcpInput]::SwitchToThisWindow($h, $true)
Start-Sleep -Milliseconds 200
if ($Focus -eq '1' -or $Focus -eq 'true' -or $Focus -eq 'True') {
  [void][HsmcpInput]::SetForegroundWindow($h)
  $fg = [HsmcpInput]::GetForegroundWindow()
  if ($fg -ne $h) {
    $targetPid = 0
    $targetThread = [HsmcpInput]::GetWindowThreadProcessId($h, [ref]$targetPid)
    $current = [HsmcpInput]::GetCurrentThreadId()
    [void][HsmcpInput]::AttachThreadInput($current, $targetThread, $true)
    [void][HsmcpInput]::SetForegroundWindow($h)
    [void][HsmcpInput]::SetFocus($h)
    [void][HsmcpInput]::AttachThreadInput($current, $targetThread, $false)
  }
}
Start-Sleep -Milliseconds $WaitMs
for ($i = 0; $i -lt $Repeat; $i++) {
  foreach ($ch in $Keys.ToCharArray()) {
    $scan = [HsmcpInput]::VkKeyScan($ch)
    if ($scan -eq -1) { continue }
    $vk = [byte]($scan -band 0xff)
    [HsmcpInput]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [HsmcpInput]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds $IntervalMs
  }
}
$fg = [HsmcpInput]::GetForegroundWindow()
@{ processId = $ProcessId; title = $p.MainWindowTitle; hwnd = $h.ToInt64(); foreground = $fg.ToInt64(); focused = ($fg -eq $h); keys = $Keys; repeat = $Repeat } | ConvertTo-Json -Compress
`;
}

export const runInputTool = defineTool({
  name: "run_input",
  description:
    "Sends a short key sequence to a running window, for interactions a console command cannot " +
    "express (the `E` pickup, a menu key). Focuses the window with SetForegroundWindow and " +
    "AttachThreadInput, sends virtual-key down/up with keybd_event, and reports whether the " +
    "window actually became foreground. `process` is a process name such as left4dead2; " +
    "`processId` pins one window. Guarded.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    process: z.string().min(1).default("left4dead2").describe("Process name, no .exe."),
    processId: z.number().int().positive().optional().describe("Pin a specific process."),
    keys: z
      .string()
      .min(1)
      .default("e")
      .describe("Characters to press, for example `e`, `1`, `wasd`. Named keys are not mapped yet."),
    repeat: z.number().int().min(1).max(50).default(1),
    intervalMs: z.number().int().min(10).max(5000).default(200),
    waitMs: z
      .number()
      .int()
      .min(0)
      .max(5000)
      .default(500)
      .describe("Wait after focusing, before the first key."),
    focus: z.boolean().default(true).describe("Bring the window to the foreground first."),
    confirm: CONFIRM,
  },
  outputSchema: {
    processId: z.number(),
    windowTitle: z.string(),
    hwnd: z.number(),
    foreground: z.number(),
    focused: z.boolean(),
    keys: z.string(),
    repeat: z.number(),
    stdout: z.string(),
  },
  handler: async (args, ctx) => {
    void ctx;
    let pid = args.processId;
    if (pid === undefined) {
      const candidates = windowPids([args.process]);
      pid = candidates[0] ?? processIds([args.process])[0];
    }
    if (pid === undefined) throw new Error(`no running process named ${args.process}`);
    const dir = mkdtempSync(join(tmpdir(), "hsmcp-input-"));
    const path = join(dir, "input.ps1");
    writeFileSync(path, script(), "utf8");
    try {
      const { stdout } = await run(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path,
          "-ProcessId",
          String(pid),
          "-Keys",
          args.keys,
          "-Repeat",
          String(args.repeat ?? 1),
          "-IntervalMs",
          String(args.intervalMs ?? 200),
          "-WaitMs",
          String(args.waitMs ?? 500),
          "-Focus",
          args.focus === false ? "0" : "1",
        ],
        { timeout: 30_000, windowsHide: true },
      );
      const last = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? "{}";
      const result = JSON.parse(last) as {
        processId: number;
        title: string;
        hwnd: number;
        foreground: number;
        focused: boolean;
        keys: string;
        repeat: number;
      };
      return { ...result, windowTitle: result.title, stdout: stdout.trim() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

export const inputTools = [runInputTool];
