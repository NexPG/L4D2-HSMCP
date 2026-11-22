/**
 * DMX: the datamodel Blender, Crowbar and SFM export.
 *
 * A `.qc` is what the compiler reads; a `.dmx` is what an artist's tool writes. Until now
 * the toolkit could compile a QC and never look inside the model source it came from, so
 * "take these model sources and make a prop" stopped at the first file.
 *
 * Both directions are here: `read_dmx` returns the element tree as JSON (references stay
 * references — a model graph is cyclic), `write_dmx` builds a file from that shape and
 * reads it back. Binary and KeyValues2 text are both supported by the same Python verb.
 */
import { existsSync, statSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

const ELEMENT_REF = z.object({
  name: z.string(),
  type: z.string(),
  uuid: z.string(),
  stub: z.boolean().optional(),
  null: z.boolean().optional(),
});

const ATTRIBUTE = z.object({
  type: z.string(),
  value: z.unknown().optional(),
  element: z.unknown().optional(),
  array: z.boolean().optional(),
  count: z.number().optional(),
  truncated: z.boolean().optional(),
  values: z.array(z.unknown()).optional(),
});

const NODE = z.object({
  name: z.string(),
  type: z.string(),
  uuid: z.string(),
  attributes: z.record(z.string(), ATTRIBUTE),
});

/** The same shape without a uuid: a hand-written tree does not have to invent one. */
const NODE_INPUT = z.object({
  name: z.string(),
  type: z.string(),
  uuid: z.string().optional(),
  attributes: z.record(z.string(), ATTRIBUTE),
});

export const readDmxTool = defineTool({
  name: "read_dmx",
  description:
    "Reads a .dmx datamodel (binary or KeyValues2) as a JSON element tree: header encoding, " +
    "format name/version, root type, element counts by type, and every attribute with its " +
    "type and value. Element references are kept as {name,type,uuid} instead of expanded, " +
    "because a model graph is cyclic and a full expansion never terminates; raise maxDepth " +
    "to see one more level. Use it to check what a Blender/Crowbar export actually contains " +
    "before feeding it to a model pipeline. Needs the Python sidecar; see health.",
  realm: "local",
  inputSchema: {
    path: z.string().describe("Path to the .dmx, absolute or relative to the repo root."),
    maxDepth: z
      .number()
      .int()
      .min(0)
      .max(16)
      .default(4)
      .describe("How many levels of singular element attributes to expand."),
    maxItems: z
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(512)
      .describe("Maximum array items returned per attribute; the count is always reported."),
  },
  outputSchema: {
    path: z.string(),
    read: z.boolean(),
    bytes: z.number().optional(),
    encoding: z.string().optional(),
    encodingVersion: z.number().optional(),
    unicode: z.boolean().optional(),
    format: z.string().optional(),
    formatVersion: z.number().optional(),
    rootType: z.string().optional(),
    elementCount: z.number().optional(),
    elementTypes: z.record(z.string(), z.number()).optional(),
    tree: NODE.optional(),
    maxDepth: z.number().optional(),
    note: z.string().optional(),
    readError: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    return (await callSidecar(
      "dmx_read",
      { path, maxDepth: args.maxDepth, maxItems: args.maxItems },
      ctx.config,
      120_000,
    )) as Record<string, unknown>;
  },
});

export const writeDmxTool = defineTool({
  name: "write_dmx",
  description:
    "Builds a .dmx from a JSON element tree and reads the written file back to prove the " +
    "parser sees the same root. `encoding: \"kv2\"` writes diffable KeyValues2 text; the " +
    "default is binary v4, which is what L4D2-era model tools expect (format model, version " +
    "15). An element attribute takes a nested node; arrays take `values`. Refuses unknown " +
    "types instead of writing a file the game would silently misread. Pair with read_dmx " +
    "to inspect an existing file first: its tree is directly reusable as input here.",
  realm: "local",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Where to write the .dmx, absolute or relative to the repo root."),
    tree: NODE_INPUT.describe("Root element: {name, type, attributes}."),
    encoding: z.enum(["binary", "kv2"]).default("binary"),
    version: z
      .number()
      .int()
      .min(0)
      .max(5)
      .default(4)
      .describe("Binary encoding version; ignored for kv2. L4D2 model sources use 4."),
    format: z.string().default("model").describe("Header format name, e.g. model or animation."),
    formatVersion: z
      .number()
      .int()
      .default(15)
      .describe("Header format version; L4D2 model sources use 15."),
    overwrite: z.boolean().default(false).describe("Replace an existing file."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    encoding: z.string(),
    encodingVersion: z.number(),
    format: z.string(),
    formatVersion: z.number(),
    root: ELEMENT_REF,
    verified: z.boolean(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (existsSync(path) && !args.overwrite) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }
    const result = (await callSidecar(
      "dmx_write",
      {
        path,
        tree: args.tree,
        encoding: args.encoding,
        version: args.version,
        format: args.format,
        formatVersion: args.formatVersion,
      },
      ctx.config,
      120_000,
    )) as Record<string, unknown>;
    ctx.audit.record({
      kind: "file_write",
      data: { path, created: true, bytes: statSync(path).size },
    });
    return result;
  },
});

export const dmxTools = [readDmxTool, writeDmxTool];
