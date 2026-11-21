/**
 * `read_model_flexes`: the facial/procedural shape keys in a compiled `.mdl`.
 *
 * The deltas are float16 (see `mdlflex.ts`). This tool is the read side: descriptors,
 * controllers, rules and the per-vertex deltas, so the data can be inspected and compared
 * before or after `decompile_model` writes it as a VTA.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { openGameVpk } from "../../../assets/typescript/game/vpkcontent.js";
import { modelSiblings } from "../../../assets/typescript/game/models.js";
import { parseModelGeometry } from "../formats/mdlmesh.js";
import { flexRuleExpression, readFlexHeader } from "../formats/mdlflex.js";

function normalizeModelPath(model: string): string {
  let path = model.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path.toLowerCase().endsWith(".mdl")) path += ".mdl";
  if (!path.toLowerCase().startsWith("models/")) path = `models/${path}`;
  return path;
}

function loadSibling(gameDir: string, path: string): Buffer | null {
  const loose = join(gameDir, path);
  if (existsSync(loose)) return readFileSync(loose);
  return openGameVpk(gameDir)?.read(path) ?? null;
}

const FLEX_REPORT = z.object({
  descriptor: z.string(),
  descriptorIndex: z.number(),
  flexPair: z.number(),
  vertAnimType: z.number(),
  vertexCount: z.number(),
  sample: z.array(
    z.object({
      index: z.number(),
      position: z.tuple([z.number(), z.number(), z.number()]).nullable(),
      delta: z.tuple([z.number(), z.number(), z.number()]),
      normalDelta: z.tuple([z.number(), z.number(), z.number()]),
      /** Present on a wrinkle flex; the fixed-point extra channel. */
      wrinkle: z.number().optional(),
    }),
  ),
});

export const readModelFlexesTool = defineTool({
  name: "read_model_flexes",
  description:
    "Reads a compiled model's flexes: descriptor names, controllers with their ranges, " +
    "rules (as QC-style expressions when the postfix ops are understood), and every " +
    "body-part model's per-vertex position and normal deltas. `sample` returns the first " +
    "`maxVertices` deltas of each flex, with the vertex position so they can be compared " +
    "across models. `decompile_model` writes the same data as a VTA; this tool is how to " +
    "check it. Pass an engine model path or a local " +
    "`.mdl`; the VVD/VTX beside it are used for the deltas, and the header is read without " +
    "them when they are absent.",
  realm: "map",
  inputSchema: {
    model: z
      .string()
      .optional()
      .describe("Engine model path; the models/ prefix and .mdl suffix are added if missing."),
    path: z
      .string()
      .optional()
      .describe("Local .mdl path, absolute or relative to the repo root."),
    game: GAME,
    maxVertices: z
      .number()
      .int()
      .min(0)
      .max(500)
      .default(12)
      .describe("How many deltas to return per flex; 0 returns counts only."),
  },
  outputSchema: {
    game: GAME_BLOCK,
    model: z.string(),
    found: z.boolean(),
    hasGeometry: z.boolean(),
    descriptors: z.array(z.string()),
    controllers: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        min: z.number(),
        max: z.number(),
      }),
    ),
    rules: z.array(
      z.object({
        flex: z.number(),
        descriptor: z.string().nullable(),
        expression: z.string().nullable(),
        opCount: z.number(),
      }),
    ),
    bodyParts: z.array(
      z.object({
        name: z.string(),
        models: z.array(
          z.object({
            name: z.string(),
            meshes: z.array(
              z.object({
                mesh: z.number(),
                flexes: z.array(FLEX_REPORT),
              }),
            ),
          }),
        ),
      }),
    ),
    flexDescriptorCount: z.number(),
    flexControllerCount: z.number(),
    flexRuleCount: z.number(),
    flexVertexCount: z.number(),
    note: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    const gameDir = game.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const local = args.path ? resolveInput(args.path, ctx.config) : null;
    const modelPath = local ?? normalizeModelPath(args.model ?? "");
    if (!modelPath) throw new Error("give `model` (engine path) or `path` (local .mdl)");
    if (extname(modelPath).toLowerCase() !== ".mdl") {
      throw new Error("`path` must be a .mdl");
    }
    const mdlBytes = local ? readFileSync(local) : loadSibling(gameDir, modelPath);
    const readBeside = (siblingPath: string): Buffer | null => {
      if (!local) return loadSibling(gameDir, siblingPath);
      const beside = join(dirname(local), basename(siblingPath));
      return existsSync(beside) ? readFileSync(beside) : null;
    };
    if (!mdlBytes) {
      return {
        game: gameBlock(game, from),
        model: modelPath,
        found: false,
        hasGeometry: false,
        descriptors: [],
        controllers: [],
        rules: [],
        bodyParts: [],
        flexDescriptorCount: 0,
        flexControllerCount: 0,
        flexRuleCount: 0,
        flexVertexCount: 0,
        note: `${modelPath} is not installed`,
      };
    }

    const flex = readFlexHeader(mdlBytes);
    const siblings = modelSiblings(modelPath);
    const vvd = readBeside(siblings.vvd);
    let vtx: Buffer | null = null;
    for (const candidate of siblings.vtx) {
      vtx = readBeside(candidate);
      if (vtx) break;
    }
    const geometry = vvd && vtx ? parseModelGeometry(mdlBytes, vvd, vtx) : null;
    const sampleSize = Math.max(0, args.maxVertices);
    let flexVertexCount = 0;

    const bodyParts = (geometry?.bodyParts ?? []).map((part) => ({
      name: part.name,
      models: part.models.map((model) => ({
        name: model.name,
        meshes: model.meshes.map((mesh, meshIndex) => ({
          mesh: meshIndex,
          flexes: (mesh.flexes ?? []).map((entry) => {
            const descriptor =
              flex.descriptors[entry.flexDesc] ?? `flex_${entry.flexDesc}`;
            flexVertexCount += entry.vertices.length;
            return {
              descriptor,
              descriptorIndex: entry.flexDesc,
              flexPair: entry.flexPair,
              vertAnimType: entry.vertAnimType,
              vertexCount: entry.vertices.length,
              sample: entry.vertices.slice(0, sampleSize).map((vertex) => ({
                index: vertex.index,
                position: geometry?.lod0Vertices[vertex.index]?.position ?? null,
                delta: vertex.delta,
                normalDelta: vertex.normalDelta,
                ...(vertex.wrinkle !== undefined ? { wrinkle: vertex.wrinkle } : {}),
              })),
            };
          }),
        })),
      })),
    }));

    return {
      game: gameBlock(game, from),
      model: modelPath,
      found: true,
      hasGeometry: geometry !== null,
      descriptors: flex.descriptors,
      controllers: flex.controllers,
      rules: flex.rules.map((rule) => ({
        flex: rule.flex,
        descriptor: flex.descriptors[rule.flex] ?? null,
        expression: flexRuleExpression(rule, flex),
        opCount: rule.ops.length,
      })),
      bodyParts,
      flexDescriptorCount: flex.descriptors.length,
      flexControllerCount: flex.controllers.length,
      flexRuleCount: flex.rules.length,
      flexVertexCount,
      note:
        "Deltas are float16 in the .mdl; `decompile_model` writes them as VTA frames with " +
        "the original controllers and rules.",
    };
  },
});

export const modelFlexTools = [readModelFlexesTool];
