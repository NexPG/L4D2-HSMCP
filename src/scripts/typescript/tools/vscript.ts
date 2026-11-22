import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput, resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { editVmf } from "../../../maps/typescript/tools/vmfedit.js";
import { checkNut, stripNut } from "../vscript/check.js";
import {
  DIRECTOR_OPTIONS,
  MUTATION_ONLY_OPTIONS,
  NAMED_HOOKS,
  NUMERIC_OPTION_KEYS,
} from "../vscript/api.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";

const DIAGNOSTIC = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  line: z.number().nullable(),
});

export const writeVscript = defineTool({
  name: "write_vscript",
  description:
    "Writes a Left 4 Dead 2 VScript (.nut) and optionally attaches it to a map. Checks the " +
    "source as Squirrel before writing: Lua habits (`end`, `elseif`, `nil`, `~=`, `--[[`) " +
    "are refused, braces/parentheses are balanced, the DirectorOptions custom-finale stage " +
    "list is checked for missing or extra stages, and a missing load banner is a warning. " +
    "When `vmf` is given, adds a logic_script entity with `vscripts` set to the file's base " +
    "name (no extension), which is how the engine finds it inside an add-on VPK. Guarded.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Where to write the .nut, for example <campaign>/addon/scripts/vscripts/finale.nut."),
    content: z.string().describe("The Squirrel source."),
    vmf: z
      .string()
      .optional()
      .describe("Optional .vmf to attach the script to; adds a logic_script entity."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    bytes: z.number(),
    attached: z.boolean(),
    vmf: z.string().nullable(),
    entityId: z.number().nullable(),
    warnings: z.array(z.string()),
    functions: z.array(z.string()),
    includes: z.array(z.string()),
    stageCount: z.number().nullable(),
    diagnostics: z.array(DIAGNOSTIC),
  },
  handler: async (args, ctx) => {
    // Validate a map path before touching anything else: a .vmf tool handed a .bsp has to
    // say "compiled map" and name a reader, not fail later inside the filesystem.
    if (args.vmf) resolveVmfInput(args.vmf, ctx.config);
    if (!args.path) throw new Error("path is required: where should the .nut be written?");
    if (extname(args.path).toLowerCase() !== ".nut") {
      throw new Error("a VScript file must end in .nut");
    }
    const path = resolveInput(args.path, ctx.config);
    const report = checkNut(args.content, path);
    const errors = report.diagnostics.filter((entry) => entry.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `the script would not compile:\n${errors
          .map((entry) => `${entry.line === null ? "" : `line ${entry.line}: `}${entry.message}`)
          .join("\n")}`,
      );
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, args.content, "utf8");

    let attached = false;
    let vmf: string | null = null;
    let entityId: number | null = null;

    if (args.vmf) {
      vmf = resolveVmfInput(args.vmf, ctx.config);
      const name = basename(path, ".nut");
      const edit = (await editVmf.handler(
        {
          path: vmf,
          ops: [
            {
              op: "add",
              keyvalues: {
                classname: "logic_script",
                origin: "0 0 64",
                vscripts: name,
              },
            },
          ],
          backup: false,
          dryRun: false,
          confirm: true,
        },
        ctx,
      )) as { outcomes: Array<{ ids: number[] }> };
      attached = true;
      entityId = edit.outcomes[0]?.ids[0] ?? null;
    }

    if (!existsSync(path)) throw new Error(`${path} was not written`);
    return {
      path,
      bytes: statSync(path).size,
      attached,
      vmf,
      entityId,
      warnings: report.diagnostics
        .filter((entry) => entry.severity !== "info")
        .map((entry) => `${entry.rule}: ${entry.message}`),
      functions: report.functions,
      includes: report.includes,
      stageCount: report.stageCount,
      diagnostics: report.diagnostics,
    };
  },
});

export const readVscriptTool = defineTool({
  name: "read_vscript",
  description:
    "Reads a .nut as Squirrel without running it: functions, IncludeScript targets, the " +
    "DirectorOptions and MutationOptions tables, the custom-finale stage list, whether a load banner exists, and " +
    "diagnostics. Errors are the Lua habits and unbalanced delimiters that stop the engine " +
    "compiling; a missing stage or a stage beyond A_CustomFinale_StageCount is an error or " +
    "warning; an unknown DirectorOptions key is information, because this checker does not " +
    "pretend to know every engine key. Use it before write_vscript or run_map_test.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .nut, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    ok: z.boolean(),
    functions: z.array(z.string()),
    includes: z.array(z.string()),
    directorOptions: z.record(z.string()),
    mutationOptions: z.record(z.string()),
    stageCount: z.number().nullable(),
    stages: z.array(z.object({ index: z.number(), type: z.string(), value: z.string().nullable() })),
    hasBanner: z.boolean(),
    diagnostics: z.array(DIAGNOSTIC),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    if (extname(path).toLowerCase() !== ".nut") throw new Error(`${path} is not a .nut`);
    return checkNut(readFileSync(path, "utf8"), path) as unknown as Record<string, unknown>;
  },
});

const API_EVENT = z.object({
  name: z.string(),
  fields: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
});

export const readVscriptApiTool = defineTool({
  name: "read_vscript_api",
  description:
    "Lists the Left 4 Dead 2 VScript contract this server knows: game events from the " +
    "engine's own `resource/modevents.res`, the `OnGameEvent_<event>` hook names derived " +
    "from them, named hooks such as OnMapSpawn, and the DirectorOptions/MutationOptions " +
    "catalogue with each key's expected type. Search by substring; `details` includes every " +
    "event field and its type. Unknown keys are still information, not errors: this " +
    "catalogue is the checker's knowledge, not the engine's complete API.",
  realm: "map",
  inputSchema: {
    section: z.enum(["events", "director", "mutation", "hooks", "all"]).default("all"),
    search: z.string().optional().describe("Case-insensitive substring filter."),
    details: z.boolean().default(false).describe("Include each event's typed fields."),
    limit: z.number().int().min(1).max(1000).default(200),
  },
  outputSchema: {
    section: z.string(),
    search: z.string().nullable(),
    eventCount: z.number(),
    directorOptions: z.array(z.object({ key: z.string(), type: z.string(), note: z.string() })),
    mutationOnlyOptions: z.array(
      z.object({ key: z.string(), type: z.string(), note: z.string() }),
    ),
    hooks: z.array(z.object({ name: z.string(), event: z.string().nullable() })),
    events: z.array(API_EVENT),
    returned: z.number(),
    truncated: z.boolean(),
    gameDir: z.string(),
  },
  handler: async (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const reply = (await callSidecar(
      "game_events",
      { gameDir },
      ctx.config,
      120_000,
    )) as {
      count: number;
      events: Array<{ name: string; fields: Array<{ name: string; type: string }> }>;
    };
    const search = args.search?.toLowerCase();
    const matches = (value: string): boolean => !search || value.toLowerCase().includes(search);
    const events = reply.events.filter((event) => matches(event.name));
    const directorOptions = DIRECTOR_OPTIONS.filter((option) => matches(option.key));
    const mutationOnlyOptions = MUTATION_ONLY_OPTIONS.filter((option) => matches(option.key));
    const hooks = [
      ...reply.events.map((event) => ({ name: `OnGameEvent_${event.name}`, event: event.name })),
      ...NAMED_HOOKS.map((name) => ({ name, event: null })),
    ].filter((hook) => matches(hook.name));

    const wantEvents = args.section === "events" || args.section === "all";
    const wantDirector = args.section === "director" || args.section === "all";
    const wantMutation = args.section === "mutation" || args.section === "all";
    const wantHooks = args.section === "hooks" || args.section === "all";
    const eventList = wantEvents
      ? events.slice(0, args.limit).map((event) => ({
          name: event.name,
          ...(args.details ? { fields: event.fields } : {}),
        }))
      : [];
    return {
      section: args.section,
      search: args.search ?? null,
      eventCount: reply.count,
      directorOptions: wantDirector ? directorOptions : [],
      mutationOnlyOptions: wantMutation ? mutationOnlyOptions : [],
      hooks: wantHooks ? hooks.slice(0, args.limit) : [],
      events: eventList,
      returned: eventList.length,
      truncated:
        (wantEvents && events.length > args.limit) || (wantHooks && hooks.length > args.limit),
      gameDir,
    };
  },
});

const CONTRACT_FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  line: z.number().nullable(),
});

const CONTRACT_HOOK = z.object({
  name: z.string(),
  event: z.string(),
  known: z.boolean(),
  fields: z.array(z.string()),
  unknownFields: z.array(z.string()),
});

function functionBody(code: string, name: string): string | null {
  const match = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(code);
  if (!match) return null;
  let depth = 0;
  for (let index = match.index + match[0].length - 1; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    else if (code[index] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(match.index, index + 1);
    }
  }
  return null;
}

export const checkVscriptContractTool = defineTool({
  name: "check_vscript_contract",
  description:
    "Checks a .nut against the engine's game-event contract: every `OnGameEvent_<name>` " +
    "hook must name an event in `resource/modevents.res`, and every `event_data.<field>` " +
    "read inside it must be a field that event declares. A misspelled hook never runs and " +
    "leaves no console error, which is why this is checked separately from syntax. It also " +
    "reports the read_vscript diagnostics, including quoted numeric DirectorOptions / " +
    "MutationOptions values and unknown option keys. Unknown hooks are warnings because an " +
    "add-on may register its own event; the stock event list is the oracle.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .nut, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    ok: z.boolean(),
    eventCount: z.number(),
    hooks: z.array(CONTRACT_HOOK),
    findings: z.array(CONTRACT_FINDING),
    errors: z.number(),
    warnings: z.number(),
    functions: z.array(z.string()),
    includes: z.array(z.string()),
    directorOptions: z.record(z.string()),
    mutationOptions: z.record(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    if (extname(path).toLowerCase() !== ".nut") throw new Error(`${path} is not a .nut`);
    const source = readFileSync(path, "utf8");
    const report = checkNut(source, path);
    const code = stripNut(source);
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const reply = (await callSidecar(
      "game_events",
      { gameDir },
      ctx.config,
      120_000,
    )) as {
      count: number;
      events: Array<{ name: string; fields: Array<{ name: string; type: string }> }>;
    };
    const events = new Map(reply.events.map((event) => [event.name, event]));
    const findings: Array<z.infer<typeof CONTRACT_FINDING>> = report.diagnostics.map(
      (diagnostic) => ({ ...diagnostic }),
    );
    for (const key of NUMERIC_OPTION_KEYS) {
      if (new RegExp(`\\b${key}\\s*=\\s*["']`).test(source)) {
        findings.push({
          severity: "warning",
          rule: "vscript-option-quoted",
          message: `${key} is assigned a quoted string; the engine reads this key as a number`,
          line: null,
        });
      }
    }
    const hooks: Array<z.infer<typeof CONTRACT_HOOK>> = [];
    for (const name of report.functions.filter((entry) => entry.startsWith("OnGameEvent_"))) {
      const eventName = name.slice("OnGameEvent_".length);
      const event = events.get(eventName);
      const body = functionBody(code, name) ?? "";
      const used = [...body.matchAll(/event_data\.([A-Za-z_]\w*)/g)].map((match) => match[1]!);
      const fields = event?.fields.map((field) => field.name) ?? [];
      const unknownFields = event
        ? [...new Set(used.filter((field) => !fields.includes(field)))]
        : [];
      hooks.push({
        name,
        event: eventName,
        known: event !== undefined,
        fields: [...new Set(used)],
        unknownFields,
      });
      if (!event) {
        findings.push({
          severity: "warning",
          rule: "vscript-event-unknown",
          message:
            `${name} does not match an event in resource/modevents.res; ` +
            `a misspelled hook never runs`,
          line: null,
        });
      }
      for (const field of unknownFields) {
        findings.push({
          severity: "warning",
          rule: "vscript-event-field",
          message: `${eventName} has no field "${field}" in resource/modevents.res`,
          line: null,
        });
      }
    }
    const errors = findings.filter((finding) => finding.severity === "error").length;
    const warnings = findings.filter((finding) => finding.severity === "warning").length;
    return {
      path,
      ok: errors === 0,
      eventCount: reply.count,
      hooks,
      findings,
      errors,
      warnings,
      functions: report.functions,
      includes: report.includes,
      directorOptions: report.directorOptions,
      mutationOptions: report.mutationOptions,
    };
  },
});

export const vscriptTools = [
  writeVscript,
  readVscriptTool,
  readVscriptApiTool,
  checkVscriptContractTool,
];

