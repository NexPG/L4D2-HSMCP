/**
 * Getting a mapper's work back after Hammer dies.
 *
 * Hammer writes autosaves next to the map they belong to only if the user configured a
 * folder; the folder lives in Hammer++'s ini or the registry, and the files are named
 * `<map>_NNN.vmf_autosave`. Nothing in this server knew any of that, so an agent asked to
 * "recover my map" had to be told where to look by the person who just lost an evening.
 *
 * `read_autosaves` finds them and says which one is newer than the saved `.vmf`;
 * `restore_autosave` writes the chosen one out as a normal `.vmf`. Neither touches the
 * original map: recovery is a copy, and a copy can be compared before it replaces anything.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { autosavesForMap, resolveAutosaveFolder } from "../game/autosave.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

export const readAutosavesTool = defineTool({
  name: "read_autosaves",
  description:
    "Finds Hammer's autosaves for one map and says which are newer than the saved .vmf. " +
    "Looks in Hammer++'s `AutosaveDir` (bin/hammerplusplus/hammerplusplus_settings.ini) and " +
    "in stock Hammer's registry keys, and reports which one it used. Autosaves are matched " +
    "to the map through `versioninfo.originalname`, not by file name alone, because two maps " +
    "in different folders can share a base name. This is the recovery path after a crash. " +
    "An empty list with a stated reason means no folder is configured, not that nothing exists.",
  realm: "local",
  inputSchema: {
    map: z.string().describe("Path to the saved .vmf the autosaves belong to."),
    folder: z
      .string()
      .optional()
      .describe("Autosave folder, when it is not where Hammer++ or the registry says."),
  },
  outputSchema: {
    map: z.string(),
    mapModified: z.string().nullable(),
    folder: z.string().nullable(),
    folderSource: z.enum(["argument", "hammer++ settings", "registry", "unknown"]),
    enabled: z.boolean(),
    detail: z.string(),
    count: z.number(),
    autosaves: z.array(
      z.object({
        path: z.string(),
        file: z.string(),
        written: z.string(),
        mapVersion: z.number().nullable(),
        originalName: z.string().nullable(),
        newerThanMap: z.boolean(),
      }),
    ),
    advice: z.string(),
  },
  handler: (args, ctx) => {
    const map = resolveInput(args.map, ctx.config);
    const resolved = resolveAutosaveFolder({
      ...(args.folder === undefined ? {} : { explicit: resolveInput(args.folder, ctx.config) }),
      plusPlusBinDir: ctx.config.plusPlusBinDir,
      binDir: ctx.config.binDir,
    });

    const autosaves = resolved.folder === null ? [] : autosavesForMap(resolved.folder, map);
    const newest = autosaves[0];
    const mapModified = existsSync(map) ? new Date(statSync(map).mtimeMs).toISOString() : null;

    let advice: string;
    if (!resolved.enabled) {
      advice = `Autosaves are disabled or their folder is unknown: ${resolved.detail}`;
    } else if (resolved.folder === null) {
      advice = resolved.detail;
    } else if (autosaves.length === 0) {
      advice = `No autosave for ${map} in ${resolved.folder}. Hammer writes them while a map is open and unsaved; none means the map was never open long enough, or the folder changed.`;
    } else if (newest?.newerThanMap) {
      advice = `The newest autosave (${newest.file}) is newer than the saved map. restore_autosave writes it out as a .vmf so it can be compared before anything replaces the original.`;
    } else {
      advice = `Every autosave is older than the saved map; the map on disk is the newest state.`;
    }

    return {
      map,
      mapModified,
      folder: resolved.folder,
      folderSource: resolved.source,
      enabled: resolved.enabled,
      detail: resolved.detail,
      count: autosaves.length,
      autosaves: autosaves.map((a) => ({
        path: a.path,
        file: a.file,
        written: a.written,
        mapVersion: a.mapVersion,
        originalName: a.originalName,
        newerThanMap: a.newerThanMap,
      })),
      advice,
    };
  },
});

export const restoreAutosaveTool = defineTool({
  name: "restore_autosave",
  description:
    "Writes one autosave out as a normal .vmf, so it can be opened in Hammer or compared " +
    "with the map it came from. Refuses to overwrite an existing file unless told to, and " +
    "never modifies the autosave or the map it belongs to. Use read_autosaves first: it says " +
    "which file is newer than the saved map.",
  realm: "map",
  guarded: true,
  inputSchema: {
    autosave: z.string().describe("Path to the .vmf_autosave, as reported by read_autosaves."),
    out: z
      .string()
      .optional()
      .describe(
        "Where to write the .vmf. Defaults to the autosave path with `.vmf_autosave` " +
          "replaced by `.vmf`, beside the autosave. Refuses to replace an existing file unless " +
          "overwrite is set.",
      ),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    autosave: z.string(),
    out: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    mapVersion: z.number().nullable(),
    originalName: z.string().nullable(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const autosave = resolveInput(args.autosave, ctx.config);
    const out = args.out
      ? resolveInput(args.out, ctx.config)
      : autosave.replace(/\.vmf_autosave$/i, ".vmf");
    if (!autosave.toLowerCase().endsWith(".vmf_autosave")) {
      throw new Error(`${autosave} is not a .vmf_autosave; read_autosaves lists the real ones`);
    }
    if (!out.toLowerCase().endsWith(".vmf")) {
      throw new Error(`${out} is not a .vmf path`);
    }
    if (existsSync(out) && !args.overwrite) {
      throw new Error(`${out} already exists; pass overwrite: true to replace it`);
    }

    const text = readFileSync(autosave, "utf8");
    const head = text.slice(0, 4096);
    const mapVersion = head.match(/"mapversion"\s+"(\d+)"/i)?.[1];
    const originalName = head.match(/"originalname"\s+"([^"]+)"/i)?.[1] ?? null;

    const warnings: string[] = [];
    if (!head.includes("versioninfo")) {
      warnings.push("the autosave has no versioninfo block; Hammer may not open it as a map");
    }
    if (originalName === null) {
      warnings.push("the autosave names no original map, so it cannot be matched to one");
    }

    const result = writeGuarded(out, text, ctx.config);
    ctx.audit.record({ kind: "file_write", data: { path: result.path, from: autosave, created: true } });

    return {
      autosave,
      out: result.path,
      written: result.written,
      bytes: Buffer.byteLength(text, "utf8"),
      mapVersion: mapVersion === undefined ? null : Number(mapVersion),
      originalName,
      warnings,
    };
  },
});

export const autosaveTools = [readAutosavesTool, restoreAutosaveTool];
