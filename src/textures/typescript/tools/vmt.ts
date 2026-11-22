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
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { writeGuarded } from "../../../core/typescript/fs/write.js";
import { parseVmt, parseVmtSource, serializeVmt, vmtCompileFlags, vmtTextures, vmtTree } from "../../../formats/typescript/formats/vmt.js";
import type { KvNode, KvPair } from "../../../formats/typescript/kv/parse.js";
import type { VmtDocument, VmtTree } from "../../../formats/typescript/formats/vmt.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "../../../core/typescript/tools/paths.js";

const NODE = z.object({
  kind: z.enum(["pair", "block"]),
  key: z.string(),
  value: z.string().optional(),
  entries: z.number().optional().describe("For a block: how many entries it holds."),
});

/** A `.vmt` value: a parameter string, or a block of them. */
type VmtValue = string | number | boolean | { [key: string]: VmtValue };
const VmtValueSchema: z.ZodType<VmtValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.record(VmtValueSchema)]),
);

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
    tree: z.record(VmtValueSchema),
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
      tree: vmtTree(document),
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

/** One pair at a case-insensitive block path, or a refusal naming what is missing. */
function findVmtPair(nodes: readonly KvNode[], path: readonly string[]): KvPair {
  const shader = nodes[0];
  if (!shader || shader.kind !== "block") throw new Error("the material has no shader block");
  let entries = shader.entries;
  const walked: string[] = [];
  for (const segment of path.slice(0, -1)) {
    const block = entries.find(
      (entry) => entry.kind === "block" && entry.name.toLowerCase() === segment.toLowerCase(),
    );
    if (!block || block.kind !== "block") {
      throw new Error(
        `no block "${segment}" under ${walked.length > 0 ? walked.join("/") : shader.name}`,
      );
    }
    walked.push(block.name);
    entries = block.entries;
  }
  const key = path[path.length - 1]!;
  const matches = entries.filter(
    (entry): entry is KvPair => entry.kind === "pair" && entry.key.toLowerCase() === key.toLowerCase(),
  );
  if (matches.length === 0) {
    throw new Error(
      `no "${key}" under ${walked.length > 0 ? walked.join("/") : shader.name}. ` +
        `This editor changes existing values; write_vmt creates a new parameter.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `"${key}" appears ${matches.length} times under ` +
        `${walked.length > 0 ? walked.join("/") : shader.name}; the engine's winner is not ` +
        `promised and this editor will not guess`,
    );
  }
  return matches[0]!;
}

export const editVmtTool = defineTool({
  name: "edit_vmt",
  description:
    "Changes existing values in a `.vmt` without reserialising it: comments, indentation, a " +
    "`Proxies` block and every untouched parameter stay byte-identical. Each edit is a path " +
    "of block names plus the final key, e.g. `[\"Proxies\", \"AnimatedTexture\", " +
    "\"animatedtextureframerate\"]`; a missing block or key is refused rather than created " +
    "(write_vmt creates materials). The result is parsed back and every value is read " +
    "before the guarded write. `out` writes an add-on copy.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmt, absolute or relative to the repo root."),
    edits: z
      .array(
        z.object({
          path: z
            .array(z.string().min(1))
            .min(1)
            .describe(
              'Block names then key, e.g. ["$basetexture"] or ' +
                '["Proxies", "AnimatedTexture", "animatedtextureframerate"].',
            ),
          value: z.string().describe("New unquoted value."),
        }),
      )
      .min(1),
    out: z.string().optional().describe("Write here instead of editing the source in place."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    verified: z.boolean(),
    edits: z.array(
      z.object({
        path: z.array(z.string()),
        previous: z.string(),
        value: z.string(),
      }),
    ),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const source = readFileSync(path, "utf8");
    const parsed = parseVmtSource(source, path);
    const replacements: Array<{ start: number; end: number; text: string }> = [];
    const edits: Array<{ path: string[]; previous: string; value: string }> = [];
    const claimed = new Set<string>();

    for (const edit of args.edits) {
      const pair = findVmtPair(parsed.nodes, edit.path);
      if (pair.valueStart === undefined || pair.valueEnd === undefined) {
        throw new Error(`"${edit.path.join("/")}" has no value range to replace`);
      }
      const key = edit.path.join("\u0000").toLowerCase();
      if (claimed.has(key)) throw new Error(`"${edit.path.join("/")}" is edited more than once`);
      claimed.add(key);
      if (/[\r\n]/.test(edit.value)) {
        throw new Error(`"${edit.path.join("/")}" value contains a newline`);
      }
      replacements.push({
        start: pair.valueStart,
        end: pair.valueEnd,
        text: `"${edit.value.replace(/"/g, '\\"')}"`,
      });
      edits.push({ path: [...edit.path], previous: pair.value, value: edit.value });
    }

    replacements.sort((a, b) => b.start - a.start);
    let text = parsed.text;
    for (const splice of replacements) {
      text = text.slice(0, splice.start) + splice.text + text.slice(splice.end);
    }

    // The oracle: parse the result and read every edited value back.
    const after = parseVmtSource(text, path);
    for (const edit of edits) {
      const pair = findVmtPair(after.nodes, edit.path);
      if (pair.value !== edit.value) {
        throw new Error(
          `refusing to write: ${edit.path.join("/")} was set to ${JSON.stringify(edit.value)} ` +
            `but reads back as ${JSON.stringify(pair.value)}`,
        );
      }
    }

    const target = args.out ? resolveInput(args.out, ctx.config) : path;
    const targetBefore = existsSync(target) ? readFileSync(target, "utf8") : null;
    const unchanged = targetBefore === text;
    const write = writeGuarded(target, text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup && targetBefore !== null,
      unchanged,
    });

    return {
      path,
      out: target,
      written: write.written,
      backupPath: write.backupPath,
      unchanged,
      verified: true,
      edits,
      bytesBefore: Buffer.byteLength(source, "utf8"),
      bytesAfter: Buffer.byteLength(text, "utf8"),
      note:
        target === path
          ? "edited in place; untouched bytes were copied through"
          : `wrote an add-on copy; ${path} was not changed`,
    };
  },
});

export const vmtTools = [readVmtTool, writeVmtTool, editVmtTool];
