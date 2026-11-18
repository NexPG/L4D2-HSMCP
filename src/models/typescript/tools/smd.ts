/**
 * SMD: the model source studiomdl actually reads.
 *
 * `read_qc` names the SMDs and `run_studiomdl` compiles them; neither could tell an agent
 * what is inside one, and nothing could create one. That made model authoring impossible
 * without Blender. `read_smd` reports the skeleton, frames, materials, triangles and the
 * structural faults studiomdl would otherwise report after a failed compile; `write_smd`
 * builds a file from JSON and reads it back.
 *
 * Format facts this file depends on, all in the parser: a triangle is three consecutive
 * vertex lines, a vertex carries parent, position, normal, UV and an optional link list,
 * and weights that do not sum to one are legal but are reported.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);
const VEC2 = z.tuple([z.number(), z.number()]);

const DIAGNOSTIC = z.object({
  severity: z.enum(["error", "warning"]),
  rule: z.string(),
  message: z.string(),
  line: z.number().nullable(),
});

const VERTEX = z.object({
  parent: z.number(),
  position: VEC3,
  normal: VEC3,
  uv: VEC2,
  links: z.array(z.object({ bone: z.number(), weight: z.number() })),
});

export const readSmdTool = defineTool({
  name: "read_smd",
  description:
    "Parses an SMD model source: version, nodes (the skeleton), frame times and bone " +
    "transforms, triangle and vertex counts, material groups, bounds, and per-vertex bone " +
    "links. Diagnostics catch what studiomdl reports only as a failed compile: a duplicate " +
    "or dangling node, a triangle with one or two vertices, a weight set that does not sum " +
    "to 1, a vertex bound to a bone no node declares. `includeTriangles: true` returns the " +
    "geometry itself (bounded by `limit`). Needs the Python sidecar; see health.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .smd, absolute or relative to the repo root."),
    includeTriangles: z
      .boolean()
      .default(false)
      .describe("Return every triangle's three vertices. Off by default: a character SMD is large."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50_000)
      .default(5000)
      .describe("Maximum triangles returned when includeTriangles is on."),
  },
  outputSchema: {
    path: z.string(),
    read: z.boolean(),
    version: z.number().nullable().optional(),
    nodes: z.array(z.object({ id: z.number(), name: z.string(), parent: z.number() })).optional(),
    bones: z.array(z.string()).optional(),
    boneCount: z.number().optional(),
    frameLines: z.number().optional(),
    frameTimes: z.array(z.number()).optional(),
    frameCount: z.number().optional(),
    triangles: z.array(z.object({ material: z.string(), vertices: z.array(VERTEX) })).optional(),
    trianglesOmitted: z.number().optional(),
    triangleCount: z.number().optional(),
    vertexCount: z.number().optional(),
    materials: z.array(z.object({ name: z.string(), triangles: z.number() })).optional(),
    mins: z.array(z.number()).nullable().optional(),
    maxs: z.array(z.number()).nullable().optional(),
    size: z.array(z.number()).nullable().optional(),
    diagnostics: z.array(DIAGNOSTIC).optional(),
    ok: z.boolean().optional(),
    truncated: z.boolean().optional(),
    note: z.string().optional(),
    readError: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    return (await callSidecar(
      "smd_read",
      { path, includeTriangles: args.includeTriangles, limit: args.limit },
      ctx.config,
      120_000,
    )) as Record<string, unknown>;
  },
});

const INPUT_VERTEX = z.object({
  position: VEC3,
  normal: VEC3.optional(),
  uv: VEC2.optional(),
  parent: z.number().int().optional().describe("Bone used when `links` is omitted."),
  links: z
    .array(z.object({ bone: z.number().int(), weight: z.number() }))
    .optional()
    .describe("Per-vertex bone weights. Omitted means one link at weight 1."),
});

export const writeSmdTool = defineTool({
  name: "write_smd",
  description:
    "Writes an SMD from JSON: nodes (skeleton), frames and triangles, then reads it back " +
    "and reports what the parser saw. Together with write_qc and run_studiomdl this is the " +
    "whole model path without Blender: describe a mesh, name its materials, compile it. " +
    "Bones are named, not numbered — `parent: \"root\"` is resolved to an index and a " +
    "duplicate name is refused. Every triangle needs exactly three vertices; missing " +
    "normals/UVs default to +Z and (0,0) rather than being invented silently, and the " +
    "read-back result says whether the file is structurally valid.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Where to write the .smd, absolute or relative to the repo root."),
    nodes: z
      .array(
        z.object({
          name: z.string().min(1),
          parent: z.union([z.string(), z.number()]).nullable().optional(),
        }),
      )
      .min(1)
      .describe("Skeleton. The first node is not assumed to be the root; parent -1/null is."),
    frames: z
      .array(
        z.object({
          time: z.number().default(0),
          bones: z.array(
            z.object({
              bone: z.number().int(),
              position: VEC3.default([0, 0, 0]),
              rotation: VEC3.default([0, 0, 0]),
            }),
          ),
        }),
      )
      .optional()
      .describe("One frame at time 0 with an identity root is written when omitted."),
    triangles: z
      .array(
        z.object({
          material: z.string().describe("Material name as studiomdl sees it, e.g. crate."),
          vertices: z.array(INPUT_VERTEX).length(3),
        }),
      )
      .min(1),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    boneCount: z.number(),
    triangleCount: z.number(),
    materials: z.array(z.object({ name: z.string(), triangles: z.number() })),
    diagnostics: z.array(DIAGNOSTIC),
    verified: z.boolean(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (existsSync(path) && !args.overwrite) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }
    const result = (await callSidecar(
      "smd_write",
      {
        path,
        nodes: args.nodes,
        frames: args.frames,
        triangles: args.triangles,
      },
      ctx.config,
      120_000,
    )) as Record<string, unknown>;
    ctx.audit.record({ kind: "file_write", data: { path, created: true } });
    return result;
  },
});

export const smdTools = [readSmdTool, writeSmdTool];
