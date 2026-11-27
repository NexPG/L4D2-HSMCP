/**
 * `DirectorOptions` / `MutationOptions` validator.
 *
 * `read_vscript` already parses the table and reports Lua habits; this checks the option
 * layer: a key the catalogue knows, a value of the declared type, a non-negative limit, and
 * a MinSpecials/MaxSpecials pair that can actually be satisfied. It does not run the script.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, extname } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { checkNut, tableBody } from "../vscript/check.js";
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

const OPTION_FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  key: z.string(),
  value: z.string(),
  message: z.string(),
});

type OptionInput = Record<string, string | number | boolean>;

function formatOptionValue(key: string, value: string | number | boolean): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${key} is not a finite number`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  // A custom-finale stage type is a Squirrel constant, not a string. Writing `"PANIC"`
  // would compile but the Director would not match it; the table examples use PANIC/TANK.
  if (/^A_CustomFinale\d+$/.test(key) && /^[A-Za-z_]\w*$/.test(value)) return value;
  return JSON.stringify(value);
}

function optionsTable(options: OptionInput): string {
  const entries = Object.entries(options);
  if (entries.length === 0) throw new Error("options is empty: nothing to write");
  const lines = ["{"];
  for (const [key, value] of entries) {
    if (!/^[A-Za-z_]\w*$/.test(key)) {
      throw new Error(`"${key}" is not a Squirrel identifier`);
    }
    lines.push(`    ${key} = ${formatOptionValue(key, value)}`);
  }
  lines.push("}");
  return lines.join("\n");
}

function upsertOptionsTable(
  source: string,
  table: string,
  options: OptionInput,
): { code: string; replaced: boolean } {
  const assignment = new RegExp(`\\b${table}\\s*(?:<-|=)\\s*\\{`).exec(source);
  const block = optionsTable(options);
  if (!assignment) {
    const head = source.replace(/\s*$/, "");
    return {
      code: `${head}${head ? "\n\n" : ""}${table} <-\n${block}\n`,
      replaced: false,
    };
  }
  const start = assignment.index + assignment[0].lastIndexOf("{");
  const body = tableBody(source, start);
  if (!body) throw new Error(`the ${table} table has no closing brace`);
  return {
    code: `${source.slice(0, start)}${block}${source.slice(body.end + 1)}`,
    replaced: true,
  };
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
    findings: z.array(OPTION_FINDING),
    verdict: z.enum(["pass", "fail"]),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    return checkDirectorOptions(path) as unknown as Record<string, unknown>;
  },
});

export const writeDirectorOptionsTool = defineTool({
  name: "write_director_options",
  description:
    "Writes or replaces a DirectorOptions/MutationOptions table in an existing or new .nut. " +
    "This is a builder over write_vscript, not a second writer: code outside the table is " +
    "preserved byte-for-byte, a missing table is appended, an existing one is replaced, and " +
    "the result is read back with check_director_options. Invalid Squirrel or a table that " +
    "fails the option check leaves the file as it was. Guarded.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("The .nut to edit; it is created when absent."),
    table: z
      .enum(["DirectorOptions", "MutationOptions"])
      .default("DirectorOptions")
      .describe("Which table to write."),
    options: z
      .record(z.union([z.number(), z.boolean(), z.string()]))
      .describe(
        "Key/value pairs. Numbers and booleans are written unquoted; strings are quoted. " +
          "Unknown keys are allowed and reported as information, not refused.",
      ),
    backup: z.boolean().default(true).describe("Copy the previous file to <path>.bak."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    table: z.string(),
    created: z.boolean(),
    replaced: z.boolean(),
    written: z.boolean(),
    backupPath: z.string().nullable(),
    bytes: z.number(),
    directorOptions: z.record(z.string()),
    mutationOptions: z.record(z.string()),
    findings: z.array(OPTION_FINDING),
    verdict: z.enum(["pass", "fail"]),
  },
  handler: (args, ctx) => {
    if (extname(args.path).toLowerCase() !== ".nut") {
      throw new Error("a VScript file must end in .nut");
    }
    const path = resolveInput(args.path, ctx.config);
    const table = args.table ?? "DirectorOptions";
    const before = existsSync(path) ? readFileSync(path, "utf8") : null;
    const next = upsertOptionsTable(before ?? "", table, args.options);
    const syntax = checkNut(next.code, path);
    const errors = syntax.diagnostics.filter((entry) => entry.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `the table would not compile:\n${errors
          .map((entry) => `${entry.line === null ? "" : `line ${entry.line}: `}${entry.message}`)
          .join("\n")}`,
      );
    }

    mkdirSync(dirname(path), { recursive: true });
    const write = writeGuarded(path, next.code, ctx.config, {
      backup: args.backup !== false && before !== null,
      unchanged: before === next.code,
    });
    const check = checkDirectorOptions(path);
    if (check.verdict === "fail") {
      if (before === null) rmSync(path, { force: true });
      else writeGuarded(path, before, ctx.config, { backup: false });
      throw new Error(
        `the table would not pass check_director_options:\n${check.findings
          .filter((finding) => finding.severity === "error")
          .map((finding) => `${finding.key}: ${finding.message}`)
          .join("\n")}`,
      );
    }

    return {
      path,
      table,
      created: before === null,
      replaced: next.replaced,
      written: write.written,
      backupPath: write.backupPath,
      bytes: statSync(path).size,
      directorOptions: check.directorOptions,
      mutationOptions: check.mutationOptions,
      findings: check.findings,
      verdict: check.verdict,
    };
  },
});

export const directorOptionsTools = [checkDirectorOptionsTool, writeDirectorOptionsTool];
