/**
 * The mode contract: what each mission mode needs from the maps it lists.
 *
 * `check_campaign` answers "does every referenced file exist". This answers a different
 * question: "is the map able to run the mode it is listed under". The checks are the ones
 * that can be made without the engine and without guessing:
 *
 * - Scavenge needs gas cans. `weapon_scavenge_item_spawn` is the entity the mode counts;
 *   a map with none cannot start a round.
 * - Survival needs a finale/panic trigger. Without one the timer stays at `00:00`: the
 *   engine has nothing to start the round with.
 * - A coop/versus campaign's last chapter should end, either with a `trigger_finale` or
 *   with a changelevel to a credits map. Neither means the campaign has no ending.
 * - Mode names come from a known set; a typo in `[modes]` is not a mode the menu shows.
 *
 * A BSP inside a VPK is not opened here: the entity lump would need an extraction, and a
 * skip is reported as information rather than a pass.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readEntityLump } from "../../../maps/typescript/bsp/entities.js";
import type { CampaignChapter, CampaignMode, Mission } from "../campaign/mission.js";
import { loadMission } from "./campaign.js";

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  mode: z.string(),
  chapter: z.string().nullable(),
  map: z.string().nullable(),
});

const MODE_SUMMARY = z.object({
  name: z.string(),
  chapters: z.number(),
  maps: z.array(z.string()),
  known: z.boolean(),
});

const KNOWN_MODE = /^(coop|versus|survival|scavenge|mutation\d*|community\d*)$/i;

type Finding = z.infer<typeof FINDING>;

function classnameOf(entity: { classname?: string; keyvalues: Array<[string, string]> }): string {
  return entity.classname ?? entity.keyvalues.find(([key]) => key === "classname")?.[1] ?? "";
}

function keyOf(entity: { keyvalues: Array<[string, string]> }, key: string): string | null {
  return entity.keyvalues.find(([name]) => name === key)?.[1] ?? null;
}

function bspFor(map: string, mapsDirs: readonly string[]): string | null {
  for (const dir of mapsDirs) {
    const candidate = resolve(dir, `${map}.bsp`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function checkModeFiles(
  mode: CampaignMode,
  mapsDirs: readonly string[],
  useEntityLump: boolean,
): Finding[] {
  const findings: Finding[] = [];
  const seen = new Map<string, string>();
  for (const chapter of mode.chapters) {
    const map = chapter.map;
    if (!map) continue;
    const previous = seen.get(map);
    if (previous !== undefined) {
      findings.push({
        severity: "warning",
        rule: "mode-duplicate-map",
        message: `mode "${mode.name}" lists ${map} in chapters ${previous} and ${chapter.key}`,
        mode: mode.name,
        chapter: chapter.key,
        map,
      });
    } else {
      seen.set(map, chapter.key);
    }

    const bsp = bspFor(map, mapsDirs);
    if (bsp === null) {
      findings.push({
        severity: "warning",
        rule: "mode-map-not-readable",
        message: `mode "${mode.name}" chapter ${chapter.key} map ${map} is not a loose .bsp here; ` +
          "entity checks were skipped (a VPK map is not opened by this tool)",
        mode: mode.name,
        chapter: chapter.key,
        map,
      });
      continue;
    }
    if (!useEntityLump) continue;

    let entities;
    try {
      entities = readEntityLump(bsp).entities;
    } catch (error) {
      findings.push({
        severity: "warning",
        rule: "mode-bsp-unreadable",
        message: `${bsp} could not be read: ${error instanceof Error ? error.message : String(error)}`,
        mode: mode.name,
        chapter: chapter.key,
        map,
      });
      continue;
    }

    if (mode.name.toLowerCase() === "scavenge") {
      const cans = entities.filter((entity) => classnameOf(entity) === "weapon_scavenge_item_spawn").length;
      if (cans === 0) {
        findings.push({
          severity: "error",
          rule: "mode-scavenge-no-items",
          message: `mode "scavenge" chapter ${chapter.key} (${map}) has no ` +
            "weapon_scavenge_item_spawn; the round has nothing to score",
          mode: mode.name,
          chapter: chapter.key,
          map,
        });
      } else {
        findings.push({
          severity: "info",
          rule: "mode-scavenge-items",
          message: `mode "scavenge" chapter ${chapter.key} (${map}) has ${cans} gas-can spawn(s)`,
          mode: mode.name,
          chapter: chapter.key,
          map,
        });
      }
    }

    if (mode.name.toLowerCase() === "survival") {
      const trigger = entities.some(
        (entity) => classnameOf(entity) === "trigger_finale" || classnameOf(entity) === "func_finale",
      );
      if (!trigger) {
        findings.push({
          severity: "warning",
          rule: "mode-survival-no-trigger",
          message: `mode "survival" chapter ${chapter.key} (${map}) has no trigger_finale/func_finale; ` +
            "the survival round may not start from the map alone",
          mode: mode.name,
          chapter: chapter.key,
          map,
        });
      }
    }
  }

  const lower = mode.name.toLowerCase();
  if ((lower === "coop" || lower === "versus") && mode.chapters.length > 0) {
    const last = mode.chapters[mode.chapters.length - 1]!;
    const bsp = last.map ? bspFor(last.map, mapsDirs) : null;
    if (bsp !== null) {
      try {
        const entities = readEntityLump(bsp).entities;
        const ends = entities.some((entity) => {
          const name = classnameOf(entity);
          return name === "trigger_finale" || name === "info_changelevel";
        });
        if (!ends) {
          findings.push({
            severity: "warning",
            rule: "mode-last-no-end",
            message: `mode "${mode.name}" ends on ${last.map}, which has neither a trigger_finale ` +
              "nor an info_changelevel; the campaign has no ending",
            mode: mode.name,
            chapter: last.key,
            map: last.map ?? null,
          });
        }
      } catch {
        // A malformed BSP is reported by the per-chapter check above.
      }
    }
  }

  return findings;
}

export const checkModesTool = defineTool({
  name: "check_modes",
  description:
    "Checks each mission mode against the maps it lists, without the engine: scavenge " +
    "needs `weapon_scavenge_item_spawn`; survival needs a `trigger_finale`/`func_finale` or " +
    "the timer never starts; the last coop/versus chapter needs a finale or a changelevel; " +
    "a map repeated inside one mode is a warning; a mode name outside the known set is a " +
    "warning. Loose .bsp files are read for their entity lump; a map that exists only in a " +
    "VPK is reported as skipped rather than passed. Reports findings and a verdict.",
  realm: "map",
  inputSchema: {
    path: z.string().optional().describe("Mission .txt on disk."),
    vpk: z.string().optional().describe("VPK holding the mission, e.g. pak01_dir.vpk."),
    entry: z.string().optional().describe("Entry inside the VPK, e.g. missions/campaign1.txt."),
    mapsDirs: z.array(z.string()).optional().describe("Directories holding <map>.bsp."),
  },
  outputSchema: {
    source: z.object({
      kind: z.enum(["file", "vpk"]),
      path: z.string(),
      entry: z.string().nullable(),
    }),
    overall: z.enum(["pass", "warn", "fail"]),
    findings: z.array(FINDING),
    counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    modes: z.array(MODE_SUMMARY),
    checked: z.object({ mapsDirs: z.array(z.string()) }),
  },
  handler: async (args, ctx) => {
    const { mission, source } = await loadMission(ctx.config, args);
    let mapsDirs = (args.mapsDirs ?? []).map((path) => resolveInput(path, ctx.config));
    if (args.mapsDirs === undefined) {
      mapsDirs =
        source.kind === "file"
          ? [resolve(dirname(source.path), "..", "maps")]
          : [resolve(dirname(source.path), "maps")];
    }

    const findings: Finding[] = [];
    for (const mode of mission.modes) {
      if (!KNOWN_MODE.test(mode.name)) {
        findings.push({
          severity: "warning",
          rule: "mode-unknown-name",
          message: `mode "${mode.name}" is not one of coop/versus/survival/scavenge/mutation*/` +
            "community*; the menu will not show it",
          mode: mode.name,
          chapter: null,
          map: null,
        });
      }
      findings.push(...checkModeFiles(mode, mapsDirs, true));
    }

    const counts = {
      error: findings.filter((entry) => entry.severity === "error").length,
      warning: findings.filter((entry) => entry.severity === "warning").length,
      info: findings.filter((entry) => entry.severity === "info").length,
    };
    const overall = counts.error > 0 ? "fail" : counts.warning > 0 ? "warn" : "pass";
    return {
      source,
      overall,
      findings,
      counts,
      modes: mission.modes.map((mode) => ({
        name: mode.name,
        chapters: mode.chapters.length,
        maps: mode.chapters.map((chapter) => chapter.map).filter((map): map is string => Boolean(map)),
        known: KNOWN_MODE.test(mode.name),
      })),
      checked: { mapsDirs },
    };
  },
});

export type { CampaignChapter, CampaignMode, Mission };

export const checkModeTools = [checkModesTool];
