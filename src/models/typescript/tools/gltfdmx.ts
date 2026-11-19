/**
 * glTF shape keys -> a DMX model source with flexes.
 *
 * The SMD path cannot carry a morph target, but L4D2's `studiomdl` reads DMX shape keys and
 * registers flexdesc/controller/rule records without a `$flex` command in the QC. This tool
 * writes that DMX: one merged mesh, the bind skeleton, a `DmeVertexDeltaData` per glTF morph
 * target and the `DmeCombinationOperator` that pairs them.
 *
 * The one non-obvious attribute is `DmeMesh.deltaStateWeights`: one `(0, 0)` per control.
 * Without it the compiler writes the flex payload but no flex rules, and the flex is never
 * driven. The probe against the real compiler is in `test/models/gltfdmx.test.ts`.
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
  severity: z.enum(["error", "warning"]),
  rule: z.string(),
  message: z.string(),
});

const QC_BLOCK = z.object({
  path: z.string().describe("Where to write the .qc."),
  modelname: z
    .string()
    .min(1)
    .describe(
      'Target path relative to the game\'s models/ directory, e.g. `props_myaddon/face.mdl`. ' +
        "A leading `models/` is stripped because studiomdl already adds it.",
    ),
  cdmaterials: z
    .array(z.string())
    .optional()
    .describe("`$cdmaterials`. Defaults to the directories of the DMX materials."),
  surfaceprop: z.string().optional().describe("`$surfaceprop`, e.g. `flesh`."),
  staticprop: z
    .boolean()
    .default(false)
    .describe("`$staticprop`; a morph character is normally not static."),
  sequence: z.string().default("idle").describe("`$sequence` name over the DMX."),
  fps: z.number().positive().default(30),
  overwrite: z.boolean().default(false),
});

function qcRelative(fromDir: string, file: string): string {
  const rel = relative(fromDir, file);
  if (isAbsolute(rel)) {
    throw new Error(`${file} is on a different drive from the QC; a QC cannot name it`);
  }
  return rel.replace(/\\/g, "/") || basename(file);
}

function derivedDirectories(materials: Array<{ name: string }>): string[] {
  const out = new Set<string>();
  for (const material of materials) {
    const slash = material.name.lastIndexOf("/");
    if (slash >= 0) out.add(`${material.name.slice(0, slash)}/`);
  }
  return [...out];
}

export const gltfToDmxTool = defineTool({
  name: "gltf_to_dmx",
  description:
    "Converts glTF/GLB shape keys to a DMX model source with Source flexes. L4D2's " +
    "studiomdl reads the DMX directly and writes flexdesc/controller/rule records; the QC " +
    "needs no `$flex` command. The mesh is one body with face sets per material, the bind " +
    "skeleton comes from `inverseBindMatrices`, and every morph target becomes a " +
    "`DmeVertexDeltaData` plus a `DmeCombinationInputControl`. The exporter writes the " +
    "`deltaStateWeights` that make studiomdl emit flex rules; without them the payload " +
    "exists but nothing drives it. Animations are not included: use `gltf_to_smd` for one " +
    "SMD per animation. An optional `qc` block writes the body/sequence QC in the same call.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Source .gltf or .glb."),
    output: z.string().describe("Destination .dmx. The suffix is added when missing."),
    scale: z.number().positive().default(1).describe("Uniform scale applied to positions and bones."),
    axis: z
      .enum(["z", "y"])
      .default("z")
      .describe(
        "Source up axis. 'z' keeps Blender's mesh space; 'y' rotates Y-up with " +
          "(x,y,z) -> (x,-z,y).",
      ),
    useNodeTransforms: z
      .boolean()
      .default(false)
      .describe("Apply static mesh node transforms before the axis conversion."),
    flipV: z
      .boolean()
      .default(true)
      .describe("Write UV V as 1-v, the SMD/DMX convention studiomdl inverts."),
    parts: z
      .array(z.string())
      .default([])
      .describe("Only these node or mesh names (case-insensitive). Empty means every mesh."),
    material: z
      .string()
      .default("debug/debugempty")
      .describe("Material name for a primitive that declares none."),
    qc: QC_BLOCK.optional().describe("Also write the QC that names the DMX."),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    source: z.string(),
    format: z.literal("dmx"),
    encoding: z.literal("binary"),
    encodingVersion: z.number(),
    formatVersion: z.number(),
    triangles: z.number(),
    vertices: z.number(),
    positions: z.number(),
    materials: z.array(
      z.object({ name: z.string(), mtlName: z.string(), faceSets: z.number() }),
    ),
    morphTargets: z.array(
      z.object({ name: z.string(), deltas: z.number(), maxDelta: z.number() }),
    ),
    morphTargetCount: z.number(),
    boneCount: z.number(),
    skinned: z.boolean(),
    ignoredAnimations: z.number(),
    warnings: z.array(z.string()),
    diagnostics: z.array(DIAGNOSTIC),
    verified: z.boolean(),
    note: z.string(),
    qc: z
      .object({
        path: z.string(),
        written: z.boolean(),
        modelname: z.string(),
        body: z.string(),
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
    if (!/\.(gltf|glb)$/i.test(source)) {
      throw new Error(`${source} is not a .gltf or .glb; the extension is the format, it is not guessed`);
    }
    const requested = resolveInput(args.output, ctx.config);
    const output = requested.toLowerCase().endsWith(".dmx") ? requested : `${requested}.dmx`;
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
      "gltf_to_dmx",
      {
        path: source,
        out: output,
        scale: args.scale,
        axis: args.axis,
        useNodeTransforms: args.useNodeTransforms,
        flipV: args.flipV,
        parts: args.parts,
        material: args.material,
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
      const dmxName = qcRelative(qcDir, output);
      const materials = (result.materials ?? []) as Array<{ name: string }>;
      const cdmaterials = args.qc.cdmaterials ?? derivedDirectories(materials);
      const text = buildQc({
        modelname: args.qc.modelname,
        body: [{ name: "Body", smd: dmxName }],
        ...(cdmaterials.length > 0 ? { cdmaterials } : {}),
        ...(args.qc.surfaceprop === undefined ? {} : { surfaceprop: args.qc.surfaceprop }),
        staticprop: args.qc.staticprop ?? false,
        sequences: [
          { name: args.qc.sequence ?? "idle", smd: dmxName, fps: args.qc.fps ?? 30 },
        ],
      });
      mkdirSync(dirname(qcPath), { recursive: true });
      const written = writeGuarded(qcPath, text, ctx.config);
      ctx.audit.record({ kind: "file_write", data: { path: written.path, created: true } });
      const parsed = loadQc(written.path);
      result.qc = {
        path: written.path,
        written: written.written,
        modelname: qcModelName(parsed) ?? args.qc.modelname,
        body: dmxName,
        diagnostics: parsed.diagnostics,
      };
    }
    return result as never;
  },
});

export const gltfDmxTools = [gltfToDmxTool];
