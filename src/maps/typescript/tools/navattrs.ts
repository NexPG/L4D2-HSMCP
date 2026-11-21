/**
 * `func_nav_attribute_region`: the brush that gives nav areas their L4D2 attributes.
 *
 * The bits are `TerrorNavSpawnAttributeType`, not the nav file's area flags. They only share
 * names: CHECKPOINT is 2048 here, FINALE 64, RESCUE_CLOSET 65536. This is the half a rescue
 * closet needs; `write_rescue_closet` writes the entity, this writes the nav region.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { addBrushEntity, verifyEntities } from "./entityfamilies.js";

const BOUNDS = z.object({
  mins: z.tuple([z.number(), z.number(), z.number()]),
  maxs: z.tuple([z.number(), z.number(), z.number()]),
});

/** `NavAttributeRegion` spawnflags from the L4D2 FGD. */
const ATTRIBUTES = {
  empty: 2,
  battlestation: 32,
  finale: 64,
  mission_start: 128,
  battlefield: 256,
  not_clearable: 1024,
  checkpoint: 2048,
  obscured: 4096,
  no_mobs: 8192,
  rescue_vehicle: 32768,
  rescue_closet: 65536,
  no_threat: 524288,
  lying_down: 1048576,
} as const;

type Attribute = keyof typeof ATTRIBUTES;
export type AttributeName = Attribute;

/** The same bits for other tools that need to test or explain a nav attribute. */
export const NAV_SPAWN_BITS = ATTRIBUTES;

export const writeNavAttributeRegionTool = defineTool({
  name: "write_nav_attribute_region",
  description:
    "Writes a `func_nav_attribute_region` brush with the L4D2 spawnflags (CHECKPOINT 2048, " +
    "FINALE 64, RESCUE_CLOSET 65536, ...). A rescue closet needs both this region and the " +
    "`info_survivor_rescue` entity; the nav attribute is what the Director reads. Regenerate " +
    "nav after writing. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    attributes: z
      .array(z.enum(Object.keys(ATTRIBUTES) as [Attribute, ...Attribute[]]))
      .min(1)
      .describe("Attribute names; the bits are OR-ed."),
    bounds: BOUNDS,
    material: z
      .string()
      .default("TOOLS/TOOLSNODRAW")
      .describe("Brush material; nodraw is the conventional choice."),
    targetname: z.string().optional(),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    entityId: z.number().nullable(),
    solidIds: z.array(z.number()),
    attributes: z.array(z.string()),
    spawnflags: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const names = args.attributes ?? [];
    if (names.length === 0) throw new Error("give at least one nav attribute");
    let bits = 0;
    for (const name of names) bits |= ATTRIBUTES[name];
    const keyvalues: Record<string, string> = {
      classname: "func_nav_attribute_region",
      spawnflags: String(bits),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
    };
    const written = await addBrushEntity(
      path,
      keyvalues,
      { mins: args.bounds.mins, maxs: args.bounds.maxs },
      args.material ?? "TOOLS/TOOLSNODRAW",
      ctx,
    );
    verifyEntities(path, [written.id], ["func_nav_attribute_region"]);
    return {
      path,
      entityId: written.id,
      solidIds: written.solidIds,
      attributes: names,
      spawnflags: bits,
      warnings: [],
      nextStep:
        "Run run_nav_generate; the region applies its bits to the nav areas inside the brush. " +
        "`read_nav`/`read_nav_dump` confirms the resulting area attributes.",
    };
  },
});

export const navAttributeTools = [writeNavAttributeRegionTool];
