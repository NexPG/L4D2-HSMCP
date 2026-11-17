/**
 * Duplicating brushes that are already in a `.vmf`.
 *
 * Hammer's Ctrl+C / Ctrl+V is one of the few editor operations the write path did not
 * have. It matters most for the 3D skybox: the sky camera sees a 1/16 copy of geometry that
 * must not be part of the playable map, and there was no way to make that copy without
 * rewriting it by hand.
 *
 * The clone is a byte-range copy, like `reclass.ts` moves one. That is deliberate: every
 * material, texture axis, smoothing group and editor colour comes through untouched, which
 * a rebuild from measured vertices would lose. Only the ids change -- a duplicate id makes
 * Hammer's entity report ambiguous and can make the wrong brush selectable.
 */
import { parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { maxId } from "./edit.js";
import { transformSolids } from "./modify.js";
import type { TransformOptions } from "./modify.js";
import { findSolids, isEmptySelector, lineRange, matchesSolid } from "./select.js";
import type { SolidSelector } from "./select.js";
import { checkVmfSolids } from "./solid.js";
import type { SolidCheck } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";
import { IDENTITY } from "./transform.js";
import type { Mat34 } from "./transform.js";

export class VmfCloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfCloneError";
  }
}

export interface CloneResult {
  text: string;
  clones: Array<{ sourceId: number; newId: number; owner: string }>;
  warnings: string[];
  unchanged: boolean;
}

/** A new id for every `"id"` pair in the cloned block, in the order they appear. */
function remapIds(body: string, start: number): { text: string; firstId: number } {
  let next = start;
  let first: number | null = null;
  const text = body.replace(/"id"(\s+)"\d+"/g, (_match, space: string) => {
    const id = next;
    next += 1;
    if (first === null) first = id;
    return `"id"${space}"${id}"`;
  });
  if (first === null) {
    throw new VmfCloneError("a solid block had no id to remap; refusing to write a duplicate");
  }
  return { text, firstId: first };
}

/**
 * Copies the selected brushes, `count` times, optionally transforming the copies.
 *
 * The copies are inserted directly after each source block, so they keep their owner: a
 * brush inside `func_detail` stays inside it, and a world brush stays in the world. Hidden
 * and displaced brushes are refused for the same reasons `transform_solids` refuses them.
 */
export function cloneSolids(
  source: string,
  selector: SolidSelector,
  count = 1,
  matrix: Mat34 = IDENTITY,
  options: TransformOptions = {},
): CloneResult {
  if (isEmptySelector(selector)) {
    throw new VmfCloneError(
      "refusing an empty selector: it would copy every brush in the map. Name ids, an " +
        "owner, a material or a bounding box.",
    );
  }
  if (!Number.isInteger(count) || count < 1 || count > 256) {
    throw new VmfCloneError(`count must be between 1 and 256, not ${count}`);
  }
  const moves = matrix.some((value, index) => value !== IDENTITY[index]);
  if (count > 1 && moves) {
    throw new VmfCloneError(
      "a transform applies to one copy. Every copy would land on the same spot. Clone the " +
        "brushes, then call transform_solids on the ids this returns.",
    );
  }

  const nodes = parse(source);
  const roots = nodes.filter((n): n is KvBlock => n.kind === "block");
  const report = checkVmfSolids("(memory)", source);
  const byId = new Map<number, SolidCheck>();
  for (const s of report.solids) if (s.id !== null) byId.set(s.id, s);

  const wanted = findSolids(roots).filter((f) => {
    const check = byId.get(f.id);
    return check ? matchesSolid(check, selector) : false;
  });
  if (wanted.length === 0) {
    return { text: source, clones: [], warnings: ["nothing matched the selector"], unchanged: true };
  }

  const hidden = wanted.filter((f) => f.hidden);
  if (hidden.length > 0) {
    throw new VmfCloneError(
      `refusing to copy ${hidden.length} solid(s) inside a hidden block: ` +
        `${hidden.map((h) => h.id).join(", ")}. The copy would be invisible too, and the ` +
        `call would look like it did nothing.`,
    );
  }
  const withDisp = wanted.filter((f) => byId.get(f.id)?.sides.some((s) => s.hasDisplacement));
  if (withDisp.length > 0) {
    throw new VmfCloneError(
      `refusing to copy ${withDisp.length} solid(s) carrying a displacement: ` +
        `${withDisp.map((h) => h.id).join(", ")}. A dispinfo holds its own startposition ` +
        `and per-vertex offsets; a byte copy would duplicate the face without its shape.`,
    );
  }

  const splices: Splice[] = [];
  const clones: CloneResult["clones"] = [];
  let nextId = maxId(nodes) + 1;

  for (const found of wanted) {
    const { start, end } = lineRange(source, found.block);
    const body = source.slice(start, end);
    for (let copy = 0; copy < count; copy++) {
      const remapped = remapIds(body, nextId);
      nextId += (body.match(/"id"\s+"\d+"/g) ?? []).length;
      splices.push({ start: end, end, text: remapped.text });
      clones.push({ sourceId: found.id, newId: remapped.firstId, owner: found.owner });
    }
  }

  let text = applySplices(source, splices);
  const warnings: string[] = [];

  if (moves) {    const moved = transformSolids(
      text,
      { ids: clones.map((c) => c.newId) },
      matrix,
      options,
    );
    text = moved.text;
    warnings.push(...moved.warnings);
  }

  const after = checkVmfSolids("(memory)", text);
  if (after.solidCount !== report.solidCount + clones.length) {
    throw new VmfCloneError(
      `refusing to write: ${report.solidCount} solids in, ${clones.length} copies asked ` +
        `for, ${after.solidCount} out`,
    );
  }
  const ids = new Set(clones.map((c) => c.newId));
  const broken = after.solids.filter((s) => s.id !== null && ids.has(s.id) && !s.valid);
  if (broken.length > 0) {
    throw new VmfCloneError(
      `refusing to write: ${broken.length} copied brush(es) are not valid solids: ` +
        broken.map((s) => `${s.id}: ${s.findings.map((f) => f.message).join(", ")}`).join("; "),
    );
  }

  return { text, clones, warnings, unchanged: text === source };
}
