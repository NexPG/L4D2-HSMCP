/**
 * Left 4 Dead 2 campaign files (`missions/<name>.txt`).
 *
 * The file is Valve KeyValues with a `"mission"` wrapper. Its shape was read from
 * `missions/campaign1.txt` inside the game's `pak01_dir.vpk` on 16.11.2026, not from a
 * wiki: `Name`, `DisplayTitle`, `poster`, and `modes` whose entries are `coop`, `versus`,
 * `survival`, `scavenge`, each with numbered chapter blocks.
 *
 * Parsing keeps the whole KeyValues tree, including keys this module does not interpret
 * (`VersusCompletionScore`, `x360leaderboard` and friends). A campaign file is a schema
 * that grows, and dropping what we do not understand would silently rewrite a shipped
 * campaign. Serialisation writes what is in the tree, canonically.
 */
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock, KvNode, KvPair } from "../../../formats/typescript/kv/parse.js";

export interface CampaignChapter {
  /** The block's key: "1", "2", ... */
  key: string;
  map: string;
  displayName: string | null;
  image: string | null;
  /** Per-chapter launch convars, from the `convar` block. */
  convars: Record<string, string>;
  /** The parsed block, so unknown keys survive a rewrite. */
  node: KvBlock;
}

export interface CampaignMode {
  name: string;
  chapters: CampaignChapter[];
  node: KvBlock;
}

export interface Mission {
  path: string | null;
  name: string;
  displayTitle: string | null;
  image: string | null;
  modes: CampaignMode[];
  /** The whole `mission` block, including fields not modelled above. */
  node: KvBlock;
}

export class CampaignFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignFormatError";
  }
}

function firstPair(block: KvBlock, key: string): KvPair | undefined {
  return block.entries.find((e): e is KvPair => e.kind === "pair" && e.key === key);
}

function firstBlock(block: KvBlock, key: string): KvBlock | undefined {
  return block.entries.find((e): e is KvBlock => e.kind === "block" && e.name === key);
}

function value(block: KvBlock, key: string): string | null {
  return firstPair(block, key)?.value ?? null;
}

/** Parses a mission file. Throws when the wrapper or `modes` is absent. */
export function parseMission(text: string, path: string | null = null): Mission {
  const nodes = parse(text);
  const root = nodes.find((e): e is KvBlock => e.kind === "block" && e.name === "mission");
  if (!root) {
    throw new CampaignFormatError(
      `${path ?? "mission"}: no "mission" block. A campaign file is ` +
        `"mission" { "Name" ... "modes" { ... } }, not a flat list of keys`,
    );
  }

  const modesBlock = firstBlock(root, "modes");
  if (!modesBlock) {
    throw new CampaignFormatError(`${path ?? "mission"}: no "modes" block`);
  }

  const modes: CampaignMode[] = [];
  for (const entry of modesBlock.entries) {
    if (entry.kind !== "block") continue;
    const chapters: CampaignChapter[] = [];
    for (const child of entry.entries) {
      if (child.kind !== "block" || !/^\d+$/.test(child.name)) continue;
      const map = value(child, "Map");
      if (map === null) {
        throw new CampaignFormatError(
          `${path ?? "mission"}: mode "${entry.name}" chapter "${child.name}" has no "Map"`,
        );
      }
      const convarBlock = firstBlock(child, "convar");
      const convars: Record<string, string> = {};
      if (convarBlock) {
        for (const entry of convarBlock.entries) {
          if (entry.kind === "pair") convars[entry.key] = entry.value;
        }
      }
      chapters.push({
        key: child.name,
        map,
        displayName: value(child, "DisplayName"),
        image: value(child, "Image"),
        convars,
        node: child,
      });
    }
    chapters.sort((a, b) => Number(a.key) - Number(b.key));
    modes.push({ name: entry.name, chapters, node: entry });
  }

  return {
    path,
    name: value(root, "Name") ?? "",
    displayTitle: value(root, "DisplayTitle"),
    image: value(root, "Image"),
    modes,
    node: root,
  };
}

/** Quotes a KeyValues string, refusing what the grammar cannot represent. */
function quote(text: string): string {
  if (text.includes('"') || text.includes("\n") || text.includes("\r")) {
    throw new CampaignFormatError(
      `a campaign value cannot contain a quote or a newline: ${JSON.stringify(text)}`,
    );
  }
  return `"${text}"`;
}

function serializeNodes(nodes: readonly KvNode[], indent: number, out: string[]): void {
  const tabs = "\t".repeat(indent);
  for (const node of nodes) {
    if (node.kind === "pair") {
      out.push(`${tabs}${quote(node.key)}\t\t${quote(node.value)}`);
      continue;
    }
    out.push(`${tabs}${quote(node.name)}`);
    out.push(`${tabs}{`);
    serializeNodes(node.entries, indent + 1, out);
    out.push(`${tabs}}`);
  }
}

/** Canonical text for the whole mission tree, unknown keys included. */
export function serializeMission(mission: Mission | KvBlock): string {
  const node = "node" in mission ? mission.node : mission;
  const out: string[] = [];
  out.push(quote(node.name));
  out.push("{");
  serializeNodes(node.entries, 1, out);
  out.push("}");
  out.push("");
  return out.join("\n");
}

/** What `write_campaign` accepts: only the fields a caller should have to supply. */
export interface CampaignSpec {
  name: string;
  displayTitle?: string;
  description?: string;
  image?: string;
  author?: string;
  /**
   * Any extra mission-level keyvalue. Structural blocks (`modes`) and the fields above
   * cannot be replaced this way; the fields cover those.
   */
  keyvalues?: Record<string, string>;
  modes: Array<{
    name: string;
    /** Any extra key on the mode block. Numeric keys would collide with chapters. */
    keyvalues?: Record<string, string>;
    chapters: Array<{
      map: string;
      displayName: string;
      image?: string;
      /** Launch convars for this chapter, e.g. z_finale_spawn_mob_safety_range. */
      convars?: Record<string, string>;
      /** Any extra chapter key except `Map` and the `convar` block. */
      keyvalues?: Record<string, string>;
    }>;
  }>;
}

function pair(key: string, valueText: string): KvPair {
  return { kind: "pair", key, value: valueText, start: 0, end: 0 };
}

function block(name: string, entries: KvNode[]): KvBlock {
  return { kind: "block", name, entries, start: 0, end: 0, bodyStart: 0, bodyEnd: 0 };
}

/** Replaces a pair in place, or appends it. Used for caller-supplied extra keys. */
function upsert(entries: KvNode[], key: string, valueText: string): void {
  const index = entries.findIndex((e) => e.kind === "pair" && e.key === key);
  if (index >= 0) entries[index] = pair(key, valueText);
  else entries.push(pair(key, valueText));
}

/** Builds a mission tree from the small shape a caller can reasonably provide. */
export function missionFromSpec(spec: CampaignSpec): Mission {
  const rootEntries: KvNode[] = [
    pair("Name", spec.name),
    pair("Version", "1"),
    pair("Author", spec.author ?? ""),
  ];
  if (spec.displayTitle) rootEntries.push(pair("DisplayTitle", spec.displayTitle));
  if (spec.description) rootEntries.push(pair("Description", spec.description));
  if (spec.image) rootEntries.push(pair("Image", spec.image));
  for (const [key, valueText] of Object.entries(spec.keyvalues ?? {})) {
    if (["Name", "DisplayTitle", "Description", "Image", "Author", "modes"].includes(key)) {
      throw new CampaignFormatError(
        `"${key}" has its own field; keyvalues are for keys this spec does not model`,
      );
    }
    upsert(rootEntries, key, valueText);
  }

  const modeBlocks: KvNode[] = spec.modes.map((mode) => {
    const chapterBlocks: KvNode[] = mode.chapters.map((chapter, i) => {
      const entries: KvNode[] = [
        pair("Map", chapter.map),
        pair("DisplayName", chapter.displayName),
      ];
      if (chapter.image) entries.push(pair("Image", chapter.image));
      if (chapter.convars && Object.keys(chapter.convars).length > 0) {
        entries.push(
          block(
            "convar",
            Object.entries(chapter.convars).map(([key, valueText]) => pair(key, valueText)),
          ),
        );
      }
      for (const [key, valueText] of Object.entries(chapter.keyvalues ?? {})) {
        if (["Map", "DisplayName", "Image", "convar"].includes(key)) {
          throw new CampaignFormatError(
            `chapter keyvalues cannot use "${key}": it has its own field`,
          );
        }
        upsert(entries, key, valueText);
      }
      return block(String(i + 1), entries);
    });

    const modeEntries: KvNode[] = [...chapterBlocks];
    for (const [key, valueText] of Object.entries(mode.keyvalues ?? {})) {
      if (/^\d+$/.test(key)) {
        throw new CampaignFormatError(
          `mode keyvalues cannot use "${key}": numbered keys are chapter blocks`,
        );
      }
      upsert(modeEntries, key, valueText);
    }
    return block(mode.name, modeEntries);
  });
  rootEntries.push(block("modes", modeBlocks));

  const root = block("mission", rootEntries);
  return {
    path: null,
    name: spec.name,
    displayTitle: spec.displayTitle ?? null,
    image: spec.image ?? null,
    modes: spec.modes.map((mode, i) => ({
      name: mode.name,
      node: modeBlocks[i] as KvBlock,
      chapters: mode.chapters.map((chapter, j) => ({
        key: String(j + 1),
        map: chapter.map,
        displayName: chapter.displayName,
        image: chapter.image ?? null,
        convars: chapter.convars ?? {},
        node: (modeBlocks[i] as KvBlock).entries[j] as KvBlock,
      })),
    })),
    node: root,
  };
}

export interface CampaignFinding {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  mode?: string;
  chapter?: string;
}

/**
 * Structural checks that need no disk: numbering, names, map identifiers.
 *
 * The numbering is a rule, not a style choice: the game indexes chapters by those keys.
 */
export function checkMissionStructure(mission: Mission): CampaignFinding[] {
  const findings: CampaignFinding[] = [];
  if (!mission.name.trim()) {
    findings.push({
      severity: "error",
      rule: "mission-name-missing",
      message: 'the mission block has no "Name"',
    });
  }
  if (mission.modes.length === 0) {
    findings.push({
      severity: "error",
      rule: "no-modes",
      message: 'the "modes" block declares no mode at all',
    });
  }

  for (const mode of mission.modes) {
    if (mode.chapters.length === 0) {
      findings.push({
        severity: "error",
        rule: "empty-mode",
        message: `mode "${mode.name}" has no chapters`,
        mode: mode.name,
      });
    }
    const seen = new Set<string>();
    for (let i = 0; i < mode.chapters.length; i++) {
      const chapter = mode.chapters[i]!;
      const expected = String(i + 1);
      if (chapter.key !== expected) {
        findings.push({
          severity: "error",
          rule: "chapter-numbering",
          message: `chapter ${i + 1} of mode "${mode.name}" is keyed "${chapter.key}"; ` +
            `the game reads them as "1", "2", ... with no gaps`,
          mode: mode.name,
          chapter: chapter.key,
        });
      }
      if (!chapter.map.trim()) {
        findings.push({
          severity: "error",
          rule: "map-missing-name",
          message: `chapter ${chapter.key} of mode "${mode.name}" has an empty "Map"`,
          mode: mode.name,
          chapter: chapter.key,
        });
      } else if (/[\\/]/.test(chapter.map) || /\.bsp$/i.test(chapter.map)) {
        findings.push({
          severity: "error",
          rule: "map-not-a-name",
          message: `chapter ${chapter.key} of mode "${mode.name}" uses "${chapter.map}"; ` +
            `"Map" is the .bsp file name without a path or extension`,
          mode: mode.name,
          chapter: chapter.key,
        });
      } else if (seen.has(chapter.map)) {
        findings.push({
          severity: "warning",
          rule: "chapter-duplicate-map",
          message: `mode "${mode.name}" lists "${chapter.map}" more than once`,
          mode: mode.name,
          chapter: chapter.key,
        });
      }
      seen.add(chapter.map);
      if (!chapter.displayName?.trim()) {
        findings.push({
          severity: "warning",
          rule: "display-name-missing",
          message: `chapter ${chapter.key} of mode "${mode.name}" has no "DisplayName"; ` +
            `the lobby will show nothing for it`,
          mode: mode.name,
          chapter: chapter.key,
        });
      }
    }
  }
  return findings;
}

export interface CampaignFiles {
  /** Directories holding `<map>.bsp`. */
  mapsDirs: string[];
  /** Directories holding `vgui/maps/<image>.vmt` (i.e. `materials/`). */
  materialsDirs: string[];
  /** Entry paths from a VPK, when the campaign ships or is checked there. */
  vpkEntries?: ReadonlySet<string>;
}

/**
 * Checks what the campaign references against the files that exist.
 *
 * A map may live in a directory or in a VPK; both count. An image may be a `.vmt` or a
 * `.vtf`, because a material can be either a shader or a raw texture.
 */
export function checkMissionFiles(
  mission: Mission,
  files: CampaignFiles,
  exists: (path: string) => boolean,
): CampaignFinding[] {
  const findings: CampaignFinding[] = [];
  const inVpk = (path: string): boolean => files.vpkEntries?.has(path.toLowerCase()) ?? false;

  for (const mode of mission.modes) {
    for (const chapter of mode.chapters) {
      const map = chapter.map;
      if (!map) continue;
      const mapFile = `${map}.bsp`;
      const found =
        files.mapsDirs.some((dir) => exists(`${dir}/${mapFile}`)) ||
        inVpk(`maps/${mapFile}`);
      if (!found) {
        findings.push({
          severity: "error",
          rule: "map-file-missing",
          message: `mode "${mode.name}" chapter ${chapter.key} points at maps/${mapFile}, ` +
            `and it exists in no maps directory or VPK given`,
          mode: mode.name,
          chapter: chapter.key,
        });
      }
      if (chapter.image) {
        const base = chapter.image.replace(/^materials\//, "");
        const candidates = [`vgui/${base}.vmt`, `vgui/${base}.vtf`];
        const imageFound = candidates.some(
          (rel) =>
            files.materialsDirs.some((dir) => exists(`${dir}/${rel}`)) ||
            inVpk(`materials/${rel}`),
        );
        if (!imageFound) {
          findings.push({
            severity: "warning",
            rule: "image-missing",
            message: `chapter ${chapter.key} of mode "${mode.name}" uses image ` +
              `"${chapter.image}", and no materials/${candidates.join(" or materials/")} exists`,
            mode: mode.name,
            chapter: chapter.key,
          });
        }
      }
    }
  }
  return findings;
}
