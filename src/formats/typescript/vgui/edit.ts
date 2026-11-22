/**
 * Editing a VGUI `.res` by splicing values, not by reserialising it.
 *
 * A HUD file is not a document we own: it ships with the game, is copied into an add-on,
 * and carries conditions, comments and indentation that Hammer does not normalise. The
 * writer therefore replaces only the value token's range and inserts a missing key before
 * the control's closing brace. Everything else is copied through byte for byte.
 *
 * `srctools.keyvalues` is not used here: it evaluates `[$WIN32]`/`[!$OSX]` and discards
 * the tags, which is exactly the information a writer must preserve.
 */
import type { HudControl, HudDocument } from "./res.js";
import type { KvPair } from "../kv/parse.js";

export interface HudEdit {
  /** Control path, fieldName or block name. Ambiguity is refused, never guessed. */
  control: string;
  key: string;
  value: string;
  /** Optional condition, with or without brackets. */
  condition?: string;
}

export interface AppliedHudEdit {
  control: string;
  key: string;
  value: string;
  condition: string | null;
  previous: string | null;
  action: "replaced" | "added";
}

function conditionKey(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text === "") return null;
  return text.replace(/\s+/g, "").toLowerCase();
}

function normalizeCondition(text: string | undefined): string | null {
  if (text === undefined || text.trim() === "") return null;
  const trimmed = text.trim();
  const bracketed = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed : `[${trimmed}]`;
  return bracketed;
}

function pairCondition(pair: KvPair): string | null {
  if (!pair.conditions || pair.conditions.length === 0) return null;
  return pair.conditions.map((condition) => condition.text).join(" ");
}

/** Finds one control by path, fieldName or unique name. */
export function findHudControl(document: HudDocument, selector: string): HudControl {
  const lowered = selector.toLowerCase();
  const byPath = document.controls.find((control) => control.path.toLowerCase() === lowered);
  if (byPath) return byPath;

  const byField = document.controls.filter(
    (control) => control.fieldName?.toLowerCase() === lowered,
  );
  if (byField.length === 1) return byField[0]!;
  if (byField.length > 1) {
    throw new Error(
      `control selector "${selector}" matches ${byField.length} fieldName values: ` +
        byField.map((control) => control.path).join(", ") +
        ". Pass the full control path.",
    );
  }

  const byName = document.controls.filter((control) => control.name.toLowerCase() === lowered);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new Error(
      `control selector "${selector}" matches ${byName.length} blocks: ` +
        byName.map((control) => control.path).join(", ") +
        ". Pass the full control path.",
    );
  }

  throw new Error(
    `no control named "${selector}" in this file. ` +
      `Known controls: ${document.controls
        .slice(0, 20)
        .map((control) => control.path)
        .join(", ")}${document.controls.length > 20 ? ", ..." : ""}`,
  );
}

/** The value currently stored under a control/key/condition, or null. */
export function findHudValue(
  document: HudDocument,
  controlPath: string,
  key: string,
  condition: string | null,
): string | null {
  const control = document.controls.find((candidate) => candidate.path === controlPath);
  if (!control) return null;
  const wantedKey = key.toLowerCase();
  const wantedCondition = conditionKey(condition);
  for (const entry of control.block.entries) {
    if (entry.kind !== "pair" || entry.key.toLowerCase() !== wantedKey) continue;
    if (conditionKey(pairCondition(entry)) !== wantedCondition) continue;
    return entry.value;
  }
  return null;
}

interface Insertion {
  at: number;
  indent: string;
  lines: string[];
}

function insertionFor(
  source: string,
  block: HudControl["block"],
  eol: string,
): Insertion {
  const firstEntry = block.entries[0];
  let indent = "";
  if (firstEntry) {
    const lineStart = source.lastIndexOf("\n", firstEntry.start - 1) + 1;
    const prefix = source.slice(lineStart, firstEntry.start);
    if (/^[ \t]*$/.test(prefix)) indent = prefix;
  }

  const newline = source.lastIndexOf("\n", block.bodyEnd - 1);
  let at = newline === -1 ? block.bodyStart : newline + 1;
  let closing = source.slice(at, block.bodyEnd);
  if (!/^[ \t]*$/.test(closing)) {
    at = block.bodyStart;
    closing = source.slice(at, block.bodyEnd);
  }
  if (indent === "") indent = `${/^[ \t]*$/.test(closing) ? closing : ""}\t`;
  const leading = newline === -1 ? eol : "";
  return { at, indent, lines: [leading] };
}

/**
 * Applies edits to the source. Returns the new text and what each edit did.
 *
 * All selectors and duplicate-key cases are checked before any splice is made, so a bad
 * edit refuses the whole batch instead of leaving a half-edited file.
 */
export function applyHudEdits(
  source: string,
  document: HudDocument,
  edits: readonly HudEdit[],
): { text: string; edits: AppliedHudEdit[]; eol: string } {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const insertions = new Map<HudControl["block"], Insertion>();
  const results: AppliedHudEdit[] = [];
  const claimed = new Set<string>();

  const quote = (value: string): string => {
    if (value.includes('"') || value.includes("\n") || value.includes("\r")) {
      throw new Error(
        `value ${JSON.stringify(value)} contains a quote or newline; a .res value is one ` +
          `quoted string and this writer will not guess how to escape it`,
      );
    }
    return `"${value}"`;
  };

  for (const edit of edits) {
    const control = findHudControl(document, edit.control);
    const condition = normalizeCondition(edit.condition);
    const wantedKey = edit.key.toLowerCase();
    const pairs = control.block.entries.filter(
      (entry): entry is KvPair => entry.kind === "pair" && entry.key.toLowerCase() === wantedKey,
    );

    let target: KvPair | undefined;
    if (condition === null) {
      if (pairs.length > 1) {
        throw new Error(
          `${control.path} has ${pairs.length} "${edit.key}" pairs; add a condition to choose ` +
            `one: ${pairs.map((pair) => pairCondition(pair) ?? "(none)").join(", ")}`,
        );
      }
      target = pairs[0];
    } else {
      const matching = pairs.filter(
        (pair) => conditionKey(pairCondition(pair)) === conditionKey(condition),
      );
      if (matching.length > 1) {
        throw new Error(
          `${control.path} has ${matching.length} "${edit.key}" pairs with ${condition}`,
        );
      }
      target = matching[0];
    }

    if (target) {
      const start = target.valueStart;
      const end = target.valueEnd;
      if (start === undefined || end === undefined) {
        throw new Error(`cannot replace the value of "${edit.key}" in ${control.path}: no range`);
      }
      const claim = `${start}:${end}`;
      if (claimed.has(claim)) {
        throw new Error(`${control.path} "${edit.key}" is edited more than once`);
      }
      claimed.add(claim);
      const quoted = quote(edit.value);
      replacements.push({ start, end, text: quoted });
      results.push({
        control: control.path,
        key: target.key,
        value: edit.value,
        condition: pairCondition(target),
        previous: target.value,
        action: "replaced",
      });
    } else {
      let insertion = insertions.get(control.block);
      if (!insertion) {
        insertion = insertionFor(source, control.block, eol);
        insertions.set(control.block, insertion);
      }
      const suffix = condition === null ? "" : ` ${condition}`;
      insertion.lines.push(`${insertion.indent}"${edit.key}" ${quote(edit.value)}${suffix}${eol}`);
      results.push({
        control: control.path,
        key: edit.key,
        value: edit.value,
        condition,
        previous: null,
        action: "added",
      });
    }
  }

  const splices = [
    ...replacements,
    ...[...insertions.values()].map((insertion) => ({
      start: insertion.at,
      end: insertion.at,
      text: insertion.lines.join(""),
    })),
  ].sort((a, b) => b.start - a.start || b.end - a.end);

  let text = source;
  for (const splice of splices) {
    text = text.slice(0, splice.start) + splice.text + text.slice(splice.end);
  }
  return { text, edits: results, eol };
}
