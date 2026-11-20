/**
 * Campaign gameplay entities: item spawners, a saferoom stock row, an intro camera, a rescue
 * point and an infected border. Each is a shortcut over the point-entity primitive; the
 * classname stays a string when the enum does not cover a new spawner.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import type { ToolContext } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import {
  addEntities,
  addOutputs,
  fgdWarnings,
  verifyEntities,
} from "../../../maps/typescript/tools/entityfamilies.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);
const vec = (v: readonly number[]): string =>
  v.map((n) => String(Math.round(n * 1000) / 1000)).join(" ");

const OUTPUT = z.object({
  output: z.string(),
  target: z.string(),
  input: z.string(),
  parameter: z.string().default(""),
  delay: z.number().nonnegative().default(0),
  times: z.number().int().default(-1),
});
type OutputSpec = z.infer<typeof OUTPUT>;

const ITEMS = {
  rifle: "weapon_rifle_spawn",
  smg: "weapon_smg_spawn",
  pumpshotgun: "weapon_pumpshotgun_spawn",
  autoshotgun: "weapon_autoshotgun_spawn",
  shotgun_chrome: "weapon_shotgun_chrome_spawn",
  shotgun_spas: "weapon_shotgun_spas_spawn",
  sniper_military: "weapon_sniper_military_spawn",
  sniper_scout: "weapon_sniper_scout_spawn",
  sniper_awp: "weapon_sniper_awp_spawn",
  hunting_rifle: "weapon_hunting_rifle_spawn",
  pistol: "weapon_pistol_spawn",
  magnum: "weapon_pistol_magnum_spawn",
  melee: "weapon_melee_spawn",
  chainsaw: "weapon_chainsaw_spawn",
  grenade_launcher: "weapon_grenade_launcher_spawn",
  m60: "weapon_rifle_m60_spawn",
  ammo: "weapon_ammo_spawn",
  medkit: "weapon_first_aid_kit_spawn",
  pills: "weapon_pain_pills_spawn",
  adrenaline: "weapon_adrenaline_spawn",
  defib: "weapon_defibrillator_spawn",
  molotov: "weapon_molotov_spawn",
  pipe_bomb: "weapon_pipe_bomb_spawn",
  vomitjar: "weapon_vomitjar_spawn",
  upgradepack_incendiary: "weapon_upgradepack_incendiary_spawn",
  upgradepack_explosive: "weapon_upgradepack_explosive_spawn",
  gascan: "weapon_gascan_spawn",
  scavenge_item: "weapon_scavenge_item_spawn",
} as const;

export const writeItemSpawnsTool = defineTool({
  name: "write_item_spawns",
  description:
    "Places item/weapon spawners at points: the L4D2 `weapon_*_spawn` classes, with an " +
    "optional `count`, skin or classname override for a spawner the enum does not list. A " +
    "spawner is a point entity; the Director decides whether it spawns. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z.enum(Object.keys(ITEMS) as [keyof typeof ITEMS, ...Array<keyof typeof ITEMS>]),
    placements: z
      .array(
        z.object({
          origin: VEC3,
          angles: VEC3.default([0, 0, 0]),
          count: z.number().int().min(0).optional(),
          skin: z.number().int().min(0).optional(),
          targetname: z.string().optional(),
        }),
      )
      .min(1)
      .max(128),
    classname: z.string().optional().describe("Override the spawner class."),
    keyvalues: z.record(z.string()).default({}),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    classname: z.string(),
    ids: z.array(z.number().nullable()),
    count: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const classname = args.classname ?? ITEMS[args.kind];
    for (const placement of args.placements) {
      if (!placement.origin.every((n) => Math.abs(n) <= 16384)) {
        throw new Error(`item origin ${vec(placement.origin)} leaves Source's world`);
      }
    }
    const keyvalues = args.placements.map((placement) => ({
      classname,
      origin: vec(placement.origin),
      angles: vec(placement.angles ?? [0, 0, 0]),
      ...(placement.count !== undefined ? { count: String(placement.count) } : {}),
      ...(placement.skin !== undefined ? { skin: String(placement.skin) } : {}),
      ...(placement.targetname !== undefined ? { targetname: placement.targetname } : {}),
      ...(args.keyvalues ?? {}),
    }));
    const warnings = await fgdWarnings(classname, keyvalues[0]!, ctx);
    const ids = await addEntities(path, keyvalues, ctx);
    verifyEntities(path, ids, keyvalues.map(() => classname));
    return {
      path,
      classname,
      ids,
      count: ids.length,
      warnings,
      nextStep:
        "Compile and load. Item density is set by info_map_parameters; a spawner is a " +
        "candidate, not a guaranteed item.",
    };
  },
});

export const writeSaferoomStockTool = defineTool({
  name: "write_saferoom_stock",
  description:
    "Places a row of saferoom stock at an origin: medkit, pills, ammo and pistols by default, " +
    "or a chosen list. It is a shortcut over `write_item_spawns`; positions are 48 units " +
    "apart on X and can be moved after. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    origin: VEC3,
    angles: VEC3.default([0, 0, 0]),
    items: z
      .array(z.enum(["medkit", "pills", "ammo", "pistol", "adrenaline", "defib", "molotov", "pipe_bomb"]))
      .default(["medkit", "pills", "ammo", "pistol"]),
    spacing: z.number().positive().default(48),
    targetname: z
      .string()
      .optional()
      .describe(
        "Prefix for each item's targetname, with the item kind appended (`<prefix>_medkit`). " +
          "A targetname is what makes the entity probeable at runtime.",
      ),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    ids: z.array(z.number().nullable()),
    count: z.number(),
    classes: z.array(z.string()),
    targetnames: z.array(z.string().nullable()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const items = args.items ?? ["medkit", "pills", "ammo", "pistol"];
    const origin = args.origin;
    if (!origin.every((n) => Math.abs(n) <= 16384)) throw new Error("the stock origin leaves Source's world");
    const keyvalues = items.map((item, index) => ({
      classname: ITEMS[item],
      origin: vec([origin[0] + index * (args.spacing ?? 48), origin[1], origin[2]]),
      angles: vec(args.angles ?? [0, 0, 0]),
      ...(args.targetname !== undefined
        ? { targetname: `${args.targetname}_${item}` }
        : {}),
    }));
    const warnings: string[] = [];
    for (const kv of keyvalues) warnings.push(...(await fgdWarnings(kv.classname, kv, ctx)));
    const ids = await addEntities(path, keyvalues, ctx);
    verifyEntities(path, ids, keyvalues.map((kv) => kv.classname));
    return {
      path,
      ids,
      count: ids.length,
      classes: keyvalues.map((kv) => kv.classname),
      targetnames: keyvalues.map((kv) => kv.targetname ?? null),
      warnings,
      nextStep: "Move any item that landed in a wall; the row is a starting layout, not a rule.",
    };
  },
});

export const writeIntroCameraTool = defineTool({
  name: "write_intro_camera",
  description:
    "Writes a `point_viewcontrol` and a `logic_auto` that enables it OnMapSpawn, optionally " +
    "disabling it after `holdSeconds` through a `logic_timer`. This is the scripted intro " +
    "camera; the player is frozen while it is enabled. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    origin: VEC3,
    angles: VEC3.default([0, 0, 0]),
    targetname: z.string().default("intro_camera"),
    fov: z.number().min(1).max(179).default(90),
    holdSeconds: z.number().positive().optional().describe("Disable after this many seconds."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    cameraId: z.number().nullable(),
    logicAutoId: z.number().nullable(),
    timerId: z.number().nullable(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const name = args.targetname ?? "intro_camera";
    const camera = {
      classname: "point_viewcontrol",
      targetname: name,
      origin: vec(args.origin),
      angles: vec(args.angles ?? [0, 0, 0]),
      fov: String(args.fov ?? 90),
    };
    const warnings = await fgdWarnings("point_viewcontrol", camera, ctx);
    const [cameraId = null] = await addEntities(path, [camera], ctx);
    verifyEntities(path, [cameraId], ["point_viewcontrol"]);
    const outputs: OutputSpec[] = [
      { output: "OnMapSpawn", target: name, input: "Enable", parameter: "", delay: 0, times: -1 },
    ];
    if (args.holdSeconds !== undefined) {
      outputs.push({
        output: "OnMapSpawn",
        target: `${name}_timer`,
        input: "Enable",
        parameter: "",
        delay: 0,
        times: -1,
      });
    }
    const [logicAutoId = null] = await addEntities(
      path,
      [{ classname: "logic_auto", targetname: `${name}_auto`, origin: vec(args.origin) }],
      ctx,
    );
    verifyEntities(path, [logicAutoId], ["logic_auto"]);
    await addOutputs(path, logicAutoId!, outputs, ctx);
    let timerId: number | null = null;
    if (args.holdSeconds !== undefined) {
      const [id = null] = await addEntities(
        path,
        [
          {
            classname: "logic_timer",
            targetname: `${name}_timer`,
            origin: vec(args.origin),
            RefireTime: String(args.holdSeconds),
            StartDisabled: "0",
          },
        ],
        ctx,
      );
      verifyEntities(path, [id], ["logic_timer"]);
      await addOutputs(
        path,
        id!,
        [{ output: "OnTimer", target: name, input: "Disable", parameter: "", delay: 0, times: 1 }],
        ctx,
      );
      timerId = id;
    }
    return {
      path,
      cameraId,
      logicAutoId,
      timerId,
      warnings,
      nextStep:
        "Compile and load. The camera freezes the player; check its position in the first frame.",
    };
  },
});

export const writeRescueTool = defineTool({
  name: "write_rescue_closet",
  description:
    "Writes an `info_survivor_rescue` point, plus optional ordered survivor positions for the " +
    "rescue closet. Nav still has to mark the area; this is the entity half. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    origin: VEC3,
    angles: VEC3.default([0, 0, 0]),
    model: z.string().default("models/editor/playerstart.mdl"),
    targetname: z.string().optional(),
    survivorPositions: z.array(VEC3).max(4).default([]),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    rescueId: z.number().nullable(),
    positionIds: z.array(z.number().nullable()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!args.origin.every((n) => Math.abs(n) <= 16384)) throw new Error("the rescue origin leaves Source's world");
    const warnings: string[] = [];
    const [rescueId = null] = await addEntities(
      path,
      [
        {
          classname: "info_survivor_rescue",
          origin: vec(args.origin),
          angles: vec(args.angles ?? [0, 0, 0]),
          model: args.model ?? "models/editor/playerstart.mdl",
          ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
        },
      ],
      ctx,
    );
    verifyEntities(path, [rescueId], ["info_survivor_rescue"]);
    const positions = args.survivorPositions ?? [];
    const positionIds = positions.length
      ? await addEntities(
          path,
          positions.map((position, index) => ({
            classname: "info_survivor_position",
            origin: vec(position),
            Order: String(index + 1),
            targetname: `${args.targetname ?? "rescue"}_pos_${index + 1}`,
          })),
          ctx,
        )
      : [];
    if (positionIds.length) verifyEntities(path, positionIds, positionIds.map(() => "info_survivor_position"));
    return {
      path,
      rescueId,
      positionIds,
      warnings,
      nextStep: "Mark the closet area as RESCUE on the nav mesh; the entity alone does not.",
    };
  },
});

export const writeZombieBorderTool = defineTool({
  name: "write_zombie_border",
  description:
    "Writes an `info_zombie_border` point, the marker that tells the Director where infected " +
    "spawning stops. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    origin: VEC3,
    angles: VEC3.default([0, 0, 0]),
    targetname: z.string().optional(),
    startDisabled: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    entityId: z.number().nullable(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!args.origin.every((n) => Math.abs(n) <= 16384)) throw new Error("the border leaves Source's world");
    const kv = {
      classname: "info_zombie_border",
      origin: vec(args.origin),
      angles: vec(args.angles ?? [0, 0, 0]),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      ...(args.startDisabled === true ? { StartDisabled: "1" } : {}),
    };
    const warnings = await fgdWarnings("info_zombie_border", kv, ctx);
    const [id = null] = await addEntities(path, [kv], ctx);
    verifyEntities(path, [id], ["info_zombie_border"]);
    return {
      path,
      entityId: id,
      warnings,
      nextStep: "Compile and load; the Director uses the border with the map's nav mesh.",
    };
  },
});

export const gameplayTools = [
  writeItemSpawnsTool,
  writeSaferoomStockTool,
  writeIntroCameraTool,
  writeRescueTool,
  writeZombieBorderTool,
];
