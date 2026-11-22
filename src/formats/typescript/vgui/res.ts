/**
 * VGUI `.res` screens, read as a flat control tree.
 *
 * The grammar is KeyValues with two additions the VMF parser used to reject: a condition
 * after a block name (`"Child" [$WIN32] {`) and after a value (`"visible" "1" [!$OSX]`).
 * `kv/parse.ts` now keeps both, with offsets, so a writer can change a value and leave the
 * condition and every byte around it alone.
 *
 * `srctools.keyvalues` can parse these files, but it evaluates the conditions against the
 * host platform and drops the tags. A HUD tool has to show a `[$X360]` control as an X360
 * control on a Windows machine, so this reads the structure itself; see
 * `docs/reference/library-boundary.md`.
 */
import { parse } from "../kv/parse.js";
import type { KvBlock, KvPair } from "../kv/parse.js";

export interface HudValue {
  key: string;
  value: string;
  /** The bracketed condition, or null when unconditional. */
  condition: string | null;
}

export interface HudControl {
  /** Slash-separated names from the root, e.g. `Audio/SldGameVolume`. */
  path: string;
  name: string;
  depth: number;
  condition: string | null;
  controlName: string | null;
  fieldName: string | null;
  xpos: string | null;
  ypos: string | null;
  wide: string | null;
  tall: string | null;
  zpos: string | null;
  visible: string | null;
  enabled: string | null;
  values: HudValue[];
  children: number;
  /** The parsed block, for the writer. Not part of the JSON reply. */
  block: KvBlock;
}

export interface HudDocument {
  /** The root block's name, which is the resource path (`Resource/UI/...`). */
  root: string;
  controls: HudControl[];
  maxDepth: number;
  /** Pairs directly under the root, if the file has any. */
  rootValues: HudValue[];
}

function conditionText(block: KvBlock | KvPair): string | null {
  if (!block.conditions || block.conditions.length === 0) return null;
  return block.conditions.map((condition) => condition.text).join(" ");
}

function firstValue(block: KvBlock, key: string): string | null {
  const wanted = key.toLowerCase();
  for (const entry of block.entries) {
    if (entry.kind === "pair" && entry.key.toLowerCase() === wanted) return entry.value;
  }
  return null;
}

function valuesOf(block: KvBlock): HudValue[] {
  return block.entries
    .filter((entry): entry is KvPair => entry.kind === "pair")
    .map((entry) => ({
      key: entry.key,
      value: entry.value,
      condition: conditionText(entry),
    }));
}

/** Parses a `.res` into controls in source order, pre-order (parent before children). */
export function parseHud(source: string): HudDocument {
  const nodes = parse(source);
  const root = nodes.find((node): node is KvBlock => node.kind === "block");
  if (!root) throw new Error("a .res file has no root resource block");

  const controls: HudControl[] = [];
  let maxDepth = 0;

  const walk = (block: KvBlock, parent: string, depth: number): void => {
    const path = parent === "" ? block.name : `${parent}/${block.name}`;
    const childBlocks = block.entries.filter((entry): entry is KvBlock => entry.kind === "block");
    controls.push({
      path,
      name: block.name,
      depth,
      condition: conditionText(block),
      controlName: firstValue(block, "ControlName"),
      fieldName: firstValue(block, "fieldName"),
      xpos: firstValue(block, "xpos"),
      ypos: firstValue(block, "ypos"),
      wide: firstValue(block, "wide"),
      tall: firstValue(block, "tall"),
      zpos: firstValue(block, "zpos"),
      visible: firstValue(block, "visible"),
      enabled: firstValue(block, "enabled"),
      values: valuesOf(block),
      children: childBlocks.length,
      block,
    });
    maxDepth = Math.max(maxDepth, depth);
    for (const child of childBlocks) walk(child, path, depth + 1);
  };

  for (const entry of root.entries) {
    if (entry.kind === "block") walk(entry, "", 1);
  }

  return {
    root: root.name,
    controls,
    maxDepth,
    rootValues: valuesOf(root),
  };
}

/** Case-insensitive substring match over the names, values and conditions of a control. */
export function hudControlMatches(control: HudControl, needle: string): boolean {
  const lower = needle.toLowerCase();
  const fields = [
    control.path,
    control.name,
    control.condition ?? "",
    control.controlName ?? "",
    control.fieldName ?? "",
    control.xpos ?? "",
    control.ypos ?? "",
    control.wide ?? "",
    control.tall ?? "",
    ...control.values.flatMap((value) => [value.key, value.value, value.condition ?? ""]),
  ];
  return fields.some((field) => field.toLowerCase().includes(lower));
}
