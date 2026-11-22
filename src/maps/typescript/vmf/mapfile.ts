/**
 * Exporting a `.vmf` to Valve's `.map` (format 220).
 *
 * A `.map` face is the same three points a VMF stores, followed by the texture and the two
 * texture axes. VMF's `uaxis`/`vaxis` already carry the axis and offset in exactly the
 * bracket form the format wants, so the export is a translation rather than a rebuild:
 * geometry, material names and alignment survive.
 *
 * The formats are not equivalent. `.map` has no visgroups, instances, displacements or
 * editor blocks, so those are counted and reported as warnings rather than silently lost.
 */
import { children, get, parse, pairs } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock } from "../../../formats/typescript/kv/parse.js";

export class MapExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapExportError";
  }
}

export interface MapExport {
  text: string;
  entities: number;
  brushes: number;
  faces: number;
  warnings: string[];
}

const vec = (value: string): string => value.trim().replace(/\s+/g, " ");
const quote = (value: string): string => {
  if (value.includes('"') || value.includes("\n") || value.includes("\r")) {
    throw new MapExportError(`a .map value cannot contain a quote or newline: ${JSON.stringify(value)}`);
  }
  return `"${value}"`;
};

interface Axis {
  bracket: string;
  scale: string;
}

function axis(raw: string | undefined, fallback: Axis): Axis {
  if (!raw) return fallback;
  const match = /^\[([^\]]+)\]\s+(\S+)$/.exec(raw.trim());
  if (!match) return fallback;
  return { bracket: `[ ${vec(match[1]!)} ]`, scale: match[2]! };
}

function faceLine(side: KvBlock, warnings: string[]): string | null {
  const plane = get(side, "plane");
  if (!plane) {
    warnings.push("a side has no plane and was skipped");
    return null;
  }
  const material = get(side, "material") ?? "TOOLS/TOOLSNODRAW";
  const u = axis(get(side, "uaxis"), { bracket: "[ 1 0 0 0 ]", scale: "1" });
  const v = axis(get(side, "vaxis"), { bracket: "[ 0 -1 0 0 ]", scale: "1" });
  return `${vec(plane)} ${material} ${u.bracket} ${v.bracket} 0 ${u.scale} ${v.scale}`;
}

function brush(block: KvBlock, warnings: string[]): string | null {
  const sides = children(block, "side");
  if (sides.length === 0) {
    warnings.push("a solid has no side blocks and was skipped");
    return null;
  }
  const lines = sides.map((side) => faceLine(side, warnings)).filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return `{\n${lines.join("\n")}\n}`;
}

function entityKeyvalues(block: KvBlock, isWorld: boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [key, value] of pairs(block)) {
    if (key === "id") continue;
    if (isWorld && (key === "classname" || key === "mapversion")) continue;
    out.push(`${quote(key)} ${quote(value)}`);
    seen.add(key);
  }
  if (isWorld && !seen.has("classname")) out.unshift('"classname" "worldspawn"');
  if (isWorld && !seen.has("mapversion")) out.splice(1, 0, '"mapversion" "220"');
  return out;
}

function entity(block: KvBlock, isWorld: boolean, warnings: string[]): string | null {
  const solids = children(block, "solid");
  const brushes = solids
    .map((solid) => brush(solid, warnings))
    .filter((text): text is string => text !== null);
  const connections = children(block, "connections")[0];
  const outputs = connections ? pairs(connections).map(([k, v]) => `${quote(k)} ${quote(v)}`) : [];
  const keyvalues = entityKeyvalues(block, isWorld);
  if (!isWorld && brushes.length === 0 && keyvalues.length === 0) return null;
  return `{\n${[...keyvalues, ...outputs, ...brushes].join("\n")}\n}`;
}

/** Converts the whole VMF tree. Unknown blocks are counted, not shown, and warned about. */
export function exportMap(source: string): MapExport {
  const nodes = parse(source);
  const roots = nodes.filter((n): n is KvBlock => n.kind === "block");
  const world = roots.find((b) => b.name === "world");
  if (!world) throw new MapExportError("this file has no `world` block");

  const warnings: string[] = [];
  const entities: string[] = [];
  let brushes = 0;
  let faces = 0;

  const worldText = entity(world, true, warnings);
  if (worldText) entities.push(worldText);
  for (const block of roots) {
    if (block.name === "entity") {
      const text = entity(block, false, warnings);
      if (text) entities.push(text);
    } else if (block.name !== "world") {
      warnings.push(`block "${block.name}" is not represented in a .map and was skipped`);
    }
  }

  for (const block of roots) {
    for (const solid of children(block, "solid")) {
      brushes += 1;
      faces += children(solid, "side").length;
    }
  }

  if (source.includes("dispinfo")) {
    warnings.push("displacements are VMF-only and are not represented in a .map");
  }
  if (source.includes("func_instance")) {
    warnings.push("func_instance is a VMF construct; the .map contains the reference, not the expanded geometry");
  }

  return {
    text: `${entities.join("\n\n")}\n`,
    entities: entities.length,
    brushes,
    faces,
    warnings,
  };
}
