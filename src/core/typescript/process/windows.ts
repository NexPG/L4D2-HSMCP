/**
 * Closing the processes a tool started, and proving they are gone.
 *
 * `spawn("taskkill", ...)` returns a handle, not a result: the caller reports `closed: true`
 * while the window is still on screen, and a server restart can kill the pending taskkill
 * before it runs. Two HLMVs left behind by earlier calls are the proof. Everything here is
 * synchronous for the kill, then re-reads the process list until the pid is gone or the
 * retries run out.
 *
 * Only processes that appeared after the tool's own launch are touched. A person's HLMV or
 * Hammer is never a target; `before` is the snapshot taken immediately before spawning.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type WindowKind = "hlmv" | "hammer";

const WINDOW_NAMES: Record<WindowKind, string[]> = {
  hlmv: ["hlmv", "hlmvplusplus"],
  hammer: ["hammerplusplus", "hammer", "wc"],
};

export interface WindowRecord {
  name: WindowKind;
  pid: number;
  since: number;
}

function ledgerPath(stateDir: string): string {
  return join(stateDir, "windows.json");
}

/**
 * Windows a tool opened and has not confirmed closed.
 *
 * The kill can be interrupted by a server restart, and the window survives the tool call
 * that started it. A small ledger in the state directory makes the next server start the
 * place that finishes the cleanup, instead of leaving a person to close HLMV by hand.
 */
export function readWindowLedger(stateDir: string): WindowRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(stateDir), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is WindowRecord =>
        typeof entry === "object" &&
        entry !== null &&
        ((entry as WindowRecord).name === "hlmv" ||
          (entry as WindowRecord).name === "hammer") &&
        Number.isInteger((entry as WindowRecord).pid) &&
        (entry as WindowRecord).pid > 0,
    );
  } catch {
    return [];
  }
}

function writeWindowLedger(stateDir: string, records: readonly WindowRecord[]): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(ledgerPath(stateDir), JSON.stringify(records), "utf8");
}

/** Records a window this process just opened, so a later start can close it. */
export function rememberWindow(stateDir: string, name: WindowKind, pid: number): void {
  const records = readWindowLedger(stateDir).filter((record) => record.pid !== pid);
  records.push({ name, pid, since: Date.now() });
  writeWindowLedger(stateDir, records);
}

/** Removes a window after its close has been confirmed. */
export function forgetWindow(stateDir: string, pid: number): void {
  const records = readWindowLedger(stateDir).filter((record) => record.pid !== pid);
  writeWindowLedger(stateDir, records);
}

/**
 * Closes every recorded window that is still alive, and returns the pids it closed.
 *
 * The process name is checked as well as the pid, because a pid can be reused by an
 * unrelated process after a reboot. Called at server start; safe when the ledger is absent.
 */
export async function sweepWindows(stateDir: string): Promise<number[]> {
  const records = readWindowLedger(stateDir);
  const swept: number[] = [];
  for (const record of records) {
    if (!processAlive(record.pid)) continue;
    if (!processIds(WINDOW_NAMES[record.name]).includes(record.pid)) continue;
    if (await terminate(record.pid)) swept.push(record.pid);
  }
  // A pid that is already gone is not a window to close; drop it rather than keep a stale
  // record that a future pid could reuse.
  writeWindowLedger(
    stateDir,
    records.filter((record) => processAlive(record.pid) && !swept.includes(record.pid)),
  );
  return swept;
}

/** PIDs for the named processes, as `Get-Process` spells them (no `.exe`). */
export function processIds(names: readonly string[]): number[] {
  if (names.length === 0) return [];
  const quoted = names.map((name) => `'${name.replace(/'/g, "''")}'`).join(",");
  const script =
    `$items = @(Get-Process -Name @(${quoted}) -ErrorAction SilentlyContinue | ` +
    `ForEach-Object { $_.Id }); $items -join ' '`;
  try {
    const raw = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    ).trim();
    return raw
      .split(/\s+/)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

/** PIDs that were not in the snapshot. Pure, so the diff can be tested without processes. */
export function newPids(after: readonly number[], before: ReadonlySet<number>): number[] {
  return [...new Set(after)].filter((pid) => !before.has(pid));
}

/**
 * PIDs of the named processes that own a main window.
 *
 * HLMV++ starts a second process and puts the window there, while the process the caller
 * spawned may already be gone. Capturing by the spawned pid therefore fails with
 * `GetWindowRect failed`; the window pid is the only useful one.
 */
export function windowPids(names: readonly string[]): number[] {
  if (names.length === 0) return [];
  const quoted = names.map((name) => `'${name.replace(/'/g, "''")}'`).join(",");
  const script =
    `$items = @(Get-Process -Name @(${quoted}) -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.Id }); $items -join ' '`;
  try {
    const raw = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    ).trim();
    return raw
      .split(/\s+/)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

/** True while the pid exists. `process.kill(pid, 0)` is the portable existence check. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** `taskkill /T /F` for one tree, then a short wait for the process table to catch up. */
async function terminate(pid: number, timeoutMs = 3_000): Promise<boolean> {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 15_000,
    });
  } catch {
    // Already gone, or access denied; the existence check decides.
  }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!processAlive(pid)) return true;
    await wait(200);
  }
  return !processAlive(pid);
}

/** A polite WM_CLOSE and a five-second wait, for an editor that records its shutdown. */
function closeMainWindow(pid: number): void {
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
          `if ($p) { $null = $p.CloseMainWindow(); $null = $p.WaitForExit(5000) }`,
      ],
      { stdio: "ignore", windowsHide: true, timeout: 15_000 },
    );
  } catch {
    // The process may already be gone.
  }
}

export interface CloseOutcome {
  /** PIDs that were new and are gone now. */
  closed: number[];
  /** PIDs that are still running after the retries. */
  remaining: number[];
}

/**
 * Closes every process that appeared after `before`.
 *
 * `gracefulFirst` asks the window to close before the tree is terminated; use it for an
 * editor whose unsaved-state recovery prompt matters. The fallback is always a forced tree
 * kill, because a window left open is the defect this function exists to prevent.
 */
export async function closeNewProcesses(
  names: readonly string[],
  before: ReadonlySet<number>,
  options: { gracefulFirst?: boolean; attempts?: number } = {},
): Promise<CloseOutcome> {
  const initial = newPids(processIds(names), before);
  if (initial.length === 0) return { closed: [], remaining: [] };

  if (options.gracefulFirst) {
    for (const pid of initial) closeMainWindow(pid);
    await wait(300);
  }

  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = newPids(processIds(names), before);
    if (remaining.length === 0) break;
    for (const pid of remaining) await terminate(pid);
  }

  const remaining = newPids(processIds(names), before);
  const closed = initial.filter((pid) => !remaining.includes(pid));
  return { closed, remaining };
}
