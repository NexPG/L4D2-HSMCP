/**
 * `read_model_catalog`: the stock models as facts, not names.
 *
 * `read_game_content` answers "does this model exist?", and `read_model_info` answers
 * everything about one model. Neither answers "which prop is between 96 and 160 units and
 * has collision?", which is the question before placing a door, a vehicle or a crate. This
 * walks the same `pak01_dir.vpk` the engine reads, parses each `.mdl` header and material
 * table without its `.vvd`/`.vtx`, and filters on the measured hull, the `$staticprop` flag,
 * a `.phy` sibling and a material name.
 *
 * The hull is the model's bound, not its visual silhouette, and the `.mdl` stores no forward
 * axis. Facing is a separate, measured problem: `preview_model` or `read_model_facing`.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock, gameFor } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK } from "../../../core/typescript/tools/paths.js";
import { openGameVpk } from "../game/vpkcontent.js";
import { readModelHeaderInfo } from "../../../models/typescript/formats/mdlbones.js";
import { readModelMaterials } from "../../../models/typescript/formats/mdlmesh.js";

/** `STATIC_PROP`: the header flag vbsp requires before a model can be a `prop_static`. */
const STATIC_PROP = 1 << 4;
const MATERIALS_RETURNED = 24;

/** Substring, or a `*`/`?` wildcard over the full path; case-insensitive either way. */
function matches(pattern: string, value: string): boolean {
  if (!pattern) return true;
  const needle = pattern.replace(/\\/g, "/");
  if (!/[*?]/.test(needle)) return value.toLowerCase().includes(needle.toLowerCase());
  const source = needle
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(source, "i").test(value);
}

const MODEL = z.object({
  path: z.string(),
  mins: z.tuple([z.number(), z.number(), z.number()]),
  maxs: z.tuple([z.number(), z.number(), z.number()]),
  /** `maxs - mins` in model units, one per axis. */
  size: z.tuple([z.number(), z.number(), z.number()]),
  /** The largest of the three, the number a doorway or a shaft is checked against. */
  maxDimension: z.number(),
  /** The `$staticprop` header flag; false means vbsp deletes it as a `prop_static`. */
  staticProp: z.boolean(),
  /** A `.phy` exists beside the model in the VPK. */
  hasPhysics: z.boolean(),
  surfaceProp: z.string().nullable(),
  materialCount: z.number(),
  /** The first `MATERIALS_RETURNED`; `materialCount` is the full count. */
  materials: z.array(z.string()),
  materialsTruncated: z.boolean(),
  readError: z.string().optional(),
});

export const readModelCatalogTool = defineTool({
  name: "read_model_catalog",
  description:
    "Filters the installed stock models by their measured hull, `$staticprop` flag, `.phy` " +
    "sibling and material name. This is the question before placing a prop: which models are " +
    "between 96 and 160 units, which have collision, which can be a `prop_static`. Reads the " +
    "`pak01_dir.vpk` header and material table without the `.vvd`/`.vtx`; no game launch. The " +
    "hull is a bound, not a silhouette, and the `.mdl` stores no forward axis: use " +
    "`preview_model` or `read_model_facing` for facing. `pattern` is a substring or a " +
    "`*`/`?` wildcard over the path; empty means every stock model.",
  realm: "map",
  inputSchema: {
    pattern: z
      .string()
      .default("")
      .describe(
        "Path filter: substring by default, or a `*`/`?` wildcard (e.g. `props_junk/*crate*`).",
      ),
    minDimension: z
      .number()
      .min(0)
      .optional()
      .describe("Only models whose largest hull dimension is at least this many units."),
    maxDimension: z
      .number()
      .min(0)
      .optional()
      .describe("Only models whose largest hull dimension is at most this many units."),
    staticProp: z
      .boolean()
      .optional()
      .describe("true: only models with `$staticprop`; false: only models without it."),
    hasPhysics: z
      .boolean()
      .optional()
      .describe("true: only models with a `.phy`; false: only models without one."),
    material: z
      .string()
      .optional()
      .describe("Only models whose material list contains this substring or wildcard."),
    includeMaterials: z
      .boolean()
      .default(true)
      .describe("Return the first 24 material paths per model. `materialCount` is always full."),
    sort: z.enum(["path", "size"]).default("path"),
    order: z.enum(["asc", "desc"]).default("asc"),
    limit: z.number().int().min(1).max(500).default(50),
    offset: z.number().int().min(0).default(0),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    gameDir: z.string().nullable(),
    vpk: z.string().nullable(),
    /** `.mdl` entries that matched the path pattern and were opened. */
    scanned: z.number(),
    /** Models that passed every filter, before `limit`/`offset`. */
    total: z.number(),
    returned: z.number(),
    offset: z.number(),
    nextOffset: z.number().nullable(),
    models: z.array(MODEL),
    warnings: z.array(z.string()),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    const vpk = openGameVpk(game.gameDir);
    if (!vpk) throw new Error(`no pak01_dir.vpk under ${game.gameDir}`);

    // The MCP registry applies the schema defaults; a direct handler call does not, and a
    // missing offset used to turn `slice(undefined, NaN)` into an empty page.
    const pattern = args.pattern ?? "";
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;
    const includeMaterials = args.includeMaterials ?? true;
    const sort = args.sort ?? "path";
    const order = args.order ?? "asc";
    const warnings: string[] = [];
    const entries = vpk
      .entries()
      .filter((entry) => {
        const path = entry.path.toLowerCase();
        return path.startsWith("models/") && path.endsWith(".mdl");
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    const candidates = entries.filter((entry) => matches(pattern, entry.path));

    const rows: Array<z.infer<typeof MODEL>> = [];
    let unreadable = 0;
    for (const entry of candidates) {
      const bytes = vpk.read(entry.path);
      if (!bytes) {
        unreadable += 1;
        continue;
      }
      const header = readModelHeaderInfo(bytes);
      if (!header) {
        unreadable += 1;
        continue;
      }
      const round = (value: number): number =>
        Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
      const mins: [number, number, number] = header.hull.min.map(round) as [
        number,
        number,
        number,
      ];
      const maxs: [number, number, number] = header.hull.max.map(round) as [
        number,
        number,
        number,
      ];
      const size: [number, number, number] = [
        Number((maxs[0] - mins[0]).toFixed(3)),
        Number((maxs[1] - mins[1]).toFixed(3)),
        Number((maxs[2] - mins[2]).toFixed(3)),
      ];
      const maxDimension = Math.max(...size);
      if (args.minDimension !== undefined && maxDimension < args.minDimension) continue;
      if (args.maxDimension !== undefined && maxDimension > args.maxDimension) continue;
      const staticProp = (header.flags & STATIC_PROP) !== 0;
      if (args.staticProp !== undefined && staticProp !== args.staticProp) continue;
      const hasPhysics = vpk.entry(entry.path.replace(/\.mdl$/i, ".phy")) !== null;
      if (args.hasPhysics !== undefined && hasPhysics !== args.hasPhysics) continue;
      const materials = readModelMaterials(bytes);
      if (args.material && !materials.some((name) => matches(args.material!, name))) continue;
      rows.push({
        path: entry.path,
        mins,
        maxs,
        size,
        maxDimension: Number(maxDimension.toFixed(3)),
        staticProp,
        hasPhysics,
        surfaceProp: header.surfaceProp,
        materialCount: materials.length,
        materials: includeMaterials ? materials.slice(0, MATERIALS_RETURNED) : [],
        materialsTruncated: includeMaterials && materials.length > MATERIALS_RETURNED,
      });
    }

    rows.sort((a, b) => {
      const value = sort === "path" ? a.path.localeCompare(b.path) : a.maxDimension - b.maxDimension;
      return order === "asc" ? value : -value;
    });
    const total = rows.length;
    const page = rows.slice(offset, offset + limit);
    const nextOffset = offset + page.length < total ? offset + page.length : null;
    if (nextOffset !== null) {
      warnings.push(`${total - (offset + page.length)} more model(s); pass \`offset\` to page.`);
    }
    if (unreadable > 0) {
      warnings.push(`${unreadable} model(s) could not be read and are omitted.`);
    }
    if (entries.length === 0) {
      warnings.push("The VPK has no models/ entries; check the game profile.");
    }

    return {
      game: gameBlock(game, from),
      gameDir: game.gameDir,
      vpk: vpk.path,
      scanned: candidates.length,
      total,
      returned: page.length,
      offset,
      nextOffset,
      models: page,
      warnings,
      note:
        "Bounds are the MDL hull, not a silhouette. The .mdl stores no forward axis: use " +
        "`preview_model` or `read_model_facing` for facing. `staticProp` is the header flag " +
        "vbsp requires before a `prop_static`; `hasPhysics` is the .phy beside the model.",
    };
  },
});

export const modelCatalogTools = [readModelCatalogTool];
