import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { writeVmfSolidTool } from "./build.js";
import {
  sculptDisplacementTool,
  sewDisplacementsTool,
  writeDisplacementTool,
} from "./displacement.js";
import { CONFIRM, resolveVmfInput } from "./paths.js";

const Vec2 = z.tuple([z.number(), z.number()]);

/**
 * A terrain patch in one call: a grid of floor brushes, a displacement on every top face,
 * noise, and a sew. The three underlying tools are already the native path; this exists so
 * an agent does not have to discover and chain them, and so the grid/overlap rules are in
 * one place.
 */
export const writeVmfTerrain = defineTool({
  name: "write_vmf_terrain",
  description:
    "Builds a terrain patch: a grid of floor brushes at floorZ, a power-2/3/4 displacement " +
    "on every top face, then sculpt_displacement noise and sew_displacements. This is the " +
    "native Source terrain path, not a heightmap importer. The brush hulls seal the floor; " +
    "the displacement is the visible and walkable surface. It does NOT remove an existing " +
    "flat floor: use it as the floor of the area, or pits will be hidden by the old brush. " +
    "Keep the cabin, doors, boardwalk and stairs on flat floor. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    mins: Vec2.describe("Low x/y corner of the patch."),
    maxs: Vec2.describe("High x/y corner of the patch."),
    floorZ: z.number().describe("Height of the flat top before displacement."),
    thickness: z.number().positive().default(32).describe("Solid thickness under the top."),
    cellSize: z
      .number()
      .positive()
      .default(256)
      .describe("Grid cell size in units. 128-256 keeps a power-4 grid detailed."),
    power: z.number().int().min(2).max(4).default(4),
    material: z
      .string()
      .default("NATURE/BLENDSWAMPMUDROOTS01")
      .describe("Top and side material. A blend material can be painted by height later."),
    noise: z.number().min(0).default(48).describe("Noise amplitude in units. 0 skips sculpting."),
    seed: z.number().int().default(7).describe("Same seed, same terrain."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    solidIds: z.array(z.number()),
    cells: z.number(),
    displaced: z.number(),
    seamsAfter: z.number(),
    written: z.boolean(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const [x0, y0] = args.mins;
    const [x1, y1] = args.maxs;
    if (x1 <= x0 || y1 <= y0) throw new Error("maxs must be above mins on both axes");
    // Defaults live in the schema; a direct handler call (tests, campaign build) does not
    // apply them. Undefined here became NaN z and a refused write.
    const thickness = args.thickness ?? 32;
    const power = args.power ?? 4;
    const material = args.material ?? "NATURE/BLENDSWAMPMUDROOTS01";
    const noise = args.noise ?? 48;
    const seed = args.seed ?? 7;

    const step = Math.max(32, Math.round(args.cellSize ?? 256));
    const solids: Array<{ shape: "box"; mins: [number, number, number]; maxs: [number, number, number] }> = [];
    for (let x = x0; x < x1; x += step) {
      for (let y = y0; y < y1; y += step) {
        solids.push({
          shape: "box",
          mins: [x, y, args.floorZ - thickness],
          maxs: [Math.min(x + step, x1), Math.min(y + step, y1), args.floorZ],
        });
      }
    }
    if (solids.length > 512) {
      throw new Error(
        `this patch is ${solids.length} cells; 512 is the ceiling for one call. Use a larger ` +
          `cellSize or split the area.`,
      );
    }

    const made = (await writeVmfSolidTool.handler(
      {
        path,
        solids,
        material,
        confirm: true,
      } as never,
      ctx,
    )) as { solidIds?: number[]; written?: boolean };
    const solidIds = made.solidIds ?? [];
    if (solidIds.length === 0) throw new Error("write_vmf_solid created no solids");

    const displaced = (await writeDisplacementTool.handler(
      {
        path,
        solidIds,
        facing: "up",
        power,
        confirm: true,
      } as never,
      ctx,
    )) as { created?: unknown[]; warnings?: string[] };

    const warnings = [...(displaced.warnings ?? [])];
    if (noise > 0) {
      const sculpted = (await sculptDisplacementTool.handler(
        {
          path,
          solidIds,
          shape: { kind: "noise", amplitude: noise, seed },
          confirm: true,
        } as never,
        ctx,
      )) as { warnings?: string[] };
      warnings.push(...(sculpted.warnings ?? []));
    }

    const sewn = (await sewDisplacementsTool.handler(
      { path, confirm: true } as never,
      ctx,
    )) as { seamsAfter?: number; warnings?: string[] };
    warnings.push(...(sewn.warnings ?? []));

    return {
      path,
      solidIds,
      cells: solids.length,
      displaced: Array.isArray(displaced.created) ? displaced.created.length : 0,
      seamsAfter: sewn.seamsAfter ?? -1,
      written: made.written ?? false,
      warnings,
      nextStep:
        "Paint the blend with paint_displacement(byHeight/bySlope) and keep props/doors on " +
        "flat floor. A displacement does not seal; the brush hulls do.",
    };
  },
});

export const terrainTools = [writeVmfTerrain];
