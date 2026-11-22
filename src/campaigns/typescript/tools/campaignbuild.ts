import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import type { ToolContext } from "../../../core/typescript/mcp/registry.js";
import { resolveInput, resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { readEntityLump } from "../../../maps/typescript/bsp/entities.js";
import { readEntities } from "../../../maps/typescript/vmf/edit.js";
import { writeVmfSolidTool } from "../../../maps/typescript/tools/build.js";
import { placeDoorTool } from "../../../maps/typescript/tools/door.js";
import { editVmf } from "../../../maps/typescript/tools/vmfedit.js";
import { readFgdClass } from "../../../maps/typescript/tools/vmf.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);

const vec = (v: readonly number[]): string =>
  v.map((n) => String(Math.round(n * 1000) / 1000)).join(" ");

function insideWorld(point: readonly number[]): boolean {
  return point.every((n) => Math.abs(n) <= 16384);
}

function requireInside(label: string, point: readonly number[]): void {
  if (!insideWorld(point)) throw new Error(`${label} ${vec(point)} leaves Source's world`);
}

/** Add entities and return the ids, in order. */
async function addEntities(
  path: string,
  keyvalues: Array<Record<string, string>>,
  ctx: ToolContext,
): Promise<Array<number | null>> {
  const reply = (await editVmf.handler(
    {
      path,
      ops: keyvalues.map((kv) => ({ op: "add" as const, keyvalues: kv })),
      backup: false,
      dryRun: false,
      confirm: true,
    } as never,
    ctx as never,
  )) as { outcomes: Array<{ ids: number[] }> };
  return keyvalues.map((_, index) => reply.outcomes[index]?.ids[0] ?? null);
}

/** The write is refused unless each id reads back as the class it claimed. */
function verifyEntities(
  path: string,
  ids: Array<number | null>,
  classes: string[],
): void {
  const entities = readEntities(readFileSync(path, "utf8")).entities;
  ids.forEach((id, index) => {
    const found = entities.find((entity) => entity.id === id);
    if (!found) {
      throw new Error(`refusing to write: entity ${id} was not readable after the write`);
    }
    if (found.classname.toLowerCase() !== classes[index]!.toLowerCase()) {
      throw new Error(
        `refusing to write: entity ${id} reads back as ${found.classname}, not ${classes[index]}`,
      );
    }
  });
}

/** Add a brush entity by adding the entity first, then tying a box to it. */
async function addBrushEntity(
  path: string,
  keyvalues: Record<string, string>,
  bounds: { mins: readonly number[]; maxs: readonly number[] },
  material: string,
  ctx: ToolContext,
): Promise<{ id: number | null; solidIds: number[] }> {
  const [id = null] = await addEntities(path, [keyvalues], ctx);
  if (id === null) throw new Error("the brush entity was not created");
  verifyEntities(path, [id], [keyvalues["classname"]!]);
  try {
    const written = (await writeVmfSolidTool.handler(
      {
        path,
        entityId: id,
        solids: [
          {
            shape: "box",
            mins: [...bounds.mins],
            maxs: [...bounds.maxs],
          },
        ],
        material,
        backup: false,
        dryRun: false,
        confirm: true,
      } as never,
      ctx as never,
    )) as { solidIds: number[] };
    return { id, solidIds: written.solidIds };
  } catch (error) {
    // A brush entity with no solids is worse than no entity: it compiles to nothing and
    // reads as done. Put the file back before reporting the geometry failure.
    await editVmf.handler(
      {
        path,
        ops: [{ op: "remove" as const, match: { id } }],
        backup: false,
        dryRun: false,
        confirm: true,
      } as never,
      ctx as never,
    );
    throw error;
  }
}

async function fgdWarnings(
  className: string,
  keyvalues: Record<string, string>,
  ctx: ToolContext,
): Promise<string[]> {
  try {
    const description = (await readFgdClass.handler(
      { classname: className } as never,
      ctx as never,
    )) as { keyvalues?: Array<{ name: string }> };
    const known = new Set((description.keyvalues ?? []).map((kv) => kv.name.toLowerCase()));
    const unknown = Object.keys(keyvalues).filter((key) => {
      const low = key.toLowerCase();
      if (["classname", "origin", "angles", "targetname", "spawnflags", "id"].includes(low)) {
        return false;
      }
      if (low.startsWith("on")) return false; // outputs are not keyvalues
      return !known.has(low);
    });
    return unknown.length > 0
      ? [
          `${className} does not declare ${unknown.join(", ")} in the game FGD. ` +
            `The map still compiles, but read_vmf_lint is the check that will agree.`,
        ]
      : [];
  } catch {
    return [`the FGD for ${className} could not be read, so its key names were not checked`];
  }
}

// ---------------------------------------------------------------------------
// Spawn points
// ---------------------------------------------------------------------------

const SURVIVOR_POSITION = z.object({
  origin: VEC3,
  angles: VEC3.default([0, 0, 0]),
  survivorName: z.string().optional().describe("Ellis, Coach, Nick or Rochelle."),
  hideWeapons: z.boolean().default(false),
  targetname: z.string().optional(),
});

export const writeSpawnPointsTool = defineTool({
  name: "write_spawn_points",
  description:
    "Writes the entities a map spawns from, as a family rather than one class: one " +
    "`info_player_start`, one to four ordered `info_survivor_position`s, one or more " +
    "`info_zombie_spawn`s (with population and offer_tank), or `info_survivor_rescue`. " +
    "`info_player_start` is L4D2's only survivor spawn, so a second one is refused. " +
    "Survivor positions get `Order` 1-4 and an optional `GameMode` (`coop`, `versus`, " +
    "`survival`, `scavenge`). Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z.enum(["player", "survivor", "zombie", "rescue"]),
    origin: VEC3.optional().describe("player/rescue: where the entity sits."),
    angles: VEC3.default([0, 0, 0]).describe("player/rescue facing."),
    positions: z
      .array(SURVIVOR_POSITION)
      .max(64)
      .default([])
      .describe("survivor/rescue positions; zombie spawn points use `spawns`."),
    spawns: z
      .array(
        z.object({
          origin: VEC3,
          angles: VEC3.default([0, 0, 0]),
          population: z.string().default("default").describe("`default` or a number."),
          offerTank: z.boolean().default(false),
          targetname: z.string().optional(),
        }),
      )
      .max(128)
      .default([])
      .describe("zombie: spawn points."),
    gameMode: z
      .string()
      .optional()
      .describe("survivor: GameMode filter, e.g. `coop` or `versus`."),
    targetname: z.string().optional().describe("Base name; survivor orders get suffixed."),
    model: z
      .string()
      .default("models/editor/playerstart.mdl")
      .describe("rescue: the rescue model."),
    rescueEyePos: VEC3.optional().describe("rescue: rescueEyePos."),
    keyvalues: z.record(z.string()).default({}),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    ids: z.array(z.number().nullable()),
    classes: z.array(z.string()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const warnings: string[] = [];
    const keyvalues: Array<Record<string, string>> = [];
    const classes: string[] = [];
    const extra = args.keyvalues ?? {};
    const positions = args.positions ?? [];
    const angles = args.angles ?? [0, 0, 0];

    if (args.kind === "player") {
      if (!args.origin) throw new Error("player: give origin");
      requireInside("origin", args.origin);
      const existing = readEntities(readFileSync(path, "utf8")).entities.filter(
        (entity) => entity.classname === "info_player_start",
      );
      if (existing.length > 0) {
        throw new Error(
          `this map already has ${existing.length} info_player_start; L4D2 spawns the team ` +
            `around one, so a second is not a second spawn`,
        );
      }
      keyvalues.push({
        classname: "info_player_start",
        origin: vec(args.origin),
        angles: vec(args.angles ?? [0, 0, 0]),
        ...extra,
      });
      classes.push("info_player_start");
    } else if (args.kind === "survivor") {
      if (args.positions.length === 0) throw new Error("survivor: give at least one position");
      if (args.positions.length > 4) {
        throw new Error("survivor: L4D2 has four survivors; at most four positions");
      }
      const base = args.targetname ?? "survivor_pos";
      positions.forEach((position, index) => {
        requireInside("survivor position", position.origin);
        keyvalues.push({
          classname: "info_survivor_position",
          origin: vec(position.origin),
          angles: vec(position.angles ?? [0, 0, 0]),
          Order: String(index + 1),
          targetname: position.targetname ?? `${base}_${index + 1}`,
          ...(args.gameMode !== undefined ? { GameMode: args.gameMode } : {}),
          ...(position.survivorName !== undefined
            ? { SurvivorName: position.survivorName }
            : {}),
          ...(position.hideWeapons === true ? { HideWeapons: "1" } : {}),
          ...extra,
        });
        classes.push("info_survivor_position");
      });
    } else if (args.kind === "zombie") {
      if (args.spawns.length === 0) throw new Error("zombie: give at least one spawn point");
      for (const spawn of args.spawns) {
        requireInside("zombie spawn", spawn.origin);
        keyvalues.push({
          classname: "info_zombie_spawn",
          origin: vec(spawn.origin),
          angles: vec(spawn.angles ?? [0, 0, 0]),
          population: spawn.population ?? "default",
          offer_tank: spawn.offerTank === true ? "1" : "0",
          ...(spawn.targetname !== undefined ? { targetname: spawn.targetname } : {}),
          ...extra,
        });
        classes.push("info_zombie_spawn");
      }
    } else {
      const rescuePositions =
        positions.length > 0
          ? positions
          : args.origin
            ? [{ origin: args.origin, angles }]
            : [];
      if (rescuePositions.length === 0) throw new Error("rescue: give origin or positions");
      rescuePositions.forEach((position, index) => {
        requireInside("rescue position", position.origin);
        keyvalues.push({
          classname: "info_survivor_rescue",
          origin: vec(position.origin),
          angles: vec(position.angles ?? [0, 0, 0]),
          model: args.model ?? "models/editor/playerstart.mdl",
          ...(args.rescueEyePos !== undefined
            ? { rescueEyePos: vec(args.rescueEyePos) }
            : {}),
          ...(args.targetname !== undefined
            ? { targetname: rescuePositions.length > 1 ? `${args.targetname}_${index + 1}` : args.targetname }
            : {}),
          ...extra,
        });
        classes.push("info_survivor_rescue");
      });
    }

    for (const kv of keyvalues) warnings.push(...(await fgdWarnings(kv["classname"]!, kv, ctx)));
    const ids = await addEntities(path, keyvalues, ctx);
    verifyEntities(path, ids, classes);
    return {
      path,
      ids,
      classes,
      warnings,
      nextStep:
        args.kind === "player"
          ? "Survivor positions, a checkpoint door and a changelevel make this a chapter start."
          : "Compile and load: spawn entities are silent until a mode asks for them.",
    };
  },
});

// ---------------------------------------------------------------------------
// Safe room
// ---------------------------------------------------------------------------

const OPENING = z.object({
  axis: z.enum(["x", "y"]).describe("World axis the opening runs along."),
  min: z.number(),
  max: z.number(),
  at: z.number().describe("Position on the other horizontal axis: the plane of the door."),
  floorZ: z.number(),
});

export const writeSafeRoomTool = defineTool({
  name: "write_safe_room",
  description:
    "Builds a chapter's safe room in one call: a `prop_door_rotating_checkpoint` with its " +
    "origin on the hinge (through place_door, so the model hull decides the swing), an " +
    "`info_player_start`, four `info_survivor_position`s and the map's `info_director` if " +
    "it has none. The door is named exactly `checkpoint_exit` or `checkpoint_entrance` " +
    "because the engine looks those names up. Positions default to a 48-unit square around " +
    "the player start and are reported so they can be moved; pass them to place the team. " +
    "The changelevel volume is `write_changelevel`, not this tool. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    role: z
      .enum(["exit", "entrance"])
      .default("exit")
      .describe("exit = the door to the next chapter; entrance = the door behind the team."),
    opening: OPENING,
    yaw: z.number().describe("Door entity yaw in degrees; the leaf runs along the opening."),
    doorModel: z
      .string()
      .default("models/props_doors/checkpoint_door_-02.mdl")
      .describe("Checkpoint door model."),
    playerStart: z.object({ origin: VEC3, angles: VEC3.default([0, 0, 0]) }),
    survivorPositions: z.array(SURVIVOR_POSITION).max(4).default([]),
    withDirector: z.boolean().default(true).describe("Add `info_director` when absent."),
    keyvalues: z.record(z.string()).default({}),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    doorId: z.number().nullable(),
    playerStartId: z.number().nullable(),
    survivorIds: z.array(z.number().nullable()),
    directorId: z.number().nullable(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    requireInside("player start", args.playerStart.origin);
    const warnings: string[] = [];
    const existing = readEntities(readFileSync(path, "utf8")).entities;
    if (existing.some((entity) => entity.classname === "info_player_start")) {
      throw new Error(
        "this map already has an info_player_start; a safe room adds one, not a second",
      );
    }

    const doorName = args.role === "exit" ? "checkpoint_exit" : "checkpoint_entrance";
    const door = (await placeDoorTool.handler(
      {
        path,
        model: args.doorModel ?? "models/props_doors/checkpoint_door_-02.mdl",
        classname: "prop_door_rotating_checkpoint",
        opening: args.opening,
        yaw: args.yaw,
        targetname: doorName,
        backup: false,
        dryRun: false,
        confirm: true,
      } as never,
      ctx as never,
    )) as { entityId: number | null; warnings: string[] };
    warnings.push(...(door.warnings ?? []));

    const survivorPositions = args.survivorPositions ?? [];
    const positions: Array<{
      origin: readonly number[];
      angles?: readonly number[];
      targetname?: string;
    }> =
      survivorPositions.length > 0
        ? survivorPositions
        : [0, 1, 2, 3].map((index) => ({
            origin: [
              args.playerStart.origin[0] + (index % 2 === 0 ? -24 : 24),
              args.playerStart.origin[1] + (index < 2 ? -24 : 24),
              args.playerStart.origin[2],
            ] as [number, number, number],
            angles: args.playerStart.angles ?? [0, 0, 0],
          }));
    if ((args.survivorPositions ?? []).length === 0) {
      warnings.push(
        "survivor positions were laid out as a 48-unit square around the player start; move " +
          "them so no one stands in a wall or on a prop",
      );
    }

    const base = args.role === "exit" ? "survivor_start" : "survivor_arrival";
    const survivorKeyvalues = positions.map((position, index) => {
      requireInside("survivor position", position.origin);
      return {
        classname: "info_survivor_position",
        origin: vec(position.origin),
        angles: vec(position.angles ?? [0, 0, 0]),
        Order: String(index + 1),
        targetname: position.targetname ?? `${base}_${index + 1}`,
        ...(args.keyvalues ?? {}),
      };
    });
    const survivorIds = await addEntities(path, survivorKeyvalues, ctx);
    verifyEntities(path, survivorIds, survivorKeyvalues.map(() => "info_survivor_position"));

    const [playerStartId = null] = await addEntities(
      path,
      [
        {
          classname: "info_player_start",
          origin: vec(args.playerStart.origin),
          angles: vec(args.playerStart.angles ?? [0, 0, 0]),
        },
      ],
      ctx,
    );
    verifyEntities(path, [playerStartId], ["info_player_start"]);

    let directorId: number | null = null;
    if (args.withDirector !== false && !existing.some((e) => e.classname === "info_director")) {
      [directorId = null] = await addEntities(
        path,
        [{ classname: "info_director", origin: vec(args.playerStart.origin), targetname: "director" }],
        ctx,
      );
      verifyEntities(path, [directorId], ["info_director"]);
    } else if (!existing.some((e) => e.classname === "info_director")) {
      warnings.push("no info_director: the chapter has no Director until one is added");
    }

    return {
      path,
      doorId: door.entityId,
      playerStartId,
      survivorIds,
      directorId,
      warnings,
      nextStep:
        args.role === "exit"
          ? "Pair this with write_changelevel in the same room; a checkpoint door alone does not change the chapter."
          : "The arrival changelevel (`write_changelevel` role: arrival) places the team at this room's landmark.",
    };
  },
});

// ---------------------------------------------------------------------------
// Changelevel
// ---------------------------------------------------------------------------

export const writeChangelevelTool = defineTool({
  name: "write_changelevel",
  description:
    "Writes a chapter transition as the pair the engine uses: an `info_changelevel` brush " +
    "volume with `map` and `landmark`, and an `info_landmark` point with that name. " +
    "`role: departure` writes the volume that leaves this map; `role: arrival` writes the " +
    "one at the start of this map with `spawnflags 2` (Disable Touch), `map` set to this " +
    "map and the landmark of the pair that arrived here. A `trigger_changelevel` variant " +
    "exists in the FGD but no stock L4D2 chapter uses it, so it is not written. The other " +
    "map's landmark with the same name is the mapper's job and is reported. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    role: z.enum(["departure", "arrival"]).default("departure"),
    map: z.string().describe("For departure, the next map's name; for arrival, this map's."),
    landmark: z.string().describe("The landmark name shared by both maps."),
    bounds: z.object({ mins: VEC3, maxs: VEC3 }),
    origin: VEC3.optional().describe("Landmark origin; defaults to the volume centre."),
    targetname: z.string().optional(),
    material: z
      .string()
      .default("TOOLS/TOOLSNODRAW")
      .describe("Material for the volume's faces; tool textures are invisible in game."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    changelevelId: z.number().nullable(),
    landmarkId: z.number().nullable(),
    solidIds: z.array(z.number()),
    keyvalues: z.record(z.string()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const role = args.role ?? "departure";
    const current = basename(path, extname(path));
    requireInside("volume mins", args.bounds.mins);
    requireInside("volume maxs", args.bounds.maxs);
    const map = (args.map ?? "").trim().replace(/\.bsp$/i, "");
    if (map.length === 0) throw new Error("give the map name the transition leads to");
    const landmark = (args.landmark ?? "").trim();
    if (landmark.length === 0) throw new Error("give the landmark name shared by both maps");
    if (role === "arrival" && map.toLowerCase() !== current.toLowerCase()) {
      // Stock L4D2 arrival changelevels name the map they are in, not the one they came
      // from: the pair is identified by the landmark.
      throw new Error(
        `an arrival changelevel in ${current} must name ${current}, not ${map}; the ` +
          `landmark identifies the pair`,
      );
    }
    if (role === "departure" && map.toLowerCase() === current.toLowerCase()) {
      throw new Error(
        `a departure changelevel must name the next map, not ${current}; use role: arrival ` +
          `for the volume that places a team arriving here`,
      );
    }
    const origin =
      args.origin ??
      ([
        (args.bounds.mins[0] + args.bounds.maxs[0]) / 2,
        (args.bounds.mins[1] + args.bounds.maxs[1]) / 2,
        (args.bounds.mins[2] + args.bounds.maxs[2]) / 2,
      ] as [number, number, number]);
    requireInside("landmark", origin);

    const keyvalues: Record<string, string> = {
      classname: "info_changelevel",
      map,
      landmark,
      targetname: args.targetname ?? `${current}_to_${map}`,
      ...(role === "arrival" ? { spawnflags: "2" } : {}),
    };
    const brush = await addBrushEntity(
      path,
      keyvalues,
      args.bounds,
      args.material ?? "TOOLS/TOOLSNODRAW",
      ctx,
    );
    const [landmarkId = null] = await addEntities(
      path,
      [{ classname: "info_landmark", targetname: landmark, origin: vec(origin) }],
      ctx,
    );
    verifyEntities(path, [landmarkId], ["info_landmark"]);

    const warnings = await fgdWarnings("info_changelevel", keyvalues, ctx);
    const nextMap = role === "departure" ? map : current;
    return {
      path,
      changelevelId: brush.id,
      landmarkId,
      solidIds: brush.solidIds,
      keyvalues,
      warnings,
      nextStep:
        args.role === "departure"
          ? `In ${nextMap}, add an info_landmark named ${landmark} and an arrival changelevel ` +
            `(role: arrival) with the same pair.`
          : `The departure side lives in the previous chapter with an info_landmark named ` +
            `${landmark}.`,
    };
  },
});

// ---------------------------------------------------------------------------
// Finale
// ---------------------------------------------------------------------------

const FINALE_TYPES = { standard: 0, gauntlet: 1, custom: 2, scavenge: 4 } as const;

export const writeFinaleSetupTool = defineTool({
  name: "write_finale_setup",
  description:
    "Writes the finale end of a campaign: a `trigger_finale` with the game's type numbers " +
    "(standard 0, gauntlet 1, custom 2, scavenge 4), its model, optional ScriptFile, and up " +
    "to four ordered `info_survivor_position`s for the escape. It encodes the defaults " +
    "stock maps use: a custom finale starts disabled until its script or button enables it, " +
    "scavenge is type 4, and a `VersusTravelCompletion` of 0.2. It does not write " +
    "`trigger_escape` -- no stock L4D2 map ships one; escaping is the finale's own state " +
    "machine and the nav FINALE areas. `check_finale` is the contract check. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    type: z.enum(["standard", "gauntlet", "custom", "scavenge"]),
    origin: VEC3,
    angles: VEC3.default([0, 0, 0]),
    model: z.string().optional().describe("Finale model; the FGD default is the radio."),
    scriptFile: z.string().optional().describe("Custom finale script name, without .nut."),
    startDisabled: z.boolean().optional().describe("Defaults to true for a custom finale."),
    versusTravelCompletion: z.number().min(0).max(1).default(0.2),
    isSacrificeFinale: z.boolean().default(false),
    targetname: z.string().default("trigger_finale"),
    escapePositions: z.array(SURVIVOR_POSITION).max(4).default([]),
    keyvalues: z.record(z.string()).default({}),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    finaleId: z.number().nullable(),
    escapeIds: z.array(z.number().nullable()),
    keyvalues: z.record(z.string()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    requireInside("finale origin", args.origin);
    const warnings: string[] = [];
    const existing = readEntities(readFileSync(path, "utf8")).entities;
    if (existing.some((e) => e.classname === "trigger_finale")) {
      throw new Error("this map already has a trigger_finale; a map ends once");
    }
    const typeNumber = FINALE_TYPES[args.type];
    const startDisabled =
      args.startDisabled ?? args.type === "custom";
    if (args.type === "custom" && !args.scriptFile) {
      throw new Error(
        "a custom finale needs scriptFile; without one the trigger starts nothing",
      );
    }
    if (args.type !== "custom" && args.scriptFile) {
      warnings.push(
        `${args.scriptFile} was given for a ${args.type} finale; ScriptFile is the custom type's key`,
      );
    }
    if (args.type === "standard") {
      warnings.push(
        "no stock L4D2 campaign uses the standard finale; gauntlet and custom are the " +
          "shipped shapes, and a standard trigger still needs a nav FINALE area",
      );
    }

    const keyvalues: Record<string, string> = {
      classname: "trigger_finale",
      origin: vec(args.origin),
      angles: vec(args.angles ?? [0, 0, 0]),
      targetname: args.targetname ?? "trigger_finale",
      type: String(typeNumber),
      VersusTravelCompletion: String(args.versusTravelCompletion ?? 0.2),
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.scriptFile !== undefined ? { ScriptFile: args.scriptFile } : {}),
      ...(startDisabled ? { StartDisabled: "1" } : {}),
      ...(args.isSacrificeFinale === true ? { IsSacrificeFinale: "1" } : {}),
      ...(args.keyvalues ?? {}),
    };
    warnings.push(...(await fgdWarnings("trigger_finale", keyvalues, ctx)));
    const [finaleId = null] = await addEntities(path, [keyvalues], ctx);
    verifyEntities(path, [finaleId], ["trigger_finale"]);

    const escapePositions = args.escapePositions ?? [];
    if (escapePositions.length > 0) {
      if (escapePositions.length !== 4) {
        warnings.push(
          `${escapePositions.length} escape positions: L4D2 has four survivors, so the ` +
            `escape expects four`,
        );
      }
      const escapeKeyvalues = escapePositions.map((position, index) => {
        requireInside("escape position", position.origin);
        return {
          classname: "info_survivor_position",
          origin: vec(position.origin),
          angles: vec(position.angles ?? [0, 0, 0]),
          Order: String(index + 1),
          targetname: position.targetname ?? `${args.targetname ?? "trigger_finale"}_escape_${index + 1}`,
        };
      });
      const escapeIds = await addEntities(path, escapeKeyvalues, ctx);
      verifyEntities(path, escapeIds, escapeKeyvalues.map(() => "info_survivor_position"));
      return {
        path,
        finaleId,
        escapeIds,
        keyvalues,
        warnings,
        nextStep:
          "Mark the finale and escape areas as FINALE nav (`func_nav_attribute_region`), then run check_finale.",
      };
    }

    warnings.push(
      "no escape positions: escape survivors are placed by the nav FINALE areas and the " +
        "finale's own state machine",
    );
    return {
      path,
      finaleId,
      escapeIds: [],
      keyvalues,
      warnings,
      nextStep:
        "Mark the finale and escape areas as FINALE nav, then run check_finale on the VMF " +
        "and again on the compiled BSP.",
    };
  },
});

// ---------------------------------------------------------------------------
// Map parameters
// ---------------------------------------------------------------------------

const DENSITY = {
  pistol: "PistolDensity",
  ammo: "AmmoDensity",
  painPills: "PainPillDensity",
  adrenaline: "AdrenalineDensity",
  defibrillator: "DefibrillatorDensity",
  molotov: "MolotovDensity",
  pipeBomb: "PipeBombDensity",
  vomitJar: "VomitJarDensity",
  meleeWeapon: "MeleeWeaponDensity",
  chainsaw: "ChainsawDensity",
  gasCan: "GasCanDensity",
  oxygenTank: "OxygenTankDensity",
  propaneTank: "PropaneTankDensity",
  upgradepack: "UpgradepackDensity",
  magnum: "MagnumDensity",
  configurableWeapon: "ConfigurableWeaponDensity",
  itemClusterRange: "ItemClusterRange",
  configurableWeaponClusterRange: "ConfigurableWeaponClusterRange",
  finaleItemClusterCount: "FinaleItemClusterCount",
} as const;

type DensityName = keyof typeof DENSITY;

const densityShape = Object.fromEntries(
  Object.keys(DENSITY).map((key) => [key, z.number().optional()]),
) as Record<DensityName, z.ZodOptional<z.ZodNumber>>;

export const writeMapParametersTool = defineTool({
  name: "write_map_parameters",
  description:
    "Writes `info_map_parameters` (or the versus variant) with the 18 item-density keys the " +
    "game reads, named the way a mapper says them: pistol, ammo, painPills, adrenaline, " +
    "defibrillator, molotov, pipeBomb, vomitJar, meleeWeapon, chainsaw, gasCan, oxygenTank, " +
    "propaneTank, upgradepack, magnum, configurableWeapon, itemClusterRange, " +
    "configurableWeaponClusterRange and finaleItemClusterCount. Values left out keep the " +
    "game default rather than being written as a number the mapper did not choose. " +
    "`-1` disables a weapon's density in L4D2. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    versus: z.boolean().default(false).describe("Write info_map_parameters_versus instead."),
    densities: z.object(densityShape).default({}),
    origin: VEC3.default([0, 0, 0]),
    targetname: z.string().optional(),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    entityId: z.number().nullable(),
    classname: z.string(),
    keyvalues: z.record(z.string()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const className = args.versus === true ? "info_map_parameters_versus" : "info_map_parameters";
    const origin = args.origin ?? [0, 0, 0];
    requireInside("origin", origin);
    const keyvalues: Record<string, string> = {
      classname: className,
      origin: vec(origin),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
    };
    const given = args.densities ?? {};
    const written: string[] = [];
    for (const [name, key] of Object.entries(DENSITY) as Array<[DensityName, string]>) {
      const value = given[name];
      if (value !== undefined) {
        keyvalues[key] = String(value);
        written.push(name);
      }
    }
    if (written.length === 0) {
      throw new Error(
        "give at least one density; an empty info_map_parameters is the same as no entity",
      );
    }
    const warnings = await fgdWarnings(className, keyvalues, ctx);
    const [id = null] = await addEntities(path, [keyvalues], ctx);
    verifyEntities(path, [id], [className]);
    return {
      path,
      entityId: id,
      classname: className,
      keyvalues,
      warnings,
      nextStep:
        "Density is a placement probability, not a count; check the result in a loaded map, " +
        "not in the entity lump.",
    };
  },
});

// ---------------------------------------------------------------------------
// Cross-map wiring check
// ---------------------------------------------------------------------------

interface WiringEntity {
  classname: string;
  targetname: string | null;
  keys: Record<string, string>;
  solidCount: number;
}

function readWiringEntities(path: string): WiringEntity[] {
  if (path.toLowerCase().endsWith(".bsp")) {
    return readEntityLump(path).entities.map((entity) => ({
      classname: entity.classname,
      targetname: entity.targetname ?? null,
      keys: Object.fromEntries(entity.keyvalues),
      solidCount: entity.solidCount,
    }));
  }
  return readEntities(readFileSync(path, "utf8")).entities.map((entity) => ({
    classname: entity.classname,
    targetname: entity.targetname,
    keys: { ...entity.keyvalues },
    solidCount: entity.solidCount,
  }));
}


function hasSpawnflag(value: string | undefined, flag: number): boolean {
  const n = Number(value ?? "0");
  return Number.isFinite(n) && (n & flag) !== 0;
}

const FINDING = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  chapter: z.string().optional(),
  map: z.string().optional(),
});

export const checkCampaignWiringTool = defineTool({
  name: "check_campaign_wiring",
  description:
    "Checks chapters against each other, which no single-map tool can. Give the maps in " +
    "chapter order (.vmf or .bsp) and it follows every transition: an outgoing " +
    "`info_changelevel` must name the next chapter, its landmark must exist in both maps, " +
    "the destination should carry the arrival changelevel with `spawnflags 2`, each map " +
    "needs `info_player_start`, and a chapter that ends in a safe room needs a " +
    "`prop_door_rotating_checkpoint` named `checkpoint_exit`/`checkpoint_entrance` (a suffix " +
    "is accepted with a warning). The last map needs a `trigger_finale` unless `mode` is " +
    "survival; scavenge needs type 4. Findings are errors, warnings and info, never a " +
    "refusal; `overall` says fail, warn or pass.",
  realm: "map",
  inputSchema: {
    maps: z
      .array(z.string())
      .min(1)
      .describe("Chapter maps in order, .vmf or .bsp, absolute or relative to the repo root."),
    mode: z.enum(["coop", "versus", "survival", "scavenge"]).default("coop"),
    names: z
      .array(z.string())
      .optional()
      .describe("Map names for comparison; defaults to each file's basename."),
    requireFinale: z.boolean().default(true).describe("Whether the last map must have a finale."),
  },
  outputSchema: {
    overall: z.enum(["pass", "warn", "fail"]),
    findings: z.array(FINDING),
    counts: z.object({ error: z.number(), warning: z.number(), info: z.number() }),
    chapters: z.array(
      z.object({
        map: z.string(),
        path: z.string(),
        source: z.enum(["vmf", "bsp"]),
        playerStarts: z.number(),
        director: z.boolean(),
        outgoing: z.string().nullable(),
        landmark: z.string().nullable(),
        checkpointDoors: z.array(z.string()),
        finaleType: z.string().nullable(),
      }),
    ),
  },
  handler: (args, ctx) => {
    const paths = args.maps.map((map) => {
      const path = resolveInput(map, ctx.config);
      const extension = extname(path).toLowerCase();
      if (extension !== ".vmf" && extension !== ".bsp") {
        throw new Error(`${path} is neither a .vmf nor a .bsp`);
      }
      return path;
    });
    const names =
      args.names ??
      paths.map((path) => basename(path, extname(path)));
    if (names.length !== paths.length) {
      throw new Error("names must have one entry per map");
    }
    const findings: Array<z.infer<typeof FINDING>> = [];
    const chapters: Array<{
      map: string;
      path: string;
      source: "vmf" | "bsp";
      playerStarts: number;
      director: boolean;
      outgoing: string | null;
      landmark: string | null;
      checkpointDoors: string[];
      finaleType: string | null;
    }> = [];
    const loaded = paths.map((path, index) => {
      if (!existsSync(path)) {
        findings.push({
          severity: "error",
          rule: "map-missing",
          message: `${path} does not exist`,
          chapter: names[index],
        });
        return null;
      }
      const entities = readWiringEntities(path);
      return { path, name: names[index]!, source: path.toLowerCase().endsWith(".bsp") ? ("bsp" as const) : ("vmf" as const), entities };
    });

    loaded.forEach((chapter, index) => {
      if (!chapter) return;
      const chapterName = chapter.name;
      const playerStarts = chapter.entities.filter((e) => e.classname === "info_player_start");
      const director = chapter.entities.some((e) => e.classname === "info_director");
      const doors = chapter.entities
        .filter((e) => e.classname === "prop_door_rotating_checkpoint")
        .map((e) => e.targetname ?? "");
      const finale = chapter.entities.find((e) => e.classname === "trigger_finale");
      const isLast = index === loaded.length - 1;

      if (playerStarts.length === 0) {
        findings.push({
          severity: "error",
          rule: "no-player-start",
          message: "no info_player_start: the team has nowhere to spawn",
          chapter: chapterName,
          map: chapter.name,
        });
      } else if (playerStarts.length > 1) {
        findings.push({
          severity: "info",
          rule: "several-player-starts",
          message: `${playerStarts.length} info_player_start entities; L4D2 spawns the team around one`,
          chapter: chapterName,
          map: chapter.name,
        });
      }
      if (!director) {
        findings.push({
          severity: "warning",
          rule: "no-director",
          message: "no info_director: no Director behaviour in this chapter",
          chapter: chapterName,
          map: chapter.name,
        });
      }

      let outgoing: string | null = null;
      let landmark: string | null = null;
      if (!isLast) {
        const nextName = names[index + 1]!;
        const changes = chapter.entities.filter(
          (e) => e.classname === "info_changelevel" || e.classname === "trigger_changelevel",
        );
        const match = changes.find(
          (e) => (e.keys["map"] ?? "").toLowerCase() === nextName.toLowerCase(),
        );
        const anyOutgoing = changes.find((e) => !hasSpawnflag(e.keys["spawnflags"], 2));
        outgoing = anyOutgoing?.keys["map"] ?? null;
        if (!match) {
          findings.push({
            severity: "error",
            rule: "transition-missing",
            message:
              anyOutgoing !== undefined
                ? `no changelevel leads to ${nextName}; this chapter leads to ${anyOutgoing.keys["map"] ?? "?"}`
                : `no changelevel leads to ${nextName}: this chapter cannot reach the next`,
            chapter: chapterName,
            map: chapter.name,
          });
        } else {
          landmark = match.keys["landmark"] ?? null;
          if (!landmark) {
            findings.push({
              severity: "error",
              rule: "transition-no-landmark",
              message: `the changelevel to ${nextName} has no landmark`,
              chapter: chapterName,
              map: chapter.name,
            });
          }
          if (match.solidCount === 0 && chapter.source === "vmf") {
            findings.push({
              severity: "error",
              rule: "transition-no-volume",
              message: "info_changelevel is a brush entity and has no solids",
              chapter: chapterName,
              map: chapter.name,
            });
          }
          if (hasSpawnflag(match.keys["spawnflags"], 2)) {
            findings.push({
              severity: "error",
              rule: "transition-disabled",
              message:
                "the changelevel to the next chapter has Disable Touch set; it is the " +
                "arrival volume, not the departure",
              chapter: chapterName,
              map: chapter.name,
            });
          }
          const next = loaded[index + 1];
          if (next && landmark) {
            const there = next.entities.filter(
              (e) => e.classname === "info_landmark" && e.targetname === landmark,
            );
            if (there.length === 0) {
              findings.push({
                severity: "error",
                rule: "landmark-missing",
                message: `${next.name} has no info_landmark named ${landmark}`,
                chapter: names[index + 1],
                map: next.name,
              });
            }
            const arrival = next.entities.find(
              (e) =>
                e.classname === "info_changelevel" &&
                hasSpawnflag(e.keys["spawnflags"], 2) &&
                (e.keys["landmark"] ?? "") === landmark,
            );
            if (!arrival) {
              findings.push({
                severity: "warning",
                rule: "arrival-missing",
                message:
                  `${next.name} has no arrival info_changelevel for ${landmark} ` +
                  `(spawnflags 2); stock chapters carry one so the team is placed at the landmark`,
                chapter: names[index + 1],
                map: next.name,
              });
            }
          }
        }
      }

      if (!isLast) {
        const exitDoor = doors.find((name) => name.toLowerCase().startsWith("checkpoint_exit"));
        if (!exitDoor) {
          findings.push({
            severity: isLast ? "info" : "warning",
            rule: "checkpoint-exit-missing",
            message:
              doors.length > 0
                ? `no checkpoint_exit door; this room has ${doors.join(", ") || "an unnamed door"}`
                : "no checkpoint_exit door; a safe room exit is looked up by that name",
            chapter: chapterName,
            map: chapter.name,
          });
        } else if (exitDoor !== "checkpoint_exit") {
          findings.push({
            severity: "warning",
            rule: "checkpoint-exit-name",
            message: `the exit door is named ${exitDoor}; the engine looks up checkpoint_exit`,
            chapter: chapterName,
            map: chapter.name,
          });
        }
      }
      if (index > 0) {
        const entranceDoor = doors.find((name) =>
          name.toLowerCase().startsWith("checkpoint_entrance"),
        );
        if (!entranceDoor) {
          findings.push({
            severity: "warning",
            rule: "checkpoint-entrance-missing",
            message: "no checkpoint_entrance door at the start of this chapter",
            chapter: chapterName,
            map: chapter.name,
          });
        } else if (entranceDoor !== "checkpoint_entrance") {
          findings.push({
            severity: "warning",
            rule: "checkpoint-entrance-name",
            message: `the entrance door is named ${entranceDoor}; the engine looks up checkpoint_entrance`,
            chapter: chapterName,
            map: chapter.name,
          });
        }
      }

      if (isLast && args.requireFinale !== false && args.mode !== "survival") {
        if (!finale) {
          findings.push({
            severity: "error",
            rule: "finale-missing",
            message: `the last chapter (${args.mode}) has no trigger_finale`,
            chapter: chapterName,
            map: chapter.name,
          });
        } else {
          const type = finale.keys["type"] ?? "0";
          if (args.mode === "scavenge" && type !== "4") {
            findings.push({
              severity: "error",
              rule: "scavenge-finale-type",
              message: `scavenge needs trigger_finale type 4; this one is ${type}`,
              chapter: chapterName,
              map: chapter.name,
            });
          }
          if (args.mode !== "scavenge" && type === "4") {
            findings.push({
              severity: "warning",
              rule: "scavenge-finale-in-coop",
              message: `${args.mode} chapter has a scavenge (type 4) finale`,
              chapter: chapterName,
              map: chapter.name,
            });
          }
          if (type === "2" && !finale.keys["ScriptFile"]) {
            findings.push({
              severity: "info",
              rule: "custom-finale-no-script",
              message:
                "custom finale has no ScriptFile key; the engine may fall back to a " +
                "map-named finale script, so check_finale is the contract check",
              chapter: chapterName,
              map: chapter.name,
            });
          }
        }
      }

      chapters.push({
        map: chapter.name,
        path: chapter.path,
        source: chapter.source,
        playerStarts: playerStarts.length,
        director,
        outgoing,
        landmark,
        checkpointDoors: doors,
        finaleType: finale?.keys["type"] ?? null,
      });
    });

    const counts = {
      error: findings.filter((f) => f.severity === "error").length,
      warning: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
    };
    return {
      overall: counts.error > 0 ? ("fail" as const) : counts.warning > 0 ? ("warn" as const) : ("pass" as const),
      findings,
      counts,
      chapters,
    };
  },
});

export const campaignBuildTools = [
  writeSpawnPointsTool,
  writeSafeRoomTool,
  writeChangelevelTool,
  writeFinaleSetupTool,
  writeMapParametersTool,
  checkCampaignWiringTool,
];
