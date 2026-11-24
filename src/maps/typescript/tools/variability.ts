/**
 * Random choice and templated spawns: the two official variability patterns.
 *
 * `logic_case` + `PickRandom` chooses a case at map spawn; the case output can fire `Color`,
 * `SetSkin`, `SetBodyGroup` or a spawner. `point_template` + `env_entity_maker` stores a set
 * of named entities and spawns a copy on `ForceSpawn`. Both are ordinary entities; the rules
 * are in the outputs, which this builder writes.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { editVmf } from "./vmfedit.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);
const CASE_TARGET = z.object({
  target: z.string().describe("Targetname the case output fires at."),
  input: z.string().describe("Input on that entity, e.g. `Color`, `SetSkin`, `ForceSpawn`."),
  parameter: z.string().default("").describe("Optional parameter, e.g. `200 30 30`."),
  delay: z.number().min(0).default(0),
  times: z.number().int().min(-1).default(-1),
});

export const writeRandomCaseTool = defineTool({
  name: "write_random_case",
  description:
    "Writes a `logic_case` with one output per case and, by default, a `logic_auto` that " +
    "fires `PickRandom` at map spawn. This is the official random car colour / random prop " +
    "pattern: each case targets a `Color`, `SetSkin`, `SetBodyGroup` or spawner input. " +
    "`caseValues` are the values a caller can also pass to `InValue`; leave them out for " +
    "`1..N`. Use `write_template_spawner` for `point_template`/`env_entity_maker`. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Target .vmf, absolute or relative to the repo root."),
    origin: VEC3.default([0, 0, 0]),
    targetname: z.string().default("random_case"),
    cases: z.array(CASE_TARGET).min(2).max(16),
    caseValues: z.array(z.string()).optional().describe("Values for Case01..; default 1..N."),
    pickOnSpawn: z.boolean().default(true),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    caseId: z.number().nullable(),
    autoId: z.number().nullable(),
    cases: z.number(),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const cases = args.cases ?? [];
    const values = args.caseValues ?? cases.map((_, index) => String(index + 1));
    if (values.length !== cases.length) {
      throw new Error("caseValues must have one entry per case");
    }
    const keyvalues: Record<string, string> = {
      classname: "logic_case",
      targetname: args.targetname ?? "random_case",
      origin: (args.origin ?? [0, 0, 0]).join(" "),
    };
    cases.forEach((_, index) => {
      keyvalues[`Case${String(index + 1).padStart(2, "0")}`] = values[index]!;
    });
    const added = (await editVmf.handler(
      { path, ops: [{ op: "add", keyvalues }], confirm: true } as never,
      ctx,
    )) as unknown as { outcomes: Array<{ ids: number[] }> };
    const caseId = added.outcomes[0]?.ids[0] ?? null;
    if (caseId === null) throw new Error("the logic_case was not created");

    let autoId: number | null = null;
    if (args.pickOnSpawn !== false) {
      const auto = (await editVmf.handler(
        {
          path,
          ops: [
            {
              op: "add",
              keyvalues: {
                classname: "logic_auto",
                targetname: `${args.targetname ?? "random_case"}_auto`,
                origin: (args.origin ?? [0, 0, 0]).join(" "),
              },
            },
          ],
          confirm: true,
        } as never,
        ctx,
      )) as unknown as { outcomes: Array<{ ids: number[] }> };
      autoId = auto.outcomes[0]?.ids[0] ?? null;
      await editVmf.handler(
        {
          path,
          ops: [
            {
              op: "addOutput",
              match: { id: autoId! },
              output: "OnMapSpawn",
              value: `${args.targetname ?? "random_case"},PickRandom,,0,-1`,
            },
          ],
          confirm: true,
        } as never,
        ctx,
      );
    }
    const outputs = cases.map((entry, index) => ({
      op: "addOutput" as const,
      match: { id: caseId },
      output: `OnCase${String(index + 1).padStart(2, "0")}`,
      value: `${entry.target},${entry.input},${entry.parameter ?? ""},${entry.delay ?? 0},${entry.times ?? -1}`,
    }));
    await editVmf.handler({ path, ops: outputs, confirm: true } as never, ctx);
    return {
      path,
      caseId,
      autoId,
      cases: cases.length,
      warnings:
        cases.some((entry) => entry.input === "ForceSpawn")
          ? ["ForceSpawn needs a point_template target; see write_template_spawner"]
          : [],
    };
  },
});

export const writeTemplateSpawnerTool = defineTool({
  name: "write_template_spawner",
  description:
    "Writes the official `point_template` + `env_entity_maker` pair. The template lists the " +
    "named entities to copy (`Template01..`); the maker's `PointTemplate` names it and " +
    "`ForceSpawn` creates one copy at the maker. Use it for random prop sets, gascan drops " +
    "and rescue sequences. The named entities must exist in the map; this tool does not " +
    "create them. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Target .vmf, absolute or relative to the repo root."),
    origin: VEC3.default([0, 0, 0]),
    targetname: z.string().default("template_spawn"),
    templates: z.array(z.string()).min(1).max(16).describe("Targetnames to copy."),
    makerOrigin: VEC3.optional().describe("Maker position; default the template origin."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    templateId: z.number().nullable(),
    makerId: z.number().nullable(),
    templates: z.number(),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const name = args.targetname ?? "template_spawn";
    const templateKv: Record<string, string> = {
      classname: "point_template",
      targetname: name,
      origin: (args.origin ?? [0, 0, 0]).join(" "),
    };
    (args.templates ?? []).forEach((target, index) => {
      templateKv[`Template${String(index + 1).padStart(2, "0")}`] = target;
    });
    const added = (await editVmf.handler(
      { path, ops: [{ op: "add", keyvalues: templateKv }], confirm: true } as never,
      ctx,
    )) as unknown as { outcomes: Array<{ ids: number[] }> };
    const templateId = added.outcomes[0]?.ids[0] ?? null;
    if (templateId === null) throw new Error("the point_template was not created");
    const maker = (await editVmf.handler(
      {
        path,
        ops: [
          {
            op: "add",
            keyvalues: {
              classname: "env_entity_maker",
              targetname: `${name}_maker`,
              origin: (args.makerOrigin ?? args.origin ?? [0, 0, 0]).join(" "),
              PointTemplate: name,
            },
          },
        ],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as { outcomes: Array<{ ids: number[] }> };
    return {
      path,
      templateId,
      makerId: maker.outcomes[0]?.ids[0] ?? null,
      templates: args.templates?.length ?? 0,
      warnings: [
        "the template copies the named entities only if they exist; spawn a copy with " +
          "ForceSpawn and check the entity count at runtime",
      ],
    };
  },
});

export const variabilityTools = [writeRandomCaseTool, writeTemplateSpawnerTool];
