/**
 * `read_surfaceprops` and `check_surfaceprop`: the game's material table as data.
 *
 * `$surfaceprop` is a string the compiler never checks. A typo compiles and ships, and the
 * engine quietly uses the default friction and impact sound. These tools answer whether the
 * name exists, what it inherits from, and what the game will actually use.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK } from "../../../core/typescript/tools/paths.js";
import { readModelHeaderInfo } from "../../../models/typescript/formats/mdlbones.js";
import { looseOrVpk, normalizeModelPath } from "../../../models/typescript/tools/source.js";
import { readSurfaceProps, resolveSurfaceProp } from "../formats/surfaceprops.js";

export const readSurfacePropsTool = defineTool({
  name: "read_surfaceprops",
  description:
    "Reads the game's `scripts/surfaceproperties_*` table: the manifest, every property " +
    "block, its `base` inheritance chain and the physics/sound fields the engine uses " +
    "(`gamematerial`, density, friction, elasticity, thickness, impact sounds). " +
    "`filter` matches a substring of the name. This is the oracle `check_surfaceprop` uses; " +
    "it also shows which files the current install actually loads.",
  realm: "map",
  inputSchema: {
    filter: z.string().optional().describe("Only names containing this text (case-insensitive)."),
    limit: z.number().int().min(1).max(2000).default(200),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    files: z.array(z.string()),
    count: z.number(),
    returned: z.number(),
    names: z.array(z.string()),
    entries: z.array(
      z.object({
        name: z.string(),
        file: z.string(),
        base: z.string().nullable(),
        gameMaterial: z.string().nullable(),
        chain: z.array(z.string()),
        /** The resolved fields, child over base. */
        values: z.record(z.string()),
      }),
    ),
  },
  handler: (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    const table = readSurfaceProps(game.gameDir);
    const filter = args.filter?.toLowerCase();
    const entries = [...table.entries.values()]
      .filter((entry) => !filter || entry.key.includes(filter))
      .sort((left, right) => left.key.localeCompare(right.key));
    const returned = entries.slice(0, args.limit).map((entry) => {
      const resolved = resolveSurfaceProp(table, entry.name);
      return {
        name: entry.name,
        file: entry.file,
        base: entry.values.base ?? null,
        gameMaterial: resolved.gameMaterial,
        chain: resolved.chain,
        values: resolved.values,
      };
    });
    return {
      game: gameBlock(game, from),
      files: table.files,
      count: table.entries.size,
      returned: returned.length,
      names: entries.map((entry) => entry.name),
      entries: returned,
    };
  },
});

export const checkSurfacePropTool = defineTool({
  name: "check_surfaceprop",
  description:
    "Checks a surface property against the game's own table. Give `name` directly or " +
    "`model` to read the compiled model's `$surfaceprop`; a model path reports the name it " +
    "carries and whether the engine will find it. Returns the `base` chain, the resolved " +
    "physics/sound fields and the `gamematerial` letter. An unknown name is a finding, not " +
    "an error: the engine falls back to the default.",
  realm: "map",
  inputSchema: {
    name: z.string().optional().describe("Surface property name, e.g. `Metal_Box`."),
    model: z
      .string()
      .optional()
      .describe("Engine model path or local .mdl; its header's surfaceprop is checked."),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    /** The name that was actually checked. */
    name: z.string().nullable(),
    known: z.boolean(),
    model: z.string().nullable(),
    surfaceprop: z.string().nullable(),
    chain: z.array(z.string()),
    gameMaterial: z.string().nullable(),
    values: z.record(z.string()),
    note: z.string().optional(),
  },
  handler: (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    if (!args.name && !args.model) throw new Error("give `name` or `model`");

    let model: string | null = null;
    let surfaceprop: string | null = null;
    if (args.model) {
      model = normalizeModelPath(args.model);
      const bytes = looseOrVpk(game.gameDir, model);
      if (!bytes) throw new Error(`${model} was not found in the game directory or its VPK`);
      const header = readModelHeaderInfo(bytes);
      surfaceprop = header?.surfaceProp ?? null;
    }
    const name = args.name ?? surfaceprop;
    if (!name) {
      return {
        game: gameBlock(game, from),
        name: null,
        known: false,
        model,
        surfaceprop,
        chain: [],
        gameMaterial: null,
        values: {},
        note: "The model's header has no surfaceprop.",
      };
    }

    const table = readSurfaceProps(game.gameDir);
    const resolved = resolveSurfaceProp(table, name);
    return {
      game: gameBlock(game, from),
      name,
      known: resolved.known,
      model,
      surfaceprop,
      chain: resolved.chain,
      gameMaterial: resolved.gameMaterial,
      values: resolved.values,
      ...(resolved.known
        ? {}
        : {
            note:
              `"${name}" is not defined in ${table.files.join(", ")}; the engine falls back to ` +
              "the default material. Check the spelling or add a block to a loose " +
              "scripts/surfaceproperties_*.txt overriding the manifest.",
          }),
    };
  },
});

export const surfacePropsTools = [readSurfacePropsTool, checkSurfacePropTool];
