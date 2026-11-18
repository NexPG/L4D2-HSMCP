import { z } from "zod";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { GAME, GAME_BLOCK } from "../../../core/typescript/tools/paths.js";

export const readGameContentTool = defineTool({
  name: "read_game_content",
  description:
    "Searches the game's installed content for materials and models, by name, or browses a " +
    "whole kind when the pattern is empty. This is " +
    "Hammer's texture browser and model browser, which an agent otherwise does not have: " +
    "without it a material is named from memory, and vbsp resolves a name literally, so a " +
    "wrong one is a purple checkerboard nobody sees until a player loads the map. Returns " +
    "material names in the form a .vmf stores -- uppercase, no materials/ prefix, no .vmt " +
    "suffix -- which is exactly what set_face_material takes. A pattern with * or ? is a " +
    "glob; anything else is a substring. Mounts the same VPK-and-loose chain the engine " +
    "reads through, so this and read_map_dependencies cannot disagree about what exists. " +
    "A .vmt being present is NOT the same as the material drawing: a material can name a " +
    "texture this install does not have, which is the same purple checkerboard by another " +
    "route. Pass details to resolve every texture a material names, or to read a model's " +
    "hull bounds -- the size Hammer's model viewer shows and the number needed before " +
    "placing a house on the floor. Needs the Python sidecar; see health.",
  realm: "map",
  inputSchema: {
    pattern: z
      .string()
      .describe(
        "Name to look for. 'brick' matches anything containing it; 'brick*' is a glob. " +
          "Empty is a browse: it lists the kind from `offset`, which is how to discover an " +
          "asset whose name is not known yet.",
      ),
    kind: z
      .enum(["material", "model", "particle", "sound"])
      .default("material")
      .describe("Materials (.vmt), models (.mdl), particle systems (.pcf) or sounds (.wav)."),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Skip this many matches. Use the returned `nextOffset` to page a browse."),
    details: z
      .boolean()
      .optional()
      .describe(
        "Read the .vmt of each result for its shader, its surface property, and whether " +
          "every texture it names actually exists in this install. Off by default: a " +
          "Garry's Mod install holds tens of thousands, and parsing them all to answer one " +
          "search would cost seconds.",
      ),
    limit: z.number().int().min(1).max(1000).default(100),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    gameDir: z.string().nullable(),
    mounted: z.boolean(),
    mountError: z.string().nullable(),
    pattern: z.string(),
    kind: z.string(),
    offset: z.number().optional(),
    /** Every match, not only those returned. */
    total: z.number(),
    shown: z.number().optional(),
    truncated: z.boolean().optional(),
    nextOffset: z.number().nullable().optional(),
    results: z.array(
      z.object({
        path: z.string(),
        /** Materials only: the name as a .vmf writes it. */
        name: z.string().optional(),
        shader: z.string().nullable().optional(),
        basetexture: z.string().nullable().optional(),
        surfaceprop: z.string().nullable().optional(),
        translucent: z.boolean().optional(),
        toolTexture: z.boolean().optional(),
        /**
         * Whether every .vtf this material names is installed. `details` only.
         *
         * `null` means the .vmt could not be parsed, which is not evidence either way --
         * see `error` beside it.
         */
        resolves: z.boolean().nullable().optional(),
        /** The .vtf this material names and the install does not have. `details` only. */
        missingTextures: z.array(z.string()).optional(),
        /** Models only, `details` only: the hull Hammer's model viewer reports. */
        mins: z.array(z.number()).nullable().optional(),
        maxs: z.array(z.number()).nullable().optional(),
        size: z.array(z.number()).nullable().optional(),
        error: z.string().nullable().optional(),
      }),
    ),
    note: z.string().optional(),
    /** Set when the verb declined the request. Not `error`, which is the fault envelope. */
    refused: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    const result = (await callSidecar(
      "search_content",
      {
        // The selected profile's directory, and nothing else. Falling back to Garry's Mod
        // when the asked-for game is not installed returned GMod's assets under a reply
        // that named the other game -- a confident answer about content the map will not
        // have. A null directory makes the sidecar report that nothing was mounted, which
        // is the honest one.
        gameDir: game.gameDir,
        pattern: args.pattern,
        kind: args.kind,
        offset: args.offset,
        limit: args.limit,
        ...(args.details !== undefined ? { details: args.details } : {}),
      },
      ctx.config,
      120_000,
    )) as Record<string, unknown>;
    return { ...result, game: gameBlock(game, from) };
  },
});

const SEQUENCE_EVENT = z.object({
  type: z.string(),
  cycle: z.number(),
  options: z.string(),
});

const SEQUENCE_DETAIL = z.object({
  label: z.string(),
  activity: z.string(),
  actWeight: z.number(),
  flags: z.number(),
  eventCount: z.number(),
  events: z.array(SEQUENCE_EVENT),
  bboxMin: z.array(z.number()).nullable(),
  bboxMax: z.array(z.number()).nullable(),
});

export const readModelInfoTool = defineTool({
  name: "read_model_info",
  description:
    "Bounds, skins, sequences and materials of one .mdl -- what Hammer's model viewer " +
    "shows before you place a prop, plus what the viewer does not: per-sequence events and " +
    "activities, per-skin material tables, hitbox geometry, body-part model names, " +
    "$cdmaterials, surfaceprop, mass, eye/illumination positions and $includemodel. The " +
    "bounds are the reason this exists: a model's origin is wherever the artist put it, so " +
    "a prop placed at floor height sinks by however far its origin sits above its lowest " +
    "point, and nothing downstream reports that. A barrel measured here is 52 units tall " +
    "with its origin at the centre, which means 26 units underground if it is placed on " +
    "the floor's own z. Needs the Python sidecar; see health.",
  realm: "map",
  inputSchema: {
    model: z
      .string()
      .describe("Model path. The models/ prefix and the .mdl suffix are added if missing."),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    model: z.string(),
    mounted: z.boolean(),
    mountError: z.string().nullable().optional(),
    found: z.boolean(),
    /** Corner of the model's own hull, relative to its origin. */
    mins: z.array(z.number()).nullable().optional(),
    maxs: z.array(z.number()).nullable().optional(),
    size: z.array(z.number()).nullable().optional(),
    skinCount: z.number().optional(),
    /** Material table per skin, capped at 8 skins. */
    skins: z.array(z.array(z.string())).optional(),
    /** Every sequence the model has, even when only the first 64 labels are returned. */
    sequenceCount: z.number().optional(),
    sequences: z.array(z.string()).optional(),
    /** Activity, flags, events and bounds for the first 32 sequences. */
    sequenceDetails: z.array(SEQUENCE_DETAIL).optional(),
    /** `$cdmaterials`: the material directories the model expects. */
    cdmaterials: z.array(z.string()).optional(),
    surfaceprop: z.string().optional(),
    mass: z.number().optional(),
    eyePosition: z.array(z.number()).nullable().optional(),
    illumPosition: z.array(z.number()).nullable().optional(),
    viewBounds: z
      .object({ mins: z.array(z.number()).nullable(), maxs: z.array(z.number()).nullable() })
      .optional(),
    /** `$includemodel`: extra models compiled into this one. */
    includedModels: z.array(z.object({ label: z.string(), filename: z.string() })).optional(),
    materials: z.array(z.string()).optional(),
    sequencesTruncated: z.boolean().optional(),
    /** A `.phy` exists. A prop_static from a model without one has nothing to collide with. */
    hasPhysics: z.boolean().optional(),
    physicsPath: z.string().optional(),
    /** Bones in the skeleton. */
    boneCount: z.number().optional(),
    /**
     * `$attachment`-equivalent points in the model's own space, with the bone each follows.
     * 92 bytes per record in L4D2 (the SDK's older struct is 60).
     */
    attachments: z
      .array(
        z.object({
          name: z.string(),
          bone: z.number(),
          boneName: z.string().nullable(),
          position: z.array(z.number()),
        }),
      )
      .optional(),
    bodyParts: z
      .array(
        z.object({
          name: z.string(),
          models: z.number(),
          modelList: z
            .array(z.object({ name: z.string(), meshes: z.number(), vertices: z.number() }))
            .optional(),
        }),
      )
      .optional(),
    hitboxSets: z
      .array(
        z.object({
          name: z.string(),
          hitboxes: z.number(),
          boxes: z
            .array(
              z.object({
                name: z.string(),
                bone: z.number(),
                boneName: z.string().nullable(),
                group: z.number(),
                mins: z.array(z.number()),
                maxs: z.array(z.number()),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
    note: z.string().optional(),
    /** A model that exists and could not be read. Not `error`: that is the fault envelope. */
    readError: z.string().optional(),
    refused: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    const result = (await callSidecar(
      "model_info",
      // Same rule as read_game_content: the profile's own directory, or nothing.
      { gameDir: game.gameDir, model: args.model },
      ctx.config,
      120_000,
    )) as Record<string, unknown>;
    return { ...result, game: gameBlock(game, from) };
  },
});

export const readAssetCatalogTool = defineTool({
  name: "read_asset_catalog",
  description:
    "The stock model categories Hammer++'s model browser shows, in one call: escalators, " +
    "stairs and steps, doors, vehicles, foliage, street furniture, interiors, lights and " +
    "signs, each with its real count and a bounded sample. Use this before choosing an asset " +
    "for a feature: `read_game_content` needs a name, and an agent that has to guess the name " +
    "will build a ramp instead of using the escalator that is already installed. Structural " +
    "categories (stairs, escalators, doors, vehicles) carry the hull bounds, because those " +
    "numbers decide the opening or shaft they need. Also returns every skybox with its LDR " +
    "and HDR completeness; `strictComplete` is the only one safe to compile in both modes. " +
    "One walk of the same VPK-and-loose chain the engine reads. Needs the Python sidecar.",
  realm: "map",
  inputSchema: {
    perCategory: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(40)
      .describe("Sample size per category. `total` is always the real count."),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    gameDir: z.string().nullable(),
    mounted: z.boolean(),
    mountError: z.string().nullable(),
    modelCount: z.number().optional(),
    categories: z.array(
      z.object({
        name: z.string(),
        total: z.number(),
        shown: z.number(),
        results: z.array(
          z.object({
            path: z.string(),
            mins: z.array(z.number()).nullable().optional(),
            maxs: z.array(z.number()).nullable().optional(),
            size: z.array(z.number()).nullable().optional(),
            error: z.string().nullable().optional(),
          }),
        ),
      }),
    ),
    /** Materials grouped by what a mapper chooses by: brick, concrete, roof, ground ... */
    materialCategories: z.array(
      z.object({
        name: z.string(),
        total: z.number(),
        shown: z.number(),
        results: z.array(z.object({ path: z.string(), name: z.string() })),
      }),
    ),
    skyboxes: z.array(
      z.object({
        name: z.string(),
        ldrName: z.string(),
        hdrName: z.string(),
        suggested: z.string(),
        ldrComplete: z.boolean(),
        hdrComplete: z.boolean(),
        strictComplete: z.boolean(),
      }),
    ),
    note: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    const result = (await callSidecar(
      "asset_catalog",
      { gameDir: game.gameDir, perCategory: args.perCategory },
      ctx.config,
      180_000,
    )) as Record<string, unknown>;
    return { ...result, game: gameBlock(game, from) };
  },
});

export const contentTools = [readGameContentTool, readModelInfoTool, readAssetCatalogTool];
