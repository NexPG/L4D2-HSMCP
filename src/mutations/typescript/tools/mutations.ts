/**
 * Left 4 Dead 2 game modes and mutations.
 *
 * The engine's definition of a mutation is small and entirely file-based:
 *
 * - `modes/<name>.txt` (KeyValues): `base`, `maxplayers`, menu metadata and a `convar` block;
 * - `scripts/vscripts/<name>.nut` (Squirrel): `MutationOptions <- { ... }`;
 * - `addoninfo.txt` with `addonContent_Script 1` when the mode ships a script.
 *
 * The stock game demonstrates it with `modes/dash.txt` + `scripts/vscripts/dash.nuc`. This
 * module reads that file, checks the contract, and can scaffold a new mutation. The VScript
 * half is checked by the existing `checkNut`, not by a second parser.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import type { ToolContext } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { BACKUP, CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";
import { checkNut } from "../../../scripts/typescript/vscript/check.js";

/** Base modes the engine knows without a `modes/<base>.txt` file of its own. */
const BUILTIN_BASES = new Set(["coop", "versus", "survival", "scavenge", "realism", "none"]);

/** The player count the engine's own mode definitions use for each base. */
const EXPECTED_PLAYERS: Record<string, number> = {
  coop: 4,
  realism: 4,
  survival: 4,
  versus: 8,
  scavenge: 8,
};

interface ModeReply {
  path: string;
  name: string;
  blocks: string[];
  base: string | null;
  maxPlayers: string | null;
  hasDifficulty: string | null;
  singleChapter: string | null;
  playerControlledZombies: string | null;
  metadata: {
    displayTitle: string | null;
    shortDescription: string | null;
    description: string | null;
    image: string | null;
    author: string | null;
  };
  convars: Array<{ name: string; value: string }>;
  unknownKeys: string[];
}

interface InspectedMode extends ModeReply {
  filename: string;
  nameMatches: boolean;
  addonRoot: string;
  baseKind: "builtin" | "self" | "local-mode" | "unknown";
  maxPlayerCount: number | null;
  script: {
    path: string;
    exists: boolean;
    compiled: boolean;
  } | null;
  addonInfo: { path: string; exists: boolean };
}

export function addonRootOf(modePath: string): string {
  const parent = dirname(modePath);
  return basename(parent).toLowerCase() === "modes" ? dirname(parent) : parent;
}

async function inspectMode(path: string, ctx: ToolContext): Promise<InspectedMode> {
  const reply = (await callSidecar(
    "mode_read",
    { path },
    ctx.config,
    120_000,
  )) as ModeReply;
  const filename = basename(path, extname(path));
  const addonRoot = addonRootOf(path);
  const base = reply.base?.toLowerCase() ?? null;

  let baseKind: InspectedMode["baseKind"] = "unknown";
  if (base !== null && BUILTIN_BASES.has(base)) baseKind = "builtin";
  else if (base !== null && base === filename.toLowerCase()) baseKind = "self";
  else if (base !== null && existsSync(join(addonRoot, "modes", `${base}.txt`))) {
    baseKind = "local-mode";
  }

  const scriptNut = join(addonRoot, "scripts", "vscripts", `${filename}.nut`);
  const scriptNuc = join(addonRoot, "scripts", "vscripts", `${filename}.nuc`);
  const script = existsSync(scriptNut)
    ? { path: scriptNut, exists: true, compiled: false }
    : existsSync(scriptNuc)
      ? { path: scriptNuc, exists: true, compiled: true }
      : null;

  const addonInfo = join(addonRoot, "addoninfo.txt");
  return {
    ...reply,
    filename,
    nameMatches: reply.name.toLowerCase() === filename.toLowerCase(),
    addonRoot,
    baseKind,
    maxPlayerCount:
      reply.maxPlayers !== null && /^\d+$/.test(reply.maxPlayers)
        ? Number(reply.maxPlayers)
        : null,
    script,
    addonInfo: { path: addonInfo, exists: existsSync(addonInfo) },
  };
}

const MODE_OUTPUT = z.object({
  path: z.string(),
  name: z.string(),
  blocks: z.array(z.string()),
  filename: z.string(),
  nameMatches: z.boolean(),
  addonRoot: z.string(),
  base: z.string().nullable(),
  baseKind: z.enum(["builtin", "self", "local-mode", "unknown"]),
  maxPlayers: z.string().nullable(),
  maxPlayerCount: z.number().nullable(),
  hasDifficulty: z.string().nullable(),
  singleChapter: z.string().nullable(),
  playerControlledZombies: z.string().nullable(),
  metadata: z.object({
    displayTitle: z.string().nullable(),
    shortDescription: z.string().nullable(),
    description: z.string().nullable(),
    image: z.string().nullable(),
    author: z.string().nullable(),
  }),
  convars: z.array(z.object({ name: z.string(), value: z.string() })),
  unknownKeys: z.array(z.string()),
  script: z
    .object({ path: z.string(), exists: z.boolean(), compiled: z.boolean() })
    .nullable(),
  addonInfo: z.object({ path: z.string(), exists: z.boolean() }),
});

export const readGameModeTool = defineTool({
  name: "read_game_mode",
  description:
    "Reads a Left 4 Dead 2 `modes/<name>.txt` mutation definition: the root mode name, " +
    "base mode, maxplayers, hasdifficulty/singlechapter/playercontrolledzombies, the menu " +
    "title/description/image/author, every `convar` override, and unknown keys. It also " +
    "locates the companion `scripts/vscripts/<name>.nut` (or `.nuc`) and `addoninfo.txt` " +
    "next to the mode folder, so it says whether the mode is scripted or convar-only. " +
    "Parser is `srctools.keyvalues`, which accepts newlines inside `Description`; use " +
    "read_vscript for the Squirrel side.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to modes/<name>.txt, absolute or relative to the repo root."),
  },
  outputSchema: MODE_OUTPUT.shape,
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} was not found`);
    return { ...(await inspectMode(path, ctx)) };
  },
});

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  mode: z.string(),
  path: z.string().nullable(),
});

type Finding = z.infer<typeof FINDING>;

function boolFlag(value: string | null): boolean | null {
  if (value === null) return null;
  if (value === "0") return false;
  if (value === "1") return true;
  return null;
}

function inspectFindings(mode: InspectedMode): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], rule: string, message: string): void => {
    findings.push({ severity, rule, message, mode: mode.name, path: mode.path });
  };

  if (!mode.nameMatches) {
    add(
      "error",
      "mode-root-name",
      `the block is named "${mode.name}" but the file is ${mode.filename}.txt; ` +
        `the engine looks the mode up by one name`,
    );
  }
  if (mode.base === null || mode.base === "") {
    add("error", "mode-base-missing", "no base mode: the engine inherits nothing");
  } else if (mode.baseKind === "unknown") {
    add(
      "warning",
      "mode-base-unknown",
      `base "${mode.base}" is neither a built-in base nor modes/${mode.base}.txt in this addon`,
    );
  } else if (mode.baseKind === "self") {
    add(
      "info",
      "mode-base-self",
      `base is the mode's own name; this is how Valve's sample modes use an engine-side base`,
    );
  }

  if (mode.maxPlayers === null) {
    add("warning", "mode-maxplayers-missing", "no maxplayers; the menu and server slots use the base's value");
  } else if (mode.maxPlayerCount === null) {
    add("error", "mode-maxplayers", `maxplayers is "${mode.maxPlayers}", not an integer`);
  } else {
    const expected = mode.base === null ? undefined : EXPECTED_PLAYERS[mode.base.toLowerCase()];
    if (expected !== undefined && mode.maxPlayerCount !== expected) {
      add(
        "warning",
        "mode-maxplayers-base",
        `maxplayers is ${mode.maxPlayerCount}, but "${mode.base}" is a ${expected}-player base`,
      );
    }
  }

  for (const [key, value] of [
    ["hasdifficulty", mode.hasDifficulty],
    ["singlechapter", mode.singleChapter],
    ["playercontrolledzombies", mode.playerControlledZombies],
  ] as const) {
    if (value !== null && boolFlag(value) === null) {
      add("error", `mode-flag-${key}`, `${key} is "${value}", not 0 or 1`);
    }
  }

  if (!mode.metadata.displayTitle) {
    add("warning", "mode-no-title", "no DisplayTitle: the menu shows the internal name");
  }
  if (!mode.metadata.description) {
    add("warning", "mode-no-description", "no Description: the menu has nothing to explain the mode with");
  }
  if (!mode.metadata.author) {
    add("info", "mode-no-author", "no Author in the mode definition");
  }
  if (mode.unknownKeys.length > 0) {
    add(
      "info",
      "mode-unknown-keys",
      `keys this reader does not model: ${mode.unknownKeys.join(", ")}`,
    );
  }

  if (mode.script === null) {
    add(
      "info",
      "mode-no-script",
      `no scripts/vscripts/${mode.filename}.nut or .nuc; a convar-only mode is valid, ` +
        `but MutationOptions cannot run without one`,
    );
  } else if (mode.script.compiled) {
    add(
      "info",
      "mode-script-compiled",
      `the companion script is ${basename(mode.script.path)}, which is compiled; its source is not read`,
    );
  } else {
    const report = checkNut(readFileSync(mode.script.path, "utf8"), mode.script.path);
    for (const diagnostic of report.diagnostics) {
      if (diagnostic.rule === "nut-no-banner") continue;
      findings.push({
        severity: diagnostic.severity,
        rule: `script-${diagnostic.rule}`,
        message: diagnostic.message,
        mode: mode.name,
        path: mode.script.path,
      });
    }
    if (
      Object.keys(report.mutationOptions).length === 0 &&
      Object.keys(report.directorOptions).length === 0
    ) {
      add(
        "warning",
        "mode-no-options",
        "the script has neither MutationOptions nor DirectorOptions; it changes no Director setting",
      );
    }
  }

  if (!mode.addonInfo.exists) {
    add(
      "warning",
      "mode-no-addoninfo",
      "no addoninfo.txt beside modes/; a Workshop/add-on VPK needs it to mount the mode",
    );
  } else if (mode.script !== null) {
    const info = readFileSync(mode.addonInfo.path, "utf8");
    if (!/addonContent_Script\s+"?1"?/i.test(info)) {
      add(
        "warning",
        "mode-addoninfo-script",
        "addoninfo.txt does not set addonContent_Script 1, so the companion script may not mount",
      );
    }
  }

  return findings;
}

export const checkMutationTool = defineTool({
  name: "check_mutation",
  description:
    "Checks a Left 4 Dead 2 mutation before it is packed: the mode block name matches the " +
    "filename, the base is built-in or a mode in this addon, maxplayers agrees with the " +
    "base, boolean fields are 0/1, menu title/description exist, the companion " +
    "scripts/vscripts/<name>.nut (or .nuc) is found, addoninfo.txt sets " +
    "addonContent_Script when a script ships, and the .nut has a MutationOptions or " +
    "DirectorOptions table. Squirrel syntax and DirectorOptions checks are the existing " +
    "read_vscript rules, not a second parser. Accepts a mode file or an addon directory.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("An addon directory or one modes/<name>.txt file."),
    limit: z.number().int().min(1).max(1000).default(200),
  },
  outputSchema: {
    path: z.string(),
    modeCount: z.number(),
    returned: z.number(),
    modes: z.array(MODE_OUTPUT),
    findings: z.array(FINDING),
    errors: z.number(),
    warnings: z.number(),
    ok: z.boolean(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} was not found`);
    const isDir = statSync(path).isDirectory();
    const files: string[] = [];
    if (isDir) {
      const modesDir = join(path, "modes");
      if (existsSync(modesDir)) {
        for (const entry of readdirSync(modesDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
            files.push(join(modesDir, entry.name));
          }
        }
      }
      if (files.length === 0) {
        return {
          path,
          modeCount: 0,
          returned: 0,
          modes: [],
          findings: [
            {
              severity: "error" as const,
              rule: "mode-folder-empty",
              message: "no modes/*.txt in this addon directory",
              mode: "",
              path: join(path, "modes"),
            },
          ],
          errors: 1,
          warnings: 0,
          ok: false,
        };
      }
      files.sort();
    } else {
      files.push(path);
    }

    const modes: InspectedMode[] = [];
    const findings: Finding[] = [];
    for (const file of files.slice(0, args.limit)) {
      const mode = await inspectMode(file, ctx);
      modes.push(mode);
      findings.push(...inspectFindings(mode));
    }
    const errors = findings.filter((finding) => finding.severity === "error").length;
    const warnings = findings.filter((finding) => finding.severity === "warning").length;
    return {
      path,
      modeCount: files.length,
      returned: modes.length,
      modes,
      findings,
      errors,
      warnings,
      ok: errors === 0,
    };
  },
});

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function modeText(input: {
  name: string;
  base: string;
  maxPlayers: number;
  hasDifficulty: boolean;
  singleChapter: boolean;
  playerControlledZombies: boolean;
  title: string;
  description: string;
  author: string;
  image: string;
  convars: Record<string, string | number | boolean>;
}): string {
  const lines = [
    quote(input.name),
    "{",
    `\t"base"\t\t${quote(input.base)}`,
    `\t"maxplayers"\t${quote(String(input.maxPlayers))}`,
    `\t"hasdifficulty"\t\t${quote(input.hasDifficulty ? "1" : "0")}`,
    `\t"singlechapter"\t\t${quote(input.singleChapter ? "1" : "0")}`,
    `\t"playercontrolledzombies"\t${quote(input.playerControlledZombies ? "1" : "0")}`,
    "",
    `\t"DisplayTitle"\t${quote(input.title)}`,
    `\t"Description"\t${quote(input.description)}`,
    `\t"Image"\t\t${quote(input.image)}`,
    `\t"Author"\t${quote(input.author)}`,
  ];
  const convars = Object.entries(input.convars);
  if (convars.length > 0) {
    lines.push("", "\tconvar", "\t{");
    for (const [name, value] of convars) {
      lines.push(`\t\t${quote(name)}\t${quote(String(value))}`);
    }
    lines.push("\t}");
  }
  lines.push("}", "");
  return lines.join("\n");
}

function squirrelKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : quote(key);
}

function squirrelValue(value: string | number | boolean): string {
  if (typeof value === "string") return quote(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function scriptText(name: string, options: Record<string, string | number | boolean>): string {
  const lines = [
    `// ${name}: Left 4 Dead 2 mutation`,
    `// Loaded with modes/${name}.txt. MutationOptions overrides DirectorOptions.`,
    `printl("Mutation ${name} loaded");`,
    "",
    "MutationOptions <-",
    "{",
  ];
  for (const [key, value] of Object.entries(options)) {
    lines.push(`\t${squirrelKey(key)} = ${squirrelValue(value)}`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

function addonInfoText(title: string, description: string, author: string): string {
  return [
    quote("AddonInfo"),
    "{",
    "\taddonSteamAppID 550",
    `\taddonTitle ${quote(title)}`,
    "\taddonContent_Script 1",
    `\taddonAuthor ${quote(author)}`,
    `\taddonDescription ${quote(description)}`,
    "}",
    "",
  ].join("\n");
}

export const writeMutationTool = defineTool({
  name: "write_mutation",
  description:
    "Scaffolds a Left 4 Dead 2 mutation add-on: `modes/<name>.txt` with base, player count, " +
    "menu metadata and convar overrides, `scripts/vscripts/<name>.nut` with a " +
    "MutationOptions table, and `addoninfo.txt` with addonContent_Script 1 when it is not " +
    "already there. The Squirrel source is checked by the existing VScript rules and the " +
    "mode file is read back through srctools.keyvalues, so `verified` means both files " +
    "parse. Existing files are refused unless `overwrite: true`; a backup is written when " +
    "an existing file is replaced.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    directory: z.string().describe("Add-on root to create modes/ and scripts/vscripts/ under."),
    name: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9_]+$/, "the mode name becomes a filename and a console argument"),
    title: z.string().min(1).describe("DisplayTitle in the mutation menu."),
    description: z.string().min(1).describe("Description in the mutation menu."),
    author: z.string().min(1).default("unknown"),
    base: z.enum(["coop", "versus", "survival", "scavenge", "realism"]).default("coop"),
    maxPlayers: z.number().int().min(1).max(32).optional(),
    hasDifficulty: z.boolean().default(true),
    singleChapter: z.boolean().default(false),
    playerControlledZombies: z.boolean().optional(),
    convars: z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .default({})
      .describe("Convar overrides for the `convar` block, e.g. { z_common_limit: 0 }."),
    directorOptions: z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .default({})
      .describe("MutationOptions entries, e.g. { CommonLimit: 0, TankLimit: 2 }."),
    image: z.string().default("maps/any"),
    overwrite: z.boolean().default(false),
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    directory: z.string(),
    name: z.string(),
    mode: z.string(),
    script: z.string(),
    addonInfo: z.string(),
    addonInfoCreated: z.boolean(),
    written: z.array(z.string()),
    verified: z.boolean(),
    options: z.number(),
    convars: z.number(),
  },
  handler: async (args, ctx) => {
    if (BUILTIN_BASES.has(args.name.toLowerCase())) {
      throw new Error(`"${args.name}" is a built-in mode name; choose a mutation name`);
    }
    const directory = resolveInput(args.directory, ctx.config);
    const modeDir = join(directory, "modes");
    const scriptDir = join(directory, "scripts", "vscripts");
    const modePath = join(modeDir, `${args.name}.txt`);
    const scriptPath = join(scriptDir, `${args.name}.nut`);
    const addonInfoPath = join(directory, "addoninfo.txt");
    const existing = [modePath, scriptPath].filter((path) => existsSync(path));
    if (existing.length > 0 && !args.overwrite) {
      throw new Error(
        `${existing.join(", ")} already exist; pass overwrite:true to replace them`,
      );
    }

    const maxPlayers =
      args.maxPlayers ?? (args.base === "versus" || args.base === "scavenge" ? 8 : 4);
    const playerControlledZombies =
      args.playerControlledZombies ?? (args.base === "versus" || args.base === "scavenge");
    const mode = modeText({
      name: args.name,
      base: args.base,
      maxPlayers,
      hasDifficulty: args.hasDifficulty ?? true,
      singleChapter: args.singleChapter ?? false,
      playerControlledZombies,
      title: args.title,
      description: args.description,
      author: args.author ?? "unknown",
      image: args.image ?? "maps/any",
      convars: args.convars ?? {},
    });
    const script = scriptText(args.name, args.directorOptions ?? {});
    const report = checkNut(script, scriptPath);
    const errors = report.diagnostics.filter((entry) => entry.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `the generated script would not compile:\n${errors
          .map((entry) => `${entry.line === null ? "" : `line ${entry.line}: `}${entry.message}`)
          .join("\n")}`,
      );
    }

    mkdirSync(modeDir, { recursive: true });
    mkdirSync(scriptDir, { recursive: true });
    const written: string[] = [];
    for (const [path, text] of [
      [modePath, mode],
      [scriptPath, script],
    ] as const) {
      const target = assertWritable(path, ctx.config);
      writeGuarded(target, text, ctx.config, {
        backup: existsSync(target) && (args.backup ?? true),
        unchanged: false,
      });
      ctx.audit.record({ kind: "file_write", data: { path: target, mutation: args.name } });
      written.push(target);
    }

    let addonInfoCreated = false;
    if (!existsSync(addonInfoPath)) {
      const target = assertWritable(addonInfoPath, ctx.config);
      writeGuarded(
        target,
        addonInfoText(args.title, args.description, args.author ?? "unknown"),
        ctx.config,
        {
          unchanged: false,
        },
      );
      ctx.audit.record({ kind: "file_write", data: { path: target, mutation: args.name } });
      written.push(target);
      addonInfoCreated = true;
    }

    const inspected = await inspectMode(modePath, ctx);
    const expectedConvars = Object.fromEntries(
      Object.entries(args.convars ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]),
    );
    const actualConvars = Object.fromEntries(
      inspected.convars.map((convar) => [convar.name.toLowerCase(), convar.value]),
    );
    const expectedOptions = Object.fromEntries(
      Object.entries(args.directorOptions ?? {}).map(([key, value]) => [key, String(value)]),
    );
    const verified =
      inspected.name === args.name &&
      inspected.base === args.base &&
      inspected.maxPlayerCount === maxPlayers &&
      inspected.script !== null &&
      !inspected.script.compiled &&
      Object.keys(expectedConvars).length === Object.keys(actualConvars).length &&
      Object.entries(expectedConvars).every(([key, value]) => actualConvars[key] === value) &&
      Object.keys(expectedOptions).length === Object.keys(report.mutationOptions).length &&
      Object.entries(expectedOptions).every(
        ([key, value]) => report.mutationOptions[key] === value,
      );
    return {
      directory,
      name: args.name,
      mode: modePath,
      script: scriptPath,
      addonInfo: addonInfoPath,
      addonInfoCreated,
      written,
      verified,
      options: Object.keys(args.directorOptions).length,
      convars: Object.keys(args.convars).length,
    };
  },
});

const SI_CLASSES = [
  { name: "boomer", limitKey: "BoomerLimit", cvar: "z_boomer_limit", versus: "z_versus_boomer_limit" },
  { name: "smoker", limitKey: "SmokerLimit", cvar: "z_smoker_limit", versus: "z_versus_smoker_limit" },
  { name: "hunter", limitKey: "HunterLimit", cvar: "z_hunter_limit", versus: "z_versus_hunter_limit" },
  { name: "spitter", limitKey: "SpitterLimit", cvar: "z_spitter_limit", versus: "z_versus_spitter_limit" },
  { name: "jockey", limitKey: "JockeyLimit", cvar: "z_jockey_limit", versus: "z_versus_jockey_limit" },
  { name: "charger", limitKey: "ChargerLimit", cvar: "z_charger_limit", versus: "z_versus_charger_limit" },
  { name: "tank", limitKey: "TankLimit", cvar: "z_tank_limit", versus: "z_versus_tank_limit" },
  { name: "witch", limitKey: "WitchLimit", cvar: "z_witch_limit", versus: "z_versus_witch_limit" },
] as const;

function optionNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim().replace(/^"(.*)"$/, "$1");
  return /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}

export const readSpecialInfectedTool = defineTool({
  name: "read_special_infected",
  description:
    "Reports the special-infected spawn set a mutation or map actually configures: each " +
    "class's limit from MutationOptions (which overrides DirectorOptions), or from a " +
    "z_<class>_limit / z_versus_<class>_limit convar in modes/<name>.txt when the script " +
    "says nothing. A limit of 0 disables that class; absent means the base mode's default. " +
    "Also reports MaxSpecials/MinSpecials/MaxConcurrentSpecials and flags impossible " +
    "combinations, such as MinSpecials above MaxSpecials, a negative limit, or every class " +
    "disabled. Accepts a .nut, a modes/<name>.txt, or an add-on directory. The Squirrel " +
    "tables are read by the existing read_vscript rules.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("A .nut, a modes/<name>.txt, or an addon directory."),
  },
  outputSchema: {
    path: z.string(),
    modeCount: z.number(),
    scriptCount: z.number(),
    sources: z.array(z.string()),
    specials: z.array(
      z.object({
        name: z.string(),
        limit: z.number().nullable(),
        source: z.enum(["MutationOptions", "DirectorOptions", "cvar"]).nullable(),
        enabled: z.boolean(),
      }),
    ),
    totals: z.object({
      maxSpecials: z.number().nullable(),
      minSpecials: z.number().nullable(),
      maxConcurrentSpecials: z.number().nullable(),
      specialRespawnInterval: z.number().nullable(),
    }),
    convars: z.record(z.string()),
    findings: z.array(FINDING),
    errors: z.number(),
    warnings: z.number(),
    ok: z.boolean(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} was not found`);
    const isDir = statSync(path).isDirectory();
    const modes: InspectedMode[] = [];
    const directScripts: string[] = [];
    if (isDir) {
      const modesDir = join(path, "modes");
      if (existsSync(modesDir)) {
        for (const entry of readdirSync(modesDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
            modes.push(await inspectMode(join(modesDir, entry.name), ctx));
          }
        }
      }
    } else if (path.toLowerCase().endsWith(".nut")) {
      directScripts.push(path);
    } else {
      modes.push(await inspectMode(path, ctx));
    }

    const scripts = [...directScripts];
    for (const mode of modes) {
      if (mode.script !== null && !mode.script.compiled) scripts.push(mode.script.path);
    }

    let directorOptions: Record<string, string> = {};
    let mutationOptions: Record<string, string> = {};
    const sources: string[] = [];
    for (const script of scripts) {
      const report = checkNut(readFileSync(script, "utf8"), script);
      directorOptions = { ...directorOptions, ...report.directorOptions };
      mutationOptions = { ...mutationOptions, ...report.mutationOptions };
      sources.push(script);
    }
    const options = { ...directorOptions, ...mutationOptions };
    const convars: Record<string, string> = {};
    for (const mode of modes) {
      for (const convar of mode.convars) convars[convar.name.toLowerCase()] = convar.value;
    }

    const findings: Finding[] = [];
    const add = (severity: Finding["severity"], rule: string, message: string): void => {
      findings.push({ severity, rule, message, mode: modes[0]?.name ?? "", path });
    };

    const specials = SI_CLASSES.map((entry) => {
      const fromMutation = optionNumber(mutationOptions[entry.limitKey]);
      const fromDirector = optionNumber(directorOptions[entry.limitKey]);
      const cvarValue = convars[entry.versus] ?? convars[entry.cvar];
      const fromCvar = cvarValue === undefined ? null : Number(cvarValue);
      let limit: number | null = null;
      let source: "MutationOptions" | "DirectorOptions" | "cvar" | null = null;
      if (mutationOptions[entry.limitKey] !== undefined) {
        limit = fromMutation;
        source = "MutationOptions";
      } else if (directorOptions[entry.limitKey] !== undefined) {
        limit = fromDirector;
        source = "DirectorOptions";
      } else if (cvarValue !== undefined && Number.isFinite(fromCvar)) {
        limit = fromCvar;
        source = "cvar";
      }
      if (limit === null && source !== null) {
        add(
          "error",
          "special-limit-value",
          `${entry.limitKey} is not a number; the engine ignores it`,
        );
      } else if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
        add(
          "error",
          "special-limit-value",
          `${entry.limitKey} is ${limit}; a special-infected limit must be a non-negative integer`,
        );
      }
      return {
        name: entry.name,
        limit,
        source,
        enabled: limit === null || limit > 0,
      };
    });

    const totals = {
      maxSpecials: optionNumber(options["MaxSpecials"]),
      minSpecials: optionNumber(options["MinSpecials"]),
      maxConcurrentSpecials: optionNumber(options["MaxConcurrentSpecials"]),
      specialRespawnInterval: optionNumber(options["SpecialRespawnInterval"]),
    };
    if (
      totals.minSpecials !== null &&
      totals.maxSpecials !== null &&
      totals.minSpecials > totals.maxSpecials
    ) {
      add(
        "error",
        "special-min-over-max",
        `MinSpecials ${totals.minSpecials} is above MaxSpecials ${totals.maxSpecials}`,
      );
    }
    if (
      totals.maxConcurrentSpecials !== null &&
      totals.maxSpecials !== null &&
      totals.maxConcurrentSpecials > totals.maxSpecials
    ) {
      add(
        "warning",
        "special-concurrent-over-max",
        `MaxConcurrentSpecials ${totals.maxConcurrentSpecials} is above MaxSpecials ${totals.maxSpecials}`,
      );
    }
    if (specials.every((special) => !special.enabled)) {
      add("warning", "special-all-disabled", "every special-infected class has limit 0");
    }
    if (specials.every((special) => special.limit === null)) {
      add(
        "info",
        "special-none-configured",
        "no special-infected limit is set here; the base mode's defaults apply",
      );
    }

    const errors = findings.filter((finding) => finding.severity === "error").length;
    const warnings = findings.filter((finding) => finding.severity === "warning").length;
    return {
      path,
      modeCount: modes.length,
      scriptCount: scripts.length,
      sources,
      specials,
      totals,
      convars,
      findings,
      errors,
      warnings,
      ok: errors === 0,
    };
  },
});

export const mutationTools = [
  readGameModeTool,
  checkMutationTool,
  writeMutationTool,
  readSpecialInfectedTool,
];
