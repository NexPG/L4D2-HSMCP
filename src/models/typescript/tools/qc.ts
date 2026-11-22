/**
 * Reading and writing the model source file.
 *
 * `run_studiomdl` compiles a `.qc` and `read_model_info` reads the result; these two are the
 * file in between. `read_qc` follows `$include` (with cycle detection and scripblib's
 * 16-deep limit), lists sequences, materials and attachments, and reports the structural
 * faults whose absence stops a compile — no `$modelname`, no `$body`, a repeated sequence.
 * `write_qc` builds a minimal well-formed QC from parameters.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import {
  buildQc,
  flattenQc,
  loadQc,
  qcKnownCommands,
  qcModelName,
  qcSequences,
  walkQc,
} from "../../../formats/typescript/formats/qc.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

const DIAGNOSTIC = z.object({
  severity: z.enum(["error", "warning"]),
  rule: z.string(),
  message: z.string(),
  file: z.string(),
  line: z.number().nullable(),
});

/** `$cdmaterials` arguments across every included file, de-duplicated. */
function materialsOf(files: ReturnType<typeof flattenQc>): string[] {
  const out = new Set<string>();
  for (const file of files) {
    for (const statement of walkQc(file.statements)) {
      if (statement.command.toLowerCase() !== "$cdmaterials") continue;
      for (const arg of statement.args) out.add(arg.replace(/\\/g, "/").replace(/\/$/, ""));
    }
  }
  return [...out];
}

export const readQcTool = defineTool({
  name: "read_qc",
  description:
    "Parses a .qc and every file it $includes: model name, sequences (with fps and activity), " +
    "$cdmaterials, attachments, body parts, the include tree, variables and macros, and " +
    "structural faults - a missing $modelname or $body, a repeated sequence, a model path " +
    "outside models/. $definevariable and $definemacro are expanded at token level (bare " +
    "tokens only, first definition wins, `\\\\` continues a macro body). Include cycles and " +
    "missing .qci files are reported rather than followed, and the depth limit is " +
    "scriplib's 16. The command catalogue checks the structure of the common QC commands: " +
    "argument counts, numeric bounds, $bodygroup/studio, $sequence block numbers, " +
    "activity weights and flags, the $definebone parent graph (a missing parent, a " +
    "duplicate, a cycle), and reports unknown commands as warnings instead of guessing. " +
    "Use it before " +
    "run_studiomdl: studiomdl's own errors are terser and arrive after a compile.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .qc, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    modelName: z.string().nullable(),
    files: z.array(z.object({ path: z.string(), statements: z.number(), includes: z.number() })),
    includeCount: z.number(),
    statementCount: z.number(),
    commands: z.array(z.object({ command: z.string(), count: z.number() })),
    unknownCommands: z.array(z.string()),
    sequences: z.array(
      z.object({
        name: z.string(),
        smd: z.string().nullable(),
        fps: z.number().nullable(),
        activity: z.string().nullable(),
        activities: z.array(z.object({ name: z.string(), weight: z.number() })),
        line: z.number(),
      }),
    ),
    materials: z.array(z.string()),
    bodyParts: z.array(z.object({ name: z.string(), file: z.string() })),
    attachments: z.array(z.object({ name: z.string(), bone: z.string() })),
    diagnostics: z.array(DIAGNOSTIC),
    ok: z.boolean(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const root = loadQc(path);
    const files = flattenQc(root);
    const all = files.flatMap((f) => walkQc(f.statements));

    const counts = new Map<string, number>();
    for (const statement of all) {
      counts.set(statement.command, (counts.get(statement.command) ?? 0) + 1);
    }

    const bodyParts: Array<{ name: string; file: string }> = [];
    const attachments: Array<{ name: string; bone: string }> = [];
    for (const file of files) {
      for (const statement of walkQc(file.statements)) {
        const command = statement.command.toLowerCase();
        if (command === "$body" || command === "$bodygroup") {
          bodyParts.push({ name: statement.args[0] ?? "", file: file.path });
        }
        if (command === "$attachment") {
          attachments.push({ name: statement.args[0] ?? "", bone: statement.args[1] ?? "" });
        }
      }
    }

    const diagnostics = files.flatMap((f) => f.diagnostics);
    const unknownCommands = [
      ...new Set(
        all
          .filter(
            (statement) =>
              statement.command.startsWith("$") &&
              !qcKnownCommands.has(statement.command.toLowerCase()),
          )
          .map((statement) => statement.command),
      ),
    ];
    return {
      path: root.path,
      modelName: qcModelName(root),
      files: files.map((f) => ({
        path: f.path,
        statements: f.statements.length,
        includes: f.includes.length,
      })),
      includeCount: files.length - 1,
      statementCount: all.length,
      commands: [...counts]
        .map(([command, count]) => ({ command, count }))
        .sort((a, b) => b.count - a.count || (a.command < b.command ? -1 : 1)),
      unknownCommands,
      sequences: qcSequences(root),
      materials: materialsOf(files),
      bodyParts,
      attachments,
      diagnostics,
      ok: diagnostics.every((d) => d.severity !== "error"),
    };
  },
});

const POSITION = z.tuple([z.number(), z.number(), z.number()]);

export const writeQcTool = defineTool({
  name: "write_qc",
  description:
    "Writes a .qc from parameters: $modelname, $body entries, $cdmaterials, $surfaceprop, " +
    "$staticprop, $sequence (with fps, activity and an optional block of events), and " +
    "$attachment. Anything this builder does not model goes through `extra` verbatim, so no " +
    "command is silently dropped. Refuses an existing file unless overwrite is set.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Where to write the .qc, absolute or relative to the repo root."),
    modelname: z
      .string()
      .min(1)
      .describe(
        'Target path relative to the game\'s models/ directory, e.g. ' +
          '`props_myaddon/crate.mdl`. A leading `models/` is stripped because studiomdl ' +
          "already adds it.",
      ),
    body: z
      .array(z.object({ name: z.string(), smd: z.string() }))
      .optional()
      .describe('`$body "name" "file.smd"` entries. A model needs at least one.'),
    cdmaterials: z
      .array(z.string())
      .optional()
      .describe('Material directories, e.g. `models/props_myaddon`.'),
    surfaceprop: z.string().optional().describe("`$surfaceprop`, e.g. `wood`, `metal`, `concrete`."),
    staticprop: z.boolean().default(false).describe("`$staticprop`: a prop_static, not a dynamic entity."),
    sequences: z
      .array(
        z.object({
          name: z.string(),
          smd: z.string(),
          fps: z.number().optional(),
          activity: z.string().optional().describe("e.g. `ACT_IDLE`."),
          activityWeight: z.number().optional(),
          args: z.array(z.string()).optional().describe("Extra arguments, appended verbatim."),
          block: z.array(z.string()).optional().describe("Lines inside the sequence block, e.g. `event`."),
        }),
      )
      .optional(),
    poseParameters: z
      .array(
        z.object({
          name: z.string().min(1),
          min: z.number(),
          max: z.number(),
          loop: z.number().int().default(0).describe("Loop value, usually 0 or 360."),
        }),
      )
      .optional()
      .describe("`$poseparameter` sliders, e.g. move_x -1 1 0."),
    attachments: z
      .array(z.object({ name: z.string(), bone: z.string(), position: POSITION.optional() }))
      .optional(),
    bodygroups: z
      .array(
        z.object({
          name: z.string(),
          options: z
            .array(z.object({ studio: z.string().optional(), blank: z.number().int().min(0).optional() }))
            .min(1),
        }),
      )
      .optional()
      .describe("`$bodygroup`: named alternatives, each a studio SMD or a blank index."),
    lods: z
      .array(
        z.object({
          distance: z.number().positive(),
          source: z.string(),
          replace: z.string(),
          shadow: z.boolean().optional(),
        }),
      )
      .optional()
      .describe("`$lod`/`$shadowlod`: a distance and the high/low model replacement."),
    hitboxSets: z
      .array(
        z.object({
          name: z.string(),
          boxes: z.array(
            z.object({
              group: z.number().int().min(0),
              bone: z.string(),
              mins: POSITION,
              maxs: POSITION,
            }),
          ),
        }),
      )
      .optional()
      .describe("`$hboxset` plus its `$hbox` boxes."),
    bbox: z.object({ mins: POSITION, maxs: POSITION }).optional(),
    cbox: z.object({ mins: POSITION, maxs: POSITION }).optional(),
    illumposition: POSITION.optional(),
    eyeposition: POSITION.optional(),
    extra: z.array(z.string()).optional().describe("Raw QC lines appended last."),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    modelName: z.string(),
    diagnostics: z.array(DIAGNOSTIC),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!path.toLowerCase().endsWith(".qc")) {
      throw new Error(`${path} is not a .qc path; studiomdl only reads that extension`);
    }
    if (existsSync(path) && !args.overwrite) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }

    const text = buildQc({
      modelname: args.modelname,
      ...(args.body === undefined ? {} : { body: args.body }),
      ...(args.cdmaterials === undefined ? {} : { cdmaterials: args.cdmaterials }),
      ...(args.surfaceprop === undefined ? {} : { surfaceprop: args.surfaceprop }),
      staticprop: args.staticprop,
      ...(args.sequences === undefined ? {} : { sequences: args.sequences }),
      ...(args.poseParameters === undefined ? {} : { poseParameters: args.poseParameters }),
      ...(args.attachments === undefined ? {} : { attachments: args.attachments }),
      ...(args.bodygroups === undefined ? {} : { bodygroups: args.bodygroups }),
      ...(args.lods === undefined ? {} : { lods: args.lods }),
      ...(args.hitboxSets === undefined ? {} : { hitboxSets: args.hitboxSets }),
      ...(args.bbox === undefined ? {} : { bbox: args.bbox }),
      ...(args.cbox === undefined ? {} : { cbox: args.cbox }),
      ...(args.illumposition === undefined ? {} : { illumposition: args.illumposition }),
      ...(args.eyeposition === undefined ? {} : { eyeposition: args.eyeposition }),
      ...(args.extra === undefined ? {} : { extra: args.extra }),
    });

    mkdirSync(dirname(assertWritable(path, ctx.config)), { recursive: true });
    const result = writeGuarded(path, text, ctx.config);
    ctx.audit.record({ kind: "file_write", data: { path: result.path, created: true } });

    // Read it back rather than trusting the builder: a written QC that fails its own parser
    // is the one failure this tool would otherwise hide.
    const parsed = loadQc(result.path);
    return {
      path: result.path,
      written: result.written,
      bytes: Buffer.byteLength(text, "utf8"),
      modelName: qcModelName(parsed) ?? args.modelname,
      diagnostics: parsed.diagnostics,
    };
  },
});

export const qcTools = [readQcTool, writeQcTool];
