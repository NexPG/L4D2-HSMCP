import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  checkMissionFiles,
  checkMissionStructure,
  missionFromSpec,
  parseMission,
  serializeMission,
} from "../campaign/mission.js";
import type { CampaignFinding, Mission } from "../campaign/mission.js";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { resolveInput } from "./paths.js";

const CHAPTER = z.object({
  key: z.string(),
  map: z.string(),
  displayName: z.string().nullable(),
  image: z.string().nullable(),
});

const MODE = z.object({ name: z.string(), chapters: z.array(CHAPTER) });

const SOURCE = z.object({
  kind: z.enum(["file", "vpk"]),
  path: z.string(),
  entry: z.string().nullable(),
});

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  mode: z.string().optional(),
  chapter: z.string().optional(),
});

/** Resolves the mission text from a file or from a VPK entry. */
async function loadMission(
  config: import("../config.js").Config,
  args: { path?: string; vpk?: string; entry?: string },
): Promise<{ mission: Mission; source: { kind: "file" | "vpk"; path: string; entry: string | null } }> {
  const fromFile = args.path !== undefined;
  const fromVpk = args.vpk !== undefined || args.entry !== undefined;
  if (fromFile === fromVpk) {
    throw new Error("give either `path` (a .txt on disk) or both `vpk` and `entry`");
  }
  if (fromVpk && !(args.vpk && args.entry)) {
    throw new Error("reading from a VPK needs both `vpk` and `entry`");
  }

  if (fromFile) {
    const path = resolveInput(args.path as string, config);
    return {
      mission: parseMission(readFileSync(path, "utf8"), path),
      source: { kind: "file", path, entry: null },
    };
  }

  const vpk = resolveInput(args.vpk as string, config);
  const entry = args.entry as string;
  const reply = await callSidecar<{ text: string }>(
    "vpk_read",
    { path: vpk, entry },
    config,
    120_000,
  );
  return {
    mission: parseMission(reply.text, `${vpk}:${entry}`),
    source: { kind: "vpk", path: vpk, entry },
  };
}

function summary(mission: Mission): {
  modes: Array<{ name: string; chapters: Array<{ key: string; map: string; displayName: string | null; image: string | null }> }>;
  chapterCount: number;
} {
  const modes = mission.modes.map((mode) => ({
    name: mode.name,
    chapters: mode.chapters.map((c) => ({
      key: c.key,
      map: c.map,
      displayName: c.displayName,
      image: c.image,
    })),
  }));
  return { modes, chapterCount: modes.reduce((n, m) => n + m.chapters.length, 0) };
}

export const readCampaignTool = defineTool({
  name: "read_campaign",
  description:
    "Reads a Left 4 Dead 2 campaign file: the `mission` block, its modes (coop, versus, " +
    "survival, scavenge) and each mode's numbered chapters with the map, display name and " +
    "image. Accepts a `.txt` on disk, or a `vpk` plus the entry inside it -- the game's " +
    "own campaigns live in `left4dead2/pak01_dir.vpk` under `missions/`. Unknown keys and " +
    "nested blocks are kept, so a later write does not silently drop them.",
  realm: "map",
  inputSchema: {
    path: z.string().optional().describe("Path to the mission .txt, absolute or relative to the repo root."),
    vpk: z.string().optional().describe("Path to a .vpk, when the mission lives inside one."),
    entry: z.string().optional().describe("Entry inside the VPK, e.g. missions/campaign1.txt."),
  },
  outputSchema: {
    source: SOURCE,
    name: z.string(),
    displayTitle: z.string().nullable(),
    image: z.string().nullable(),
    modes: z.array(MODE),
    chapterCount: z.number(),
    modeNames: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const { mission, source } = await loadMission(ctx.config, args);
    const body = summary(mission);
    return {
      source,
      name: mission.name,
      displayTitle: mission.displayTitle,
      image: mission.image,
      modes: body.modes,
      chapterCount: body.chapterCount,
      modeNames: mission.modes.map((m) => m.name),
    };
  },
});

export const writeCampaignTool = defineTool({
  name: "write_campaign",
  description:
    "Writes a campaign file from a name and a list of modes with numbered chapters. " +
    "Refuses to overwrite unless `overwrite` is set, and refuses a structurally invalid " +
    "campaign (no name, an empty mode, a map given with a path or extension) rather than " +
    "writing one the game will not read. The file is written through the same write guard " +
    "as every other writer.",
  realm: "map",
  guarded: true,
  inputSchema: {
    out: z.string().optional().describe("Destination .txt, absolute or relative to the repo root."),
    name: z.string().describe('The mission "Name", e.g. "L4D2C1".'),
    displayTitle: z.string().optional().describe("Localisation token or plain title."),
    description: z.string().optional(),
    image: z.string().optional().describe('Campaign image, e.g. "maps/c1".'),
    author: z.string().optional(),
    modes: z
      .array(
        z.object({
          name: z.string().describe("coop, versus, survival, scavenge."),
          chapters: z
            .array(
              z.object({
                map: z.string().describe(".bsp name without path or extension."),
                displayName: z.string().describe("Chapter title or localisation token."),
                image: z.string().optional().describe('Chapter image, e.g. "maps/c1m1_hotel".'),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
    overwrite: z.boolean().default(false),
    backup: z
      .boolean()
      .default(false)
      .describe(
        "Keep a .bak beside an overwritten mission. Off by default: a staging directory " +
          "is packed as-is, and a backup there would ship inside the addon.",
      ),
    dryRun: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: z.string().nullable(),
    bytes: z.number(),
    modes: z.array(MODE),
    chapterCount: z.number(),
  },
  handler: (args, ctx) => {
    if (!args.out) throw new Error("`out` is required: where should the campaign be written?");
    const mission = missionFromSpec(args);
    const findings = checkMissionStructure(mission);
    const errors = findings.filter((f) => f.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `refusing to write an invalid campaign:\n` +
          errors.map((f) => `  - ${f.rule}: ${f.message}`).join("\n"),
      );
    }

    const out = resolveInput(args.out, ctx.config);
    if (existsSync(out) && !args.overwrite) {
      throw new Error(`${out} already exists; pass overwrite: true to replace it`);
    }
    mkdirSync(dirname(out), { recursive: true });
    const text = serializeMission(mission);
    const result = writeGuarded(out, text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup && args.overwrite && existsSync(out),
    });
    const body = summary(mission);
    return {
      path: result.path || out,
      written: result.written,
      backupPath: result.backupPath,
      bytes: Buffer.byteLength(text, "utf8"),
      modes: body.modes,
      chapterCount: body.chapterCount,
    };
  },
});

export const checkCampaignTool = defineTool({
  name: "check_campaign",
  description:
    "Checks a campaign against the files it references: every chapter's .bsp exists in a " +
    "maps directory or in a VPK, every chapter image exists under materials/vgui, chapter " +
    "numbering has no gaps, and every mode has chapters. Reports findings and an overall " +
    "verdict; it does not refuse. The game's own campaigns can be checked in place by " +
    "passing `vpk: left4dead2/pak01_dir.vpk` and the mission entry.",
  realm: "map",
  inputSchema: {
    path: z.string().optional().describe("Mission .txt on disk."),
    vpk: z.string().optional().describe("VPK holding the mission, e.g. pak01_dir.vpk."),
    entry: z.string().optional().describe("Entry inside the VPK, e.g. missions/campaign1.txt."),
    mapsDirs: z.array(z.string()).optional().describe("Directories holding <map>.bsp. Defaults from the mission's location."),
    materialsDirs: z.array(z.string()).optional().describe("materials/ directories. Defaults from the mission's location."),
    vpks: z.array(z.string()).optional().describe("Further VPKs whose entries count as present."),
  },
  outputSchema: {
    source: SOURCE,
    overall: z.enum(["pass", "warn", "fail"]),
    findings: z.array(FINDING),
    counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    checked: z.object({
      mapsDirs: z.array(z.string()),
      materialsDirs: z.array(z.string()),
      vpks: z.array(z.string()),
      vpkEntries: z.number(),
    }),
    modes: z.array(MODE),
    chapterCount: z.number(),
  },
  handler: async (args, ctx) => {
    const { mission, source } = await loadMission(ctx.config, args);
    const findings: CampaignFinding[] = checkMissionStructure(mission);

    let mapsDirs = (args.mapsDirs ?? []).map((p) => resolveInput(p, ctx.config));
    let materialsDirs = (args.materialsDirs ?? []).map((p) => resolveInput(p, ctx.config));
    if (source.kind === "file" && args.mapsDirs === undefined && args.materialsDirs === undefined) {
      const base = dirname(source.path);
      mapsDirs = [resolve(base, "..", "maps")];
      materialsDirs = [resolve(base, "..", "materials")];
    }
    if (source.kind === "file" && args.mapsDirs === undefined && args.materialsDirs !== undefined) {
      mapsDirs = [resolve(dirname(source.path), "..", "maps")];
    }
    if (source.kind === "file" && args.mapsDirs !== undefined && args.materialsDirs === undefined) {
      materialsDirs = [resolve(dirname(source.path), "..", "materials")];
    }
    // A mission read from a VPK usually still has its maps loose beside it: the game ships
    // maps in `left4dead2/maps`, not inside `pak01`. The directory of the VPK is that root.
    if (source.kind === "vpk" && args.mapsDirs === undefined) {
      mapsDirs = [resolve(dirname(source.path), "maps")];
    }
    if (source.kind === "vpk" && args.materialsDirs === undefined) {
      materialsDirs = [resolve(dirname(source.path), "materials")];
    }

    const vpks = [
      ...new Set([
        ...(args.vpks ?? []).map((p) => resolveInput(p, ctx.config)),
        ...(source.kind === "vpk" ? [source.path] : []),
      ]),
    ];
    const vpkEntries = new Set<string>();
    for (const vpk of vpks) {
      for (const prefix of ["maps", "materials/vgui/maps"]) {
        const reply = await callSidecar<{ entries: string[] }>(
          "vpk_list",
          { path: vpk, prefix, limit: 20_000 },
          ctx.config,
          120_000,
        );
        for (const entry of reply.entries) vpkEntries.add(entry.toLowerCase());
      }
    }

    findings.push(
      ...checkMissionFiles(mission, { mapsDirs, materialsDirs, vpkEntries }, existsSync),
    );

    const counts = {
      error: findings.filter((f) => f.severity === "error").length,
      warning: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
    };
    const overall = counts.error > 0 ? "fail" : counts.warning > 0 ? "warn" : "pass";
    const body = summary(mission);
    return {
      source,
      overall,
      findings,
      counts,
      checked: { mapsDirs, materialsDirs, vpks, vpkEntries: vpkEntries.size },
      modes: body.modes,
      chapterCount: body.chapterCount,
    };
  },
});

export const campaignTools = [readCampaignTool, writeCampaignTool, checkCampaignTool];
