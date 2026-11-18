import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { editVmf } from "./vmfedit.js";
import { writeVmfSolidTool } from "./build.js";
import { readGameContentTool } from "./content.js";
import { CONFIRM, DRY_RUN, BACKUP, BACKUP_PATH, resolveVmfInput } from "./paths.js";

const VEC3 = z.array(z.number()).length(3);

/**
 * A water volume is two things that must agree: a `func_water_analog` brush whose faces
 * use a Water-shader material, and a `water_lod_control` entity that tells the engine how
 * to switch between the near and far water shaders. Writing the brush alone gives a
 * surface that draws with the wrong shader at distance; writing the entity alone gives
 * nothing at all.
 */
export const writeVmfWaterTool = defineTool({
  name: "write_vmf_water",
  description:
    "Creates a water volume: a `func_water_analog` brush with a Water-shader material and a " +
    "`water_lod_control` entity if the map has none. The material is checked against the " +
    "installed game before it is written, because a Water entity with a non-water material " +
    "is a solid, opaque box. The brush is written through write_vmf_solid, so it is checked " +
    "for valid planes and outward faces before the file is touched. Use it for a swamp, a " +
    "canal or a flooded basement; keep the boardwalk/bridge on nav, because water is not a " +
    "nav surface.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    mins: VEC3.describe("Low corner of the water volume."),
    maxs: VEC3.describe("High corner of the water volume."),
    material: z
      .string()
      .default("LIQUIDS/WATER_SWAMP_M1")
      .describe("Water-shader material, in the VMF's uppercase form."),
    targetname: z.string().optional().describe("Name for the func_water_analog entity."),
    waveHeight: z.number().optional().describe("WaveHeight keyvalue; the engine default is 3.0."),
    addLodControl: z
      .boolean()
      .default(true)
      .describe("Add a water_lod_control entity when the map has none."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    entityId: z.number(),
    solidId: z.number().nullable(),
    lodEntityId: z.number().nullable(),
    material: z.string(),
    shader: z.string().nullable(),
    warnings: z.array(z.string()),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const mins = args.mins as [number, number, number];
    const maxs = args.maxs as [number, number, number];
    for (let i = 0; i < 3; i++) {
      if (!(maxs[i]! > mins[i]!)) {
        throw new Error("`maxs` must be greater than `mins` on every axis");
      }
    }

    // A Water entity with a non-water material is an opaque box. Check the shader, not only
    // that the VMT resolves.
    const material = args.material.toUpperCase();
    const lookup = (await readGameContentTool.handler(
      { pattern: material, kind: "material", offset: 0, details: true, limit: 20 },
      ctx,
    )) as {
      results: Array<{ name: string; shader: string | null; resolves: boolean | null }>;
    };
    const found = lookup.results.find((r) => r.name.toUpperCase() === material);
    if (!found) {
      throw new Error(
        `${material} is not an installed material. Use read_game_content(kind: "material") ` +
          "to find a Water-shader material.",
      );
    }
    if (found.shader !== "Water") {
      throw new Error(
        `${material} uses the ${found.shader ?? "unknown"} shader, not Water. A func_water_analog ` +
          "with this material is a solid box, not water.",
      );
    }

    const before = readFileSync(path, "utf8");
    let entityId = 0;
    let solid: { solidIds: number[]; warnings: string[]; written: boolean } = {
      solidIds: [],
      warnings: [],
      written: false,
    };
    try {
      const add = (await editVmf.handler(
        {
          path,
          ops: [
            {
              op: "add",
              keyvalues: {
                classname: "func_water_analog",
                ...(args.targetname ? { targetname: args.targetname } : {}),
                ...(args.waveHeight !== undefined ? { WaveHeight: String(args.waveHeight) } : {}),
              },
            },
          ],
          dryRun: false,
          backup: true,
          confirm: true,
        },
        ctx,
      )) as { outcomes: Array<{ ids: Array<number | null> }> };
      const id = add.outcomes[0]?.ids[0];
      if (id === null || id === undefined) {
        throw new Error("the water entity was added but no entity id came back");
      }
      entityId = id;
      solid = (await writeVmfSolidTool.handler(
        {
          path,
          entityId,
          solids: [{ shape: "box", mins, maxs }],
          material,
          dryRun: false,
          backup: true,
          confirm: true,
        },
        ctx,
      )) as { solidIds: number[]; warnings: string[]; written: boolean };
    } catch (error) {
      // The entity and the brush are one object; a half-written water volume is worse than
      // none, because the entity with no brush looks like a point entity and does nothing.
      writeFileSync(path, before, "utf8");
      throw error;
    }

    let lodEntityId: number | null = null;
    const text = readFileSync(path, "utf8");
    if (args.addLodControl !== false && !/"classname"\s+"water_lod_control"/i.test(text)) {
      const center = [
        (mins[0] + maxs[0]) / 2,
        (mins[1] + maxs[1]) / 2,
        (mins[2] + maxs[2]) / 2,
      ];
      const lod = (await editVmf.handler(
        {
          path,
          ops: [
            {
              op: "add",
              keyvalues: {
                classname: "water_lod_control",
                origin: center.join(" "),
              },
            },
          ],
          dryRun: false,
          backup: true,
          confirm: true,
        },
        ctx,
      )) as { outcomes: Array<{ ids: Array<number | null> }> };
      lodEntityId = lod.outcomes[0]?.ids[0] ?? null;
    }

    const warnings = [...(solid.warnings ?? [])];
    if (!args.targetname) {
      warnings.push(
        "the water volume has no targetname; that is fine for a static pool, but a moving " +
          "water brush needs one to be fired.",
      );
    }
    if (args.addLodControl === false) {
      warnings.push("no water_lod_control was added; distance shader switching may be wrong.");
    }

    return {
      path,
      written: solid.written !== false,
      backupPath: null,
      entityId,
      solidId: solid.solidIds?.[0] ?? null,
      lodEntityId,
      material,
      shader: found.shader,
      warnings,
      note:
        "Water is not nav: put a boardwalk, bridge or stair on the walking route and check " +
        "that it joins the nav mesh on both banks. The func_water_analog brush is a volume; " +
        "its top face should sit at the intended water line.",
    };
  },
});

export const waterTools = [writeVmfWaterTool];
