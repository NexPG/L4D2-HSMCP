/**
 * Writing the entity lump of a compiled `.bsp`.
 *
 * The lump is plain KeyValues, and `readEntityLump` already parses it. The write strategy
 * is deliberately append-only: the new entity text goes at the end of the file and only the
 * entity lump's directory entry changes. No other lump moves, so the pakfile, brush data
 * and lighting cannot be shifted by a byte. The old entity text stays in the file as dead
 * bytes; a `.bsp` does not promise to be compact, and moving a gigabyte of pakfile to save
 * a few kilobytes would be the riskier operation.
 *
 * Compiled outputs are ordinary keyvalues here, unlike a VMF's `connections` block, and
 * this writer keeps them that way: `"OnMapSpawn" "cmd,Command,buildcubemaps,0,-1"` is a
 * pair like any other.
 */
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  openSync,
  statSync,
  writeSync,
} from "node:fs";
import { readHeader, LUMP_ENTITIES } from "./header.js";
import type { BspHeader } from "./header.js";
import { parseEntityText, readEntityLump } from "./entities.js";
import type { MapEntity } from "../entity/model.js";

export class BspEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BspEditError";
  }
}

export interface EntityMatch {
  id?: number;
  /** Zero-based position in the lump, for maps whose entities carry no id. */
  index?: number;
  classname?: string;
  targetname?: string;
}

export type EntityOp =
  | {
      op: "add";
      /** Must include `classname`. Compiled outputs are ordinary keys. */
      keyvalues: Record<string, string>;
    }
  | {
      op: "update";
      match: EntityMatch;
      keyvalues?: Record<string, string>;
      removeKeys?: string[];
    }
  | { op: "remove"; match: EntityMatch };

export interface EntityOutcome {
  op: EntityOp["op"];
  matched: number;
  /** For an add: the index the entity received. */
  index?: number;
}

export interface BspEditResult {
  text: string;
  entitiesBefore: number;
  entitiesAfter: number;
  outcomes: EntityOutcome[];
  warnings: string[];
}

function pairsOf(entity: MapEntity): Array<[string, string]> {
  const pairs = entity.keyvalues.map(([k, v]) => [k, v] as [string, string]);
  if (!pairs.some(([k]) => k === "classname") && entity.classname) {
    pairs.unshift(["classname", entity.classname]);
  }
  return pairs;
}

function hasMatch(entity: MapEntity, match: EntityMatch, position: number): boolean {
  if (match.id !== undefined && entity.id !== match.id) return false;
  if (match.index !== undefined && position !== match.index) return false;
  if (match.classname !== undefined && entity.classname !== match.classname) return false;
  if (match.targetname !== undefined && entity.targetname !== match.targetname) return false;
  return true;
}

function requireMatch(match: EntityMatch, what: string): void {
  if (
    match.id === undefined &&
    match.index === undefined &&
    !match.classname &&
    !match.targetname
  ) {
    throw new BspEditError(
      `${what}: match needs at least one of id, index, classname or targetname`,
    );
  }
}

/** Replaces the first pair with this key, drops the rest, or appends it once. */
function upsert(pairs: Array<[string, string]>, key: string, value: string): void {
  const at = pairs.findIndex(([k]) => k === key);
  if (at >= 0) {
    pairs[at] = [key, value];
    for (let i = pairs.length - 1; i > at; i -= 1) {
      if (pairs[i]![0] === key) pairs.splice(i, 1);
    }
    return;
  }
  pairs.push([key, value]);
}

function quote(text: string, what: string): string {
  if (text.includes('"') || text.includes("\n") || text.includes("\r")) {
    throw new BspEditError(`${what} cannot contain a quote or newline: ${JSON.stringify(text)}`);
  }
  return `"${text}"`;
}

/** One anonymous `{ ... }` block, as a compiled entity lump stores it. */
function entityText(pairs: ReadonlyArray<[string, string]>): string {
  return `{\n${pairs
    .map(([k, v]) => `${quote(k, "entity key")} ${quote(v, "entity value")}`)
    .join("\n")}\n}\n`;
}

/** Applies the operations to parsed entity text and returns the new text. */
export function editEntityText(text: string, ops: readonly EntityOp[]): BspEditResult {
  if (ops.length === 0) throw new BspEditError("no operations were given");
  const before = parseEntityText(text);
  const working = before.map(pairsOf);
  const initialCount = before.length;
  const outcomes: EntityOutcome[] = [];
  const warnings: string[] = [];

  for (const op of ops) {
    if (op.op === "add") {
      const pairs = Object.entries(op.keyvalues);
      const classname = op.keyvalues["classname"];
      if (!classname) throw new BspEditError("add: keyvalues must include classname");
      const index = working.length;
      working.push(pairs);
      // Keep the two views aligned so a later op in the same call can match this entity.
      before.push({
        index,
        classname,
        ...(op.keyvalues["targetname"] !== undefined
          ? { targetname: op.keyvalues["targetname"]! }
          : {}),
        keyvalues: pairs,
        connections: [],
        solidCount: 0,
        start: 0,
        end: 0,
      });
      outcomes.push({ op: "add", matched: 1, index });
      continue;
    }

    requireMatch(op.match, op.op);
    const matched = before
      .map((entity, index) => ({ entity, index }))
      .filter(({ entity, index }) => hasMatch(entity, op.match, index));

    if (matched.length === 0) {
      throw new BspEditError(`${op.op}: nothing matched ${JSON.stringify(op.match)}`);
    }
    outcomes.push({ op: op.op, matched: matched.length });

    if (op.op === "remove") {
      for (const { index } of [...matched].sort((a, b) => b.index - a.index)) {
        working.splice(index, 1);
        before.splice(index, 1);
      }
      continue;
    }

    for (const { index } of matched) {
      const pairs = working[index]!;
      for (const key of op.removeKeys ?? []) {
        for (let i = pairs.length - 1; i >= 0; i -= 1) {
          if (pairs[i]![0] === key) pairs.splice(i, 1);
        }
      }
      for (const [key, value] of Object.entries(op.keyvalues ?? {})) upsert(pairs, key, value);
    }
  }

  if (!working.some((pairs) => pairs.some(([k, v]) => k === "classname" && v === "worldspawn"))) {
    throw new BspEditError("refusing to write an entity lump with no worldspawn");
  }

  return {
    text: working.map(entityText).join(""),
    entitiesBefore: initialCount,
    entitiesAfter: working.length,
    outcomes,
    warnings,
  };
}

/** Writes the entity lump, in place or to a new file, and returns what changed. */
export function writeBspEntities(
  path: string,
  ops: readonly EntityOp[],
  options: { out?: string; backup?: boolean } = {},
): BspEditResult & {
  path: string;
  written: boolean;
  backupPath: string | null;
  lumpOffset: number;
  lumpBytes: number;
} {
  const header = readHeader(path);
  const lump = header.lumps[LUMP_ENTITIES];
  if (!lump) throw new BspEditError(`${path}: no entity lump in the directory`);
  if (lump.compressed) {
    throw new BspEditError(
      `${path}: the entity lump is compressed; appending raw KeyValues would leave a ` +
        `mismatched length. Repack the map without lump compression or edit the source VMF.`,
    );
  }

  const source = readEntityLump(path);
  const result = editEntityText(source.text, ops);
  const payload = Buffer.from(`${result.text}\0`, "utf8");

  const out = options.out ?? path;
  if (out !== path) {
    copyFileSync(path, out);
  }

  let backupPath: string | null = null;
  if (options.backup && out === path) {
    backupPath = `${path}.bak`;
    copyFileSync(path, backupPath);
  }

  const sizeBefore = statSync(out).size;
  appendFileSync(out, payload);
  patchEntityLump(out, header, sizeBefore, payload.length);

  const check = readEntityLump(out);
  if (check.entities.length !== result.entitiesAfter) {
    throw new BspEditError(
      `refusing to report success: wrote ${result.entitiesAfter} entities but the file ` +
        `reads back ${check.entities.length}`,
    );
  }

  return {
    ...result,
    path: out,
    written: true,
    backupPath,
    lumpOffset: sizeBefore,
    lumpBytes: payload.length,
  };
}

/** Points the entity lump's directory entry at the appended bytes. */
function patchEntityLump(
  path: string,
  header: BspHeader,
  offset: number,
  length: number,
): void {
  const at = 8 + LUMP_ENTITIES * 16;
  const offsetAt = at + (header.layout === "l4d2" ? 4 : 0);
  const lengthAt = at + (header.layout === "l4d2" ? 8 : 4);

  // The two fields are four bytes apart but in opposite order in the two layouts, so they
  // are written field by field rather than as one eight-byte window.
  const field = (position: number, value: number): void => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(value, 0);
    const fd = openSync(path, "r+");
    try {
      writeSync(fd, b, 0, 4, position);
    } finally {
      closeSync(fd);
    }
  };
  field(offsetAt, offset);
  field(lengthAt, length);
}
