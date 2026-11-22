/**
 * The live-edit journal: an append-only record of what was proposed, approved and sent to
 * a running Hammer, plus the state needed to address an entity created in an earlier call.
 *
 * The shell channel addresses entities by `class + origin` and cannot see unsaved editor
 * state. Two calls that create an entity and then set one of its keyvalues therefore cannot
 * be validated against the saved `.vmf` alone: the file does not contain the first change
 * yet. `buildLiveState()` replays applied journal entries over the saved map, and the
 * address check accepts an entity that exists only in that replay.
 *
 * The replay is idempotent against a save:
 * - a create whose address is already in the file is skipped;
 * - a delete whose address is already absent is skipped;
 * - a set whose value already matches is skipped;
 * - and entries applied before the file's current mtime are skipped, because the save has
 *   already written them (or a person has since changed them, which is their decision).
 *
 * The journal does not replace Hammer's undo stack. It records intent and result; the
 * editor's own history is still the only thing that can undo a keyvalue change.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readEntities } from "../../../maps/typescript/vmf/edit.js";
import type { VmfEntity } from "../../../maps/typescript/vmf/edit.js";

export type JournalOp =
  | {
      op: "create";
      classname: string;
      origin: number[];
      keyvalues?: Record<string, string>;
    }
  | {
      op: "setKeyvalue";
      classname: string;
      origin: number[];
      key: string;
      value: string;
    }
  | { op: "delete"; classname: string; origin: number[] }
  | { op: "rotate"; classname: string; origin: number[]; angles: number[] };

export interface LiveEntity {
  classname: string;
  origin: number[];
  keyvalues: Record<string, string>;
}

export type JournalState = "staged" | "approved" | "rejected" | "applied" | "failed";

export interface JournalResult {
  accepted: boolean;
  command: string;
}

export interface LiveJournalEntry {
  id: string;
  pid: number;
  vmf: string;
  createdAt: string;
  updatedAt: string;
  state: JournalState;
  ops: JournalOp[];
  /** `true` when the apply step also posted Hammer's Save command. */
  save: boolean;
  commands: string[];
  /** The addressed entity before the op; null for a create. */
  before: Array<LiveEntity | null>;
  note?: string;
  reason?: string;
  accepted?: number;
  rejected?: number;
  results?: JournalResult[];
  saved?: boolean;
  appliedAt?: string;
}

const VALID_STATES = new Set<JournalState>(["staged", "approved", "rejected", "applied", "failed"]);

export function journalPath(stateDir: string): string {
  return join(stateDir, "live", "journal.jsonl");
}

/** Every entry, latest event per id winning. Invalid lines are ignored, not fatal. */
export function readJournal(stateDir: string): LiveJournalEntry[] {
  let text: string;
  try {
    text = readFileSync(journalPath(stateDir), "utf8");
  } catch {
    return [];
  }
  const byId = new Map<string, LiveJournalEntry>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = raw as Partial<LiveJournalEntry>;
    if (
      typeof entry.id !== "string" ||
      typeof entry.pid !== "number" ||
      typeof entry.vmf !== "string" ||
      !Array.isArray(entry.ops) ||
      typeof entry.state !== "string" ||
      !VALID_STATES.has(entry.state as JournalState)
    ) {
      continue;
    }
    byId.set(entry.id, entry as LiveJournalEntry);
  }
  return [...byId.values()];
}

/** Appends one event. The caller supplies the complete entry at its new state. */
export function appendJournal(stateDir: string, entry: LiveJournalEntry): void {
  const path = journalPath(stateDir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

export function nextJournalId(entries: readonly LiveJournalEntry[]): string {
  let max = 0;
  for (const entry of entries) {
    const match = /^live-(\d+)$/.exec(entry.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `live-${String(max + 1).padStart(4, "0")}`;
}

export function latestJournalEntry(
  entries: readonly LiveJournalEntry[],
  id: string,
): LiveJournalEntry | undefined {
  return entries.find((entry) => entry.id === id);
}

export function parseLiveOrigin(value: string | undefined): number[] | null {
  const parts = (value ?? "").trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function liveAddressKey(
  classname: string,
  origin: readonly number[],
): string {
  return `${classname.toLowerCase()}|${origin
    .slice(0, 3)
    .map((value) => value.toFixed(2))
    .join(" ")}`;
}

function fromVmf(entity: VmfEntity): LiveEntity | null {
  const origin = parseLiveOrigin(entity.keyvalues.origin);
  if (!origin) return null;
  return { classname: entity.classname, origin, keyvalues: { ...entity.keyvalues } };
}

function clone(entity: LiveEntity): LiveEntity {
  return {
    classname: entity.classname,
    origin: [...entity.origin],
    keyvalues: { ...entity.keyvalues },
  };
}

function keyOf(entity: LiveEntity): string {
  return liveAddressKey(entity.classname, entity.origin);
}

/**
 * The map as the editor sees it: the saved file plus applied entries not yet saved.
 *
 * `mtimeMs` is the saved file's modification time. An applied entry older than it is assumed
 * to be in the file (or superseded by a person's own edit) and is not replayed.
 */
function replay(state: Map<string, LiveEntity>, entries: readonly LiveJournalEntry[]): void {
  for (const entry of entries) {
    for (const op of entry.ops) {
      const origin = op.origin;
      const key = liveAddressKey(op.classname, origin);
      if (op.op === "create") {
        if (!state.has(key)) {
          state.set(key, {
            classname: op.classname,
            origin: [...origin],
            keyvalues: { ...(op.keyvalues ?? {}) },
          });
        }
      } else if (op.op === "delete") {
        state.delete(key);
      } else if (op.op === "setKeyvalue") {
        const entity = state.get(key);
        if (!entity) continue;
        if (op.key.toLowerCase() === "origin") {
          const moved = parseLiveOrigin(op.value);
          if (!moved) continue;
          state.delete(key);
          entity.origin = moved;
          entity.keyvalues.origin = op.value;
          state.set(keyOf(entity), entity);
        } else if (entity.keyvalues[op.key] !== op.value) {
          entity.keyvalues[op.key] = op.value;
        }
      }
      // A rotate changes angles, not the class+origin address; it does not affect state.
    }
  }
}

export function buildLiveState(
  vmfText: string,
  entries: readonly LiveJournalEntry[],
  mtimeMs?: number,
): Map<string, LiveEntity> {
  const state = new Map<string, LiveEntity>();
  for (const entity of readEntities(vmfText).entities) {
    const live = fromVmf(entity);
    if (live) state.set(keyOf(live), live);
  }

  const applied = entries
    .filter((entry) => entry.state === "applied")
    .filter((entry) => {
      if (mtimeMs === undefined || entry.appliedAt === undefined) return true;
      const appliedAt = Date.parse(entry.appliedAt);
      return !Number.isFinite(appliedAt) || appliedAt >= mtimeMs;
    })
    .sort((a, b) => (a.appliedAt ?? a.updatedAt).localeCompare(b.appliedAt ?? b.updatedAt));
  replay(state, applied);
  return state;
}

/**
 * The live state plus edits that are queued but not yet in the editor. Used when staging and
 * reviewing, so two pending creates cannot both reserve the same class+origin. Applying checks
 * the actual editor state only: an approved edit that a person never applies must not block a
 * different one.
 */
export function buildQueueState(
  vmfText: string,
  entries: readonly LiveJournalEntry[],
  mtimeMs?: number,
): Map<string, LiveEntity> {
  const state = buildLiveState(vmfText, entries, mtimeMs);
  const pending = entries
    .filter((entry) => entry.state === "staged" || entry.state === "approved")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  replay(state, pending);
  return state;
}

/** A snapshot of each addressed entity, for the journal's `before` column. */
export function captureBefore(
  state: ReadonlyMap<string, LiveEntity>,
  ops: readonly JournalOp[],
): Array<LiveEntity | null> {
  return ops.map((op) => {
    if (op.op === "create") return null;
    const entity = state.get(liveAddressKey(op.classname, op.origin));
    return entity ? clone(entity) : null;
  });
}
