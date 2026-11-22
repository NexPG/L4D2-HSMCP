import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { readEntities } from "../vmf/edit.js";
import { editVmf } from "./vmfedit.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);
const vec = (v: readonly number[]): string =>
  v.map((n) => String(Math.round(n * 1000) / 1000)).join(" ");

function insideWorld(point: readonly number[]): boolean {
  return point.every((n) => Math.abs(n) <= 16384);
}

export const writeCubemapGridTool = defineTool({
  name: "write_cubemap_grid",
  description:
    "Places `env_cubemap` entities on a regular grid inside a bounds box. A cubemap is " +
    "captured where its entity sits, one per room or major space; a grid is the starting " +
    "point for an open area, and `spacing` is the only decision that matters. The tool " +
    "refuses a grid over 128 samples and a height outside the box. `env_cubemap` is an " +
    "internal class the stock FGD does not declare, so the per-class FGD check is skipped. " +
    "Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    bounds: z.object({ mins: VEC3, maxs: VEC3 }),
    spacing: z.number().positive().default(512).describe("Distance between samples."),
    height: z
      .number()
      .optional()
      .describe("Z for every sample; defaults to 64 units above the bounds floor."),
    prefix: z.string().default("cubemap").describe("Targetname prefix; each gets an index."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    ids: z.array(z.number().nullable()),
    count: z.number(),
    spacing: z.number(),
    height: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const { mins, maxs } = args.bounds;
    if (!insideWorld(mins) || !insideWorld(maxs)) {
      throw new Error("the cubemap grid leaves Source's world");
    }
    if (maxs[0] < mins[0] || maxs[1] < mins[1] || maxs[2] < mins[2]) {
      throw new Error("bounds maxs must be at least mins on every axis");
    }
    const spacing = args.spacing ?? 512;
    const height = args.height ?? mins[2] + 64;
    if (height < mins[2] || height > maxs[2]) {
      throw new Error("height must lie between bounds.mins.z and bounds.maxs.z");
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = mins[0]; x <= maxs[0] + 0.001; x += spacing) xs.push(x);
    for (let y = mins[1]; y <= maxs[1] + 0.001; y += spacing) ys.push(y);
    const count = xs.length * ys.length;
    if (count > 128) {
      throw new Error(
        `${count} samples is over the 128 this tool will write; raise spacing or split the box`,
      );
    }
    const keyvalues = xs.flatMap((x) =>
      ys.map((y, index) => ({
        classname: "env_cubemap",
        origin: vec([x, y, height]),
        targetname: `${args.prefix ?? "cubemap"}_${index + 1}`,
      })),
    );
    const reply = (await editVmf.handler(
      {
        path,
        ops: keyvalues.map((kv) => ({ op: "add" as const, keyvalues: kv })),
        backup: false,
        dryRun: false,
        confirm: true,
      } as never,
      ctx as never,
    )) as { outcomes: Array<{ ids: number[] }> };
    const ids = keyvalues.map((_, index) => reply.outcomes[index]?.ids[0] ?? null);
    const entities = readEntities(readFileSync(path, "utf8")).entities;
    const missing = ids.filter((id) => id === null || !entities.some((entity) => entity.id === id));
    if (missing.length > 0) throw new Error(`${missing.length} cubemap entities did not read back`);
    return {
      path,
      ids,
      count,
      spacing,
      height,
      warnings:
        height === mins[2] + 64
          ? ["height defaulted to 64 units above the floor; move it if the ceiling is low"]
          : [],
      nextStep:
        "Compile, run with -buildcubemaps, then pack the resulting cubemap .vtf files with run_build_cubemaps.",
    };
  },
});

export const cubemapGridTools = [writeCubemapGridTool];
