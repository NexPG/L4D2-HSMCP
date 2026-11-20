import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { run } from "../../../core/typescript/proc/run.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { parse } from "../../../formats/typescript/kv/parse.js";

/** Quoting for the addon manifest; the grammar has no escapes. */
function quote(text: string): string {
  if (text.includes('"') || text.includes("\n") || text.includes("\r")) {
    throw new Error(`an addon field cannot contain a quote or a newline: ${JSON.stringify(text)}`);
  }
  return `"${text}"`;
}

export const AI_CREDIT_KEY = "addonAICredit";

/** Version of the toolkit that produced the addon, read from package.json. */
export function toolkitVersion(): string {
  try {
    const text = readFileSync(new URL("../../../../package.json", import.meta.url), "utf8");
    return (JSON.parse(text) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function aiCredit(): string {
  return `Created by AI via L4D2-HSMCP ${toolkitVersion()}`;
}

export interface AddonInfo {
  title: string;
  description?: string;
  author?: string;
  version?: string;
  tag?: string;
  tagline?: string;
}

/** The conventional Left 4 Dead 2 addon manifest. */
export function addonInfoText(info: AddonInfo, credit = true): string {
  const lines = [
    quote("addoninfo"),
    "{",
    `\t"addonSteamAppID"\t${quote("550")}`,
    `\t"addontitle"\t${quote(info.title)}`,
    `\t"addonauthor"\t${quote(info.author ?? "")}`,
    `\t"addonversion"\t${quote(info.version ?? "1")}`,
  ];
  if (info.tagline) lines.push(`\t"addonTagline"\t${quote(info.tagline)}`);
  if ((info.tag ?? "campaign") === "campaign") {
    lines.push(`\t"addonContent_Campaign"\t${quote("1")}`);
  }
  if (info.description) lines.push(`\t"addonDescription"\t${quote(info.description)}`);
  if (credit) lines.push(`\t"${AI_CREDIT_KEY}"\t${quote(aiCredit())}`);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function ensureAddonCredit(path: string, config: import("../../../core/typescript/config.js").Config): boolean {
  const text = readFileSync(path, "utf8");
  if (text.toLowerCase().includes(AI_CREDIT_KEY.toLowerCase())) return false;
  const close = text.lastIndexOf("}");
  if (close < 0) return false;
  const before = text.slice(0, close);
  const line = `${before.endsWith("\n") ? "" : "\n"}\t"${AI_CREDIT_KEY}"\t${quote(aiCredit())}\n`;
  const updated = before + line + text.slice(close);
  writeGuarded(path, updated, config);
  return true;
}

const ADDON_INFO = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  version: z.string().optional(),
  tag: z.string().optional().describe('Usually "campaign".'),
  tagline: z.string().optional().describe("AddonTagline, the one-line description in the menu."),
});

export const runVpkPackTool = defineTool({
  name: "run_vpk_pack",
  description:
    "Packs a staging directory into an addon VPK with the game's own vpk.exe. The " +
    "directory is packed root-relative, so `addoninfo.txt`, `missions/`, `maps/` and " +
    "`materials/vgui/maps/` end up where the game expects them. `addoninfo` writes the " +
    "manifest first when the directory has none. Afterwards the archive is read back " +
    "through the sidecar and its entry list is compared with the staging tree: a pack " +
    "that silently dropped a file is the failure this check exists for. `install: true` " +
    "copies the finished archive into the game's left4dead2/addons directory.",
  realm: "local",
  guarded: true,
  inputSchema: {
    dir: z.string().describe("Staging directory containing addoninfo.txt and the addon's tree."),
    out: z
      .string()
      .optional()
      .describe("Destination .vpk. Defaults to <parent>/<directory name>.vpk."),
    addoninfo: ADDON_INFO.optional().describe("Write addoninfo.txt into the staging directory first."),
    install: z
      .boolean()
      .default(false)
      .describe("Copy the finished .vpk into the game's left4dead2/addons directory."),
    credit: z
      .boolean()
      .default(true)
      .describe("Append the addonAICredit line naming L4D2-HSMCP and its version."),
    overwrite: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    vpk: z.string(),
    bytes: z.number(),
    entries: z.array(z.string()),
    entryCount: z.number(),
    staging: z.string(),
    addoninfoWritten: z.boolean(),
    installedPath: z.string().nullable(),
    aiCredit: z.string().nullable(),
    verified: z.object({
      compared: z.number(),
      missingFromVpk: z.array(z.string()),
      extraInVpk: z.array(z.string()),
    }),
  },
  handler: async (args, ctx) => {
    const dir = resolveInput(args.dir, ctx.config);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new Error(`${dir} is not an existing directory`);
    }

    let addoninfoWritten = false;
    if (args.addoninfo) {
      const target = join(dir, "addoninfo.txt");
      writeGuarded(target, addonInfoText(args.addoninfo), ctx.config);
      addoninfoWritten = true;
    }
    if (!existsSync(join(dir, "addoninfo.txt"))) {
      throw new Error(
        `${dir} has no addoninfo.txt; pass \`addoninfo\` or write one first. ` +
          `The game reads the title from it, and an addon without one is hard to identify in the menu.`,
      );
    }

    if (args.credit !== false) {
      ensureAddonCredit(join(dir, "addoninfo.txt"), ctx.config);
    }

    const parent = dirname(dir);
    const stagingName = basename(dir);
    const produced = join(parent, `${stagingName.toLowerCase()}.vpk`);
    const out = args.out
      ? resolveInput(args.out, ctx.config)
      : join(parent, `${stagingName.toLowerCase()}.vpk`);
    const stagingRoot = resolve(dir);
    if (resolve(out) === stagingRoot || resolve(out).startsWith(stagingRoot + sep)) {
      throw new Error(`the output VPK must not live inside the directory being packed: ${out}`);
    }

    const vpkExe = join(ctx.config.binDir ?? "", "vpk.exe");
    if (!ctx.config.binDir || !existsSync(vpkExe)) {
      throw new Error(
        `vpk.exe not found in ${ctx.config.binDir ?? "the game's bin directory"}. ` +
          `It ships with the Left 4 Dead 2 client; run health to see what was found.`,
      );
    }

    if (existsSync(out) && !args.overwrite) {
      throw new Error(`${out} already exists; pass overwrite: true to replace it`);
    }
    // vpk.exe writes beside the directory, named after it; clear the staging output and
    // the destination so a stale archive cannot be mistaken for this run.
    for (const p of [produced, out]) if (existsSync(p)) rmSync(p, { force: true });
    if (dirname(out) !== parent) mkdirSync(dirname(out), { recursive: true });

    const result = await run(vpkExe, [stagingName], { cwd: parent, timeoutMs: 600_000 });
    if (result.timedOut) throw new Error(`vpk.exe timed out packing ${dir}`);
    if (result.code !== 0) {
      throw new Error(
        `vpk.exe exited ${result.code} packing ${dir}: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    if (!existsSync(produced)) {
      throw new Error(`vpk.exe reported success but wrote no ${produced}`);
    }
    if (resolve(produced) !== resolve(out)) {
      copyFileSync(produced, out);
      rmSync(produced, { force: true });
    }

    const listed = await callSidecar<{ entries: string[] }>(
      "vpk_list",
      { path: out, prefix: "", limit: 100_000 },
      ctx.config,
      120_000,
    );
    const entries = listed.entries;
    // The oracle: every file the staging tree holds must be in the archive. A directory is
    // not an entry; vpk.exe does not record empty directories, and neither does the format.
    const expected = new Set<string>();
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else expected.add(full.slice(dir.length + 1).replace(/\\/g, "/"));
      }
    };
    walk(dir);
    // Windows and VPK paths are case-insensitive in practice: vpk.exe lowercases the
    // archive entries, so a README.md on disk is readme.md inside. Compare without case
    // rather than reporting a file that is present as missing.
    const have = new Set(entries.map((p) => p.toLowerCase()));
    const expectedLower = new Set([...expected].map((p) => p.toLowerCase()));
    const missingFromVpk = [...expected].filter((p) => !have.has(p.toLowerCase()));
    const extraInVpk = entries.filter((p) => !expectedLower.has(p.toLowerCase()));

    let installedPath: string | null = null;
    if (args.install) {
      if (!ctx.config.gameDir) {
        throw new Error("the game directory is not resolved; run health first");
      }
      const addonsDir = join(ctx.config.gameDir, "addons");
      mkdirSync(addonsDir, { recursive: true });
      installedPath = join(addonsDir, basename(out));
      copyFileSync(out, installedPath);
    }

    return {
      vpk: out,
      bytes: statSync(out).size,
      entries,
      entryCount: entries.length,
      staging: dir,
      addoninfoWritten,
      installedPath,
      aiCredit: args.credit === false ? null : aiCredit(),
      verified: { compared: expected.size, missingFromVpk, extraInVpk },
    };
  },
});

export const writeAddonInfoTool = defineTool({
  name: "write_addoninfo",
  description:
    "Writes an `addoninfo.txt` without packing an archive: appid 550, title, author, " +
    "version, tag, tagline and description, plus the `addonAICredit` line with the toolkit " +
    "version. Refuses an existing file unless `overwrite` is set, and parses the result back " +
    "as KeyValues. Use it for a campaign or addon staging folder before `validate_addon` and " +
    "`run_vpk_pack`. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z
      .string()
      .describe("addoninfo.txt path, or a staging directory to put addoninfo.txt in."),
    ...ADDON_INFO.shape,
    credit: z.boolean().default(true),
    overwrite: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    aiCredit: z.string().nullable(),
    title: z.string(),
  },
  handler: (args, ctx) => {
    let path = resolveInput(args.path, ctx.config);
    if (!path.toLowerCase().endsWith(".txt")) path = join(path, "addoninfo.txt");
    if (existsSync(path) && args.overwrite !== true) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }
    mkdirSync(dirname(path), { recursive: true });
    const text = addonInfoText(
      {
        title: args.title,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.author === undefined ? {} : { author: args.author }),
        ...(args.version === undefined ? {} : { version: args.version }),
        ...(args.tag === undefined ? {} : { tag: args.tag }),
        ...(args.tagline === undefined ? {} : { tagline: args.tagline }),
      },
      args.credit !== false,
    );
    const write = writeGuarded(path, text, ctx.config);
    const parsed = parse(text);
    const block = parsed.find((node) => node.kind === "block" && node.name === "addoninfo");
    if (!block) throw new Error("the addoninfo did not parse back with its block");
    return {
      path,
      written: write.written,
      bytes: Buffer.byteLength(text, "utf8"),
      aiCredit: args.credit === false ? null : aiCredit(),
      title: args.title,
    };
  },
});

function countTree(root: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        files += 1;
        bytes += statSync(full).size;
      }
    }
  };
  walk(root);
  return { files, bytes };
}

export const installAddonTool = defineTool({
  name: "install_addon",
  description:
    "Copies an addon into the game's `left4dead2/addons`: a `.vpk` as itself, or a staging " +
    "folder as a folder with the same name. Refuses an existing destination unless " +
    "`overwrite` is true. This is the install step; `run_vpk_pack` builds, `run_map_test` " +
    "runs. Guarded.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("A .vpk or a staging directory."),
    overwrite: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    source: z.string(),
    installedPath: z.string(),
    kind: z.enum(["vpk", "folder"]),
    files: z.number(),
    bytes: z.number(),
  },
  handler: (args, ctx) => {
    const source = resolveInput(args.path, ctx.config);
    if (!existsSync(source)) throw new Error(`${source} does not exist`);
    if (!ctx.config.gameDir) throw new Error("the game directory is not resolved; run health first");
    const addons = join(ctx.config.gameDir, "addons");
    mkdirSync(addons, { recursive: true });
    const isVpk = source.toLowerCase().endsWith(".vpk");
    const name = basename(source);
    const target = join(addons, name);
    if (existsSync(target) && args.overwrite !== true) {
      throw new Error(`${target} already exists; pass overwrite: true to replace it`);
    }
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    if (isVpk) {
      copyFileSync(source, target);
      return { source, installedPath: target, kind: "vpk" as const, files: 1, bytes: statSync(target).size };
    }
    if (!statSync(source).isDirectory()) throw new Error(`${source} is neither a .vpk nor a directory`);
    cpSync(source, target, { recursive: true });
    const counts = countTree(target);
    return { source, installedPath: target, kind: "folder" as const, ...counts };
  },
});

export const scaffoldAddonTool = defineTool({
  name: "write_addon_scaffold",
  description:
    "Creates the minimum pure-VScript addon layout: `addoninfo.txt` with the AI credit and " +
    "`scripts/vscripts/mapspawn_addon.nut` with a load banner. It is a starting point, not a " +
    "template that limits what goes beside it; add scripts, materials and maps freely. " +
    "Refuses an existing addoninfo unless `overwrite` is true. Guarded.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Addon staging directory."),
    title: z.string().min(1),
    author: z.string().optional(),
    version: z.string().optional(),
    tag: z.string().optional(),
    tagline: z.string().optional(),
    description: z.string().optional(),
    overwrite: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    dir: z.string(),
    addoninfo: z.string(),
    mapspawn: z.string().nullable(),
    written: z.boolean(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const dir = resolveInput(args.path, ctx.config);
    const infoPath = join(dir, "addoninfo.txt");
    if (existsSync(infoPath) && args.overwrite !== true) {
      throw new Error(`${infoPath} already exists; pass overwrite: true to replace it`);
    }
    mkdirSync(join(dir, "scripts", "vscripts"), { recursive: true });
    const text = addonInfoText(
      {
        title: args.title,
        ...(args.author === undefined ? {} : { author: args.author }),
        ...(args.version === undefined ? {} : { version: args.version }),
        ...(args.tag === undefined ? {} : { tag: args.tag }),
        ...(args.tagline === undefined ? {} : { tagline: args.tagline }),
        ...(args.description === undefined ? {} : { description: args.description }),
      },
      true,
    );
    const write = writeGuarded(infoPath, text, ctx.config);
    const mapspawnPath = join(dir, "scripts", "vscripts", "mapspawn_addon.nut");
    let mapspawn: string | null = null;
    if (!existsSync(mapspawnPath)) {
      const banner =
        `// Created by AI via L4D2-HSMCP ${toolkitVersion()}\n` +
        `printl("[HSMCP] mapspawn loaded");\n`;
      writeGuarded(mapspawnPath, banner, ctx.config);
      mapspawn = mapspawnPath;
    }
    return {
      dir,
      addoninfo: infoPath,
      mapspawn,
      written: write.written,
      warnings:
        mapspawn === null
          ? ["scripts/vscripts/mapspawn_addon.nut already existed and was left alone"]
          : [],
    };
  },
});

export const readAddonInfoTool = defineTool({
  name: "read_addoninfo",
  description:
    "Reads an `addoninfo.txt`: title, author, version, tag, description, the " +
    "`addonAICredit` line and every key it contains. Missing title or credit is reported, " +
    "not hidden. Use it after a hand edit or before `validate_addon`.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("addoninfo.txt, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    title: z.string().nullable(),
    author: z.string().nullable(),
    version: z.string().nullable(),
    tag: z.string().nullable(),
    description: z.string().nullable(),
    aiCredit: z.string().nullable(),
    keys: z.record(z.string()),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const nodes = parse(readFileSync(path, "utf8"));
    const info = nodes.find((node) => node.kind === "block" && node.name.toLowerCase() === "addoninfo");
    if (!info || info.kind !== "block") throw new Error(`${path} has no addoninfo block`);
    const keys = Object.fromEntries(
      info.entries
        .filter((entry) => entry.kind === "pair")
        .map((entry) => [entry.key, entry.value]),
    );
    const lower = Object.fromEntries(Object.entries(keys).map(([key, value]) => [key.toLowerCase(), value]));
    const warnings: string[] = [];
    if (!lower["addontitle"]) warnings.push("no addonTitle");
    if (!lower["addonaicredit"]) warnings.push("no addonAICredit");
    return {
      path,
      title: lower["addontitle"] ?? null,
      author: lower["addonauthor"] ?? null,
      version: lower["addonversion"] ?? null,
      tag: lower["addontag"] ?? null,
      description: lower["addondescription"] ?? null,
      aiCredit: lower["addonaicredit"] ?? null,
      keys,
      warnings,
    };
  },
});

export const addonTools = [runVpkPackTool, writeAddonInfoTool, readAddonInfoTool, installAddonTool, scaffoldAddonTool];
