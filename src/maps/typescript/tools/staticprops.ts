/**
 * Editing static props in a compiled map.
 *
 * `read_static_props` says what vbsp baked; this changes it. The useful cases are a skin,
 * solidity, tint, fade or flags fix on a map whose source is gone. Model/origin changes are
 * allowed but reported as stale: the compiled visleaf set was computed for the old prop and
 * only vbsp can recompute it.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

const POSITION = z.tuple([z.number(), z.number(), z.number()]);
const COMMON = {
  angles: POSITION.optional(),
  skin: z.number().int().min(0).optional(),
  solidity: z.number().int().min(0).max(6).optional(),
  scale: z.union([z.number(), POSITION]).optional(),
  tint: POSITION.optional(),
  renderfx: z.number().int().min(0).max(255).optional(),
  minFade: z.number().optional(),
  maxFade: z.number().optional(),
  fadeScale: z.number().optional(),
  flagsAdd: z.array(z.string()).optional(),
  flagsRemove: z.array(z.string()).optional(),
};
const OPTIONAL = {
  model: z.string().optional(),
  origin: POSITION.optional(),
  ...COMMON,
};

const OP = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    ...COMMON,
    model: z.string(),
    origin: POSITION,
  }),
  z.object({
    op: z.literal("set"),
    index: z.number().int().min(0),
    ...OPTIONAL,
  }),
  z.object({ op: z.literal("remove"), index: z.number().int().min(0) }),
]);

const PROP = z.object({
  index: z.number(),
  model: z.string(),
  origin: z.array(z.number()),
  angles: z.array(z.number()),
  skin: z.number(),
  solidity: z.number(),
  scaling: z.union([z.number(), z.array(z.number())]),
  flags: z.array(z.string()),
  tint: z.array(z.number()),
  renderfx: z.number(),
  minFade: z.number(),
  maxFade: z.number(),
  fadeScale: z.number(),
  visleafs: z.number(),
});

export const editStaticPropsTool = defineTool({
  name: "edit_static_props",
  description:
    "Adds, changes or removes props in a compiled .bsp's static-prop game lump. Fix a " +
    "skin, solidity, tint, fade, scaling or flags without the source VMF; the BSP is read " +
    "through srctools, the `sprp` lump rebuilt and the file read back. Model/origin changes " +
    "and additions are allowed but reported: their compiled visleafs are stale until vbsp " +
    "runs again, so culling may be wrong. Writes in place with a .bak by default, or to " +
    "`out`. The result is the full prop list, so a wrong index is visible immediately.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Compiled .bsp to edit."),
    ops: z.array(OP).min(1),
    out: z.string().optional().describe("Write a new file instead of changing this one."),
    backup: z.boolean().default(true),
    limit: z.number().int().min(1).max(10_000).default(200),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    backup: z.string().nullable(),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    count: z.number(),
    changed: z.array(z.number()),
    props: z.array(PROP),
    warnings: z.array(z.string()),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const out = args.out ? resolveInput(args.out, ctx.config) : undefined;
    const result = (await callSidecar(
      "static_props_edit",
      {
        path,
        ...(out ? { out } : {}),
        backup: args.backup,
        limit: args.limit,
        ops: args.ops,
      },
      ctx.config,
      300_000,
    )) as Record<string, unknown>;
    ctx.audit.record({
      kind: "file_write",
      data: { path: (result.out as string) ?? path, props: result.count, backup: result.backup },
    });
    return result;
  },
});

export const staticPropTools = [editStaticPropsTool];
