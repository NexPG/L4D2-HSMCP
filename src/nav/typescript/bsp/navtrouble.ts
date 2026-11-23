/**
 * `nav_trouble_report`, both as the engine prints it and as an offline summary.
 *
 * The engine command is the authority: it selects the offending areas and names the check
 * that failed. Parsing its text gives a structured answer, and the selection it leaves
 * behind can be written out with `nav_dump_selected_set_positions`, which turns "3 areas
 * are missing FINALE" into three coordinates an agent can actually fix.
 *
 * The offline half works from the dump alone. It cannot reproduce the engine's overlap or
 * corner-to-corner tests -- the dump carries connection counts, not endpoints -- so it
 * only claims what the dump can support: goals, orphans and flow.
 */

import { get, parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";
import type { NavDumpReport } from "./navdump.js";

export type ExpectedGoal = "checkpoint" | "finale" | "either" | "none";

export interface NavTroubleCheck {
  /** The check's name without the trailing "check": `Orphan`, `Missing Finale`. */
  name: string;
  passed: boolean;
  /** How many areas the engine selected for this check, when it said. */
  areas: number | null;
  /** The console line, unchanged. */
  raw: string;
}

export interface NavTroubleFinding {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  count?: number;
  centers?: Array<[number, number, number]>;
}

export interface NavTroubleReport {
  /** Checks the engine printed, in order. */
  checks: NavTroubleCheck[];
  /** The checks that did not pass. */
  failures: NavTroubleCheck[];
  /** `Selected N trouble areas`, when printed. */
  selectedAreas: number | null;
  /** Coordinates from `nav_dump_selected_set_positions`, when the caller read the file. */
  selectedPoints: Array<[number, number, number]>;
  /** Lines worth keeping from the console, not the whole log. */
  rawLines: string[];
  verdict: "pass" | "fail" | "unknown";
}

const CHECK = /^\s*(.+?)\s+check\s+(passed|failed|found\s+(\d+)\s+areas?)\b/i;
const SELECTED = /\bSelected\s+(\d+)\s+(?:trouble\s+)?areas?\b/i;

/** Parses the engine's text, or returns `unknown` rather than inventing a pass. */
export function parseNavTrouble(text: string): NavTroubleReport {
  const checks: NavTroubleCheck[] = [];
  const rawLines: string[] = [];
  let selectedAreas: number | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const check = CHECK.exec(trimmed);
    if (check) {
      const status = check[2]!.toLowerCase();
      const found = check[3] === undefined ? null : Number.parseInt(check[3], 10);
      checks.push({
        name: check[1]!.trim(),
        passed: status === "passed" || found === 0,
        areas: found,
        raw: trimmed,
      });
      rawLines.push(trimmed);
      continue;
    }
    const selected = SELECTED.exec(trimmed);
    if (selected) {
      selectedAreas = Number.parseInt(selected[1]!, 10);
      rawLines.push(trimmed);
      continue;
    }
    // The command can refuse outright (no nav, nav_edit off). Those lines are the answer
    // when no check ever ran, so keep them too.
    if (/nav|trouble|no areas/i.test(trimmed)) rawLines.push(trimmed);
  }

  const failures = checks.filter((c) => !c.passed);
  return {
    checks,
    failures,
    selectedAreas,
    selectedPoints: [],
    rawLines,
    verdict: checks.length === 0 ? "unknown" : failures.length > 0 ? "fail" : "pass",
  };
}

export interface SelectedNavArea {
  id: number;
  center: [number, number, number];
  /** Corners as the engine wrote them; the centre is their average. */
  northWest: [number, number, number];
  northEast: [number, number, number];
  southWest: [number, number, number];
  southEast: [number, number, number];
  attributes: number;
  spawnAttributes: number;
  /** Area ids this selection says it connects to. */
  connections: number[];
}

function vecFrom(child: KvBlock | undefined): [number, number, number] | null {
  if (!child) return null;
  const x = Number(get(child, "x"));
  const y = Number(get(child, "y"));
  const z = Number(get(child, "z"));
  if (![x, y, z].every((n) => Number.isFinite(n))) return null;
  return [x, y, z];
}

/**
 * Parses the `"Selected Nav Areas"` KeyValues file L4D2's `nav_save_selected` writes.
 *
 * L4D2 has no `nav_dump_selected_set_positions` (that command is Source SDK 2013), so the
 * selected set is the only way the engine gives coordinates. The file carries each area's
 * four corners, its attribute words and its connections -- more than the xyz form would.
 * Any other .txt returns [] rather than a guessed area.
 */
export function parseSavedSelection(text: string): SelectedNavArea[] {
  if (!/"Selected Nav Areas"/i.test(text)) return [];
  const root = parse(text).find(
    (n): n is KvBlock => n.kind === "block" && /^Selected Nav Areas$/i.test(n.name),
  );
  if (!root) return [];

  const areas: SelectedNavArea[] = [];
  for (const child of root.entries) {
    if (child.kind !== "block" || !/^\d+$/.test(child.name)) continue;
    const corners = new Map(
      ["NorthWest", "NorthEast", "SouthWest", "SouthEast"].map((name) => [
        name,
        vecFrom(child.entries.find((e): e is KvBlock => e.kind === "block" && e.name === name)),
      ]),
    );
    const nw = corners.get("NorthWest");
    const ne = corners.get("NorthEast");
    const sw = corners.get("SouthWest");
    const se = corners.get("SouthEast");
    if (!nw || !ne || !sw || !se) continue;
    const center: [number, number, number] = [
      (nw[0] + ne[0] + sw[0] + se[0]) / 4,
      (nw[1] + ne[1] + sw[1] + se[1]) / 4,
      (nw[2] + ne[2] + sw[2] + se[2]) / 4,
    ];
    const connections: number[] = [];
    for (const dir of ["North", "East", "South", "West"]) {
      const block = child.entries.find(
        (e): e is KvBlock => e.kind === "block" && e.name === dir,
      );
      if (!block) continue;
      for (const entry of block.entries) {
        if (entry.kind !== "pair") continue;
        const id = Number(entry.value);
        if (Number.isFinite(id)) connections.push(id);
      }
    }
    areas.push({
      id: Number(child.name),
      center,
      northWest: nw,
      northEast: ne,
      southWest: sw,
      southEast: se,
      attributes: Number(get(child, "Attributes") ?? 0),
      spawnAttributes: Number(get(child, "SpawnAttributes") ?? 0),
      connections,
    });
  }
  return areas;
}

/** Parses the `<map>_xyz.txt` the engine writes for the current selection. */
export function parseSelectedPositions(text: string): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    points.push([nums[0]!, nums[1]!, nums[2]!]);
  }
  return points;
}

export interface OfflineTrouble {
  findings: NavTroubleFinding[];
  verdict: "pass" | "warn" | "fail";
}

const MAX_CENTERS = 24;

/**
 * What the dump can prove about a mesh, given the goal the chapter is supposed to have.
 *
 * `expected` is the chapter's role, not a guess: a middle chapter has a checkpoint goal, a
 * last chapter has a finale. Asking for the wrong one here is how a nav that looks fine in
 * `read_nav_dump` fails the campaign on the map after it.
 */
export function offlineNavTrouble(
  report: NavDumpReport,
  expected: ExpectedGoal,
): OfflineTrouble {
  const findings: NavTroubleFinding[] = [];
  const add = (
    severity: NavTroubleFinding["severity"],
    rule: string,
    message: string,
    count?: number,
  ): void => {
    findings.push({ severity, rule, message, ...(count !== undefined ? { count } : {}) });
  };

  if (report.areas.length === 0) {
    add("error", "nav-empty", "the nav mesh has no areas; nothing can path on this map");
  } else {
    const hasCheckpoint = report.summary.checkpoint > 0;
    const hasFinale = report.summary.finale > 0;
    if (expected === "checkpoint" && !hasCheckpoint) {
      add(
        "error",
        "nav-missing-checkpoint",
        "this chapter needs a CHECKPOINT area and the mesh has none; the Director has no goal " +
          "and the safe room is not a destination",
      );
    }
    if (expected === "finale" && !hasFinale) {
      add(
        "error",
        "nav-missing-finale",
        "this is the last chapter and the mesh has no FINALE area; the escape route cannot be " +
          "chosen and the finale has no ground to stand on",
      );
    }
    if (expected === "either" && !hasCheckpoint && !hasFinale) {
      add(
        "error",
        "nav-missing-goal",
        "the mesh has neither a CHECKPOINT nor a FINALE area; the Director has no goal at all",
      );
    }

    const orphans = report.areas.filter((a) => a.connections === 0);
    if (orphans.length > 0) {
      add(
        "warning",
        "nav-orphan",
        `${orphans.length} area(s) have no connection in any direction; the Director can ` +
          "select them for a spawn and no bot can leave them",
        orphans.length,
      );
      const finding = findings.find((f) => f.rule === "nav-orphan")!;
      finding.centers = orphans.slice(0, MAX_CENTERS).map((a) => a.center);
    }

    if (report.summary.playerStart === 0 && expected !== "none") {
      add(
        "warning",
        "nav-no-player-start",
        "no PLAYER_START area; the Director has no place to put the survivors, which is the " +
          "failure a start below the map produces",
      );
    }
  }

  return {
    findings,
    verdict: findings.some((f) => f.severity === "error")
      ? "fail"
      : findings.length > 0
        ? "warn"
        : "pass",
  };
}
