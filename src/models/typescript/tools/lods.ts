/**
 * `read_model_lods`: the LOD chain with switch distances, counts and materials.
 *
 * `read_model_info` reports the triangles of LOD 0; this reports every VTX LOD, its switch
 * distance (negative is a shadow LOD), the mesh and vertex counts it keeps, and the material
 * each mesh uses at that LOD (including a VTX material override).
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { loadModelBones, loadModelGeometry, normalizeModelPath } from "./source.js";
import { boneReplacementsForLod } from "../formats/mdlbones.js";

export const readModelLodsTool = defineTool({
  name: "read_model_lods",
  description:
    "Reads a compiled model's LOD chain: one entry per VTX LOD with its switch distance " +
    "(negative is a shadow LOD), mesh/vertex/triangle counts, and each mesh's material at " +
    "that LOD (a VTX override wins over the base material). Use it to see whether a `$lod` " +
    "block lost geometry or a material at a distance.",
  realm: "map",
  inputSchema: {
    model: z
      .string()
      .optional()
      .describe("Engine model path; the models/ prefix and .mdl suffix are added if missing."),
    path: z.string().optional().describe("Local .mdl path, absolute or relative to the repo root."),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    path: z.string().nullable(),
    model: z.string().nullable(),
    lodCount: z.number(),
    lods: z.array(
      z.object({
        level: z.number(),
        switchDistance: z.number(),
        shadow: z.boolean(),
        meshes: z.number(),
        vertices: z.number(),
        triangles: z.number(),
        materials: z.array(z.string()),
        /** A strip group has FLEXED or DELTAFIXED; the QC option is `facial`. */
        facial: z.boolean(),
        materialReplacements: z.array(
          z.object({ materialIndex: z.number(), from: z.string(), to: z.string() }),
        ),
        boneReplacements: z.array(z.object({ from: z.string(), to: z.string() })),
        /** Bodygroup models present at LOD 0 but absent at this LOD. */
        removedModels: z.array(z.string()),
      }),
    ),
    note: z.string().optional(),
  },
  handler: (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    let path: string | null = null;
    let model: string | null = null;
    if (args.path) {
      path = resolveInput(args.path, ctx.config);
      model = path;
    } else if (args.model) {
      model = normalizeModelPath(args.model);
      path = model;
    } else {
      throw new Error("give `model` (engine path) or `path` (local .mdl)");
    }
    if (args.path && !existsSync(path)) throw new Error(`${path} was not found`);
    const geometry = loadModelGeometry(game.gameDir, model);
    if (!geometry) throw new Error(`${model} has no readable .mdl/.vvd/.vtx trio`);
    const bones = loadModelBones(game.gameDir, model) ?? [];

    return {
      game: gameBlock(game, from),
      path,
      model,
      lodCount: geometry.lods.length,
      lods: geometry.lods.map((lod, level) => ({
        level,
        switchDistance: lod.switchDistance,
        shadow: lod.switchDistance < 0,
        meshes: lod.meshes.length,
        vertices: lod.meshes.reduce((sum, mesh) => sum + mesh.vertices.length, 0),
        triangles: lod.triangleCount,
        materials: lod.meshes.map(
          (mesh) => mesh.materialOverride ?? geometry.materials[mesh.materialIndex] ?? "material",
        ),
        facial: lod.usesFacial,
        materialReplacements: lod.materialReplacements.map((replacement) => ({
          materialIndex: replacement.materialIndex,
          from: geometry.materials[replacement.materialIndex] ?? "material",
          to: replacement.replacement,
        })),
        boneReplacements: boneReplacementsForLod(bones, level),
        removedModels: geometry.bodyParts.flatMap((part) =>
          part.models
            .filter((alternative) => alternative.lods[level] === null && alternative.lods[0])
            .map((alternative) => alternative.name),
        ),
      })),
      ...(geometry.lods.length <= 1
        ? { note: "The model has no LOD replacements beyond LOD 0." }
        : {}),
    };
  },
});

export const modelLodTools = [readModelLodsTool];
