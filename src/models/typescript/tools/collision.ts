/**
 * `read_model_collision`: what a model's `.phy` actually contains.
 *
 * `read_static_props` can only answer "does this model have a .phy?" A `.phy` can exist and
 * still be the wrong shape: a concave object stored as several convex pieces needs
 * `$concave` in its QC, or studiomdl keeps one piece and the player walks through the rest.
 * This reads the solid and convex-piece counts, the triangle and vertex counts, the
 * `prop_data` block, and whether the file's checksum still matches the `.mdl`.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { readPhy } from "../formats/phy.js";
import type { PhyReport } from "../formats/phy.js";
import { looseOrVpk, normalizeModelPath } from "./source.js";

function keyValue(text: string | null, key: string): string | null {
  if (!text) return null;
  const match = new RegExp(`"${key}"\\s+"([^"]*)"`, "i").exec(text);
  return match?.[1] ?? null;
}

function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reportOf(report: PhyReport, mdlChecksum: number | null): Record<string, unknown> {
  const totalConvexPieces = report.solids.reduce((sum, solid) => sum + solid.convexPieces, 0);
  const totalTriangles = report.solids.reduce((sum, solid) => sum + solid.triangles, 0);
  const totalVertices = report.solids.reduce((sum, solid) => sum + solid.vertices, 0);
  const ragdoll = report.ragdoll;
  return {
    found: true,
    checksum: report.checksum,
    mdlChecksum,
    checksumMatchesModel: mdlChecksum === null ? null : report.checksum === mdlChecksum,
    solidCount: report.solidCount,
    totalConvexPieces,
    totalTriangles,
    totalVertices,
    maxConvexPieces: report.maxConvexPieces,
    concaveRequired: report.maxConvexPieces > 1,
    solids: report.solids,
    collisionName: keyValue(report.collisionText, "name"),
    mass: ragdoll?.totalMass ?? numberOrNull(keyValue(report.collisionText, "mass")),
    surfaceProp: keyValue(report.collisionText, "surfaceprop"),
    /** The `.phy` text section: the ragdoll, not just a hull count. */
    ragdoll: ragdoll
      ? {
          solids: ragdoll.solids,
          constraints: ragdoll.constraints,
          rootName: ragdoll.rootName,
          totalMass: ragdoll.totalMass,
          concave: ragdoll.concave,
          selfCollisions: ragdoll.selfCollisions,
          collisionPairs: ragdoll.collisionPairs,
        }
      : null,
    /** True when the file carries more than one solid or any parent link. */
    jointed: ragdoll
      ? ragdoll.solids.length > 1 || ragdoll.solids.some((solid) => solid.parent !== null)
      : false,
    collisionText: report.collisionText ? report.collisionText.slice(0, 4000) : null,
  };
}

export const readModelCollisionTool = defineTool({
  name: "read_model_collision",
  description:
    "Reads a model's `.phy` collision and reports its solids, convex pieces, triangles, " +
    "vertices, `prop_data` block, the ragdoll text section (per-solid name/parent/mass/" +
    "massbias, joint constraints, editparams and collision rules) and whether the file still " +
    "matches the model's checksum. " +
    "This is the difference between `read_static_props` saying a .phy exists and knowing " +
    "whether it is one hull or several: more than one convex piece per solid requires " +
    "`$concave` in the QC, or studiomdl keeps the first piece and the rest is walk-through. " +
    "Pass an engine model path (`props_vehicles/cara_84sedan.mdl`) or a local `.mdl`/`.phy` " +
    "path. A missing .phy is reported as `found: false`, not as an error: the prop is " +
    "non-solid unless its `solid` key asks for a bounding box.",
  realm: "map",
  inputSchema: {
    model: z
      .string()
      .optional()
      .describe("Engine model path; the models/ prefix and .mdl suffix are added if missing."),
    path: z
      .string()
      .optional()
      .describe("Local .mdl or .phy path, absolute or relative to the repo root."),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    path: z.string().nullable(),
    model: z.string().nullable(),
    found: z.boolean(),
    checksum: z.number().nullable(),
    mdlChecksum: z.number().nullable(),
    checksumMatchesModel: z.boolean().nullable(),
    solidCount: z.number(),
    totalConvexPieces: z.number(),
    totalTriangles: z.number(),
    totalVertices: z.number(),
    maxConvexPieces: z.number(),
    /** True when at least one solid is made of more than one convex piece. */
    concaveRequired: z.boolean(),
    solids: z.array(
      z.object({
        index: z.number(),
        convexPieces: z.number(),
        triangles: z.number(),
        vertices: z.number(),
      }),
    ),
    collisionName: z.string().nullable(),
    mass: z.number().nullable(),
    surfaceProp: z.string().nullable(),
    /** The `.phy` text section; null for a file that carries none. */
    ragdoll: z
      .object({
        solids: z.array(
          z.object({
            index: z.number(),
            name: z.string(),
            parent: z.string().nullable(),
            mass: z.number(),
            surfaceprop: z.string().nullable(),
            damping: z.number(),
            rotdamping: z.number(),
            inertia: z.number(),
            volume: z.number(),
            massbias: z.number(),
          }),
        ),
        constraints: z.array(
          z.object({
            parent: z.number(),
            child: z.number(),
            limits: z.object({
              x: z.tuple([z.number(), z.number()]),
              y: z.tuple([z.number(), z.number()]),
              z: z.tuple([z.number(), z.number()]),
            }),
            friction: z.object({ x: z.number(), y: z.number(), z: z.number() }),
          }),
        ),
        rootName: z.string().nullable(),
        totalMass: z.number().nullable(),
        concave: z.boolean(),
        selfCollisions: z.boolean(),
        collisionPairs: z.array(z.tuple([z.number(), z.number()])).nullable(),
      })
      .nullable(),
    /** True when the file has more than one solid or any parent link. */
    jointed: z.boolean(),
    /** The trailing KeyValues block, capped at 4,000 characters. */
    collisionText: z.string().nullable(),
    note: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    let phyPath: string | null = null;
    let mdlPath: string | null = null;
    let model: string | null = null;
    let phyBytes: Buffer | null = null;
    let mdlBytes: Buffer | null = null;

    if (args.path) {
      const input = resolveInput(args.path, ctx.config);
      const extension = extname(input).toLowerCase();
      if (extension === ".phy") {
        phyPath = input;
        mdlPath = input.replace(/\.phy$/i, ".mdl");
      } else if (extension === ".mdl") {
        mdlPath = input;
        phyPath = input.replace(/\.mdl$/i, ".phy");
      } else {
        throw new Error("`path` must be a .mdl or .phy");
      }
      if (existsSync(phyPath)) phyBytes = readFileSync(phyPath);
      if (existsSync(mdlPath)) mdlBytes = readFileSync(mdlPath);
    } else if (args.model) {
      if (!game.gameDir) {
        throw new Error("the game directory is not resolved; run health first");
      }
      model = normalizeModelPath(args.model);
      phyPath = model.replace(/\.mdl$/i, ".phy");
      mdlPath = model;
      mdlBytes = looseOrVpk(game.gameDir, model);
      phyBytes = looseOrVpk(game.gameDir, phyPath);
    } else {
      throw new Error("give `model` (engine path) or `path` (local .mdl/.phy)");
    }

    const mdlChecksum =
      mdlBytes && mdlBytes.length >= 12 ? mdlBytes.readInt32LE(8) : null;
    const base = {
      game: gameBlock(game, from),
      path: phyPath,
      model,
      found: phyBytes !== null,
      solidCount: 0,
      totalConvexPieces: 0,
      totalTriangles: 0,
      totalVertices: 0,
      maxConvexPieces: 0,
      concaveRequired: false,
      solids: [],
      checksum: null,
      mdlChecksum,
      checksumMatchesModel: null,
      collisionName: null,
      mass: null,
      surfaceProp: null,
      ragdoll: null,
      jointed: false,
      collisionText: null,
    };

    if (!phyBytes) {
      return {
        ...base,
        note:
          "No .phy is installed for this model. A prop_static using it is non-solid unless " +
          "its `solid` key is 2 (bounding box), which is the same state `read_static_props` " +
          "reports as missing physics.",
      };
    }

    const report = readPhy(phyBytes);
    const result = reportOf(report, mdlChecksum);
    return {
      ...base,
      ...result,
      ...(mdlChecksum !== null && report.checksum !== mdlChecksum
        ? {
            note:
              "The .phy checksum does not match the .mdl. The collision was built from a " +
              "different model build; either the model or the .phy is stale, and a recompile " +
              "is the only way to know which.",
          }
        : {}),
    };
  },
});

export const modelCollisionTools = [readModelCollisionTool];
