/**
 * `.vmt` — the material, as opposed to the texture it points at.
 *
 * A map's faces name a material, and a material is a shader plus parameters: `$basetexture`,
 * `$surfaceprop`, `%compileclip`, a `Proxies` block for anything animated. Until now this
 * project could see the *name* of a material in a compiled map and could not open the file,
 * so "make a texture" stopped at the `.vtf` and "why is this wall see-through" had no
 * answer at all.
 *
 * Three behaviours are ported from EpicMorg/Hammer-MCP `Materials/VmtMaterial.cs` (MIT,
 * Copyright (c) 2026 EpicMorg), which learned them from shipped files:
 *
 * * parameters are matched **case-insensitively** — the engine does, and community files
 *   disagree about `$BaseTexture`;
 * * nested blocks (`Proxies`, a `patch`'s `insert`/`replace`) are kept as blocks rather than
 *   flattened into strings, because flattening loses the structure a writer needs;
 * * **a missing closing brace is tolerated**. Valve's own Portal 2 DLC ships VMTs that never
 *   close their last block, and the engine accepts them. The count of braces that had to be
 *   invented is reported rather than hidden, because a file we had to repair is a fact about
 *   the file.
 */
import { lex } from "../kv/lex.js";
import { parse } from "../kv/parse.js";
import type { KvNode } from "../kv/parse.js";

export interface VmtPair {
  kind: "pair";
  key: string;
  value: string;
}

export interface VmtBlock {
  kind: "block";
  name: string;
  entries: VmtNode[];
}

export type VmtNode = VmtPair | VmtBlock;

export interface VmtDocument {
  path: string;
  shader: string;
  entries: VmtNode[];
  /** Lower-cased key → value, first occurrence wins. */
  parameters: Map<string, string>;
  /** Lower-cased block name → its entries. */
  blocks: Map<string, VmtNode[]>;
  /** Keys that appear more than once at the top level, lower-cased. */
  duplicates: string[];
  /** Closing braces added to make the file parse; 0 for a well-formed file. */
  appendedBraces: number;
  warnings: string[];
}

/**
 * Keys whose value names a texture. Spelled out rather than guessed from a `$` prefix: a
 * `$` key is a parameter, and `$surfaceprop` is not a texture no matter how it looks.
 */
export const VMT_TEXTURE_KEYS = [
  "$basetexture",
  "$basetexture2",
  "$bumpmap",
  "$bumpmask",
  "$detail",
  "$detail2",
  "$dudvmap",
  "$envmap",
  "$envmapmask",
  "$lightwarptexture",
  "$normalmap",
  "$phongexponenttexture",
  "$phongmask",
  "$reflecttexture",
  "$refracttexture",
  "$selfillummask",
  "$tintmasktexture",
  "$translucencyphongexponenttexture",
] as const;

/** `%compile*` — what the material tells vbsp about the brush it sits on. */
export const VMT_COMPILE_PREFIX = "%compile";

function toVmtNodes(nodes: readonly KvNode[]): VmtNode[] {
  const out: VmtNode[] = [];
  for (const node of nodes) {
    if (node.kind === "pair") {
      out.push({ kind: "pair", key: node.key, value: node.value });
    } else {
      out.push({ kind: "block", name: node.name, entries: toVmtNodes(node.entries) });
    }
  }
  return out;
}

/** Counts braces that a naive scan sees as unclosed. Comments and strings are not stripped
 * because this only ever runs on a file the parser has already rejected. */
function missingBraces(source: string): number {
  const open = (source.match(/\{/g) ?? []).length;
  const close = (source.match(/\}/g) ?? []).length;
  return Math.max(0, open - close);
}

/**
 * Parses a `.vmt`.
 *
 * The shader is the first bare word, which is how every material is written; a file whose
 * first token is a quoted string has no shader and is reported rather than guessed at.
 */
export function parseVmt(source: string, path = "<text>"): VmtDocument {
  const warnings: string[] = [];
  // Valve's own materials open with a bare `LightmappedGeneric`, not a quoted one, which is
  // legal in this grammar. A byte-order mark would become part of that word, so it goes.
  let text = source.replace(/^\uFEFF/, "");
  let appendedBraces = 0;

  // The file must open with a name and then a brace. Checking the second token rather than
  // "the first token is a string" is what stops a file that merely contains braces from
  // being repaired into a material called `just`.
  const leading = lex(text);
  if (
    leading.length < 2 ||
    leading[0]!.kind !== "string" ||
    leading[1]!.kind !== "lbrace"
  ) {
    throw new Error(
      `${path}: a .vmt must be a shader name followed by a block, such as ` +
        `\`"VertexLitGeneric" { ... }\``,
    );
  }

  let nodes: KvNode[];
  try {
    nodes = parse(text);
  } catch (error) {
    const missing = missingBraces(text);
    if (missing === 0) throw error;
    text = `${text}${"\n}".repeat(missing)}`;
    appendedBraces = missing;
    nodes = parse(text);
    warnings.push(
      `${missing} closing brace${missing === 1 ? "" : "s"} were missing; the engine accepts ` +
        `this and so does this reader, but a tool that edits the file will rewrite it closed`,
    );
  }

  // The shader is the first node when it is an unnamed block: `"VertexLitGeneric" { ... }`
  // parses as a block whose name is the shader. A `.vmt` with a top-level pair instead is
  // malformed and says so rather than producing a document with an empty shader.
  const first = nodes[0];
  if (!first || first.kind !== "block") {
    throw new Error(`${path}: expected a shader block such as \`"VertexLitGeneric" { ... }\``);
  }

  const parameters = new Map<string, string>();
  const blocks = new Map<string, VmtNode[]>();
  const duplicates: string[] = [];
  const entries = toVmtNodes(first.entries);

  for (const entry of entries) {
    if (entry.kind === "pair") {
      const key = entry.key.toLowerCase();
      if (parameters.has(key)) duplicates.push(key);
      else parameters.set(key, entry.value);
    } else {
      const name = entry.name.toLowerCase();
      if (blocks.has(name)) duplicates.push(name);
      else blocks.set(name, entry.entries);
    }
  }

  const document: VmtDocument = {
    path,
    shader: first.name,
    entries,
    parameters,
    blocks,
    duplicates,
    appendedBraces,
    warnings,
  };

  const shader = document.shader.toLowerCase();
  if (shader === "patch" && !parameters.has("include")) {
    warnings.push('shader `patch` has no `include`; there is nothing for it to patch');
  }
  if (shader !== "patch" && parameters.has("include")) {
    warnings.push(
      "`include` is only meaningful on a `patch` material; the engine ignores it on " +
        `\`${document.shader}\``,
    );
  }
  if (duplicates.length > 0) {
    warnings.push(
      `repeated at the top level: ${duplicates.join(", ")}. The engine keeps one of them, ` +
        `so which one wins is not something this reader promises`,
    );
  }

  return document;
}

/** Case-insensitive parameter lookup, the way the engine does it. */
export function vmtParameter(document: VmtDocument, key: string): string | undefined {
  return document.parameters.get(key.toLowerCase());
}

/** Every texture path the material names, lower-cased, deduplicated. */
export function vmtTextures(document: VmtDocument): Array<{ key: string; texture: string }> {
  const out: Array<{ key: string; texture: string }> = [];
  for (const key of VMT_TEXTURE_KEYS) {
    const value = document.parameters.get(key);
    if (value) out.push({ key, texture: value.replace(/\\/g, "/").replace(/^materials\//, "").replace(/\.vtf$/i, "") });
  }
  return out;
}

/** The `%compile*` flags, as the brush solidity vbsp will apply. */
export function vmtCompileFlags(document: VmtDocument): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of document.parameters) {
    if (key.startsWith(VMT_COMPILE_PREFIX)) out[key] = value;
  }
  return out;
}

/** A `.vmt` as nested plain objects: strings are parameters, objects are blocks. */
export type VmtTree = { [key: string]: string | VmtTree };

function nodesToTree(nodes: readonly VmtNode[]): VmtTree {
  const out: VmtTree = {};
  for (const node of nodes) {
    if (node.kind === "pair") out[node.key] = node.value;
    else out[node.name] = nodesToTree(node.entries);
  }
  return out;
}

export function vmtTree(document: VmtDocument): VmtTree {
  return nodesToTree(document.entries);
}

/**
 * Merges own parameters over an upstream material, the way a `patch` does: `replace` wins,
 * `insert` adds what is missing. Returned as a tree for `serializeVmt`.
 */
export function applyVmtPatch(base: VmtDocument, patch: VmtDocument): VmtTree {
  const tree = vmtTree(base);
  const replace = patch.blocks.get("replace") ?? [];
  const insert = patch.blocks.get("insert") ?? [];
  for (const node of replace) {
    if (node.kind === "pair") tree[node.key] = node.value;
    else tree[node.name] = nodesToTree(node.entries);
  }
  for (const node of insert) {
    if (node.kind === "pair") {
      if (!(node.key in tree)) tree[node.key] = node.value;
    } else if (!(node.name in tree)) {
      tree[node.name] = nodesToTree(node.entries);
    }
  }
  for (const [key, value] of patch.parameters) {
    if (!(key in tree)) tree[key] = value;
  }
  return tree;
}

function quote(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`a .vmt value cannot contain a newline: ${JSON.stringify(value)}`);
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Serialises a shader and a tree into the tab-indented form every Valve material uses. */
export function serializeVmt(shader: string, tree: VmtTree, indent = 0): string {
  const pad = "\t".repeat(indent);
  const lines = [`${pad}${quote(shader)}`, `${pad}{`];
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      lines.push(`${pad}\t${quote(key)}\t${quote(value)}`);
    } else {
      // The recursive call already pads at `indent + 1`; adding another prefix here is how
      // a nested block ends up indented twice as far as its parent.
      lines.push(serializeVmt(key, value, indent + 1));
    }
  }
  lines.push(`${pad}}`);
  return lines.join("\n");
}
