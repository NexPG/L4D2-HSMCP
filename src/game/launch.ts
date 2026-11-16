import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The game executable sits next to `left4dead2/`, not inside it. */
export function gameExecutable(gameDir: string): string {
  return join(dirname(gameDir), "left4dead2.exe");
}

export interface LaunchHandle {
  child: ChildProcess;
  /** Terminates the process tree. Safe to call twice. */
  stop: () => void;
}

/**
 * Starts the game as a child process. No shell: the argument list is passed as written, so
 * `+map` and the map name stay two arguments instead of being re-split by cmd.exe.
 */
export function launchGame(exe: string, args: string[]): LaunchHandle {
  const child = spawn(exe, args, {
    cwd: dirname(exe),
    stdio: "ignore",
    windowsHide: false,
  });
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill();
    } catch {
      // The process may already be gone; taskkill below is the belt-and-braces.
    }
    if (child.pid !== undefined) {
      try {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {
        // Nothing else to do: the caller only cares that the game is not left running.
      }
    }
  };
  return { child, stop };
}

export function readLog(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export type WaitReason = "matched" | "exited" | "timeout";

/** Polls a file until `pattern` matches it, the process exits, or the timeout passes. */
export async function waitForLog(
  path: string,
  pattern: RegExp,
  timeoutMs: number,
  alive: () => boolean,
  intervalMs = 1000,
): Promise<WaitReason> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path) && pattern.test(readFileSync(path, "utf8"))) return "matched";
    if (!alive()) return "exited";
    await sleep(intervalMs);
  }
  return "timeout";
}

/** Polls until a file appears, the process exits, or the timeout passes. */
export async function waitForFile(
  path: string,
  timeoutMs: number,
  alive: () => boolean,
  intervalMs = 1000,
): Promise<WaitReason> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) return "matched";
    if (!alive()) return "exited";
    await sleep(intervalMs);
  }
  return "timeout";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The listen-server config that makes `nav_generate` actually run. */
export function navGenerateConfig(): string {
  return ["sv_cheats 1", "nav_edit 1", "nav_mark_walkable", "nav_generate"].join("\n") + "\n";
}

/** Lines a nav generation log uses to complain about the result. */
export const FLOW_WARNING =
  /GetGoalArea|Flow Warning|Flow Error|Checkpoint failed|NAV ERRORS|nav error/i;

export function flowWarnings(log: string): string[] {
  return log
    .split(/\r?\n/)
    .filter((line) => FLOW_WARNING.test(line))
    .map((line) => line.trim())
    .slice(0, 20);
}
