/**
 * DMX mesh → SMD: the static prop path through a DCC export.
 *
 * `read_dmx` shows the graph and `read_smd`/`run_studiomdl` consume the result; this is the
 * bridge. It is explicit about being static: one root bone, every weight 1, DAG transform
 * and `flipVCoordinates` applied. Skeletal conversion is not a flag here because a wrong
 * quaternion convention produces a model that compiles sideways — it needs its own probe.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

export const dmxToSmdTool = defineTool({
  name: "dmx_to_smd",
  description:
    "Converts a static .dmx model export to .smd: walks DmeMesh/DmeVertexData/DmeFaceSet, " +
    "applies the DAG transform, honours flipVCoordinates, fan-triangulates polygons and " +
    "writes the same SMD the writer uses. Geometry, normals, UVs and material names " +
    "(stripped of materials/ and .vmt) are kept. **Static:** every vertex is weighted to " +
    "one root bone; the result says how many joints were ignored, so an armature export is " +
    "visible rather than silently broken. Use Blender's SMD export for skinned models until " +
    "skeletal conversion has its own verified probe.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Source .dmx."),
    output: z.string().describe("Destination .smd. The suffix is added if missing."),
    scale: z.number().positive().default(1).describe("Uniform scale applied after the transform."),
    flipV: z
      .boolean()
      .optional()
      .describe("Force a V flip. Omit to keep the UVs as written; the BlenderSourceTools fixture proves that is what its SMD export does."),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    source: z.string(),
    meshes: z.number(),
    triangles: z.number(),
    vertices: z.number(),
    materials: z.array(z.object({ name: z.string(), triangles: z.number() })),
    mins: z.array(z.number()),
    maxs: z.array(z.number()),
    appliedTransforms: z.number(),
    boneCount: z.number(),
    skinned: z.boolean(),
    warnings: z.array(z.string()),
    diagnostics: z.array(
      z.object({
        severity: z.enum(["error", "warning"]),
        rule: z.string(),
        message: z.string(),
        line: z.number().nullable(),
      }),
    ),
    verified: z.boolean(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const source = resolveInput(args.path, ctx.config);
    if (!existsSync(source)) throw new Error(`${source} does not exist`);
    const requested = resolveInput(args.output, ctx.config);
    const output = requested.toLowerCase().endsWith(".smd") ? requested : `${requested}.smd`;
    if (existsSync(output) && !args.overwrite) {
      throw new Error(`${output} already exists; pass overwrite: true to replace it`);
    }
    const result = (await callSidecar(
      "dmx_to_smd",
      {
        path: source,
        out: output,
        scale: args.scale,
        flipV: args.flipV,
      },
      ctx.config,
      300_000,
    )) as Record<string, unknown>;
    ctx.audit.record({ kind: "file_write", data: { path: output, created: true } });
    return result;
  },
});

export const dmxSmdTools = [dmxToSmdTool];
