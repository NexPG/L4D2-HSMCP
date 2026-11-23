/**
 * A model preview that does not depend on HLMV's 3D canvas.
 *
 * HLMV opens a model and its window can be captured, but the viewport is a GPU surface. On
 * a desktop where that child window never presents -- the case this tool exists for -- the
 * capture is window chrome around a black rectangle, and no amount of `PrintWindow` fixes
 * it because there is nothing in the window to read.
 *
 * The fallback is the thing the engine already does well: seal the model in a dev-textured
 * room, compile it, generate a nav, launch the map and capture the real game view. That is
 * a different claim from HLMV's: it proves the model loads, its materials resolve, its scale
 * and origin put it on the floor, and the engine is willing to draw it. It is slower and it
 * is not a turntable, so HLMV stays the default and this is the fallback.
 *
 * The blank test is a measurement, not a guess: the centre of the captured window is
 * sampled and its luminance spread is compared with a threshold. A dark but rendered model
 * has gradients; a dead canvas has none. `via: "map"` skips the question entirely.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import type { ToolContext } from "../../../core/typescript/mcp/registry.js";
import { gameFor } from "../../../core/typescript/games/resolve.js";
import { CONFIRM, GAME, resolveInput } from "../../../core/typescript/tools/paths.js";
import { readModelInfoTool } from "../../../assets/typescript/tools/content.js";
import { runHlmvTool } from "../../../hammer/typescript/tools/hlmv.js";
import { runCompile } from "../../../maps/typescript/tools/compile.js";
import { pngLuminance } from "../../../maps/typescript/render/png.js";
import { DEFAULT_SKYNAME, emptyVmf } from "../../../maps/typescript/vmf/skeleton.js";
import { insertSolids } from "../../../maps/typescript/vmf/build.js";
import { applyVmfOps } from "../../../maps/typescript/vmf/edit.js";
import { runNavGenerate, runMapTest } from "../../../scripts/typescript/tools/runtime.js";

const DEV_MATERIAL = "DEV/DEV_MEASUREGENERIC01B";

/** The centre of a capture, where HLMV's viewport is. */
const VIEWPORT_REGION = { x0: 0.25, y0: 0.2, x1: 0.75, y1: 0.8 };

/** Below this spread the centre is one flat colour, which a rendered model never is. */
const BLANK_STDDEV = 3;

/**
 * Whether a captured viewport is a flat rectangle.
 *
 * Spread, not brightness: a dark model on a dark background still has gradients, while a
 * canvas that never presented is one value edge to edge. The threshold is deliberately low
 * -- this decides whether to spend a compile on the fallback, and guessing "blank" on a
 * legitimately moody render would be the more expensive mistake.
 */
export function viewportIsBlank(stdDev: number): boolean {
  return stdDev < BLANK_STDDEV;
}

export function safeMapName(model: string): string {
  const base =
    basename(model.replace(/\\/g, "/"), ".mdl")
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "model";
  const unique = Date.now().toString(36);
  // The nav header stores the map name in 32 bytes, but the engine fails signon at 31
  // characters: measured `hsmcp_preview_checkpoi_mwteil6r` (31) stayed at the main menu
  // while `hsmcp_preview_bench001_mwtehbv5` (30) loaded. Cap at 30, not at the header size.
  const room = Math.max(1, 30 - "hsmcp_preview_".length - 1 - unique.length);
  return `hsmcp_preview_${base.slice(0, room)}_${unique}`;
}

function box(mins: [number, number, number], maxs: [number, number, number]) {
  return { shape: "box" as const, mins, maxs };
}

/** The pedestal's top, i.e. the plane the model's lowest point must touch. */
export const PREVIEW_PEDESTAL = 48;

export interface PreviewRoom {
  text: string;
  warnings: string[];
  /** Half-width of the sealed room, in units. */
  half: number;
  ceiling: number;
  /** Where `prop_dynamic` is placed, in world units. */
  originZ: number;
  /** Where the player's eye ends up, which is what the camera frames the model with. */
  eyeZ: number;
}

/**
 * The room, as a VMF, without touching the disk or the engine.
 *
 * Pure so it can be tested: the placement arithmetic (origin = pedestal - mins.z * scale)
 * is the part that goes wrong invisibly, and a test can assert it without a compile. The
 * room is sized from the model, because a fixed room puts a tall model through the ceiling
 * and makes a small one a dot.
 */
export function buildPreviewRoom(
  model: string,
  mins: readonly number[],
  size: readonly number[],
  scale: number,
): PreviewRoom {
  const span = Math.max(size[0] ?? 64, size[1] ?? 64) * scale;
  const half = Math.max(160, Math.ceil((span * 1.5 + 64) / 16) * 16);
  const ceiling = Math.max(224, Math.ceil(((size[2] ?? 64) * scale + 192) / 16) * 16);
  const pedestal = PREVIEW_PEDESTAL;
  const originZ = pedestal - (mins[2] ?? 0) * scale;
  const eyeZ = Math.min(ceiling - 32, Math.max(80, pedestal + (size[2] ?? 64) * scale * 0.5));

  const source = emptyVmf({ skyname: DEFAULT_SKYNAME, gridSpacing: 16 });
  const solids = insertSolids(
    source,
    [
      box([-half, -half, -16], [half, half, 0]), // floor
      box([-half, -half, ceiling], [half, half, ceiling + 16]), // ceiling
      box([-half - 16, -half, -16], [-half, half, ceiling]), // -X
      box([half, -half, -16], [half + 16, half, ceiling]), // +X
      box([-half, -half - 16, -16], [half, -half, ceiling]), // -Y
      box([-half, half, -16], [half, half + 16, ceiling]), // +Y
      box([-48, -48, 0], [48, 48, pedestal]), // pedestal
    ],
    { material: DEV_MATERIAL, textureScale: 0.25 },
  ).text;

  // `modelscale` scales about the origin, so the model's own mins.z is what has to be
  // compensated. The bottom then sits on the pedestal whether the artist put the origin at
  // the feet or in the middle -- which is the mistake this is meant to expose.
  const built = applyVmfOps(solids, [
    {
      op: "add",
      keyvalues: {
        // `prop_dynamic` deletes a model that carries propdata ("which means that it be
        // used on a prop_physics. DELETED."). Most props a person wants to look at are
        // exactly those models, so the override class is the correct one here.
        classname: "prop_dynamic_override",
        targetname: "preview_model",
        model,
        origin: `0 0 ${originZ.toFixed(3)}`,
        angles: "0 0 0",
        modelscale: String(scale),
        solid: "0",
        spawnflags: "0",
      },
    },
    {
      op: "add",
      keyvalues: {
        classname: "info_player_start",
        targetname: "preview_spawn",
        origin: `${-half + 48} 0 16`,
        angles: "0 0 0",
      },
    },
    {
      op: "add",
      keyvalues: {
        classname: "light",
        targetname: "preview_key",
        origin: `0 0 ${ceiling - 32}`,
        _light: "255 255 255 400",
        _lightHDR: "255 255 255 400",
        _lightscale: "1",
        // Without a distance a `light` has no falloff radius and vrad lights nothing.
        _distance: "1024",
      },
    },
    {
      op: "add",
      keyvalues: {
        classname: "light",
        targetname: "preview_fill",
        origin: `${-half / 2} ${-half / 2} ${eyeZ}`,
        _light: "200 215 255 500",
        _lightHDR: "200 215 255 500",
        _lightscale: "1",
        _distance: "1024",
      },
    },
    // Compiled lightmaps depend on vrad and on the light entities being read; a dynamic
    // light is the same mechanism as the player's flashlight and always draws. Two of them
    // make the preview legible even when the lightmap came out dark.
    {
      op: "add",
      keyvalues: {
        classname: "light_dynamic",
        targetname: "preview_dynamic_key",
        target: "preview_model",
        origin: `0 0 ${ceiling - 48}`,
        _light: "255 250 240",
        brightness: "2",
        distance: "512",
        spotlight_radius: "256",
        _inner_cone: "60",
        _cone: "90",
      },
    },
    {
      op: "add",
      keyvalues: {
        classname: "light_dynamic",
        targetname: "preview_dynamic_fill",
        target: "preview_model",
        origin: `${-half / 2} ${-half / 2} ${eyeZ}`,
        _light: "200 215 255",
        brightness: "1",
        distance: "512",
        spotlight_radius: "256",
        _inner_cone: "60",
        _cone: "90",
      },
    },
  ]);
  return { text: built.text, warnings: [...built.warnings], half, ceiling, originZ, eyeZ };
}

interface HlmvAttempt {
  screenshotPath: string | null;
  width: number | null;
  height: number | null;
  blank: boolean;
  closed: boolean;
  mean: number | null;
  stdDev: number | null;
}

async function tryHlmv(
  model: string,
  args: { waitMs: number; output?: string | undefined; game?: string | undefined },
  ctx: ToolContext,
): Promise<HlmvAttempt> {
  const result = (await runHlmvTool.handler(
    {
      model,
      screenshot: true,
      method: "screen",
      close: true,
      waitMs: args.waitMs,
      ...(args.output ? { out: args.output.replace(/\.png$/i, "") + "-hlmv.png" } : {}),
      game: args.game,
      confirm: true,
    } as never,
    ctx,
  )) as {
    screenshotPath: string | null;
    screenshotWidth: number | null;
    screenshotHeight: number | null;
    closed: boolean;
    };
    if (!result.screenshotPath || !existsSync(result.screenshotPath)) {
    return {
      screenshotPath: null,
      width: result.screenshotWidth,
      height: result.screenshotHeight,
      blank: true,
      closed: result.closed,
      mean: null,
      stdDev: null,
    };
  }
  let mean: number | null = null;
  let stdDev: number | null = null;
  try {
    const stats = pngLuminance(readFileSync(result.screenshotPath), VIEWPORT_REGION);
    mean = Number(stats.mean.toFixed(2));
    stdDev = Number(stats.stdDev.toFixed(2));
  } catch {
    // An unreadable capture is not evidence of a rendered one. Fall through to the map.
    return {
      screenshotPath: result.screenshotPath,
      width: result.screenshotWidth,
      height: result.screenshotHeight,
      blank: true,
      closed: result.closed,
      mean,
      stdDev,
    };
  }
  return {
    screenshotPath: result.screenshotPath,
    width: result.screenshotWidth,
    height: result.screenshotHeight,
    blank: viewportIsBlank(stdDev),
    closed: result.closed,
    mean,
    stdDev,
  };
}

export const previewModelTool = defineTool({
  name: "preview_model",
  description:
    "Returns a real image of a compiled model. By default it tries HLMV and measures the " +
    "captured viewport; when the centre is a flat colour -- HLMV's 3D canvas does not " +
    "present on some desktops -- it falls back to the engine: a sealed dev-textured room " +
    "with the model on a pedestal and a player facing it, compiled, nav-generated, launched " +
    "and captured through `run_map_test`. `via: 'map'` skips HLMV, `via: 'hlmv'` refuses the " +
    "fallback. The model must already be compiled and installed in the game's `models/` " +
    "tree. In the map path the model's lowest point is placed on the pedestal, so a wrong " +
    "origin shows up as a floating or sunken prop rather than being hidden. Long-running: a " +
    "compile, nav generation and a game launch. `output` names the PNG.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    model: z
      .string()
      .describe(
        "Engine model path, e.g. `models/props_junk/wood_crate001a.mdl` or " +
          "`props_junk/wood_crate001a.mdl`. The model must already be installed.",
      ),
    via: z
      .enum(["auto", "hlmv", "map"])
      .default("auto")
      .describe(
        "`auto` (default) tries HLMV and falls back to the engine when the capture is blank; " +
          "`hlmv` and `map` force one path.",
      ),
    output: z.string().optional().describe("Screenshot PNG path. Defaults to the state directory."),
    modelscale: z.number().positive().default(1).describe("prop_dynamic `modelscale` in the map path."),
    mapName: z.string().optional().describe("Override the generated preview map name."),
    waitMs: z
      .number()
      .int()
      .min(500)
      .max(20_000)
      .default(4500)
      .describe("How long HLMV gets to open the model before the capture."),
    timeoutSeconds: z.number().int().min(60).max(600).default(300),
    game: GAME,
    confirm: CONFIRM,
  },
  outputSchema: {
    model: z.string(),
    via: z.enum(["hlmv", "map"]),
    map: z.string().nullable(),
    vmf: z.string().nullable(),
    bsp: z.string().nullable(),
    nav: z.string().nullable(),
    compiled: z.boolean(),
    navGenerated: z.boolean(),
    screenshotPath: z.string().nullable(),
    screenshotWidth: z.number().nullable(),
    screenshotHeight: z.number().nullable(),
    /** Luminance spread in the middle of the capture; near zero means a dead canvas. */
    viewportStdDev: z.number().nullable(),
    viewportMean: z.number().nullable(),
    elapsedSeconds: z.number(),
    warnings: z.array(z.string()),
    logTail: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const started = Date.now();
    const { game } = gameFor(ctx.config, args.game);
    if (!game.gameDir) throw new Error("the game directory is not resolved; run health first");
    const info = (await readModelInfoTool.handler(
      { model: args.model, game: args.game },
      ctx,
    )) as {
      found: boolean;
      model: string;
      mins: number[] | null;
      maxs: number[] | null;
      size: number[] | null;
    };
    if (!info.found) {
      throw new Error(
        `${args.model} is not installed in the game's models/ tree. Compile it with ` +
          "run_studiomdl first, then pass the engine path.",
      );
    }

    const warnings: string[] = [];
    let hlmv: HlmvAttempt | null = null;
    if (args.via !== "map") {
      try {
        hlmv = await tryHlmv(info.model, args, ctx);
        if (!hlmv.blank) {
          if (!hlmv.closed) {
            warnings.push(
              "HLMV did not close after the capture; run close_windows kinds:['hlmv'] to clear it",
            );
          }
          return {
            model: info.model,
            via: "hlmv" as const,
            map: null,
            vmf: null,
            bsp: null,
            nav: null,
            compiled: false,
            navGenerated: false,
            screenshotPath: hlmv.screenshotPath,
            screenshotWidth: hlmv.width,
            screenshotHeight: hlmv.height,
            viewportStdDev: hlmv.stdDev,
            viewportMean: hlmv.mean,
            elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
            warnings,
            logTail: [],
          };
        }
        if (!hlmv.closed) {
          warnings.push(
            "HLMV did not close after the capture; run close_windows kinds:['hlmv'] to clear it",
          );
        }
        if (args.via === "hlmv") {
          warnings.push(
            hlmv.screenshotPath === null
              ? "HLMV produced no capture"
              : `HLMV's viewport is flat (stdDev ${hlmv.stdDev}); the image is window chrome ` +
                "around a blank canvas. Call again with via: 'map' to render it in the engine.",
          );
          return {
            model: info.model,
            via: "hlmv" as const,
            map: null,
            vmf: null,
            bsp: null,
            nav: null,
            compiled: false,
            navGenerated: false,
            screenshotPath: hlmv.screenshotPath,
            screenshotWidth: hlmv.width,
            screenshotHeight: hlmv.height,
            viewportStdDev: hlmv.stdDev,
            viewportMean: hlmv.mean,
            elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
            warnings,
            logTail: [],
          };
        }
        warnings.push(
          hlmv.screenshotPath === null
            ? "HLMV produced no capture; rendering the model in the engine instead"
            : `HLMV's viewport is blank (stdDev ${hlmv.stdDev}); rendering the model in the ` +
              "engine instead",
        );
      } catch (error) {
        if (args.via === "hlmv") throw error;
        warnings.push(
          `HLMV could not open the model (${error instanceof Error ? error.message : String(error)}); ` +
            "rendering it in the engine instead",
        );
      }
    }

    const mins = info.mins ?? [0, 0, 0];
    const maxs = info.maxs ?? [64, 64, 64];
    const size = info.size ?? [
      Math.abs(maxs[0]! - mins[0]!),
      Math.abs(maxs[1]! - mins[1]!),
      Math.abs(maxs[2]! - mins[2]!),
    ];
    const scale = args.modelscale ?? 1;
    const mapName = (
      args.mapName?.replace(/[^A-Za-z0-9_]+/g, "_") || safeMapName(info.model)
    ).slice(0, 30);

    const room = buildPreviewRoom(info.model, mins, size, scale);
    warnings.push(...room.warnings);
    const work = join(ctx.config.stateDir, "previews", mapName);
    mkdirSync(work, { recursive: true });
    const vmfPath = join(work, `${mapName}.vmf`);
    writeFileSync(vmfPath, room.text, "utf8");

    const compile = (await runCompile.handler(
      {
        vmf: vmfPath,
        fast: true,
        hdr: true,
        stages: ["vbsp", "vvis", "vrad"],
        toolchain: "stock",
        game: args.game,
        timeoutMinutes: Math.max(1, Math.ceil((args.timeoutSeconds ?? 300) / 60)),
        confirm: true,
      },
      ctx,
    )) as {
      ok: boolean;
      bsp: string;
      leaked: boolean;
      stages: Array<{ name: string; ok: boolean }>;
    };
    if (!compile.ok || compile.leaked) {
      throw new Error(
        `preview compile failed (${compile.stages
          .filter((stage) => !stage.ok)
          .map((stage) => stage.name)
          .join(", ") || "leak"}); the .vmf is at ${vmfPath}`,
      );
    }

    const nav = (await runNavGenerate.handler(
      {
        maps: [compile.bsp],
        addonsToHide: [],
        timeoutSeconds: Math.min(300, args.timeoutSeconds ?? 300),
        confirm: true,
      },
      ctx,
    )) as {
      ok: boolean;
      maps: Array<{
        generated: boolean;
        bsp: string | null;
        nav: string | null;
        stringtableDictionary: boolean;
        consoleTail: string[];
      }>;
    };
    const generated = nav.maps[0];
    if (!nav.ok || !generated?.generated || !generated.nav) {
      throw new Error(
        `nav generation failed: ${
          generated?.consoleTail.slice(-6).join(" | ") ?? "no map result"
        }; the .bsp is at ${compile.bsp}`,
      );
    }
    // The nav step bakes the string-table dictionary into its own copy. A client that joins
    // the compile output instead fails signon with "String Table dictionary ... should be
    // rebuilt" and never leaves the main menu. Ship the pair the generator produced.
    const shippingBsp = generated.bsp ?? compile.bsp;
    if (!generated.stringtableDictionary) {
      warnings.push(
        "the nav-generated BSP has no string-table dictionary; the map may fail signon",
      );
    }

    const run = (await runMapTest.handler(
      {
        map: mapName,
        bsp: shippingBsp,
        nav: generated.nav,
        waitFor: "Loading: [0-9]",
        markers: [],
        markerOrder: "ordered",
        schedule: [],
        console: true,
        via: "direct",
        timeoutSeconds: Math.min(300, args.timeoutSeconds ?? 300),
        extraArgs: ["-console"],
        addonsToHide: [],
        replaceRunningGame: true,
        screenshot: true,
        ...(args.output ? { out: resolveInput(args.output, ctx.config) } : {}),
        waitAfterMatchMs: 4000,
        method: "screen",
        commands: [
          // The HUD is not the model. The bots may walk into frame; freezing or limiting
          // them made it worse (they stop at the spawn, in front of the lens), so a normal
          // team and the player's own camera are left alone.
          "cl_drawhud 0",
          "crosshair 0",
          "r_drawviewmodel 0",
          "mat_postprocess_enable 0",
        ],
        confirm: true,
      },
      ctx,
    )) as {
      matched: boolean;
      elapsedSeconds: number;
      screenshotPath: string | null;
      screenshotWidth: number | null;
      screenshotHeight: number | null;
      gameClosed: boolean;
      logTail: string[];
    };
    if (!run.gameClosed) {
      warnings.push(
        "the game process was still running after the capture; run close_windows kinds:['game']",
      );
    }
    if (!run.matched) {
      warnings.push(
        "the map loaded but the wait marker did not match; the screenshot may be the loading screen",
      );
    }

    let mean: number | null = null;
    let stdDev: number | null = null;
    if (run.screenshotPath && existsSync(run.screenshotPath)) {
      try {
        const stats = pngLuminance(readFileSync(run.screenshotPath), { x0: 0, y0: 0, x1: 1, y1: 1 });
        mean = Number(stats.mean.toFixed(2));
        stdDev = Number(stats.stdDev.toFixed(2));
        if (viewportIsBlank(stdDev)) {
          warnings.push("the captured game frame is flat; the engine may have been minimized");
        }
      } catch {
        warnings.push("the screenshot could not be measured");
      }
    }

    return {
      model: info.model,
      via: "map" as const,
      map: mapName,
      vmf: vmfPath,
      bsp: shippingBsp,
      nav: generated.nav,
      compiled: true,
      navGenerated: true,
      screenshotPath: run.screenshotPath,
      screenshotWidth: run.screenshotWidth,
      screenshotHeight: run.screenshotHeight,
      viewportStdDev: stdDev,
      viewportMean: mean,
      elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
      warnings,
      logTail: run.logTail,
    };
  },
});

export const previewModelTools = [previewModelTool];
