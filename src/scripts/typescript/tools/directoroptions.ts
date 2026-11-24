/**
 * `DirectorOptions` / `MutationOptions` validator.
 *
 * `read_vscript` already parses the table and reports Lua habits; this checks the option
 * layer: a key the catalogue knows, a value of the declared type, a non-negative limit, and
 * a MinSpecials/MaxSpecials pair that can actually be satisfied. It does not run the script.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { checkNut } from "../vscript/check.js";
import { DIRECTOR_OPTIONS, MUTATION_ONLY_OPTIONS } from "../vscript/api.js";

const NUMERIC = new Set([
  "A_CustomFinale_StageCount",
  "TankLimit",
  "WitchLimit",
  "CommonLimit",
  "MobMaxSize",
  "MegaMobSize",
  "MegaMobMinSize",
  "HordeEscapeCommonLimit",
  "SpecialRespawnInterval",
  "SmokerLimit",
  "BoomerLimit",
  "HunterLimit",
  "SpitterLimit",
  "JockeyLimit",
  "ChargerLimit",
  "MaxSpecials",
  "MinSpecials",
  "CommonSpawnInterval",
  "SpecialSpawnInterval",
  "MobSpawnSize",
  "PanicWavePauseMin",
  "PanicWavePauseMax",
  "NumReservedWanderers",
  "cm_MaxSpecials",
]);

interface OptionFinding {
  severity: "error" | "warning" | "info";
  key: string;
  value: string;
  message: string;
}

function knownKeys(): Map<string, { type: string; note: string }> {
  const map = new Map<string, { type: string; note: string }>();
  for (const option of [...DIRECTOR_OPTIONS, ...MUTATION_ONLY_OPTIONS]) {
    map.set(option.key, { type: option.type, note: option.note });
  }
  return map;
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

export interface DirectorOptionsCheck {
  path: string;
  directorOptions: Record<string, string>;
  mutationOptions: Record<string, string>;
  findings: OptionFinding[];
  verdict: "pass" | "fail";
  note: string;
}

export function checkDirectorOptions(path: string): DirectorOptionsCheck {
  const code = readFileSync(path, "utf8");
  const report = checkNut(code, path);
  const known = knownKeys();
  const findings: OptionFinding[] = [];
  const check = (options: Record<string, string>, table: string): void => {
    const numeric = new Map<string, number>();
    for (const [key, raw] of Object.entries(options)) {
      const value = unquote(raw);
      const declared = known.get(key);
      if (!declared) {
        findings.push({
          severity: "info",
          key,
          value,
          message: `${table}.${key} is not in the catalogue; the engine may still accept it`,
        });
        continue;
      }
      if (declared.type === "number" && !/^-?\d+(?:\.\d+)?$/.test(value)) {
        findings.push({
          severity: "error",
          key,
          value,
          message: `${table}.${key} must be a number, not ${JSON.stringify(value)}`,
        });
        continue;
      }
      if (declared.type === "number" && /^["']/.test(raw.trim())) {
        findings.push({
          severity: "error",
          key,
          value,
          message: `${table}.${key} is a quoted number; the engine compares it as a string`,
        });
      }
      if (declared.type === "boolean" && !/^(true|false)$/i.test(value)) {
        findings.push({
          severity: "error",
          key,
          value,
          message: `${table}.${key} must be true or false`,
        });
        continue;
      }
      if (declared.type === "number") {
        const number = Number(value);
        numeric.set(key, number);
        if (NUMERIC.has(key) && /limit|size|interval|pause/i.test(key) && number < 0) {
          findings.push({
            severity: "error",
            key,
            value,
            message: `${table}.${key} is negative; a limit/size/interval cannot be below zero`,
          });
        }
      }
    }
    const min = numeric.get("MinSpecials");
    const max = numeric.get("MaxSpecials");
    if (min !== undefined && max !== undefined && min > max) {
      findings.push({
        severity: "error",
        key: "MinSpecials",
        value: String(min),
        message: `MinSpecials (${min}) is above MaxSpecials (${max}); the Director can never satisfy it`,
      });
    }
  };
  check(report.directorOptions, "DirectorOptions");
  check(report.mutationOptions, "MutationOptions");
  for (const diagnostic of report.diagnostics) {
    if (diagnostic.severity === "error") {
      findings.push({
        severity: "error",
        key: "(script)",
        value: "",
        message: diagnostic.message,
      });
    }
  }
  return {
    path,
    directorOptions: report.directorOptions,
    mutationOptions: report.mutationOptions,
    findings,
    verdict: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    note:
      "The catalogue is the project's knowledge, not the engine's complete API. A pass " +
      "checks types, signs and the Min/Max pair; it does not prove the Director behaviour.",
  };
}

export const checkDirectorOptionsTool = defineTool({
  name: "check_director_options",
  description:
    "Validates the DirectorOptions/MutationOptions table in a .nut without running it: known " +
    "keys, number/boolean types, non-negative limits, MinSpecials <= MaxSpecials and the " +
    "read_vscript diagnostics. Unknown keys are information, because the catalogue is not the " +
    "engine's full API. Use it before write_vscript or a live Director test.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("A .nut with a DirectorOptions or MutationOptions table."),
  },
  outputSchema: {
    path: z.string(),
    directorOptions: z.record(z.string()),
    mutationOptions: z.record(z.string()),
    findings: z.array(
      z.object({
        severity: z.enum(["error", "warning", "info"]),
        key: z.string(),
        value: z.string(),
        message: z.string(),
      }),
    ),
    verdict: z.enum(["pass", "fail"]),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    return checkDirectorOptions(path) as unknown as Record<string, unknown>;
  },
});

export const directorOptionsTools = [checkDirectorOptionsTool];
