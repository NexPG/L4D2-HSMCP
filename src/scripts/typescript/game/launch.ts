import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The game executable sits next to `left4dead2/`, not inside it. */
export function gameExecutable(gameDir: string): string {
  return join(dirname(gameDir), "left4dead2.exe");
}

/**
 * The Steam client, which knows the install and the logged-on account.
 *
 * A direct `left4dead2.exe` launch works for short tests and then reaches `No Steam logon`
 * after about a minute; a finale or a full round outlives that. Steam is found through the
 * per-user registry first, then the two default install paths.
 */
export function steamExecutable(): string | null {
  const candidates = [
    process.env.STEAM_PATH,
    "C:\\Program Files (x86)\\Steam\\steam.exe",
    "C:\\Program Files\\Steam\\steam.exe",
    "D:\\Steam\\steam.exe",
  ].filter((path): path is string => Boolean(path));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The pid of a running `left4dead2.exe`, or null. */
export function findGamePid(): number | null {
  try {
    const out = execFileSync(
      "tasklist",
      ["/FI", "IMAGENAME eq left4dead2.exe", "/FO", "CSV", "/NH"],
      { encoding: "utf8", windowsHide: true },
    );
    for (const line of out.split(/\r?\n/)) {
      const parts = line.split('","').map((part) => part.replace(/^"|"$/g, ""));
      const pid = Number(parts[1]);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  } catch {
    // tasklist missing or refused; the caller reports that the game never appeared.
  }
  return null;
}

/** Waits for Steam to start the game and returns its pid, or null. */
export async function waitForGamePid(
  timeoutMs: number,
  intervalMs = 500,
): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pid = findGamePid();
    if (pid !== null) return pid;
    await sleep(intervalMs);
  }
  return null;
}

/** Terminates one game process by pid, never every `left4dead2.exe` on the machine. */
export function stopGamePid(pid: number): void {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 15_000,
    });
  } catch {
    // Not running is the desired state.
  }
}

/**
 * Refuses to launch a test while someone is already playing.
 *
 * A test run starts the game through Steam, which allows one instance per account: it takes
 * the session over and the player is dropped to the main menu. The harness learned this the
 * hard way -- a run started while the owner was on their own server disconnected them.
 *
 * `replaceRunningGame: true` is the explicit permission to close that game first; without it
 * the call stops before touching any file.
 */
export function guardRunningGame(allowReplace: boolean, what: string): number | null {
  const pid = findGamePid();
  if (pid === null) return null;
  if (allowReplace) {
    stopGamePid(pid);
    return pid;
  }
  throw new Error(
    `left4dead2.exe is already running (pid ${pid}). ${what} starts its own instance through ` +
      "Steam, which takes over the session and drops whoever is playing to the main menu. " +
      "Close the game first, or pass replaceRunningGame: true if that game is yours and may be closed.",
  );
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
        // Synchronous: a spawned taskkill can die with the MCP process and leave the game
        // window behind, which is exactly the defect this is meant to prevent.
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
          timeout: 15_000,
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

export interface LogMarker {
  /** A name for the step, used in the timeline and in `missing`. */
  name: string;
  /** Regular expression, matched against new log lines only. */
  pattern: string;
  /** Seconds from the previous marker (or from launch). Defaults to the whole run. */
  withinSeconds?: number;
}

export interface MarkerHit {
  name: string;
  pattern: string;
  matched: boolean;
  /** Seconds since launch, one decimal. */
  atSeconds: number;
  /** The log line the pattern matched, trimmed. */
  line: string | null;
}

/**
 * Polls the log for an ordered sequence of patterns.
 *
 * A single `waitFor` answers "did this happen"; a play test usually asks "did these happen,
 * in this order" -- finale started, escape unlocked, credits. Each marker is searched from
 * the end of the previous match, so a pattern that also appears earlier (a `Loading:` line
 * per map) cannot satisfy a later step, and the cursor makes the order a fact rather than
 * an assumption.
 *
 * `withinSeconds` is measured from the previous marker: a step that should follow in 20
 * seconds fails in 20 seconds, not at the end of the whole run.
 */
export async function waitForMarkers(
  path: string,
  markers: readonly LogMarker[],
  timeoutMs: number,
  alive: () => boolean,
  intervalMs = 500,
): Promise<{ hits: MarkerHit[]; missing: string[]; reason: WaitReason }> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  const hits: MarkerHit[] = [];
  let cursor = 0;

  for (const [index, marker] of markers.entries()) {
    const pattern = new RegExp(marker.pattern, "i");
    const stepDeadline = Math.min(
      deadline,
      Date.now() + (marker.withinSeconds ?? Math.ceil(timeoutMs / 1000)) * 1000,
    );
    let matched = false;
    let text = "";
    while (Date.now() < stepDeadline) {
      text = existsSync(path) ? readFileSync(path, "utf8") : "";
      const fresh = text.slice(cursor);
      const match = fresh.match(pattern);
      if (match && match.index !== undefined) {
        const from = fresh.lastIndexOf("\n", match.index) + 1;
        const to = fresh.indexOf("\n", match.index + match[0].length);
        const line = fresh
          .slice(from, to === -1 ? undefined : to)
          .trim();
        hits.push({
          name: marker.name,
          pattern: marker.pattern,
          matched: true,
          atSeconds: Math.round((Date.now() - started) / 100) / 10,
          line,
        });
        cursor += match.index + match[0].length;
        matched = true;
        break;
      }
      if (!alive()) {
        return {
          hits,
          missing: markers.slice(index).map((entry) => entry.name),
          reason: "exited",
        };
      }
      await sleep(intervalMs);
    }
    if (!matched) {
      return {
        hits,
        missing: markers.slice(index).map((entry) => entry.name),
        reason: "timeout",
      };
    }
  }
  return { hits, missing: [], reason: "matched" };
}

/**
 * The same markers, but searched independently in the whole log.
 *
 * Ordered matching is the right default for a sequence (`load`, then `finale`, then
 * `credits`), but wrong for events that fire at once: several `OnMapSpawn` outputs land in one
 * burst, and whichever the engine writes first would hide all the others from a cursor. Here
 * every marker is matched against the full log and reported in marker order.
 */
export async function waitForMarkersAny(
  path: string,
  markers: readonly LogMarker[],
  timeoutMs: number,
  alive: () => boolean,
  intervalMs = 500,
): Promise<{ hits: MarkerHit[]; missing: string[]; reason: WaitReason }> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  const matched = new Set<number>();
  const hits: MarkerHit[] = [];
  let exited = false;

  while (Date.now() < deadline && matched.size < markers.length) {
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    for (const [index, marker] of markers.entries()) {
      if (matched.has(index)) continue;
      const match = new RegExp(marker.pattern, "i").exec(text);
      if (!match || match.index === undefined) continue;
      const from = text.lastIndexOf("\n", match.index) + 1;
      const to = text.indexOf("\n", match.index + match[0].length);
      hits.push({
        name: marker.name,
        pattern: marker.pattern,
        matched: true,
        atSeconds: Math.round((Date.now() - started) / 100) / 10,
        line: text.slice(from, to === -1 ? undefined : to).trim(),
      });
      matched.add(index);
    }
    if (matched.size === markers.length) break;
    if (!alive()) {
      exited = true;
      break;
    }
    await sleep(intervalMs);
  }

  const missing = markers
    .map((marker, index) => ({ marker, index }))
    .filter(({ index }) => !matched.has(index))
    .map(({ marker }) => marker.name);
  const order = new Map(markers.map((marker, index) => [marker.name, index]));
  return {
    hits: hits.sort(
      (a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0),
    ),
    missing,
    reason: missing.length === 0 ? "matched" : exited ? "exited" : "timeout",
  };
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
export function navGenerateConfig(slopeLimit?: number): string {
  const lines = ["sv_cheats 1", "nav_edit 1"];
  if (slopeLimit !== undefined) lines.push(`nav_slope_limit ${slopeLimit}`);
  lines.push("nav_mark_walkable", "nav_generate");
  return lines.join("\n") + "\n";
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
