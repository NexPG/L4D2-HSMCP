import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { assertWritable } from "../fs/guard.js";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { exportMap } from "../vmf/mapfile.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput, resolveVmfInput } from "./paths.js";

export const exportMapTool = defineTool({
  name: "export_vmf_map",
  description:
    "Exports a .vmf to Valve's .map format 220: every brush face keeps its three points, " +
    "material, uaxis/vaxis and scale; every entity keeps its keyvalues and outputs. This is " +
    "Hammer's File > Export to .map, not a reimplementation of the map. VMF-only features " +
    "(visgroups, instances, displacements) cannot exist in the format and are reported as " +
    "warnings instead of disappearing silently. Refuses to replace an existing .map unless " +
    "overwrite is true. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    vmf: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    out: z
      .string()
      .optional()
      .describe("Destination .map. Defaults to the .vmf path with a .map extension."),
    overwrite: z.boolean().default(false).describe("Replace an existing .map only when true."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    vmf: z.string(),
    map: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    bytes: z.number(),
    entities: z.number(),
    brushes: z.number(),
    faces: z.number(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const vmf = resolveVmfInput(args.vmf, ctx.config);
    if (!existsSync(vmf)) throw new Error(`${vmf} does not exist`);
    if (extname(vmf).toLowerCase() !== ".vmf") throw new Error(`${vmf} is not a .vmf`);

    const out = args.out
      ? resolveInput(args.out, ctx.config)
      : join(dirname(vmf), `${basename(vmf, extname(vmf))}.map`);
    if (extname(out).toLowerCase() !== ".map") {
      throw new Error(`${out} does not end in .map`);
    }
    if (existsSync(out) && !args.overwrite) {
      throw new Error(`${out} already exists; pass overwrite: true to replace it`);
    }
    assertWritable(out, ctx.config);

    const before = existsSync(out) ? readFileSync(out, "utf8") : null;
    const result = exportMap(readFileSync(vmf, "utf8"));
    const write = writeGuarded(out, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: before === result.text,
    });

    return {
      vmf,
      map: out,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: before === result.text,
      bytes: Buffer.byteLength(result.text, "utf8"),
      entities: result.entities,
      brushes: result.brushes,
      faces: result.faces,
      warnings: result.warnings,
    };
  },
});

export const exportMapTools = [exportMapTool];
