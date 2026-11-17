import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Captures one window by process id.
 *
 * `PrintWindow` is used instead of `CopyFromScreen`: it captures the named window even when
 * another window is in front, and it does not depend on focus. That matters for HLMV, whose
 * 3D window is often behind an editor. Some 3D renderers still give an empty canvas under
 * `PrintWindow`; the UI (title, menus, tabs) is captured, and `read_model_info` remains the
 * machine-readable answer for the model itself.
 */
export interface WindowCapture {
  path: string;
  width: number;
  height: number;
}

function captureScript(
  processId: number,
  outPath: string,
  waitMs: number,
  method: "window" | "screen",
): string {
  return `
param()
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HsmcpWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@
$deadline = (Get-Date).AddMilliseconds(${waitMs})
$h = [IntPtr]::Zero
do {
  $proc = Get-Process -Id ${processId} -ErrorAction Stop
  $h = $proc.MainWindowHandle
  if ($h -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if ($h -eq [IntPtr]::Zero) { throw "the process has no main window after ${waitMs} ms" }
# SW_RESTORE. PrintWindow does not need focus; the screen method brings the window forward.
[void][HsmcpWin32]::ShowWindow($h, 9)
Start-Sleep -Milliseconds 500
$rect = New-Object HsmcpWin32+RECT
if (-not [HsmcpWin32]::GetWindowRect($h, [ref]$rect)) { throw "GetWindowRect failed" }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "the window has no size" }
$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
if ("${method}" -eq "screen") {
  [void][HsmcpWin32]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 3 -bor 64)
  [void][HsmcpWin32]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 900
  $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
  [void][HsmcpWin32]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 3)
} else {
  $hdc = $g.GetHdc()
  # 2 = PW_RENDERFULLCONTENT (Windows 8.1+); 0 is the older path and is the fallback.
  $ok = [HsmcpWin32]::PrintWindow($h, $hdc, 2)
  if (-not $ok) { $ok = [HsmcpWin32]::PrintWindow($h, $hdc, 0) }
  $g.ReleaseHdc($hdc)
  if (-not $ok) { throw "PrintWindow failed" }
}
$bmp.Save("${outPath.replace(/\\/g, "\\\\")}", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "$width $height"
`;
}

export async function captureWindow(
  processId: number,
  outPath: string,
  waitMs = 2500,
  method: "window" | "screen" = "window",
): Promise<WindowCapture> {
  const dir = mkdtempSync(join(tmpdir(), "hsmcp-shot-"));
  const script = join(dir, "capture.ps1");
  writeFileSync(script, captureScript(processId, outPath, waitMs, method), "utf8");
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
        { windowsHide: true, timeout: 20_000 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`window capture failed: ${stderr.trim() || error.message}`));
            return;
          }
          resolve(stdout.trim());
        },
      );
    });
    if (!existsSync(outPath) || statSync(outPath).size === 0) {
      throw new Error(`window capture produced no image at ${outPath}`);
    }
    const [width, height] = output.split(/\s+/).map(Number);
    return {
      path: outPath,
      width: Number.isFinite(width) ? width! : 0,
      height: Number.isFinite(height) ? height! : 0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
