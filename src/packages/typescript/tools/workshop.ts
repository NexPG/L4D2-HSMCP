/**
 * Steam Workshop build file. This is the offline half of publishing: it writes the VDF
 * `steamcmd +workshop_build_item` reads. Uploading still needs SteamCMD and the account; the
 * file, paths and metadata are what a project can prepare without touching Steam.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";

function vdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export const writeWorkshopVdfTool = defineTool({
  name: "write_workshop_vdf",
  description:
    "Writes a `workshop_build_item.vdf` for `steamcmd +workshop_build_item`. It carries the " +
    "appid 550, a publishedfileid (0 for a new item), the content folder, an optional preview " +
    "image, visibility, title, description and change note. The content folder must exist and " +
    "should contain addoninfo.txt; a missing manifest is a warning because SteamCMD will " +
    "still build the item. Uploading itself is a Steam action, not something this server can " +
    "do offline. Guarded.",
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

export const workshopTools = [writeWorkshopVdfTool];
