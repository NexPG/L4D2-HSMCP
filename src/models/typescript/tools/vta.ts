/**
 * `read_vta` / `write_vta`: inspect or hand-author a flex target file.
 *
 * The decompiler writes VTAs already; until now nothing could read one back or build a small
 * one without a 3D editor. The writer takes the basis and the deformed frames in the same
 * shape `parseVta` returns, so a VTA can be copied, edited and written again.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { CONFIRM } from "../../../core/typescript/tools/paths.js";
import { buildVtaText, parseVta } from "../formats/vta.js";
import type { VtaVertex } from "../formats/vta.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);

const INPUT_VERTEX = z.object({
  index: z.number().int().min(0),
  position: VEC3,
  normal: VEC3,
});

export const readVtaTool = defineTool({
  name: "read_vta",
  description:
    "Reads a VTA (vertex animation) file: skeleton nodes, the basis frame's vertex count, " +
    "and one entry per flex with its frame number, name and moved-vertex count. " +
    "`includeVertices` returns the actual positions/normals, which is what a deformed frame " +
    "stores (not the delta). Reports duplicate basis indices and an empty basis as warnings.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vta, absolute or relative to the repo root."),
    includeVertices: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    nodes: z.array(
      z.object({ index: z.number(), name: z.string(), parent: z.number() }),
    ),
    basisVertices: z.number(),
    frameCount: z.number(),
    frames: z.array(
      z.object({
        frame: z.number(),
        name: z.string(),
        vertices: z.number(),
        data: z.array(INPUT_VERTEX).optional(),
      }),
    ),
    basis: z.array(INPUT_VERTEX).optional(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const parsed = parseVta(readFileSync(path, "latin1"));
    return {
      path,
      nodes: parsed.nodes,
      basisVertices: parsed.basis.vertices.length,
      frameCount: parsed.frames.length,
      frames: parsed.frames.map((frame) => ({
        frame: frame.frame,
        name: frame.name,
        vertices: frame.vertices.length,
        ...(args.includeVertices ? { data: frame.vertices } : {}),
      })),
      ...(args.includeVertices ? { basis: parsed.basis.vertices } : {}),
      warnings: parsed.warnings,
    };
  },
});

export const writeVtaTool = defineTool({
  name: "write_vta",
  description:
    "Writes a VTA from JSON: optional skeleton nodes, the basis shape (every fixed LOD-0 " +
    "vertex) and one frame per flex. Vertices are the **deformed** position and normal, not " +
    "the delta. Reads the file back and reports what the parser saw, so a malformed line is " +
    "a refusal rather than a stare. Guarded.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Where to write the .vta, absolute or relative to the repo root."),
    nodes: z
      .array(z.object({ name: z.string().min(1), parent: z.number().int().default(-1) }))
      .optional()
      .describe("Skeleton in order; indices are assigned from the array position."),
    basis: z.array(INPUT_VERTEX).min(1).describe("`time 0`, every fixed LOD-0 vertex."),
    frames: z
      .array(
        z.object({
          name: z.string().min(1),
          vertices: z.array(INPUT_VERTEX),
        }),
      )
      .default([])
      .describe("One entry per flex; frames are numbered from 1 in this order."),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    nodeCount: z.number(),
    frameCount: z.number(),
    basisVertices: z.number(),
    verified: z.boolean(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    assertWritable(path, ctx.config);
    if (existsSync(path) && !args.overwrite) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }
    const frames = args.frames ?? [];
    const nodes = args.nodes?.map((node, index) => ({
      index,
      name: node.name,
      parent: node.parent,
    }));
    const text = buildVtaText(
      args.basis as VtaVertex[],
      frames as Array<{ name: string; vertices: VtaVertex[] }>,
      nodes,
    );
    writeFileSync(path, text, "latin1");
    // The write is only reported as verified when the same parser accepts it.
    let verified = true;
    let warnings: string[] = [];
    try {
      const parsed = parseVta(readFileSync(path, "latin1"));
      warnings = parsed.warnings;
    } catch {
      verified = false;
    }
    return {
      path,
      written: true,
      bytes: Buffer.byteLength(text, "latin1"),
      nodeCount: nodes?.length ?? 1,
      frameCount: frames.length,
      basisVertices: args.basis.length,
      verified,
      warnings,
    };
  },
});

export const vtaTools = [readVtaTool, writeVtaTool];
