/**
 * Reading and writing a material.
 *
 * `read_materials` answers "which material does this face use" for a compiled map, and
 * `read_vtf` says what a texture is. Neither opens the `.vmt` in between, which is where
 * `$surfaceprop`, the `%compile*` flags that decide whether a brush is solid, and the
 * texture a shader actually draws all live. `read_vmt` is that file; `write_vmt` creates one
 * so a new texture can be finished without a text editor.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { assertWritable } from "../fs/guard.js";
import { writeGuarded } from "../fs/write.js";
import { parseVmt, serializeVmt, vmtCompileFlags, vmtTextures } from "../formats/vmt.js";
import type { VmtDocument, VmtTree } from "../formats/vmt.js";
import { defineTool } from "../mcp/registry.js";
import { CONFIRM, resolveInput } from "./paths.js";

const NODE = z.object({
  kind: z.enum(["pair", "block"]),
  key: z.string(),
  value: z.string().optional(),
  entries: z.number().optional().describe("For a block: how many entries it holds."),
});

function describe(document: VmtDocument): {
  parameters: Array<{ key: string; value: string }>;
  blocks: Array<{ name: string; entries: number }>;
} {
  return {
    parameters: [...document.parameters].map(([key, value]) => ({ key, value })),
    blocks: [...document.blocks].map(([name, entries]) => ({ name, entries: entries.length })),
  };
}

export const readVmtTool = defineTool({
  name: "read_vmt",
  description:
    "Reads a .vmt material: shader, parameters, nested blocks (Proxies, patch insert/" +
    "replace), the textures it names, the %compile* flags that decide brush solidity, and " +
    "the include of a patch. Parameter names are matched case-insensitively, as the engine " +
    "does. A missing closing brace is repaired and reported, because shipped Valve materials " +
    "contain them. This is the file between a face's material name and the .vtf.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmt, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    shader: z.string(),
    parameters: z.array(z.object({ key: z.string(), value: z.string() })),
    blocks: z.array(z.object({ name: z.string(), entries: z.number() })),
    entries: z.array(NODE),
    baseTexture: z.string().nullable(),
    surfaceProp: z.string().nullable(),
    patchInclude: z.string().nullable(),
    textures: z.array(z.object({ key: z.string(), texture: z.string() })),
    compileFlags: z.record(z.string()),
    duplicates: z.array(z.string()),
    appendedBraces: z.number(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const document = parseVmt(readFileSync(path, "utf8"), path);
    const { parameters, blocks } = describe(document);

    return {
      path,
      shader: document.shader,
      parameters,
      blocks,
      entries: document.entries.map((node) =>
        node.kind === "pair"
          ? { kind: "pair" as const, key: node.key, value: node.value }
          : { kind: "block" as const, key: node.name, entries: node.entries.length },
      ),
      baseTexture: document.parameters.get("$basetexture") ?? null,
      surfaceProp: document.parameters.get("$surfaceprop") ?? null,
      patchInclude: document.parameters.get("include") ?? null,
      textures: vmtTextures(document),
      compileFlags: vmtCompileFlags(document),
      duplicates: document.duplicates,
      appendedBraces: document.appendedBraces,
      warnings: document.warnings,
    };
  },
});

/** A `.vmt` value: a parameter string, or a block of them. */
type VmtValue = string | number | boolean | { [key: string]: VmtValue };
const VmtValueSchema: z.ZodType<VmtValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.record(VmtValueSchema)]),
);

function toTree(value: { [key: string]: VmtValue }): VmtTree {
  const out: VmtTree = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = typeof item === "object" ? toTree(item) : String(item);
  }
  return out;
}

export const writeVmtTool = defineTool({
  name: "write_vmt",
  description:
    "Writes a .vmt material from a shader and a tree of parameters. Objects become nested " +
    "blocks, so a Proxies block or a patch's insert/replace is written the way the engine " +
    "reads it. Refuses an existing file unless overwrite is set, and refuses a shader name " +
    "that contains a quote or a newline.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Where to write the .vmt, absolute or relative to the repo root."),
    shader: z
      .string()
      .min(1)
      .describe('Shader name: `VertexLitGeneric`, `LightmappedGeneric`, `UnlitGeneric`, `patch` ...'),
    values: z
      .record(VmtValueSchema)
      .default({})
      .describe(
        'Parameters and blocks. `{ "$basetexture": "concrete/wall01", "Proxies": { ... } }`. ' +
          "Top-level `include` on a `patch` is a parameter, not a block.",
      ),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    shader: z.string(),
    parameterCount: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!path.toLowerCase().endsWith(".vmt")) {
      throw new Error(`${path} is not a .vmt path; the engine only loads materials with that extension`);
    }
    if (/["\r\n{}]/.test(args.shader)) {
      throw new Error(`shader ${JSON.stringify(args.shader)} contains a quote, a brace or a newline`);
    }
    if (existsSync(path) && !args.overwrite) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }
    mkdirSync(dirname(assertWritable(path, ctx.config)), { recursive: true });

    const text = `${serializeVmt(args.shader, toTree(args.values))}\n`;
    const result = writeGuarded(path, text, ctx.config);
    ctx.audit.record({ kind: "file_write", data: { path: result.path, created: true } });

    return {
      path: result.path,
      written: result.written,
      bytes: Buffer.byteLength(text, "utf8"),
      shader: args.shader,
      parameterCount: Object.keys(args.values).length,
    };
  },
});

export const vmtTools = [readVmtTool, writeVmtTool];
