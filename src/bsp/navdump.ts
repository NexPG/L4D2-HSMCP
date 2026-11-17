/**
 * The text dump the engine writes beside a generated nav mesh (`<map>_nav.txt`).
 *
 * The `.nav` itself is a binary format whose L4D2 layout is not documented here; the dump
 * is the readable view the engine produces, and it carries the two things that decide
 * whether a mesh is playable: the attribute flags on each area and the area-to-area
 * connections. Parsing the dump is how `read_nav_dump` answers "is this mesh a map the
 * Director can run?" without loading the game.
 */

export interface NavDumpArea {
  center: [number, number, number];
  north: number;
  east: number;
  south: number;
  west: number;
  baseFlags: number;
  terrorFlags: number;
  /** Decoded names for the bits this project has verified. */
  attributes: string[];
  connections: number;
}

export interface NavDumpReport {
  path: string;
  areaCount: number;
  areas: NavDumpArea[];
  summary: {
    checkpoint: number;
    playerStart: number;
    finale: number;
    escapeRoute: number;
    areasWithConnections: number;
  };
  verdict: "playable" | "no-goal" | "no-flow" | "empty";
}

const BASE_ATTRIBUTES: Array<[number, string]> = [
  [0x20000000, "escape-route"],
];

const TERROR_ATTRIBUTES: Array<[number, string]> = [
  [0x2, "empty"],
  [0x20, "battlestation"],
  [0x40, "finale"],
  [0x80, "player-start"],
  [0x100, "battlefield"],
  [0x800, "checkpoint"],
  [0x1000, "not-clearable"],
  [0x2000, "no-mobs"],
  [0x8000, "rescue-vehicle"],
  [0x10000, "rescue-closet"],
];

function decode(flags: number, table: Array<[number, string]>): string[] {
  return table.filter(([bit]) => (flags & bit) !== 0).map(([, name]) => name);
}

function intField(block: string, label: string): number {
  const match = new RegExp(`${label}:\\s*(-?\\d+)`, "i").exec(block);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

function flagsField(block: string, label: string): number {
  const match = new RegExp(`${label}:\\s*0x([0-9a-f]+)`, "i").exec(block);
  return match ? Number.parseInt(match[1]!, 16) : 0;
}

function centerField(block: string): [number, number, number] {
  const match = /Center Position:\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/i.exec(block);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Parses a Nav Mesh Text Dump.
 *
 * Throws when the file is not a dump at all rather than returning an empty mesh: an empty
 * mesh and a wrong file are different answers, and only one of them means "regenerate".
 */
export function parseNavDump(path: string, text: string): NavDumpReport {
  const countMatch = /Number of Nav Areas:\s*(\d+)/i.exec(text);
  if (!countMatch) {
    throw new Error(`${path}: not a nav mesh text dump (no area count)`);
  }

  const blocks = text.split(/NAV AREA\s*\r?\n-+/i).slice(1);
  const areas: NavDumpArea[] = blocks.map((block) => {
    const baseFlags = flagsField(block, "Base Attribute Flags");
    const terrorFlags = flagsField(block, "Terror Spawn Attribute Flags");
    const north = intField(block, "North Connection Count");
    const east = intField(block, "East Connection Count");
    const south = intField(block, "South Connection Count");
    const west = intField(block, "West Connection Count");
    return {
      center: centerField(block),
      north,
      east,
      south,
      west,
      baseFlags,
      terrorFlags,
      attributes: [...decode(baseFlags, BASE_ATTRIBUTES), ...decode(terrorFlags, TERROR_ATTRIBUTES)],
      connections: north + east + south + west,
    };
  });

  const summary = {
    checkpoint: areas.filter((a) => a.attributes.includes("checkpoint")).length,
    playerStart: areas.filter((a) => a.attributes.includes("player-start")).length,
    finale: areas.filter((a) => a.attributes.includes("finale")).length,
    escapeRoute: areas.filter((a) => a.attributes.includes("escape-route")).length,
    areasWithConnections: areas.filter((a) => a.connections > 0).length,
  };

  const hasGoal = summary.checkpoint > 0 || summary.finale > 0;
  const verdict: NavDumpReport["verdict"] =
    areas.length === 0
      ? "empty"
      : !hasGoal
        ? "no-goal"
        : summary.escapeRoute === 0
          ? "no-flow"
          : "playable";

  return {
    path,
    areaCount: Number.parseInt(countMatch[1]!, 10),
    areas,
    summary,
    verdict,
  };
}
