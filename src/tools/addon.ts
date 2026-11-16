import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { run } from "../proc/run.js";
import { callSidecar } from "../sidecar/client.js";
import { resolveInput } from "./paths.js";

/** Quoting for the addon manifest; the grammar has no escapes. */
function quote(text: string): string {
  if (text.includes('"') || text.includes("\n") || text.includes("\r")) {
    throw new Error(`an addon field cannot contain a quote or a newline: ${JSON.stringify(text)}`);
  }
  return `"${text}"`;
}

export interface AddonInfo {
  title: string;
  description?: string;
  author?: string;
  version?: string;
  tag?: string;
}

/** The conventional Left 4 Dead 2 addon manifest. */
export function addonInfoText(info: AddonInfo): string {
  const lines = [
    quote("addoninfo"),
    "{",
    `\t"addonSteamAppID"\t${quote("550")}`,
    `\t"addonTitle"\t${quote(info.title)}`,
    `\t"addonAuthor"\t${quote(info.author ?? "")}`,
    `\t"addonVersion"\t${quote(info.version ?? "1")}`,
    `\t"addonTag"\t${quote(info.tag ?? "campaign")}`,
  ];
  if ((info.tag ?? "campaign") === "campaign") {
    lines.push(`\t"addonContent_Campaign"\t${quote("1")}`);
  }
  if (info.description) lines.push(`\t"addonDesc"\t${quote(info.description)}`);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

const ADDON_INFO = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  version: z.string().optional(),
  tag: z.string().optional().describe('Usually "campaign".'),
});

export const runVpkPackTool = defineTool({
  name: "run_vpk_pack",
  description:
    "Packs a staging directory into an addon VPK with the game's own vpk.exe. The " +
    "directory is packed root-relative, so `addoninfo.txt`, `missions/`, `maps/` and " +
    "`materials/vgui/maps/` end up where the game expects them. `addoninfo` writes the " +
    "manifest first when the directory has none. Afterwards the archive is read back " +
    "through the sidecar and its entry list is compared with the staging tree: a pack " +
    "that silently dropped a file is the failure this check exists for.",
  realm: "local",
  guarded: true,
  inputSchema: {
    dir: z.string().describe("Staging directory containing addoninfo.txt and the addon's tree."),
    out: z
      .string()
      .optional()
      .describe("Destination .vpk. Defaults to <parent>/<directory name>.vpk."),
    addoninfo: ADDON_INFO.optional().describe("Write addoninfo.txt into the staging directory first."),
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
    const have = new Set(entries);
    const missingFromVpk = [...expected].filter((p) => !have.has(p));
    const extraInVpk = entries.filter((p) => !expected.has(p));

    return {
      vpk: out,
      bytes: statSync(out).size,
      entries,
      entryCount: entries.length,
      staging: dir,
      addoninfoWritten,
      verified: { compared: expected.size, missingFromVpk, extraInVpk },
    };
  },
});

export const addonTools = [runVpkPackTool];
