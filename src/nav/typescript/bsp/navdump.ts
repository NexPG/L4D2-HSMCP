/**
 * The text dump the engine writes beside a generated nav mesh (`<map>_nav.txt`).
 *
 * The `.nav` itself is a binary format whose L4D2 layout is not documented here; the dump
 * is the readable view the engine produces, and it carries the two things that decide
 * which goals and spawn attributes a mesh carries, and its connections. The dump does
 * NOT carry the Director's flow; a goal is not a playable flow. Parsing it answers
 * "does this mesh have a goal and spawn areas", and the live `nav_trouble_report` answers
 * whether the flow exists.
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
    mostlyFlat: number;
    areasWithConnections: number;
    /**
     * Always false: the text dump has no flow distance/path field. Kept explicit so a
     * caller cannot mistake "goal present" for "flow proven".
     */
    flowProven: false;
  };
  verdict: "goal-present" | "no-goal" | "empty";
}

const BASE_ATTRIBUTES: Array<[number, string]> = [
  // 0x20000000 is NAV_MESH_MOSTLY_FLAT (navfile.ts NAV_FLAGS). It is not flow: the
  // official maps have 0 ESCAPE_ROUTE spawn attributes and most areas carry this bit.
  [0x20000000, "mostly-flat"],
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
  [0x80000, "no-threat"],
  [0x100000, "lying-down"],
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

  const blocks = text.split(/NAV AREA[^\S\r\n]*\r?\n-+/i).slice(1);
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
    mostlyFlat: areas.filter((a) => a.attributes.includes("mostly-flat")).length,
    areasWithConnections: areas.filter((a) => a.connections > 0).length,
    flowProven: false as const,
  };

  const hasGoal = summary.checkpoint > 0 || summary.finale > 0;
  // The dump can prove a goal and spawn areas. It cannot prove flow: the engine's flow
  // distances are not in this text, and 0x20000000 is MOSTLY_FLAT. The live
  // `nav_trouble_report`/`nav_analyze` is the flow oracle.
  const verdict: NavDumpReport["verdict"] =
    areas.length === 0 ? "empty" : !hasGoal ? "no-goal" : "goal-present";

  return {
    path,
    areaCount: Number.parseInt(countMatch[1]!, 10),
    areas,
    summary,
    verdict,
  };
}
