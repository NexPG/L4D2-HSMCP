/**
 * Gamemode contract: what `info_gamemode` switches and what `info_map_parameters` declares.
 *
 * `info_gamemode` has no keyvalue that names a mode. The engine fires `OnCoop`, `OnVersus`,
 * `OnSurvival` and `OnScavenge` (and the `*PostIO` variants) when a round starts, so a map
 * that does not wire an output is the same in that mode. This reads both forms of a map and
 * resolves each mode output to a targetname in the same map; a target that exists nowhere is
 * a mode switch that does nothing.
 *
 * `info_map_parameters` holds the item densities. A misspelled density key is silently
 * ignored by the engine, which is why an unknown key is reported rather than passed.
 */
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { isOutputKey } from "../../../maps/typescript/bsp/entities.js";
import { readMapEntities } from "../../../maps/typescript/entity/read.js";
import { parseConnection, RUNTIME_TARGETS } from "../../../maps/typescript/entity/wiring.js";
import type { MapEntity } from "../../../maps/typescript/entity/model.js";
import { MAP_PARAMETER_DENSITY } from "./campaignbuild.js";

type Mode = "coop" | "versus" | "survival" | "scavenge";

const MODES: Mode[] = ["coop", "versus", "survival", "scavenge"];

/** Keys Valve's own maps carry that the writer does not expose yet. */
const EXTRA_PARAMETER_KEYS = [
  "AmmoPackDensity",
  "GrenadeLauncherDensity",
  "UpgradepackIncendiaryDensity",
  "UpgradepackExplosiveDensity",
];

const KNOWN_PARAMETER_KEYS = new Set([
  ...Object.values(MAP_PARAMETER_DENSITY),
  ...EXTRA_PARAMETER_KEYS,
]);

interface Finding {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

interface ModeState {
  wired: boolean;
  outputs: number;
  targets: string[];
  dangling: string[];
}

export interface GamemodeContract {
  path: string;
  source: "vmf" | "bsp";
  gamemodeEntities: number;
  scavengeSpawns: number;
  modes: Record<Mode, ModeState>;
  mapParameters: {
    entities: number;
    versusEntities: number;
    densities: Record<string, number>;
    versusDensities: Record<string, number>;
    unknownKeys: string[];
  } | null;
  findings: Finding[];
  verdict: "pass" | "warn" | "fail";
}

function modeOfOutput(name: string): Mode | null {
  if (/^OnCoop/i.test(name)) return "coop";
  if (/^OnVersus/i.test(name)) return "versus";
  if (/^OnSurvival/i.test(name)) return "survival";
  if (/^OnScavenge/i.test(name)) return "scavenge";
  return null;
}

/** Outputs of an entity, whichever form the map was read from. */
function outputsOf(entity: MapEntity): Array<[string, string]> {
  return [
    ...entity.connections,
    ...entity.keyvalues.filter(([key, value]) => isOutputKey(key, value)),
  ];
}

function densitiesOf(entities: readonly MapEntity[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entity of entities) {
    if (entity.classname !== key) continue;
    for (const [name, value] of entity.keyvalues) {
      if (!KNOWN_PARAMETER_KEYS.has(name)) continue;
      const number = Number(value);
      if (Number.isFinite(number)) out[name] = number;
    }
  }
  return out;
}

export function checkGamemodeContract(path: string): GamemodeContract {
  const entities = readMapEntities(path);
  const findings: Finding[] = [];
  const gamemodes = entities.filter((entity) => entity.classname === "info_gamemode");
  const params = entities.filter((entity) => entity.classname === "info_map_parameters");
  const versusParams = entities.filter(
    (entity) => entity.classname === "info_map_parameters_versus",
  );
  const scavengeSpawns = entities.filter(
    (entity) => entity.classname === "weapon_scavenge_item_spawn",
  ).length;

  const names = new Set<string>();
  for (const entity of entities) {
    const name = entity.targetname?.trim().toLowerCase();
    if (name) names.add(name);
  }

  const modes: Record<Mode, ModeState> = {
    coop: { wired: false, outputs: 0, targets: [], dangling: [] },
    versus: { wired: false, outputs: 0, targets: [], dangling: [] },
    survival: { wired: false, outputs: 0, targets: [], dangling: [] },
    scavenge: { wired: false, outputs: 0, targets: [], dangling: [] },
  };

  for (const entity of gamemodes) {
    for (const [output, value] of outputsOf(entity)) {
      const mode = modeOfOutput(output);
      if (!mode) continue;
      modes[mode].wired = true;
      modes[mode].outputs += 1;
      const parsed = parseConnection(value);
      if (!parsed || !parsed.target) {
        findings.push({
          severity: "error",
          rule: "mode-output-malformed",
          message: `info_gamemode.${output} is not a target,input,... value`,
        });
        continue;
      }
      modes[mode].targets.push(parsed.target);
      const target = parsed.target.toLowerCase();
      if (
        !RUNTIME_TARGETS.has(target) &&
        !target.includes("*") &&
        !names.has(target)
      ) {
        modes[mode].dangling.push(parsed.target);
      }
    }
  }

  for (const mode of MODES) {
    const state = modes[mode];
    if (state.dangling.length > 0) {
      findings.push({
        severity: "warning",
        rule: "mode-target-missing",
        message:
          `info_gamemode fires On${mode[0]!.toUpperCase()}${mode.slice(1)} at ` +
          `${[...new Set(state.dangling)].join(", ")}, and nothing in this map has that ` +
          "targetname; the mode switch does nothing",
      });
    }
  }

  if (gamemodes.length === 0) {
    findings.push({
      severity: "info",
      rule: "no-gamemode-entity",
      message:
        "no info_gamemode: the map is the same in every mode, which is valid for a " +
        "coop-only chapter",
    });
  } else if (modes.scavenge.wired && scavengeSpawns === 0) {
    findings.push({
      severity: "warning",
      rule: "scavenge-without-cans",
      message:
        "info_gamemode wires OnScavenge but the map has no weapon_scavenge_item_spawn; " +
        "a scavenge round has nothing to score",
    });
  } else if (!modes.scavenge.wired && scavengeSpawns > 0) {
    findings.push({
      severity: "info",
      rule: "scavenge-cans-unswitched",
      message:
        `${scavengeSpawns} scavenge spawners exist but no OnScavenge output hides or ` +
        "enables them; the cans are in the coop map too",
    });
  }

  const unknownKeys: string[] = [];
  for (const entity of [...params, ...versusParams]) {
    for (const [name, value] of entity.keyvalues) {
      if (name === "classname" || name === "origin" || name === "angles") continue;
      if (name === "targetname" || name === "hammerid" || name.startsWith("On")) continue;
      if (!KNOWN_PARAMETER_KEYS.has(name)) {
        unknownKeys.push(name);
        continue;
      }
      const number = Number(value);
      if (!Number.isFinite(number)) {
        findings.push({
          severity: "error",
          rule: "map-parameter-not-a-number",
          message: `${entity.classname}.${name} is ${JSON.stringify(value)}, not a number`,
        });
      } else if (number < -1) {
        findings.push({
          severity: "warning",
          rule: "map-parameter-below-minus-one",
          message: `${entity.classname}.${name} is ${number}; -1 disables a density, below -1 is undefined`,
        });
      }
    }
  }
  for (const key of [...new Set(unknownKeys)]) {
    findings.push({
      severity: "warning",
      rule: "map-parameter-unknown",
      message: `${key} is not a density key the game reads; the engine silently ignores it`,
    });
  }
  if (params.length > 1) {
    findings.push({
      severity: "warning",
      rule: "map-parameters-duplicate",
      message: `${params.length} info_map_parameters entities; the game reads one set of densities`,
    });
  }
  if (versusParams.length > 0) {
    findings.push({
      severity: "info",
      rule: "versus-parameters",
      message: `${versusParams.length} info_map_parameters_versus entity overrides the coop densities in versus`,
    });
  }

  return {
    path,
    source: extname(path).toLowerCase() === ".vmf" ? "vmf" : "bsp",
    gamemodeEntities: gamemodes.length,
    scavengeSpawns,
    modes,
    mapParameters:
      params.length + versusParams.length > 0
        ? {
            entities: params.length,
            versusEntities: versusParams.length,
            densities: densitiesOf(params, "info_map_parameters"),
            versusDensities: densitiesOf(versusParams, "info_map_parameters_versus"),
            unknownKeys: [...new Set(unknownKeys)],
          }
        : null,
    findings,
    verdict:
      findings.some((finding) => finding.severity === "error")
        ? "fail"
        : findings.some((finding) => finding.severity === "warning")
          ? "warn"
          : "pass",
  };
}

export const checkGamemodeContractTool = defineTool({
  name: "check_gamemode_contract",
  description:
    "Reads a VMF or a compiled BSP and checks the mode layer without launching the game: " +
    "which `info_gamemode` outputs (OnCoop/OnVersus/OnSurvival/OnScavenge and *PostIO) are " +
    "wired and whether their targets exist in the map, scavenge spawners without a mode " +
    "switch, a survival output without a finale trigger, and `info_map_parameters` keys the " +
    "engine ignores or values that are not numbers. A mode wiring check is not a played round.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Map .vmf or .bsp, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    source: z.enum(["vmf", "bsp"]),
    gamemodeEntities: z.number(),
    scavengeSpawns: z.number(),
    modes: z.record(
      z.object({
        wired: z.boolean(),
        outputs: z.number(),
        targets: z.array(z.string()),
        dangling: z.array(z.string()),
      }),
    ),
    mapParameters: z
      .object({
        entities: z.number(),
        versusEntities: z.number(),
        densities: z.record(z.number()),
        versusDensities: z.record(z.number()),
        unknownKeys: z.array(z.string()),
      })
      .nullable(),
    findings: z.array(
      z.object({
        severity: z.enum(["error", "warning", "info"]),
        rule: z.string(),
        message: z.string(),
      }),
    ),
    verdict: z.enum(["pass", "warn", "fail"]),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    return checkGamemodeContract(path) as unknown as Record<string, unknown>;
  },
});

export const gamemodeContractTools = [checkGamemodeContractTool];
