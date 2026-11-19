/**
 * glTF 2.0 / GLB: inspect it, and turn it into the SMD `studiomdl` reads.
 *
 * The game's compiler has no glTF loader, so a `.glb` from Blender used to mean a DCC
 * re-export or a separate compiler. `read_gltf` is the map of the document (nodes, meshes,
 * primitives, materials, skins, animations, buffers, and the faults that would make a read
 * fail); `gltf_to_smd` is the bridge, with the conventions that make it match a Source
 * model: mesh-space geometry by default, the bind pose from `inverseBindMatrices`, and the
 * SMD V inversion that cancels `studiomdl`'s own one.
 *
 * The optional `qc` block writes the QC in the same call. It is deliberately a block and
 * not an implicit template: the caller supplies `$modelname`, and an existing file is
 * refused unless `overwrite` is set.
 */
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { z } from "zod";
import { buildQc, loadQc } from "../../../formats/typescript/formats/qc.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

const DIAGNOSTIC = z.object({
  severity: z.enum(["error", "warning"]),
  rule: z.string(),
  message: z.string(),
});

const COUNTS = z.object({
  scenes: z.number(),
  nodes: z.number(),
  meshes: z.number(),
  primitives: z.number(),
  materials: z.number(),
  textures: z.number(),
  images: z.number(),
  skins: z.number(),
  animations: z.number(),
  accessors: z.number(),
  bufferViews: z.number(),
  buffers: z.number(),
  morphTargets: z.number(),
});

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);

export const readGltfTool = defineTool({
  name: "read_gltf",
  description:
    "Reads a glTF 2.0 (.gltf) or binary (.glb) file without converting it: scenes and the " +
    "active root nodes, every node's parent/mesh/skin, mesh primitives with their mode, " +
    "material, attribute accessors, vertex/index/triangle counts and bounds, materials with " +
    "their base-colour texture chain, skins with the joint list and whether inverse bind " +
    "matrices are present, animations with their duration, and buffers (external, data URI " +
    "or the GLB BIN chunk). Diagnostics catch what would otherwise become a silent empty " +
    "model: a missing buffer, a short buffer, a data URI that does not decode, a required " +
    "Draco/meshopt extension, a primitive mode that is not triangles. Use it before " +
    "gltf_to_smd; the converter refuses the faults rather than writing half a mesh.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .gltf or .glb, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    read: z.boolean(),
    readError: z.string().optional(),
    format: z.enum(["gltf", "glb"]).optional(),
    version: z.string().optional(),
    generator: z.string().nullable().optional(),
    copyright: z.string().nullable().optional(),
    scene: z.number().optional(),
    sceneRoots: z.array(z.number()).optional(),
    counts: COUNTS.optional(),
    nodes: z
      .array(
        z.object({
          index: z.number(),
          name: z.string(),
          parent: z.number(),
          children: z.array(z.number()),
          mesh: z.number().nullable(),
          skin: z.number().nullable(),
        }),
      )
      .optional(),
    meshes: z
      .array(
        z.object({
          index: z.number(),
          name: z.string(),
          primitives: z.array(
            z.object({
              index: z.number(),
              mode: z.number(),
              modeName: z.string(),
              material: z.object({ index: z.number(), name: z.string() }).nullable(),
              attributes: z.record(z.number()),
              indices: z.number().nullable(),
              vertexCount: z.number(),
              indexCount: z.number(),
              triangleCount: z.number(),
              min: z.array(z.number()).nullable(),
              max: z.array(z.number()).nullable(),
              hasNormals: z.boolean(),
              hasTexCoords: z.boolean(),
              hasJoints: z.boolean(),
              hasWeights: z.boolean(),
              morphTargets: z.number(),
            }),
          ),
        }),
      )
      .optional(),
    materials: z
      .array(
        z.object({
          index: z.number(),
          name: z.string(),
          alphaMode: z.string(),
          doubleSided: z.boolean(),
          baseColorTexture: z
            .object({
              texture: z.number(),
              source: z.number().nullable(),
              uri: z.string().nullable(),
              mimeType: z.string().nullable(),
            })
            .nullable(),
        }),
      )
      .optional(),
    skins: z
      .array(
        z.object({
          index: z.number(),
          name: z.string(),
          jointCount: z.number(),
          joints: z.array(z.object({ index: z.number(), name: z.string() })),
          skeleton: z.number().nullable(),
          hasInverseBindMatrices: z.boolean(),
        }),
      )
      .optional(),
    animations: z
      .array(
        z.object({
          index: z.number(),
          name: z.string(),
          channelCount: z.number(),
          samplerCount: z.number(),
          duration: z.object({ min: z.number(), max: z.number() }).nullable(),
          targets: z.array(z.number()),
        }),
      )
      .optional(),
    textures: z
      .array(
        z.object({
          index: z.number(),
          source: z.number().nullable(),
          sampler: z.number().nullable(),
        }),
      )
      .optional(),
    images: z
      .array(
        z.object({
          index: z.number(),
          name: z.string(),
          uri: z.string().nullable(),
          mimeType: z.string().nullable(),
          bufferView: z.number().nullable(),
        }),
      )
      .optional(),
    buffers: z
      .array(
        z.object({
          index: z.number(),
          byteLength: z.number(),
          uri: z.string().nullable(),
          external: z.boolean(),
          loaded: z.boolean(),
        }),
      )
      .optional(),
    extensionsUsed: z.array(z.string()).optional(),
    extensionsRequired: z.array(z.string()).optional(),
    bounds: z
      .object({ mins: z.array(z.number()), maxs: z.array(z.number()), size: z.array(z.number()) })
      .nullable()
      .optional(),
    diagnostics: z.array(DIAGNOSTIC).optional(),
    ok: z.boolean().optional(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    if (!/\.(gltf|glb)$/i.test(path)) {
      throw new Error(`${path} is not a .gltf or .glb; the extension is the format, it is not guessed`);
    }
    return (await callSidecar(
      "gltf_read",
      { path },
      ctx.config,
      180_000,
    )) as Record<string, unknown>;
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
  overwrite: z.boolean().default(false),
});

export const gltfToSmdTool = defineTool({
  name: "gltf_to_smd",
  description:
    "Converts glTF 2.0 (.gltf) or GLB geometry and skeleton to the SMD studiomdl reads, " +
    "without Blender or a separate compiler. Reads accessors (including sparse and " +
    "interleaved), triangle lists/strips/fans, node TRS or matrices, skins with " +
    "`inverseBindMatrices` (the bind pose, not node TRS) and JOINTS_0/WEIGHTS_0. Defaults " +
    "match a Blender export: geometry stays in mesh space (axis:'z'), node transforms are " +
    "ignored (set `useNodeTransforms:true` and `axis:'y'` for a hand-authored Y-up scene), " +
    "and the SMD V is inverted so studiomdl's own parse-time inversion leaves the glTF UV " +
    "intact. Morph targets and animations are counted and reported, not silently dropped. " +
    "An optional `qc` block writes the QC in the same call. Writes only; refuses to replace " +
    "an existing SMD without overwrite.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Source .gltf or .glb."),
    output: z.string().describe("Destination .smd. The suffix is added when missing."),
    scale: z.number().positive().default(1).describe("Uniform scale applied to positions and bones."),
    axis: z
      .enum(["z", "y"])
      .default("z")
      .describe(
        "Source up axis. 'z' (default) keeps the accessor coordinates, which is what a " +
          "Blender export writes; 'y' rotates Y-up to Z-up with (x,y,z) -> (x,-z,y).",
      ),
    useNodeTransforms: z
      .boolean()
      .default(false)
      .describe(
        "Apply each static mesh node's world transform before the axis conversion. Off by " +
          "default because a DCC export already puts geometry in model space; on for a " +
          "multi-object scene, paired with axis:'y' when the file is Y-up.",
      ),
    flipV: z
      .boolean()
      .default(true)
      .describe(
        "Write SMD V as 1-v. SMD is inverted again by studiomdl, so the compiled model " +
          "keeps the glTF UV; set false only for a source that already compensated.",
      ),
    parts: z
      .array(z.string())
      .default([])
      .describe("Only these node or mesh names (case-insensitive). Empty means every mesh."),
    material: z
      .string()
      .default("debug/debugempty")
      .describe("Material name for a primitive that declares none."),
    limitVertices: z
      .number()
      .int()
      .positive()
      .default(2_000_000)
      .describe("Refuse a conversion that would write more vertices than this."),
    qc: QC_BLOCK.optional().describe(
      "Also write a QC that names the SMD. The QC path and the SMD path may differ; the " +
        "`$body` file is made relative to the QC.",
    ),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    source: z.string(),
    format: z.enum(["gltf", "glb"]),
    triangles: z.number(),
    vertices: z.number(),
    materials: z.array(z.object({ name: z.string(), triangles: z.number() })),
    mins: VEC3,
    maxs: VEC3,
    size: VEC3,
    boneCount: z.number(),
    skinned: z.boolean(),
    frameCount: z.number(),
    nodes: z.array(z.object({ index: z.number(), name: z.string(), parent: z.number().nullable() })),
    ignoredNodeTransforms: z.number(),
    ignoredMorphTargets: z.number(),
    ignoredAnimations: z.number(),
    warnings: z.array(z.string()),
    diagnostics: z.array(
      z.object({
        severity: z.enum(["error", "warning"]),
        rule: z.string(),
        message: z.string(),
        line: z.number().nullable().optional(),
      }),
    ),
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
      "gltf_to_smd",
      {
        path: source,
        out: output,
        scale: args.scale,
        axis: args.axis,
        useNodeTransforms: args.useNodeTransforms,
        flipV: args.flipV,
        parts: args.parts,
        material: args.material,
        limitVertices: args.limitVertices,
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
      const smdName = relative(dirname(qcPath), output).replace(/\\/g, "/") || basename(output);
      const text = buildQc({
        modelname: args.qc.modelname,
        body: [{ name: "Body", smd: smdName }],
        ...(args.qc.cdmaterials === undefined ? {} : { cdmaterials: args.qc.cdmaterials }),
        ...(args.qc.surfaceprop === undefined ? {} : { surfaceprop: args.qc.surfaceprop }),
        staticprop: args.qc.staticprop,
        ...(args.qc.sequence === undefined
          ? {}
          : { sequences: [{ name: args.qc.sequence, smd: smdName, fps: args.qc.fps }] }),
      });
      mkdirSync(dirname(qcPath), { recursive: true });
      const written = writeGuarded(qcPath, text, ctx.config);
      ctx.audit.record({ kind: "file_write", data: { path: written.path, created: true } });
      const parsed = loadQc(written.path);
      result.qc = {
        path: written.path,
        written: written.written,
        modelname: args.qc.modelname,
        body: smdName,
        diagnostics: parsed.diagnostics,
      };
    }
    return result as never;
  },
});

export const gltfTools = [readGltfTool, gltfToSmdTool];
