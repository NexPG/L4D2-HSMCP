/**
 * `.rect` — Hammer++'s hotspot rectangles.
 *
 * The format is plain KeyValues, not a binary one:
 *
 * ```
 * output_scale 0.5
 * Rectangles
 * {
 *     rectangle
 *     {
 *         "min" "0 0"
 *         "max" "32 64"
 *     }
 * }
 * ```
 *
 * `output_scale` is optional and scales every coordinate when the rectangles were drawn on a
 * downscaled preview. Coordinates are in texture pixels, origin at the top-left; `min` is the
 * top-left corner and `max` the bottom-right. L4D2 ships no `.rect` files, so this reader is
 * built from the format itself rather than from a stock example — which is also why the
 * round-trip test is the oracle here.
 */
import { children, get, parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";

export class RectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RectFileError";
  }
}

export interface HotspotRect {
  /** Top-left corner in texture pixels. */
  mins: [number, number];
  /** Bottom-right corner in texture pixels. */
  maxs: [number, number];
}

export interface RectFile {
  /** Multiply every coordinate by this. Null when the file does not carry the key. */
  outputScale: number | null;
  rectangles: HotspotRect[];
  warnings: string[];
}

function pair(text: string | undefined): [number, number] | null {
  if (text === undefined) return null;
  const numbers = text.trim().split(/\s+/).map(Number);
  if (numbers.length !== 2 || numbers.some((n) => !Number.isFinite(n))) return null;
  return [numbers[0]!, numbers[1]!];
}

const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));

/** Reads a `.rect` file. Unknown blocks are ignored, as Hammer ignores them. */
export function readRectFile(source: string): RectFile {
  const nodes = parse(source);
  const roots = nodes.filter((node): node is KvBlock => node.kind === "block");
  const block = roots.find((root) => root.name.toLowerCase() === "rectangles");
  if (!block) {
    throw new RectFileError(
      "this is not a .rect file: no `Rectangles` block was found. The format is KeyValues " +
        "with one `rectangle` child per hotspot.",
    );
  }

  const rawScale = nodes.find(
    (node) => node.kind === "pair" && node.key.toLowerCase() === "output_scale",
  );
  let outputScale: number | null = null;
  if (rawScale && rawScale.kind === "pair") {
    const parsed = Number(rawScale.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new RectFileError(`output_scale must be a positive number, not ${rawScale.value}`);
    }
    outputScale = parsed;
  }

  const warnings: string[] = [];
  const rectangles: HotspotRect[] = [];
  for (const [index, rect] of children(block, "rectangle").entries()) {
    const mins = pair(get(rect, "min"));
    const maxs = pair(get(rect, "max"));
    if (!mins || !maxs) {
      warnings.push(`rectangle ${index} has no readable min/max pair; it was skipped`);
      continue;
    }
    if (maxs[0] <= mins[0] || maxs[1] <= mins[1]) {
      warnings.push(
        `rectangle ${index} has max <= min (${mins.join(" ")} .. ${maxs.join(" ")}); it was skipped`,
      );
      continue;
    }
    rectangles.push({ mins, maxs });
  }

  if (rectangles.length === 0) {
    warnings.push("the file contains no usable rectangle");
  }
  return { outputScale, rectangles, warnings };
}

/** Writes the canonical form: one rectangle per hotspot, no trailing newline issues. */
export function writeRectFile(
  rectangles: readonly HotspotRect[],
  options: { outputScale?: number } = {},
): string {
  if (rectangles.length === 0) {
    throw new RectFileError("a .rect file needs at least one rectangle");
  }
  for (const [index, rect] of rectangles.entries()) {
    if (
      rect.maxs[0] <= rect.mins[0] ||
      rect.maxs[1] <= rect.mins[1] ||
      [...rect.mins, ...rect.maxs].some((n) => !Number.isFinite(n))
    ) {
      throw new RectFileError(
        `rectangle ${index} needs finite coordinates and max above min on both axes`,
      );
    }
  }
  if (options.outputScale !== undefined && (!Number.isFinite(options.outputScale) || options.outputScale <= 0)) {
    throw new RectFileError(`output_scale must be a positive number, not ${options.outputScale}`);
  }

  let out = "";
  if (options.outputScale !== undefined && options.outputScale !== 1) {
    out += `output_scale ${num(options.outputScale)}\n`;
  }
  out += "Rectangles\n{\n";
  for (const rect of rectangles) {
    out +=
      `\trectangle\n\t{\n` +
      `\t\t"min" "${num(rect.mins[0])} ${num(rect.mins[1])}"\n` +
      `\t\t"max" "${num(rect.maxs[0])} ${num(rect.maxs[1])}"\n` +
      `\t}\n`;
  }
  out += "}\n";
  return out;
}
