/**
 * Steam Workshop build file. This is an offline descriptor for inspection and archival,
 * not the L4D2 upload path: SteamCMD's `workshop_build_item` and ISteamUGC's
 * `SetItemContent` both answer `Invalid Parameter` for L4D2 content. Use
 * `publish_workshop_item` / `update_workshop_item`, which go through the legacy
 * `ISteamRemoteStorage` path in the running Steam client.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { parse } from "../../../formats/typescript/kv/parse.js";

function vdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export const writeWorkshopVdfTool = defineTool({
  name: "write_workshop_vdf",
  description:
    "Writes a `workshop_build_item.vdf` for inspection or archival. It is not the L4D2 " +
    "upload path: SteamCMD `workshop_build_item` and ISteamUGC `SetItemContent` both fail " +
    "with `Invalid Parameter` for L4D2 content; use `publish_workshop_item` or " +
    "`update_workshop_item`, which use the legacy ISteamRemoteStorage path in the running " +
    "Steam client. The file carries appid 550, a publishedfileid (0 for a new item), the " +
    "content folder, an optional preview image, visibility, title, description and change " +
    "note. The content folder must exist and should contain addoninfo.txt. It has no field " +
    "for required items: Steam stores those on the item, and `publish_workshop_item` / " +
    "`update_workshop_item` set them by id. Guarded.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    contentFolder: z
      .string()
      .describe("Addon staging folder (the folder passed to vpk.exe / Workshop upload)."),
    out: z
      .string()
      .optional()
      .describe("Output VDF. Defaults to <contentFolder>/workshop_build_item.vdf."),
    title: z.string().min(1),
    description: z.string().default(""),
    previewFile: z
      .string()
      .optional()
      .describe("Preview image (.jpg/.png) shown on the Workshop page."),
    publishedFileId: z
      .string()
      .default("0")
      .describe("0 creates a new item; an existing id updates it."),
    visibility: z.number().int().min(0).max(3).default(0).describe("0 public, 1 friends, 2 private, 3 unlisted."),
    changeNote: z.string().optional(),
    appId: z.number().int().default(550),
    overwrite: z.boolean().default(true),
    backup: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: z.string().nullable(),
    contentFolder: z.string(),
    previewFile: z.string().nullable(),
    publishedFileId: z.string(),
    visibility: z.number(),
    bytes: z.number(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const contentFolder = resolveInput(args.contentFolder, ctx.config);
    if (!existsSync(contentFolder) || !statSync(contentFolder).isDirectory()) {
      throw new Error(`${contentFolder} is not an existing directory`);
    }
    const warnings: string[] = [];
    if (!existsSync(join(contentFolder, "addoninfo.txt"))) {
      warnings.push(
        "the content folder has no addoninfo.txt; SteamCMD will build the item but the game " +
          "menu has no title or author for it",
      );
    }
    let previewFile: string | null = null;
    if (args.previewFile !== undefined) {
      previewFile = resolveInput(args.previewFile, ctx.config);
      if (!existsSync(previewFile)) throw new Error(`${previewFile} does not exist`);
      if (!/\.(jpe?g|png)$/i.test(previewFile)) {
        warnings.push(`${previewFile} is not a .jpg or .png; Steam expects an image preview`);
      }
    }
    const out = resolveInput(
      args.out ?? join(contentFolder, "workshop_build_item.vdf"),
      ctx.config,
    );
    if (existsSync(out) && args.overwrite === false) {
      throw new Error(`${out} already exists; pass overwrite: true to replace it`);
    }

    const lines = [
      '"workshopitem"',
      "{",
      `\t"appid"\t\t"${args.appId ?? 550}"`,
      `\t"publishedfileid"\t\t"${vdf(args.publishedFileId ?? "0")}"`,
      `\t"contentfolder"\t\t"${vdf(contentFolder)}"`,
      ...(previewFile ? [`\t"previewfile"\t\t"${vdf(previewFile)}"`] : []),
      `\t"visibility"\t\t"${args.visibility ?? 0}"`,
      `\t"title"\t\t"${vdf(args.title)}"`,
      `\t"description"\t\t"${vdf(args.description ?? "")}"`,
      ...(args.changeNote !== undefined
        ? [`\t"changenote"\t\t"${vdf(args.changeNote)}"`]
        : []),
      "}",
      "",
    ];
    const text = lines.join("\n");
    const write = writeGuarded(out, text, ctx.config, {
      backup: args.backup === true,
      dryRun: false,
    });
    return {
      path: out,
      written: write.written,
      backupPath: write.backupPath,
      contentFolder,
      previewFile,
      publishedFileId: args.publishedFileId ?? "0",
      visibility: args.visibility ?? 0,
      bytes: Buffer.byteLength(text, "utf8"),
      warnings,
    };
  },
});

export const readWorkshopVdfTool = defineTool({
  name: "read_workshop_vdf",
  description:
    "Reads a `workshop_build_item.vdf`: appid, publishedfileid, contentfolder, previewfile, " +
    "visibility, title, description and change note. Use it to inspect an offline descriptor; " +
    "it is not the L4D2 upload path. The format has no dependency field: required items live " +
    "on the Workshop item, and `read_workshop_item` reports them as `children`.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Workshop VDF, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    found: z.boolean(),
    keys: z.record(z.string()),
    publishedFileId: z.string().nullable(),
    contentFolder: z.string().nullable(),
    previewFile: z.string().nullable(),
    title: z.string().nullable(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const nodes = parse(readFileSync(path, "utf8"));
    const item = nodes.find(
      (node) => node.kind === "block" && node.name.toLowerCase() === "workshopitem",
    );
    if (!item || item.kind !== "block") throw new Error(`${path} has no workshopitem block`);
    const unescape = (value: string): string => value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const keys = Object.fromEntries(
      item.entries
        .filter((entry) => entry.kind === "pair")
        .map((entry) => [entry.key, unescape(entry.value)]),
    );
    return {
      path,
      found: true,
      keys,
      publishedFileId: keys.publishedfileid ?? null,
      contentFolder: keys.contentfolder ?? null,
      previewFile: keys.previewfile ?? null,
      title: keys.title ?? null,
    };
  },
});

export const workshopTools = [writeWorkshopVdfTool, readWorkshopVdfTool];
