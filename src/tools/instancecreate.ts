import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { extractInstance, instanceFileKey } from "../vmf/instance.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput, resolveVmfInput } from "./paths.js";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const createInstanceFromSelectionTool = defineTool({
  name: "create_instance_from_selection",
  description:
    "Hammer++'s Create Instance from Selection: writes the selected brushes as a standing " +
    "instance .vmf, removes them from the map and leaves one `func_instance` at their " +
    "centre. The instance is recentred on the origin, so its contents and the entity agree. " +
    "A brush entity is taken whole; selecting part of one is refused rather than leaving the " +
    "rest with outputs pointing at nothing. `file` defaults to the path of `out` relative to " +
    "the map, which is how Hammer resolves it. Guarded for both files.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Map .vmf to take the selection from."),
    solidIds: z.array(z.number()).min(1).describe("Hammer ids of the brushes to extract."),
    out: z
      .string()
      .optional()
      .describe(
        "Where to write the instance .vmf. Default: `instances/<map>_selection.vmf` beside the map.",
      ),
    file: z
      .string()
      .optional()
      .describe("func_instance `file` value; default is `out` relative to the map."),
    origin: Vec3.optional().describe("Instance origin. Default: centre of the selection."),
    angles: z.string().default("0 0 0").describe("func_instance angles, pitch yaw roll."),
    fixupStyle: z.enum(["none", "prefix", "postfix"]).default("prefix"),
    overwrite: z.boolean().default(false).describe("Allow replacing an existing instance file."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    file: z.string(),
    written: z.boolean(),
    instanceWritten: z.boolean(),
    backupPath: BACKUP_PATH,
    removedSolids: z.number(),
    removedEntities: z.number(),
    instanceSolids: z.number(),
    instanceEntities: z.number(),
    origin: z.array(z.number()),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const derived = join(
      dirname(path),
      "instances",
      `${basename(path, ".vmf")}_selection.vmf`,
    );
    const out = resolveInput(args.out ?? derived, ctx.config);
    if (!args.overwrite && !args.dryRun && existsSync(out)) {
      throw new Error(`${out} already exists; pass overwrite:true to replace it`);
    }
    const file = args.file ?? instanceFileKey(path, out);
    const warnings: string[] = [];
    if (file.startsWith("..")) {
      warnings.push(
        `the instance file is outside the map's directory (${file}); Hammer resolves the ` +
          `file relative to the map, so move it beside the map or pass an explicit file`,
      );
    }
    const before = readFileSync(path, "utf8");
    const result = extractInstance(before, args.solidIds, {
      file,
      ...(args.origin !== undefined ? { origin: args.origin as [number, number, number] } : {}),
      angles: args.angles,
      fixupStyle: args.fixupStyle,
    });
    warnings.push(...result.warnings);

    const instanceWrite = writeGuarded(out, result.instanceText, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: false,
    });
    const targetWrite = writeGuarded(path, result.targetText, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: false,
    });
    return {
      path,
      out,
      file: result.file,
      written: targetWrite.written,
      instanceWritten: instanceWrite.written,
      backupPath: targetWrite.backupPath,
      removedSolids: result.removedSolids,
      removedEntities: result.removedEntities,
      instanceSolids: result.instanceSolids,
      instanceEntities: result.instanceEntities,
      origin: result.origin,
      warnings,
    };
  },
});

export const instanceCreateTools = [createInstanceFromSelectionTool];
