import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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

export const addonTools = [runVpkPackTool, writeAddonInfoTool];
