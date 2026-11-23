/**
 * `write_test_bench`: a sealed hall that can host a runtime test.
 *
 * Every play test needs a host, and the fixtures (`hmcp_probe`, `hmcp_backyard`) are not
 * hosts: they have no flow, no player start and no goal, so the Director spawns nothing and a
 * probe proves nothing. This builds the opposite: a sealed multi-bay hall with a spawn, a
 * Director, spawn points, lights and a FINALE end with its `trigger_finale`.
 *
 * The end is **FINALE, never a bare CHECKPOINT region**: a CHECKPOINT attribute with no
 * checkpoint door and no `info_changelevel` makes the engine count "Missing Checkpoint" on
 * every other area and show `NAV ERRORS — Map is unplayable!` over a map that plays
 * (`troubleshooting/nav-unplayable.md`).
 *
 * The pieces are the existing writers: `write_vmf` makes the skeleton, `write_vmf_solid` the
 * brushes (it verifies each one), `addEntities` the entities and `addBrushEntity` the nav
 * region. Nothing here re-implements a brush or a keyvalue.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { writeVmfSolidTool } from "./build.js";
import { addBrushEntity, addEntities, verifyEntities } from "./entityfamilies.js";
import { writeVmf } from "./vmfedit.js";

export const writeTestBenchTool = defineTool({
  name: "write_test_bench",
  description:
    "Builds a sealed, playable bench map from one call: a hall of N bays divided by walled " +
    "arches, `info_player_start`, `info_director`, `info_zombie_spawn`, a light per bay, and a " +
    "FINALE nav region with a `trigger_finale` so the Director has a goal and the engine does " +
    "not paint `NAV ERRORS` over the map. It writes a `.vmf` (never overwrites), then compile, " +
    "`run_nav_generate`, `nav_trouble_report` (expected: finale) and `run_map_test` make it a " +
    "runtime host. A CHECKPOINT region is deliberately not used: without a checkpoint door it " +
    "makes the map unplayable on screen while it still loads. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Where to create the .vmf; it must not exist yet."),
    width: z.number().int().min(512).max(8192).default(2048).describe("X size, units."),
    length: z.number().int().min(1024).max(16384).default(4608).describe("Y size, units."),
    height: z.number().int().min(192).max(1024).default(320).describe("Z size, units."),
    bays: z.number().int().min(1).max(8).default(4).describe("Rooms separated by arches."),
    archWidth: z
      .number()
      .int()
      .min(128)
      .max(2048)
      .default(256)
      .describe("Opening in each divider wall, centred on X."),
    material: z.string().default("BRICK/BRICK_EXT_01"),
    skyname: z.string().default("sky_l4d_c1_1"),
    targetname: z.string().default("bench_finale"),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    width: z.number(),
    length: z.number(),
    height: z.number(),
    bays: z.number(),
    solidCount: z.number(),
    entities: z.object({
      playerStart: z.number().nullable(),
      director: z.number().nullable(),
      zombieSpawn: z.number().nullable(),
      finale: z.number().nullable(),
      lights: z.array(z.number().nullable()),
    }),
    finaleRegion: z.object({ id: z.number().nullable(), solidIds: z.array(z.number()) }),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    // Zod defaults apply at the MCP boundary; a direct handler call (a test, another tool)
    // passes only what it means, so every option is normalised here as well.
    const width = args.width ?? 2048;
    const length = args.length ?? 4608;
    const height = args.height ?? 320;
    const bays = args.bays ?? 4;
    const archWidth = args.archWidth ?? 256;
    const material = args.material ?? "BRICK/BRICK_EXT_01";
    const skyname = args.skyname ?? "sky_l4d_c1_1";
    const targetname = args.targetname ?? "bench_finale";
    for (const [name, value] of [
      ["width", width],
      ["length", length],
      ["height", height],
      ["archWidth", archWidth],
    ] as const) {
      if (value % 16 !== 0) {
        throw new Error(`${name} must be a multiple of 16, got ${value}`);
      }
    }
    if (archWidth > width - 256) {
      throw new Error(
        `archWidth ${archWidth} leaves no wall in a ${width}-wide hall; ` +
          "keep at least 128 units of wall on each side",
      );
    }

    await writeVmf.handler(
      { path, skyname, confirm: true } as never,
      ctx as never,
    );

    const halfWidth = width / 2;
    const x0 = -halfWidth;
    const x1 = halfWidth;
    const y0 = 0;
    const y1 = length;
    const h = height;
    const thickness = 32;
    const arch = archWidth / 2;

    const box = (mins: readonly number[], maxs: readonly number[]) => ({
      shape: "box" as const,
      mins: [...mins] as [number, number, number],
      maxs: [...maxs] as [number, number, number],
    });
    const solids = [
      box([x0, y0, -thickness], [x1, y1, 0]),
      box([x0, y0, h], [x1, y1, h + thickness]),
      box([x0 - thickness, y0, 0], [x0, y1, h]),
      box([x1, y0, 0], [x1 + thickness, y1, h]),
      box([x0 - thickness, y0 - thickness, 0], [x1 + thickness, y0, h]),
      box([x0 - thickness, y1, 0], [x1 + thickness, y1 + thickness, h]),
    ];
    for (let bay = 1; bay < bays; bay += 1) {
      const y = (y1 * bay) / bays;
      solids.push(box([x0, y - 16, 0], [-arch, y + 16, h]));
      solids.push(box([arch, y - 16, 0], [x1, y + 16, h]));
    }

    const written = (await writeVmfSolidTool.handler(
      {
        path,
        solids,
        material,
        confirm: true,
        backup: false,
        dryRun: false,
      } as never,
      ctx as never,
    )) as { solidIds: number[]; solidsAfter: number };

    const entities = await addEntities(
      path,
      [
        {
          classname: "info_player_start",
          origin: `0 ${y0 + 128} 16`,
        },
        {
          classname: "info_director",
          targetname: "director",
          origin: "0 0 32",
        },
        {
          classname: "info_zombie_spawn",
          origin: `0 ${Math.round(y1 / 2)} 16`,
        },
        {
          classname: "trigger_finale",
          targetname: "finale",
          origin: `0 ${Math.round(y1 - 200)} 16`,
          type: "0",
        },
      ],
      ctx,
    );
    verifyEntities(path, entities, [
      "info_player_start",
      "info_director",
      "info_zombie_spawn",
      "trigger_finale",
    ]);

    const lights: Array<number | null> = [];
    for (let bay = 0; bay < bays; bay += 1) {
      const y = Math.round((y1 * (bay + 0.5)) / bays);
      const [id = null] = await addEntities(
        path,
        [
          {
            classname: "light",
            origin: `0 ${y} ${h - 40}`,
            _light: "255 240 220 600",
            _lightHDR: "-1 -1 -1 1",
          },
        ],
        ctx,
      );
      verifyEntities(path, [id], ["light"]);
      lights.push(id);
    }

    const region = await addBrushEntity(
      path,
      {
        classname: "func_nav_attribute_region",
        spawnflags: "64",
        targetname,
      },
      { mins: [x0, y1 - 768, 0], maxs: [x1, y1, h] },
      "TOOLS/TOOLSNODRAW",
      ctx,
    );

    if (!existsSync(path)) throw new Error(`${path} was not written`);

    return {
      path,
      width,
      length,
      height,
      bays,
      solidCount: written.solidsAfter,
      entities: {
        playerStart: entities[0] ?? null,
        director: entities[1] ?? null,
        zombieSpawn: entities[2] ?? null,
        finale: entities[3] ?? null,
        lights,
      },
      finaleRegion: { id: region.id, solidIds: region.solidIds },
      nextStep:
        "run_compile (vbsp first), run_nav_generate, then nav_trouble_report with " +
        'expected: "finale" — "Missing Finale" must pass. Then run_map_test via: "steam". ' +
        "Standing at the spawn spawns nothing: teleport the survivors toward the far end " +
        "(player.SetOrigin works) so the Director sees flow.",
    };
  },
});

export const testBenchTools = [writeTestBenchTool];
