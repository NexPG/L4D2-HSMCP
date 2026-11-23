/**
 * `read_fgd_resources`: the keyvalues of one entity class that name an asset.
 *
 * Hammer's entity report shows every key; an agent shipping an add-on needs the subset that
 * points at a file it must package (or that the game already has). This filters the class's
 * schema to the FGD's asset types -- model, sprite, sound, decal, material, particle, scene,
 * vscript, soundscape, instance file -- and adds the L4D2-specific traps that the schema
 * cannot express.
 *
 * The schema comes from `fgd_class`, the same sidecar call `read_fgd_class` makes; the notes
 * come from facts verified on a real install (`campaign-wiring.md`, `model-authoring.md`).
 */
import { z } from "zod";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { gameBlock } from "../../../core/typescript/games/resolve.js";
import { GAME, GAME_BLOCK, resolveInput } from "../../../core/typescript/tools/paths.js";
import { fgdContext } from "./vmf.js";

/** FGD value types that name a file or a payload the add-on must ship. */
const ASSET_TYPES = new Set([
  "STR_MODEL",
  "STR_SPRITE",
  "STR_SOUND",
  "STR_DECAL",
  "STR_MATERIAL",
  "STR_PARTICLE",
  "STR_SCENE",
  "STR_VSCRIPT",
  "STR_VSCRIPT_SINGLE",
  "EXT_SOUNDSCAPE",
  "INST_FILE",
]);

/**
 * What the schema cannot say. Each line was measured on L4D2, not copied from a manual; the
 * page named next to it carries the evidence.
 */
const CLASS_NOTES: Record<string, string[]> = {
  prop_door_rotating: [
    "The sound override keys (`soundmoveoverride` and friends) are broken in L4D2; the door's " +
      "sounds come from the model's `door_options` (see `read_model_keyvalues`). The mapper " +
      "workaround is `logic_auto` -> door -> `AddOutput \"SoundMoveOverride Doors.Move14\"`.",
    "A checkpoint door must be named `checkpoint_exit` on the room being left and " +
      "`checkpoint_entrance` on the one being entered; any other name is not found.",
  ],
  prop_door_rotating_checkpoint: [
    "The engine looks this up by name: `checkpoint_exit` on the room being left and " +
      "`checkpoint_entrance` on the one being entered. Without one, `info_changelevel` does " +
      "not spawn at all.",
  ],
  env_sprite: [
    "`model` is a `.spr` sprite, not a `.vmt`; a VMT path here renders nothing.",
  ],
  func_breakable: [
    "Gib models are not a key on this class: they come from the brush material's surface " +
      "properties and the model's `prop_data`, so nothing here lists them.",
  ],
  logic_script: [
    "`vscripts` names a `.nut` under `scripts/vscripts/`; the Squirrel file is the payload, " +
      "and a UTF-8 BOM stops it loading.",
  ],
  point_viewcontrol: [
    "L4D2 marks this class obsolete; use a `scripted_view`/camera entity the campaign ships.",
  ],
  skybox_swapper: [
    "The swapper's sky names must be the 18 shipped skies; `read_vmf_lint` checks the " +
      "worldspawn `skyname` against the same table.",
  ],
};

const RESOURCE = z.object({
  key: z.string(),
  type: z.string(),
  display: z.string().nullable(),
  default: z.string().nullable(),
  /** What the FGD type means for packaging, in one phrase. */
  meaning: z.string(),
});

const MEANING: Record<string, string> = {
  STR_MODEL: "engine model path (`models/...mdl`) the add-on must ship",
  STR_SPRITE: "`.spr` sprite path",
  STR_SOUND: "soundscript name or `sound/...` path",
  STR_DECAL: "decal material",
  STR_MATERIAL: "material name (`materials/...vmt`)",
  STR_PARTICLE: "particle system name (`particles/...pcf`)",
  STR_SCENE: "scene (`.vcd`) name",
  STR_VSCRIPT: "`.nut` under `scripts/vscripts/`",
  STR_VSCRIPT_SINGLE: "one `.nut` under `scripts/vscripts/`",
  EXT_SOUNDSCAPE: "soundscape name (`scripts/soundscapes_*.txt`)",
  INST_FILE: "instance `.vmf`",
};

export const readFgdResourcesTool = defineTool({
  name: "read_fgd_resources",
  description:
    "Lists the keyvalues of one entity class that name an asset: models, sprites, sounds, " +
    "decals, materials, particles, scenes, VScripts, soundscapes and instance files, with the " +
    "FGD default and what the type means for packaging. It is the filtered half of " +
    "`read_fgd_class`: what an add-on has to ship, and which key carries it. L4D2-specific " +
    "traps the schema cannot express are returned as `notes` (broken door sound overrides, " +
    "checkpoint door names, sprites not being VMTs, obsolete classes). Needs the Python " +
    "sidecar and the game's FGD; see health.",
  realm: "map",
  inputSchema: {
    classname: z.string().describe("Exact class, e.g. prop_door_rotating."),
    fgd: z
      .string()
      .optional()
      .describe("Extra FGD to merge, absolute or repo-relative (L4D2-FGD-Edits, Tools++)."),
    game: GAME,
  },
  outputSchema: {
    game: GAME_BLOCK,
    classname: z.string(),
    resources: z.array(RESOURCE),
    byType: z.record(z.number()),
    notes: z.array(z.string()),
    note: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const fgd = fgdContext(ctx.config, args.game);
    const extra = args.fgd ? resolveInput(args.fgd, ctx.config) : null;
    const reply = (await callSidecar(
      "fgd_class",
      {
        binDir: fgd.binDir,
        fgd: extra ? [...fgd.fgd, extra] : fgd.fgd,
        classname: args.classname,
        limit: 2000,
      },
      ctx.config,
      120_000,
    )) as {
      classname?: string;
      keyvalues?: Array<{
        name: string;
        type: string;
        display: string | null;
        default: string | null;
      }>;
    };

    const keyvalues = reply.keyvalues ?? [];
    // Every class inherits `vscripts` from the base entity, so it says nothing about what the
    // class itself needs; it is noted where it matters instead of repeated everywhere.
    const resources = keyvalues
      .filter((key) => key.name.toLowerCase() !== "vscripts")
      .filter((key) => ASSET_TYPES.has(key.type))
      .map((key) => ({
        key: key.name,
        type: key.type,
        display: key.display,
        default: key.default,
        meaning: MEANING[key.type] ?? key.type,
      }));
    const byType: Record<string, number> = {};
    for (const resource of resources) byType[resource.type] = (byType[resource.type] ?? 0) + 1;

    return {
      game: gameBlock(fgd.game, fgd.from),
      classname: reply.classname ?? args.classname,
      resources,
      byType,
      notes: CLASS_NOTES[args.classname.toLowerCase()] ?? [],
      ...(resources.length === 0
        ? {
            note:
              "This class carries no asset keyvalue: everything it needs comes from its model, " +
              "its material or the map, not from a key the FGD declares.",
          }
        : {}),
    };
  },
});

export const fgdResourceTools = [readFgdResourcesTool];
