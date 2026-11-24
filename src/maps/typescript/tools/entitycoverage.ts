/**
 * Official entity-class coverage: what the stock maps use, grouped by family, with what this
 * project can say about each family.
 *
 * The inventory is read from the compiled BSPs, not typed from memory. The family rules are
 * ordered: a class is assigned to the first rule that matches, so specific families come
 * before the broad `info_`/`prop_` catch-alls. Anything unmatched is reported as
 * `unclassified` rather than silently bucketed, so a new class in a future update shows up.
 *
 * Status is deliberately conservative:
 * - `covered`: a tool writes or checks the family and the skill has a page;
 * - `partial`: a tool exists but a live half or a page is missing;
 * - `documented`: the skill explains the class but no dedicated tool exists;
 * - `none`: neither.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { readEntityLump } from "../bsp/entities.js";

export type CoverageStatus = "covered" | "partial" | "documented" | "none";

export interface EntityFamilyRule {
  name: string;
  test: RegExp;
  status: CoverageStatus;
  tools: string[];
  page: string;
  note: string;
}

/** Ordered: first match wins. */
export const ENTITY_FAMILIES: readonly EntityFamilyRule[] = [
  {
    name: "Weapons and item spawners",
    test: /^(weapon_.*_spawn|weapon_spawn|upgrade_spawn)$/,
    status: "covered",
    tools: ["write_item_spawns", "read_item_density", "write_map_parameters"],
    page: "references/mechanics/weapons-and-items.md",
    note: "spawners, density and the saferoom row; the Director's choice is a live test",
  },
  {
    name: "Health cabinets and rescue stock",
    test: /^(prop_health_cabinet)$/,
    status: "covered",
    tools: ["write_saferoom_stock", "place_entity_group"],
    page: "references/mechanics/weapons-and-items.md",
    note: "the cabinet is a model prop plus a use target",
  },
  {
    name: "Breakable brushes and props",
    test: /^(func_breakable|func_breakable_surf|func_physbox|prop_wall_breakable|prop_car_glass|prop_car_alarm|prop_fuel_barrel)$/,
    status: "covered",
    tools: ["write_breakable", "write_point_entity"],
    page: "references/mechanics/coverage.md",
    note: "class and keys checked; the break reaction is verified in game",
  },
  {
    name: "Ladders",
    test: /^(func_simpleladder|func_ladder)$/,
    status: "covered",
    tools: ["read_nav_ladders", "write_nav_ladders"],
    page: "references/mechanics/ai-and-nav-content.md",
    note: "the ladder record in the .nav is edited in place; brush placement is a VMF edit",
  },
  {
    name: "Doors, buttons and movement",
    test: /^(prop_door_rotating|prop_door_rotating_checkpoint|func_door|func_door_rotating|func_button|func_button_timed|momentary_rot_button|func_rot_button|func_rotating|func_movelinear|func_platrot|func_elevator|info_elevator_floor|func_tracktrain|path_track|path_corner|func_block_charge|func_extinguisher)$/,
    status: "partial",
    tools: ["place_door", "write_safe_room", "write_changelevel"],
    page: "references/mechanics/campaign-wiring.md",
    note: "doors and the checkpoint door are covered; trains and complex moving platforms are not",
  },
  {
    name: "Brush and clip volumes",
    test: /^(func_brush|func_illusionary|func_detail_blocker|func_lod|func_occluder|func_clip_vphysics|func_playerinfected_clip|func_nav_blocker|func_nav_avoidance_obstacle|func_nav_connection_blocker|func_nav_attribute_region|env_player_blocker|func_areaportal|func_areaportalwindow|func_ragdoll_fader|func_timescale|trigger_playermovement|trigger_auto_crouch|trigger_look|trigger_remove|trigger_changelevel|trigger_escape)$/,
    status: "covered",
    tools: ["write_vmf_solid", "clip_solids", "check_ai_contract"],
    page: "references/mechanics/ai-and-nav-content.md",
    note: "solids and nav blockers; vbsp resolves the areaportal pair",
  },
  {
    name: "Props and physics",
    test: /^(prop_physics|prop_physics_multiplayer|prop_physics_override|prop_dynamic|prop_dynamic_override|prop_ragdoll|prop_car_glass|prop_car_alarm|prop_fuel_barrel|prop_minigun|prop_minigun_l4d1|prop_mounted_machine_gun)$/,
    status: "covered",
    tools: ["write_prop", "read_static_props", "read_model_info"],
    page: "references/mapping/model-facing.md",
    note: "static/dynamic/physics class and `solid` are checked; facing is a measured cache",
  },
  {
    name: "Lighting and decals",
    test: /^(light|light_spot|light_environment|light_directional|shadow_control|env_sun|env_lightglow|beam_spotlight|point_spotlight|env_sprite|sky_camera|infodecal|info_projecteddecal)$/,
    status: "covered",
    tools: ["write_light", "write_env_sun", "read_vmf_lint"],
    page: "references/mapping/lighting.md",
    note: "entity keys and placement; the baked result is a compile/render check",
  },
  {
    name: "Atmosphere, weather and sound",
    test: /^(env_fog_controller|fog_volume|color_correction|color_correction_volume|postprocess_controller|env_tonemap_controller.*|env_wind|env_steam|env_fire|env_spark|env_smokestack|env_smoketrail|env_explosion|env_physexplosion|env_physimpact|env_shake|env_fade|env_weaponfire|env_shooter|env_rock_launcher|env_airstrike_indoors|func_precipitation|func_precipitation_blocker|water_lod_control|env_detail_controller|sound_mix_layer|ambient_generic|ambient_music|env_soundscape.*|env_microphone|func_orator|ai_speechfilter|logic_choreographed_scene|logic_scene_list_manager)$/,
    status: "partial",
    tools: ["write_weather", "write_atmosphere", "read_soundscape"],
    page: "references/mapping/atmosphere.md",
    note: "weather/fog/tonemap are covered; scene and speech choreography are documented only",
  },
  {
    name: "Particles",
    test: /^(info_particle_system|info_particle_target)$/,
    status: "covered",
    tools: ["read_particle", "write_particle", "write_point_entity"],
    page: "references/mechanics/coverage.md",
    note: "PCF read/write and a stock system rendered in game",
  },
  {
    name: "Logic, math and filters",
    test: /^(logic_.*|math_.*|filter_.*|point_template|env_entity_maker|game_gib_manager|game_scavenge_progress_display)$/,
    status: "covered",
    tools: ["write_logic", "write_random_case", "write_template_spawner", "check_entity_wiring"],
    page: "references/mapping/variability.md",
    note: "logic_case/template patterns; arbitrary graphs are read and checked",
  },
  {
    name: "Triggers",
    test: /^(trigger_.*|point_hurt)$/,
    status: "partial",
    tools: ["write_trigger", "read_vmf_lint"],
    page: "references/mechanics/crescendo-and-panic.md",
    note: "panic and finale triggers are covered; a few legacy triggers are read-only",
  },
  {
    name: "Campaign, nav and mode entities",
    test: /^(info_player_start|info_l4d1_survivor_spawn|info_landmark|info_changelevel|info_director|info_gamemode|info_map_parameters.*|info_goal_infected_chase|info_zombie_spawn|info_zombie_border|info_ambient_mob.*|info_survivor_rescue|info_survivor_position|info_remarkable|info_item_position|info_game_event_proxy)$/,
    status: "covered",
    tools: [
      "write_spawn_points",
      "write_rescue_closet",
      "write_map_parameters",
      "check_gamemode_contract",
      "check_ai_contract",
    ],
    page: "references/mechanics/ai-and-nav-content.md",
    note: "the campaign/nav/mode halves are checked offline; the round is a live test",
  },
  {
    name: "Cameras and view control",
    test: /^(point_viewcontrol.*|point_deathfall_camera)$/,
    status: "documented",
    tools: [],
    page: "references/mapping/entity-families.md",
    note: "the class is documented; no writer or checker",
  },
  {
    name: "Ropes and physics constraints",
    test: /^(keyframe_rope|move_rope|phys_hinge|phys_ballsocket|phys_ragdollconstraint|phys_ragdollmagnet|phys_constraintsystem|phys_convert)$/,
    status: "documented",
    tools: ["write_prop"],
    page: "references/mapping/entity-families.md",
    note: "the prop is written; the constraint graph is read from the map, not authored",
  },
  {
    name: "Scripts, commands and overlays",
    test: /^(logic_script|point_servercommand|point_clientcommand|point_broadcastclientcommand|env_instructor_hint|commentary_zombie_spawner|player_weaponstrip|info_overlay_accessor|info_target|env_outtro_stats|trigger_active_weapon_detect|trigger_upgrade_laser_sight|worldspawn)$/,
    status: "partial",
    tools: ["write_vscript", "read_vscript", "check_vscript_contract", "write_entity_probe"],
    page: "references/scripting/vscript.md",
    note: "VScript is covered; a few command/overlay classes are read-only",
  },
  {
    name: "Use targets",
    test: /^(point_prop_use_target|point_script_use_target)$/,
    status: "covered",
    tools: ["place_entity_group", "read_official_prefab"],
    page: "references/mapping/prefabs-and-instances.md",
    note: "ammo/health cabinets and the gascan button; player +use is a live test",
  },
];

export interface EntityCoverage {
  mapsScanned: number;
  classes: number;
  families: Array<{
    name: string;
    status: CoverageStatus;
    tools: string[];
    page: string;
    note: string;
    classes: number;
    entities: number;
    examples: Array<{ classname: string; entities: number }>;
  }>;
  unclassified: Array<{ classname: string; entities: number }>;
  coverage: Record<CoverageStatus, number>;
  note: string;
}

function officialMaps(gameDir: string): string[] {
  const root = dirname(gameDir);
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("left4dead2")) continue;
    const maps = join(root, entry.name, "maps");
    if (!existsSync(maps)) continue;
    for (const file of readdirSync(maps)) {
      if (file.toLowerCase().endsWith(".bsp")) files.push(join(maps, file));
    }
  }
  return files;
}

export function readEntityCoverage(options: { maps?: string[]; examples?: number } = {}): EntityCoverage {
  const files = options.maps ?? [];
  const counts = new Map<string, number>();
  let scanned = 0;
  for (const path of files) {
    try {
      const entities = readEntityLump(path).entities;
      scanned += 1;
      for (const entity of entities) {
        counts.set(entity.classname, (counts.get(entity.classname) ?? 0) + 1);
      }
    } catch {
      // A BSP that another game wrote is skipped, not fatal: the inventory is still useful.
    }
  }

  const families = ENTITY_FAMILIES.map((rule) => ({
    ...rule,
    classEntries: [] as Array<[string, number]>,
  }));
  const unclassified: Array<[string, number]> = [];
  for (const [classname, entities] of counts) {
    const family = families.find((rule) => rule.test.test(classname));
    if (family) family.classEntries.push([classname, entities]);
    else unclassified.push([classname, entities]);
  }

  const examples = options.examples ?? 6;
  return {
    mapsScanned: scanned,
    classes: counts.size,
    families: families
      .filter((family) => family.classEntries.length > 0)
      .map((family) => ({
        name: family.name,
        status: family.status,
        tools: family.tools,
        page: family.page,
        note: family.note,
        classes: family.classEntries.length,
        entities: family.classEntries.reduce((sum, [, n]) => sum + n, 0),
        examples: family.classEntries
          .sort((a, b) => b[1] - a[1])
          .slice(0, examples)
          .map(([classname, entities]) => ({ classname, entities })),
      })),
    unclassified: unclassified
      .sort((a, b) => b[1] - a[1])
      .map(([classname, entities]) => ({ classname, entities })),
    coverage: {
      covered: families.filter((f) => f.status === "covered").length,
      partial: families.filter((f) => f.status === "partial").length,
      documented: families.filter((f) => f.status === "documented").length,
      none: families.filter((f) => f.status === "none").length,
    },
    note:
      "Counts are class occurrences across the scanned BSPs, not unique maps. A family " +
      "status is the project's own coverage claim; `unclassified` is the list a future " +
      "content update should empty.",
  };
}

export const readEntityCoverageTool = defineTool({
  name: "read_entity_coverage",
  description:
    "Builds the official entity-class inventory from compiled BSPs and groups every class " +
    "into a family with a coverage status (`covered`, `partial`, `documented`, `none`), the " +
    "tools and skill page for it, and any class no rule matched. Defaults to every " +
    "`left4dead2*/maps` beside the configured game; `maps` overrides. Read-only, no launch.",
  realm: "map",
  inputSchema: {
    maps: z
      .array(z.string())
      .optional()
      .describe("Explicit BSPs. Default: all official `left4dead2*/maps/*.bsp`."),
    examples: z.number().int().min(1).max(50).default(6),
  },
  outputSchema: {
    mapsScanned: z.number(),
    classes: z.number(),
    families: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["covered", "partial", "documented", "none"]),
        tools: z.array(z.string()),
        page: z.string(),
        note: z.string(),
        classes: z.number(),
        entities: z.number(),
        examples: z.array(z.object({ classname: z.string(), entities: z.number() })),
      }),
    ),
    unclassified: z.array(z.object({ classname: z.string(), entities: z.number() })),
    coverage: z.record(z.number()),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const gameDir = ctx.config.gameDir;
    if (!gameDir) throw new Error("the game directory is not resolved; run health first");
    const maps =
      args.maps?.map((path) => (path.match(/^[a-zA-Z]:|^\//) ? path : join(gameDir, path))) ??
      officialMaps(gameDir);
    if (maps.length === 0) throw new Error("no official BSPs were found beside the game");
    return readEntityCoverage({ maps, examples: args.examples }) as unknown as Record<string, unknown>;
  },
});

export const entityCoverageTools = [readEntityCoverageTool];
