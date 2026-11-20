/**
 * Mission poster: the `poster` block in a campaign file. It names the material the loading
 * screen draws and optionally a widescreen variant. The rest of the mission tree is
 * preserved, including keys this module does not model.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { parse } from "../../../formats/typescript/kv/parse.js";
import type { KvBlock, KvNode, KvPair } from "../../../formats/typescript/kv/parse.js";
import { serializeMission } from "../campaign/mission.js";

function pair(key: string, value: string): KvPair {
  return { kind: "pair", key, value, start: 0, end: 0 };
}

function block(name: string, entries: KvNode[]): KvBlock {
  return { kind: "block", name, entries, start: 0, end: 0, bodyStart: 0, bodyEnd: 0 };
}

function upsert(entries: KvNode[], key: string, value: string): void {
  const at = entries.findIndex((entry) => entry.kind === "pair" && entry.key.toLowerCase() === key.toLowerCase());
  if (at >= 0) entries[at] = pair(key, value);
  else entries.push(pair(key, value));
}

export const writeMissionPosterTool = defineTool({
  name: "write_mission_poster",
  description:
    "Sets a campaign mission's `poster` block: `posterImage`, optional " +
    "`posterImage_widescreen`, and `fullscreen`. The image is a material path relative to " +
    "`materials/vgui`, without `materials/` or `.vmt`; `write_loading_screen` makes the " +
    "VTF/VMT pair. Unknown keys and modes in the mission are preserved. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Mission .txt, absolute or relative to the repo root."),
    image: z.string().min(1).describe("Material path, e.g. LoadingScreen_MyCampaign."),
    widescreen: z.string().optional().describe("Optional 16:9/16:10 poster material."),
    fullscreen: z.boolean().default(false),
    backup: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: z.string().nullable(),
    image: z.string(),
    widescreen: z.string().nullable(),
    fullscreen: z.boolean(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const source = readFileSync(path, "utf8");
    const nodes = parse(source);
    const mission = nodes.find(
      (node): node is KvBlock => node.kind === "block" && node.name.toLowerCase() === "mission",
    );
    if (!mission) throw new Error(`${path} has no mission block`);
    let poster = mission.entries.find(
      (node): node is KvBlock => node.kind === "block" && node.name.toLowerCase() === "poster",
    );
    if (!poster) {
      poster = block("poster", []);
      mission.entries.push(poster);
    }
    const warnings: string[] = [];
    if (args.image.replace(/\\/g, "/").toLowerCase().startsWith("materials/") || /\.vmt$/i.test(args.image)) {
      warnings.push("posterImage is relative to materials/vgui and omits materials/ and .vmt");
    }
    upsert(poster.entries, "posterImage", args.image);
    if (args.widescreen !== undefined) {
      upsert(poster.entries, "posterImage_widescreen", args.widescreen);
    }
    upsert(poster.entries, "fullscreen", args.fullscreen === true ? "1" : "0");
    const text = serializeMission(mission);
    const check = parse(text).find(
      (node): node is KvBlock => node.kind === "block" && node.name.toLowerCase() === "mission",
    );
    const checkPoster = check?.entries.find(
      (node): node is KvBlock => node.kind === "block" && node.name.toLowerCase() === "poster",
    );
    if (!checkPoster) throw new Error("the poster block did not read back");
    const write = writeGuarded(path, text, ctx.config, {
      backup: args.backup === true,
      unchanged: text === source,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      image: args.image,
      widescreen: args.widescreen ?? null,
      fullscreen: args.fullscreen === true,
      warnings,
    };
  },
});

export const posterTools = [writeMissionPosterTool];
