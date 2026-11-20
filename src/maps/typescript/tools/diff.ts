import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { diffVmf } from "../vmf/diff.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);

const SOLID = z.object({
  id: z.number().nullable(),
  volume: z.number(),
  mins: VEC3,
  maxs: VEC3,
});

const ENTITY = z.object({
  id: z.number().nullable(),
  classname: z.string(),
  targetname: z.string().nullable(),
});

export const diffVmfTool = defineTool({
  name: "diff_vmf",
  description:
    "Compares two .vmf files by what a mapper means by changed, not by bytes: brushes " +
    "added, removed or changed (volume, bounds, materials, displacement count), entities " +
    "added, removed or changed (keyvalues and outputs), and worldspawn keys. Matched by " +
    "Hammer id, the only identifier that survives an edit that adds or removes something; " +
    "a tool that regenerates ids reads as all-added/all-removed, which is honest because " +
    "the ids really are different. Read-only. Use it to review a machine edit, to check " +
    "that a transform touched only what it named, or to see what an agent changed.",
  realm: "map",
  inputSchema: {
    before: z.string().describe("The older .vmf, absolute or relative to the repo root."),
    after: z.string().describe("The newer .vmf."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .default(100)
      .describe("Maximum entries per list."),
  },
  outputSchema: {
    before: z.string(),
    after: z.string(),
    unchanged: z.boolean(),
    summary: z.string(),
    counts: z.object({
      solidsBefore: z.number(),
      solidsAfter: z.number(),
      entitiesBefore: z.number(),
      entitiesAfter: z.number(),
    }),
    solids: z.object({
      added: z.array(SOLID),
      removed: z.array(SOLID),
      changed: z.array(
        z.object({
          id: z.number().nullable(),
          fields: z.array(z.string()),
          volumeBefore: z.number(),
          volumeAfter: z.number(),
        }),
      ),
      truncated: z.boolean(),
    }),
    entities: z.object({
      added: z.array(ENTITY),
      removed: z.array(ENTITY),
      changed: z.array(
        z.object({
          id: z.number().nullable(),
          classname: z.string(),
          targetname: z.string().nullable(),
          fields: z.array(z.string()),
        }),
      ),
      truncated: z.boolean(),
    }),
    worldspawn: z.array(
      z.object({ key: z.string(), before: z.string().nullable(), after: z.string().nullable() }),
    ),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const before = resolveVmfInput(args.before, ctx.config);
    const after = resolveVmfInput(args.after, ctx.config);
    const diff = diffVmf(readFileSync(before, "utf8"), readFileSync(after, "utf8"));
    const limit = args.limit ?? 100;

    const total = (list: readonly unknown[]): number => list.length;
    const summary =
      `${total(diff.solids.added)} solid(s) added, ${total(diff.solids.removed)} solid(s) removed, ` +
      `${total(diff.solids.changed)} solid(s) changed; ` +
      `${total(diff.entities.added)} entit(ies) added, ${total(diff.entities.removed)} entit(ies) removed, ` +
      `${total(diff.entities.changed)} entit(ies) changed; ${diff.worldspawn.length} worldspawn key(s) changed`;

    return {
      before,
      after,
      unchanged: diff.unchanged,
      summary,
      counts: diff.counts,
      solids: {
        added: diff.solids.added.slice(0, limit),
        removed: diff.solids.removed.slice(0, limit),
        changed: diff.solids.changed.slice(0, limit),
        truncated:
          diff.solids.added.length > limit ||
          diff.solids.removed.length > limit ||
          diff.solids.changed.length > limit,
      },
      entities: {
        added: diff.entities.added.slice(0, limit),
        removed: diff.entities.removed.slice(0, limit),
        changed: diff.entities.changed.slice(0, limit),
        truncated:
          diff.entities.added.length > limit ||
          diff.entities.removed.length > limit ||
          diff.entities.changed.length > limit,
      },
      worldspawn: diff.worldspawn.slice(0, limit),
      warnings: diff.warnings,
    };
  },
});

export const diffTools = [diffVmfTool];
