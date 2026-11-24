/**
 * Finale contract: the entity/nav pair the engine needs for each finale type.
 *
 * `trigger_finale.type` selects Standard (0), Gauntlet (1), Custom (2) or Scavenge (4).
 * Custom needs a ScriptFile; Scavenge needs gas-can spawns; every finale needs FINALE nav
 * areas. The rescue vehicle is an escape area, not a required brush in a custom finale.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readEntityLump } from "../../../maps/typescript/bsp/entities.js";
import { readEntities } from "../../../maps/typescript/vmf/edit.js";
import { readNavFile } from "../../../nav/typescript/formats/navfile.js";

const FINALE = 0x00000040;
const RESCUE_VEHICLE = 0x00008000;
const ESCAPE_ROUTE = 0x00020000;

export interface FinaleContract {
  path: string;
  source: "vmf" | "bsp";
  triggerCount: number;
  type: number | null;
  scriptFile: string | null;
  sacrifice: boolean;
  scavengeSpawns: number;
  finaleAreas: number | null;
  rescueAreas: number | null;
  escapeAreas: number | null;
  failures: string[];
  warnings: string[];
  verdict: "pass" | "fail" | "unknown";
}

function classes(path: string): { entities: Array<{ classname: string; keyvalues: Map<string, string> }>; source: "vmf" | "bsp" } {
  if (extname(path).toLowerCase() === ".vmf") {
    const entities = readEntities(readFileSync(path, "utf8")).entities;
    return {
      source: "vmf",
      entities: entities.map((entity) => ({
        classname: entity.classname,
        keyvalues: new Map(Object.entries(entity.keyvalues ?? {})),
      })),
    };
  }
  const entities = readEntityLump(path).entities;
  return {
    source: "bsp",
    entities: entities.map((entity) => ({
      classname: entity.classname,
      keyvalues: new Map(entity.keyvalues),
    })),
  };
}

export function checkFinaleContract(
  path: string,
  options: { nav?: string; expectedType?: number } = {},
): FinaleContract {
  const { entities, source } = classes(path);
  const triggers = entities.filter((entity) => entity.classname === "trigger_finale");
  const trigger = triggers[0];
  const typeValue = trigger?.keyvalues.get("type");
  const type = typeValue !== undefined && typeValue.trim() !== "" ? Number(typeValue) : null;
  const scriptFile = trigger?.keyvalues.get("ScriptFile")?.trim() || null;
  const sacrifice = trigger?.keyvalues.get("IsSacrificeFinale") === "1";
  const scavengeSpawns = entities.filter(
    (entity) => entity.classname === "weapon_scavenge_item_spawn",
  ).length;

  let finaleAreas: number | null = null;
  let rescueAreas: number | null = null;
  let escapeAreas: number | null = null;
  if (options.nav !== undefined) {
    if (!existsSync(options.nav)) throw new Error(`${options.nav} does not exist`);
    const nav = readNavFile(readFileSync(options.nav), options.nav);
    finaleAreas = nav.areas.filter((area) => (area.spawnAttributes & FINALE) !== 0).length;
    rescueAreas = nav.areas.filter((area) => (area.spawnAttributes & RESCUE_VEHICLE) !== 0).length;
    escapeAreas = nav.areas.filter((area) => (area.spawnAttributes & ESCAPE_ROUTE) !== 0).length;
  }

  const failures: string[] = [];
  const warnings: string[] = [];
  if (triggers.length === 0) failures.push("no trigger_finale: the chapter cannot end");
  if (triggers.length > 1) warnings.push(`${triggers.length} trigger_finale entities; one chapter should use one`);
  if (type === null || ![0, 1, 2, 4].includes(type)) {
    failures.push(`trigger_finale.type is ${typeValue ?? "(missing)"}; expected 0, 1, 2 or 4`);
  }
  if (options.expectedType !== undefined && type !== options.expectedType) {
    failures.push(`type ${type} does not match the expected ${options.expectedType}`);
  }
  if (type === 2 && !scriptFile) {
    warnings.push(
      "type 2 (Custom) has no ScriptFile; the map's own finale script must be attached " +
        "(official c2m5/c3m4 do the same)",
    );
  }
  if (type === 4 && scavengeSpawns === 0) {
    failures.push("type 4 (Scavenge) has no weapon_scavenge_item_spawn");
  }
  if (type === 4 && scavengeSpawns > 0 && scavengeSpawns < 4) {
    warnings.push(`${scavengeSpawns} scavenge item spawns is below the stock 16`);
  }
  if (finaleAreas !== null && finaleAreas === 0) {
    failures.push("the nav has no FINALE area; the Director has nowhere to hold the finale");
  }
  if (rescueAreas !== null && rescueAreas === 0 && type !== 2) {
    warnings.push("no RESCUE_VEHICLE area; a standard/gauntlet finale normally has one");
  }
  if (escapeAreas !== null && escapeAreas === 0 && type === 2) {
    warnings.push("no ESCAPE_ROUTE area; a custom finale script has to open the escape path");
  }

  return {
    path,
    source,
    triggerCount: triggers.length,
    type,
    scriptFile,
    sacrifice,
    scavengeSpawns,
    finaleAreas,
    rescueAreas,
    escapeAreas,
    failures,
    warnings,
    verdict: failures.length > 0 ? "fail" : finaleAreas === null && type !== 2 ? "unknown" : "pass",
  };
}

export const checkFinaleContractTool = defineTool({
  name: "check_finale_contract",
  description:
    "Checks the finale contract offline: exactly one `trigger_finale`, a type in 0/1/2/4, a " +
    "`ScriptFile` for type 2, gas-can spawns for type 4, and FINALE/RESCUE_VEHICLE/" +
    "ESCAPE_ROUTE nav areas when a .nav is given. Reads a VMF or compiled BSP and a .nav; no " +
    "game launch. A pass is a structural contract, not a played finale.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Map .vmf or .bsp, absolute or relative to the repo root."),
    nav: z.string().optional().describe("Optional .nav for FINALE/RESCUE/ESCAPE area checks."),
    expectedType: z.number().int().optional().describe("Require this type (0/1/2/4)."),
  },
  outputSchema: {
    path: z.string(),
    source: z.enum(["vmf", "bsp"]),
    triggerCount: z.number(),
    type: z.number().nullable(),
    scriptFile: z.string().nullable(),
    sacrifice: z.boolean(),
    scavengeSpawns: z.number(),
    finaleAreas: z.number().nullable(),
    rescueAreas: z.number().nullable(),
    escapeAreas: z.number().nullable(),
    failures: z.array(z.string()),
    warnings: z.array(z.string()),
    verdict: z.enum(["pass", "fail", "unknown"]),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const nav = args.nav !== undefined ? resolveInput(args.nav, ctx.config) : undefined;
    return checkFinaleContract(path, {
      ...(nav !== undefined ? { nav } : {}),
      ...(args.expectedType !== undefined ? { expectedType: args.expectedType } : {}),
    }) as unknown as Record<string, unknown>;
  },
});

export const finaleContractTools = [checkFinaleContractTool];
