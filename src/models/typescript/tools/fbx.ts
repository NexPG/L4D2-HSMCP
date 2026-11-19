/**
 * FBX: inspect it, and turn it into the SMD `studiomdl` reads.
 *
 * The game's compiler has no FBX loader, so an `.fbx` from Blender, Maya or 3ds Max used to
 * mean a DCC re-export or a separate compiler. `read_fbx` is the map of the file (format,
 * 7.x version, axes, units, models, geometries, materials, bones, skins, animation stacks)
 * and `fbx_to_smd` is the bridge. Both encodings are read: binary 7.x, which every DCC
 * writes by default, and ASCII.
 *
 * What the converter states rather than hides: the bind pose comes from the skin clusters
 * (`TransformLink`), UVs are flipped because SMD inverts V, animations and blend shapes are
 * counted but not exported, and FBX units are reported because centimetres and Source
 * inches are not the same number.
 */
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, relative } from "node:path";
import { z } from "zod";
import { buildQc, loadQc, qcModelName } from "../../../formats/typescript/formats/qc.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

const DIAGNOSTIC = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
});

const COUNTS = z.object({
  models: z.number(),
  bones: z.number(),
  geometries: z.number(),
  materials: z.number(),
  skins: z.number(),
  clusters: z.number(),
  animations: z.number(),
});

/** A path as a QC names it, refusing the different-drive case `relative` cannot express. */
function qcRelative(fromDir: string, file: string): string {
  const rel = relative(fromDir, file);
  if (isAbsolute(rel)) {
    throw new Error(`${file} is on a different drive from the QC; a QC cannot name it`);
  }
  return rel.replace(/\\/g, "/") || basename(file);
}

export const readFbxTool = defineTool({
  name: "read_fbx",
  description:
    "Reads a binary 7.x or ASCII FBX without converting it: the format and version, " +
    "`UpAxis` and `UnitScaleFactor` from GlobalSettings, every Model with its type and " +
    "whether it carries geometry, geometries with vertex/polygon/triangle counts and " +
    "whether normals, UVs and skinning are present, materials, bones, skins, clusters and " +
    "animation stacks. It is the model's inventory before conversion: a mesh with no " +
    "PolygonVertexIndex, an FBX with no Material, or a file whose units are centimetres " +
    "are all visible here rather than after a compile.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .fbx, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    read: z.boolean(),
    format: z.enum(["binary", "ascii"]).optional(),
    version: z.number().optional(),
    versionLabel: z.string().nullable().optional(),
    upAxis: z.number().optional(),
    unitScaleFactor: z.number().nullable().optional(),
    counts: COUNTS.partial().optional(),
    models: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
          hasGeometry: z.boolean(),
          materials: z.array(z.string()),
        }),
      )
      .optional(),
    geometries: z
      .array(
        z.object({
          name: z.string(),
          vertices: z.number(),
          polygons: z.number(),
          triangles: z.number(),
          hasNormals: z.boolean(),
          hasUVs: z.boolean(),
          skinned: z.boolean(),
        }),
      )
      .optional(),
    materials: z.array(z.string()).optional(),
    bones: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
    animations: z.array(z.string()).optional(),
    diagnostics: z.array(DIAGNOSTIC).optional(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    if (!/\.fbx$/i.test(path)) throw new Error(`${path} is not a .fbx`);
    return (await callSidecar("fbx_read", { path }, ctx.config, 180_000)) as Record<string, unknown>;
  },
});

const QC_BLOCK = z.object({
  path: z.string().describe("Where to write the .qc."),
  modelname: z
    .string()
    .min(1)
    .describe(
      'Target path relative to the game\'s models/ directory, e.g. `props_myaddon/crate.mdl`. ' +
        "A leading `models/` is stripped because studiomdl already adds it.",
    ),
  cdmaterials: z.array(z.string()).optional().describe("`$cdmaterials` directories."),
  surfaceprop: z.string().optional().describe("`$surfaceprop`, e.g. `wood`, `metal`."),
  staticprop: z.boolean().default(false).describe("`$staticprop`."),
  sequence: z
    .string()
    .optional()
    .describe("If set, add `$sequence \"<name>\"` over the same SMD (one frame at `fps`)."),
  fps: z.number().positive().default(30).describe("Sequence fps, when `sequence` is set."),
  animationSequences: z
    .boolean()
    .default(true)
    .describe("Add a `$sequence` for every exported animation SMD."),
  animationArgs: z
    .array(z.string())
    .default([])
    .describe("Extra arguments appended to every animation sequence, e.g. `loop`."),
  overwrite: z.boolean().default(false),
});

export const fbxToSmdTool = defineTool({
  name: "fbx_to_smd",
  description:
    "Converts FBX geometry, a skeleton and skin weights to the SMD studiomdl reads. Both " +
    "binary 7.x and ASCII are accepted. `axis` defaults to the file's own `UpAxis` (FBX is " +
    "usually Y-up; Source is Z-up). `scale` is not guessed: FBX is commonly centimetres and " +
    "Source units are inches, so a 180 cm character needs `scale: 0.3937` unless the DCC " +
    "already wrote Source-sized numbers. The bind pose comes from the skin clusters' " +
    "`TransformLink`; a file without clusters uses the node hierarchy and says so. UVs are " +
    "flipped because SMD inverts V. Every AnimationStack is resampled at `animationFps` " +
    "into its own SMD with the bind SMD's node table; cubic tangents are sampled linearly " +
    "and that is reported. Blend shapes are counted, not exported: SMD has no morph target. " +
    "The optional `qc` block writes a QC naming the SMD and a `$sequence` per animation.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .fbx, absolute or relative to the repo root."),
    output: z.string().describe("Where to write the .smd."),
    axis: z
      .enum(["auto", "y", "z"])
      .default("auto")
      .describe("'auto' follows GlobalSettings.UpAxis; 'y'/'z' override a wrong global setting."),
    scale: z
      .number()
      .positive()
      .default(1)
      .describe("Uniform scale. 0.3937 for a centimetre FBX; 1 when the export is already inches."),
    useNodeTransforms: z
      .boolean()
      .default(true)
      .describe(
        "Apply the model hierarchy to the geometry. On by default for FBX because objects " +
          "are placed by their node transforms; off reads raw vertices in mesh space.",
      ),
    flipV: z.boolean().default(true).describe("Write 1 - v, cancelling SMD's own V inversion."),
    models: z
      .array(z.string())
      .default([])
      .describe("Only these mesh model names (case-insensitive). Empty means every mesh model."),
    material: z
      .string()
      .default("debug/debugempty")
      .describe("Material name for a mesh that has none connected."),
    limitVertices: z
      .number()
      .int()
      .positive()
      .default(2_000_000)
      .describe("Refuse a conversion that would write more vertices than this."),
    exportAnimations: z
      .boolean()
      .default(true)
      .describe(
        "Write one SMD per AnimationStack beside the bind SMD (`<name>_<animation>.smd`). " +
          "Each frame carries every bone; the bind SMD's node table is reused.",
      ),
    animationFps: z
      .number()
      .positive()
      .default(30)
      .describe("Resample rate. SMD frame times are indices; fps turns them into seconds."),
    animations: z
      .array(z.string())
      .default([])
      .describe("Only these animation names (case-insensitive). Empty means every stack."),
    qc: QC_BLOCK.optional().describe("Also write a QC that names the SMD."),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    written: z.boolean(),
    format: z.enum(["binary", "ascii"]),
    version: z.number(),
    axis: z.enum(["y", "z"]),
    scale: z.number(),
    nodes: z.array(z.object({ name: z.string(), parent: z.number().nullable() })),
    counts: z.object({
      meshes: z.number(),
      bones: z.number(),
      triangles: z.number(),
      vertices: z.number(),
      materials: z.number(),
    }),
    materials: z.array(z.string()),
    bounds: z.object({ mins: z.array(z.number()), maxs: z.array(z.number()) }),
    unitScaleFactor: z.number().nullable(),
    animations: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        frames: z.number(),
        fps: z.number(),
        duration: z.number(),
        start: z.number(),
        end: z.number(),
      }),
    ),
    animationCount: z.number(),
    animationFps: z.number(),
    diagnostics: z.array(DIAGNOSTIC),
    warnings: z.array(z.string()),
    qc: z
      .object({
        path: z.string(),
        written: z.boolean(),
        modelname: z.string(),
        body: z.string(),
        animations: z.array(z.object({ name: z.string(), path: z.string() })),
        diagnostics: z.array(
          z.object({
            severity: z.enum(["error", "warning"]),
            rule: z.string(),
            message: z.string(),
            file: z.string(),
            line: z.number().nullable(),
          }),
        ),
      })
      .optional(),
  },
  handler: async (args, ctx) => {
    const source = resolveInput(args.path, ctx.config);
    if (!existsSync(source)) throw new Error(`${source} does not exist`);
    if (!/\.fbx$/i.test(source)) throw new Error(`${source} is not a .fbx`);
    const requested = resolveInput(args.output, ctx.config);
    const output = requested.toLowerCase().endsWith(".smd") ? requested : `${requested}.smd`;
    if (existsSync(output) && !args.overwrite) {
      throw new Error(`${output} already exists; pass overwrite: true to replace it`);
    }
    if (args.qc) {
      const qcPath = resolveInput(args.qc.path, ctx.config);
      if (existsSync(qcPath) && !args.qc.overwrite) {
        throw new Error(`${qcPath} already exists; pass qc.overwrite: true to replace it`);
      }
    }

    const result = (await callSidecar(
      "fbx_to_smd",
      {
        path: source,
        out: output,
        axis: args.axis,
        scale: args.scale,
        useNodeTransforms: args.useNodeTransforms,
        flipV: args.flipV,
        models: args.models,
        material: args.material,
        limitVertices: args.limitVertices,
        exportAnimations: args.exportAnimations,
        animationFps: args.animationFps,
        animations: args.animations,
        overwrite: args.overwrite,
      },
      ctx.config,
      600_000,
    )) as Record<string, unknown>;
    ctx.audit.record({ kind: "file_write", data: { path: output, created: true } });

    if (args.qc) {
      const qcPath = resolveInput(args.qc.path, ctx.config);
      if (!qcPath.toLowerCase().endsWith(".qc")) {
        throw new Error(`${qcPath} is not a .qc path; studiomdl only reads that extension`);
      }
      const qcDir = dirname(qcPath);
      const smdName = qcRelative(qcDir, output);
      const animationFiles = (result.animations ?? []) as Array<{
        name: string;
        path: string;
        fps: number;
      }>;
      const sequences: Array<{ name: string; smd: string; fps?: number; args?: string[] }> =
        args.qc.sequence === undefined
          ? []
          : [{ name: args.qc.sequence, smd: smdName, fps: args.qc.fps }];
      const animationArgs = args.qc.animationArgs ?? [];
      if (args.qc.animationSequences !== false) {
        for (const animation of animationFiles) {
          if (sequences.some((sequence) => sequence.name === animation.name)) continue;
          sequences.push({
            name: animation.name,
            smd: qcRelative(qcDir, animation.path),
            fps: animation.fps,
            ...(animationArgs.length > 0 ? { args: animationArgs } : {}),
          });
        }
      }
      const text = buildQc({
        modelname: args.qc.modelname,
        body: [{ name: "Body", smd: smdName }],
        ...(args.qc.cdmaterials === undefined ? {} : { cdmaterials: args.qc.cdmaterials }),
        ...(args.qc.surfaceprop === undefined ? {} : { surfaceprop: args.qc.surfaceprop }),
        staticprop: args.qc.staticprop,
        sequences,
      });
      mkdirSync(dirname(qcPath), { recursive: true });
      const written = writeGuarded(qcPath, text, ctx.config);
      ctx.audit.record({ kind: "file_write", data: { path: written.path, created: true } });
      const parsed = loadQc(written.path);
      result.qc = {
        path: written.path,
        written: written.written,
        modelname: qcModelName(parsed) ?? args.qc.modelname,
        body: smdName,
        animations: animationFiles.map((animation) => ({
          name: animation.name,
          path: qcRelative(qcDir, animation.path),
        })),
        diagnostics: parsed.diagnostics,
      };
    }
    return result as never;
  },
});

export const fbxTools = [readFbxTool, fbxToSmdTool];
