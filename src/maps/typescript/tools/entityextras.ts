/**
 * More entity families: props, physics constraints, ladders, scenes and ambient sounds.
 * Each is a shortcut over `write_point_entity`/`write_brush_entity`; the classname remains a
 * string in the primitive layer.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import {
  addBrushEntity,
  addEntities,
  addOutputs,
  fgdWarnings,
  verifyEntities,
} from "./entityfamilies.js";
import { readModelInfoTool } from "../../../assets/typescript/tools/content.js";
import { writeVmfSolidTool } from "./build.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);

/**
 * Which local axis is the front of a model.
 *
 * The MDL does not store a forward axis. These are the four axes a Source model can use,
 * and the table in `references/mapping/model-facing.md` says which one each common family
 * uses, measured by looking at the model and at stock placements.
 */
export type ModelForward = "x+" | "x-" | "y+" | "y-";

export const MODEL_FORWARD_YAW: Record<ModelForward, number> = {
  "x+": 0,
  "y+": 90,
  "x-": 180,
  "y-": 270,
};

/**
 * The VMF yaw that points a model's front at `facing`.
 *
 * Source yaw 0 is world +X and 90 is +Y. A model whose own front is local +Y needs -90
 * degrees of entity yaw before it points at +X. `yawOffset` is the per-model correction
 * measured on the model (a car whose nose is 5 degrees off its hull axis).
 */
export function modelYaw(
  facing: number,
  forward: ModelForward = "x+",
  yawOffset = 0,
): number {
  return (((facing - MODEL_FORWARD_YAW[forward] + yawOffset) % 360) + 360) % 360;
}

type ModelCheck = {
  found?: boolean;
  readError?: string;
  hasPhysics?: boolean;
  staticProp?: boolean;
  mins?: number[] | null;
  maxs?: number[] | null;
};
const vec = (v: readonly number[]): string =>
  v.map((n) => String(Math.round(n * 1000) / 1000)).join(" ");

function insideWorld(point: readonly number[]): boolean {
  return point.every((n) => Math.abs(n) <= 16384);
}

const OUTPUT = z.object({
  output: z.string(),
  target: z.string(),
  input: z.string(),
  parameter: z.string().default(""),
  delay: z.number().nonnegative().default(0),
  times: z.number().int().default(-1),
});

export const writePropTool = defineTool({
  name: "write_prop",
  description:
    "Places a `prop_static`, `prop_dynamic`, `prop_physics`, `prop_dynamic_override` or " +
    "`prop_physics_override` with its model, origin, angles, skin and solid mode. Checks the " +
    "model with read_model_info: a prop_static without `$staticprop` will be deleted by vbsp, " +
    "and a model without a `.phy` will not collide; `collision: \"clip\"` adds a world clip " +
    "hull from the model bounds, and `collision: \"dynamic\"|\"physics\"` picks the class " +
    "that carries its own VPhysics hull. Outputs are attached to the new entity. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z
      .enum(["static", "dynamic", "physics", "dynamic_override", "physics_override"])
      .default("static")
      .describe(
        "The class to write. `collision: \"dynamic\"|\"physics\"` overrides it; a " +
          "prop_static needs a model compiled with `$staticprop`.",
      ),
    origin: VEC3,
    model: z.string().min(1),
    angles: VEC3.default([0, 0, 0]),
    facing: z
      .number()
      .optional()
      .describe(
        "World yaw the model's front should point at, in degrees (0 = +X east, 90 = +Y " +
          "north). Given this, `angles`' yaw is computed from `modelForward` and " +
          "`yawOffset`; leave it out to write `angles` literally.",
      ),
    modelForward: z
      .enum(["x+", "x-", "y+", "y-"])
      .default("x+")
      .describe(
        "The model's local axis that is its front. See references/mapping/model-facing.md " +
          "for the measured family table; a wrong axis is a 90/180-degree prop.",
      ),
    yawOffset: z
      .number()
      .default(0)
      .describe(
        "Degrees added after the forward correction, for a model whose nose is off its " +
          "hull axis or whose placement convention differs from the family default.",
      ),
    skin: z.number().int().min(0).default(0),
    solid: z.number().int().min(0).max(6).optional().describe("prop_static solid mode."),
    collision: z
      .enum(["auto", "clip", "none", "dynamic", "physics"])
      .default("auto")
      .describe(
        "How the prop is made solid. auto: use the model's .phy, or add a clip hull when it " +
          "has none; clip: always add a TOOLS/TOOLSCLIP box from the model bounds and yaw; " +
          "dynamic: write prop_dynamic (solid via its .phy, not movable); physics: write " +
          "prop_physics (movable clutter); none: no collision on purpose.",
      ),
    targetname: z.string().optional(),
    validateModel: z.boolean().default(true),
    keyvalues: z.record(z.string()).default({}),
    outputs: z.array(OUTPUT).default([]),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    entityId: z.number().nullable(),
    classname: z.string(),
    keyvalues: z.record(z.string()),
    angles: VEC3,
    clipAdded: z.boolean(),
    clipBox: z.array(z.array(z.number()).length(3)).nullable(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!insideWorld(args.origin)) throw new Error("the prop origin leaves Source's world");
    // Class has one owner: `collision: dynamic|physics` is a collision decision that needs
    // that class, so it wins and kind stays the explicit class for everything else.
    const kind =
      args.collision === "dynamic"
        ? "dynamic"
        : args.collision === "physics"
          ? "physics"
          : (args.kind ?? "static");
    const classname =
      kind === "static"
        ? "prop_static"
        : kind === "dynamic"
          ? "prop_dynamic"
          : kind === "dynamic_override"
            ? "prop_dynamic_override"
            : kind === "physics_override"
              ? "prop_physics_override"
              : "prop_physics";
    const written = args.angles ?? [0, 0, 0];
    const yaw =
      args.facing !== undefined
        ? modelYaw(args.facing, args.modelForward, args.yawOffset ?? 0)
        : (((written[1] + (args.yawOffset ?? 0)) % 360) + 360) % 360;
    const angles: [number, number, number] = [written[0], yaw, written[2]];
    const keyvalues: Record<string, string> = {
      classname,
      origin: vec(args.origin),
      angles: vec(angles),
      model: args.model,
      skin: String(args.skin ?? 0),
      ...(args.solid !== undefined ? { solid: String(args.solid) } : {}),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      ...(args.keyvalues ?? {}),
    };
    const warnings = await fgdWarnings(classname, keyvalues, ctx);
    let info: ModelCheck | null = null;
    if (args.validateModel !== false) {
      try {
        info = (await readModelInfoTool.handler(
          { model: args.model } as never,
          ctx as never,
        )) as unknown as ModelCheck;
        if (!info?.found) {
          warnings.push(`model ${args.model} was not found: ${info?.readError ?? "unknown reason"}`);
          info = null;
        } else {
          const staticClass = classname === "prop_static";
          if (staticClass && info.staticProp === false) {
            warnings.push(
              `${args.model} has no $staticprop: vbsp deletes a prop_static from it ` +
                `("Error! ... Deleted.") and exits 0. Use collision: "dynamic" or "physics"` +
                `, or a $staticprop model`,
            );
          }
          if (info.hasPhysics === false) {
            const clipWillHelp = args.collision === "auto" || args.collision === "clip";
            warnings.push(
              `${args.model} has no .phy: a ${classname} from it will not collide` +
                (clipWillHelp ? "; a clip hull is added" : ""),
            );
          }
        }
      } catch (error) {
        warnings.push(`the model could not be checked: ${(error as Error).message}`);
      }
    }

    // `solid` is the key vbsp actually reads. The FGD says the default is 6, but a static
    // prop with the key absent compiles to `solidity 0`: measured on this map, all 382
    // `prop_static` instances came out solidity 0 and every bench, car and cart was a ghost.
    // Write the decision explicitly, do not rely on the FGD default.
    const decorative = (Number(args.keyvalues?.spawnflags ?? "0") & 2) !== 0;
    if (keyvalues.solid === undefined) {
      keyvalues.solid =
        args.collision === "none" || decorative
          ? "0"
          : info?.hasPhysics === false
            ? "0"
            : "6";
    }

    // A clip hull from the model's own bounds. Yaw is applied as a conservative AABB; it
    // does not need to be exact, only to cover the prop for a player.
    let clipAdded = false;
    let clipBox: number[][] | null = null;
    if (
      info?.mins &&
      info.maxs &&
      !decorative &&
      args.collision !== "none" &&
      (args.collision === "clip" || (args.collision === "auto" && info.hasPhysics === false))
    ) {
      const [x, y, z] = args.origin;
      const [minX, minY, minZ] = info.mins as [number, number, number];
      const [maxX, maxY, maxZ] = info.maxs as [number, number, number];
      const yawRadians = (angles[1] * Math.PI) / 180;
      const c = Math.abs(Math.cos(yawRadians));
      const s = Math.abs(Math.sin(yawRadians));
      const halfX = (c * (maxX - minX) + s * (maxY - minY)) / 2;
      const halfY = (s * (maxX - minX) + c * (maxY - minY)) / 2;
      const cxLocal = (minX + maxX) / 2;
      const cyLocal = (minY + maxY) / 2;
      const cx = x + cxLocal * Math.cos(yawRadians) - cyLocal * Math.sin(yawRadians);
      const cy = y + cxLocal * Math.sin(yawRadians) + cyLocal * Math.cos(yawRadians);
      clipBox = [
        [cx - halfX, cy - halfY, z + minZ],
        [cx + halfX, cy + halfY, z + maxZ],
      ];
      await writeVmfSolidTool.handler(
        {
          path,
          solids: [
            {
              shape: "box",
              mins: clipBox[0] as [number, number, number],
              maxs: clipBox[1] as [number, number, number],
            },
          ],
          material: "TOOLS/TOOLSCLIP",
          backup: true,
          confirm: true,
        },
        ctx,
      );
      clipAdded = true;
    }

    const [id = null] = await addEntities(path, [keyvalues], ctx);
    verifyEntities(path, [id], [classname]);
    await addOutputs(path, id!, args.outputs ?? [], ctx);
    return {
      path,
      entityId: id,
      classname,
      keyvalues,
      angles,
      clipAdded,
      clipBox,
      warnings,
      nextStep:
        classname === "prop_static"
          ? "Compile and look at its shadow and fade distance; a static prop is baked."
          : "Compile and use it; a dynamic/physics prop needs a model with the right hull.",
    };
  },
});

const CONSTRAINTS = {
  hinge: "phys_hinge",
  length: "phys_lengthconstraint",
  ballsocket: "phys_ballsocket",
  slide: "phys_slideconstraint",
  ragdoll: "phys_ragdollconstraint",
} as const;

export const writeConstraintTool = defineTool({
  name: "write_physics_constraint",
  description:
    "Writes a `phys_hinge`, `phys_lengthconstraint`, `phys_ballsocket`, " +
    "`phys_slideconstraint` or `phys_ragdollconstraint` between two named entities. " +
    "`attach1` and `attach2` are required; the class-specific keys (hingeaxis, slideaxis, " +
    "length, limits) pass through `keyvalues`. Outputs are attached to the new entity. " +
    "Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z.enum(["hinge", "length", "ballsocket", "slide", "ragdoll"]),
    origin: VEC3.default([0, 0, 0]),
    attach1: z.string().min(1),
    attach2: z.string().min(1),
    targetname: z.string().optional(),
    keyvalues: z.record(z.string()).default({}),
    outputs: z.array(OUTPUT).default([]),
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
    const origin = args.origin ?? [0, 0, 0];
    if (!insideWorld(origin)) throw new Error("the constraint origin leaves Source's world");
    const classname = CONSTRAINTS[args.kind];
    const keyvalues: Record<string, string> = {
      classname,
      origin: vec(origin),
      attach1: args.attach1,
      attach2: args.attach2,
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      ...(args.keyvalues ?? {}),
    };
    const warnings = await fgdWarnings(classname, keyvalues, ctx);
    const [id = null] = await addEntities(path, [keyvalues], ctx);
    verifyEntities(path, [id], [classname]);
    await addOutputs(path, id!, args.outputs ?? [], ctx);
    return {
      path,
      entityId: id,
      classname,
      keyvalues,
      warnings,
      nextStep:
        "Compile and test the two attached entities; a constraint with a name that does not " +
        "exist is silently inert.",
    };
  },
});

export const writeLadderTool = defineTool({
  name: "write_ladder",
  description:
    "Writes `func_ladder` as a brush volume plus the `func_useableladder` point L4D2's " +
    "compiler turns into AI ladder data. `func_ladder` has no keyvalues of its own; the " +
    "volume is the ladder. The useable points sit 33 units outside the climbing face and " +
    "16 above the bottom/top, because a point inside the brush is rejected as blocked and " +
    "nav generation then has no walkable seed. Extend the brush to the top of the upper " +
    "floor and pass `facing` when the approach is not the thinner positive axis. Compile " +
    "with Tools++ so vbsp emits `func_simpleladder`; stock vbsp cannot. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    bounds: z.object({ mins: VEC3, maxs: VEC3 }),
    targetname: z.string().optional(),
    useable: z.boolean().default(true).describe("Also write func_useableladder for AI."),
    facing: z
      .enum(["x+", "x-", "y+", "y-"])
      .optional()
      .describe(
        "Side the player climbs from. Default: the thinner horizontal axis, positive side. " +
          "The useable points are offset 17 units this way; the wrong side is a blocked point.",
      ),
    material: z.string().default("TOOLS/TOOLSNODRAW"),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    entityId: z.number().nullable(),
    solidIds: z.array(z.number()),
    useableId: z.number().nullable(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!insideWorld(args.bounds.mins) || !insideWorld(args.bounds.maxs)) {
      throw new Error("the ladder volume leaves Source's world");
    }
    const brush = await addBrushEntity(
      path,
      {
        classname: "func_ladder",
        ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      },
      args.bounds,
      args.material,
      ctx,
    );
    let useableId: number | null = null;
    const warnings: string[] = [];
    if (args.useable !== false) {
      const [mx, my, mz] = args.bounds.mins;
      const [xx, xy, xz] = args.bounds.maxs;
      const size = [xx - mx, xy - my, xz - mz];
      // A ladder brush is thin across the climbing face. The points must be outside that
      // face and above/below the ends; the old centre-line points were inside the brush,
      // and vbsp logged `funcladder with blocked bottom point` before nav found no seed.
      const axis = args.facing?.[0] ?? (size[0]! <= size[1]! ? "x" : "y");
      const sign = args.facing?.endsWith("-") === true ? -1 : 1;
      const yaw = axis === "x" ? (sign > 0 ? 0 : 180) : sign > 0 ? 90 : 270;
      const outset = 33;
      const climbX = (mx + xx) / 2 + (axis === "x" ? sign * outset : 0);
      const climbY = (my + xy) / 2 + (axis === "y" ? sign * outset : 0);
      const point0: [number, number, number] = [climbX, climbY, mz + 16];
      const point1: [number, number, number] = [climbX, climbY, xz + 16];
      const center = [(point0[0] + point1[0]) / 2, (point0[1] + point1[1]) / 2, (point0[2] + point1[2]) / 2];
      if (Math.min(size[0]!, size[1]!) > 32) {
        warnings.push(
          `the ladder is ${Math.min(size[0]!, size[1]!)} units thick across its thin axis; ` +
            `a ladder brush is normally one player width (32) or less`,
        );
      }
      if (size[2]! < 64) {
        warnings.push(`the ladder is ${size[2]} units tall; a climb under 64 is not a ladder`);
      }
      const [id = null] = await addEntities(
        path,
        [
          {
            classname: "func_useableladder",
            origin: vec(center as [number, number, number]),
            angles: `0 ${yaw} 0`,
            point0: vec(point0),
            point1: vec(point1),
            ...(args.targetname !== undefined ? { targetname: `${args.targetname}_use` } : {}),
          },
        ],
        ctx,
      );
      verifyEntities(path, [id], ["func_useableladder"]);
      useableId = id;
    }
    const fgd = await fgdWarnings("func_ladder", { classname: "func_ladder" }, ctx);
    warnings.push(...fgd);
    return {
      path,
      entityId: brush.id,
      solidIds: brush.solidIds,
      useableId,
      warnings,
      nextStep:
        "Compile with Tools++: its vbsp emits `func_simpleladder` from the useable points; " +
        "stock vbsp has no `-simpleladders`. Then run nav and `read_nav_ladders`; a blocked " +
        "point is printed at map load and leaves no climb link.",
    };
  },
});

export const writeSceneTool = defineTool({
  name: "write_scene",
  description:
    "Writes a `logic_choreographed_scene` with a required `SceneFile`, optional targets " +
    "1-8 and outputs. Scenes are `.vcd` files; the builder does not compile them. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    origin: VEC3.default([0, 0, 0]),
    sceneFile: z.string().min(1).describe("Scene file under scenes/, e.g. scenes/MyScene.vcd."),
    targetname: z.string().optional(),
    targets: z.array(z.string()).max(8).default([]),
    keyvalues: z.record(z.string()).default({}),
    outputs: z.array(OUTPUT).default([]),
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
    const origin = args.origin ?? [0, 0, 0];
    if (!insideWorld(origin)) throw new Error("the scene origin leaves Source's world");
    const keyvalues: Record<string, string> = {
      classname: "logic_choreographed_scene",
      origin: vec(origin),
      SceneFile: args.sceneFile,
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      ...(args.keyvalues ?? {}),
    };
    (args.targets ?? []).forEach((target, index) => {
      keyvalues[`target${index + 1}`] = target;
    });
    const warnings = await fgdWarnings("logic_choreographed_scene", keyvalues, ctx);
    const [id = null] = await addEntities(path, [keyvalues], ctx);
    verifyEntities(path, [id], ["logic_choreographed_scene"]);
    await addOutputs(path, id!, args.outputs ?? [], ctx);
    return {
      path,
      entityId: id,
      classname: "logic_choreographed_scene",
      keyvalues,
      warnings,
      nextStep:
        "Compile and trigger it. A .vcd that is missing or names the wrong actors is silent; " +
        "there is no static check for the scene contents here.",
    };
  },
});

export const writeAmbientGenericTool = defineTool({
  name: "write_ambient_generic",
  description:
    "Writes an `ambient_generic` sound emitter with `message` (the soundscript name), " +
    "`health` volume, `radius`, `pitch` and outputs. The sound name is not resolved; use " +
    "`read_soundscript` when the game is available. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    origin: VEC3,
    message: z.string().min(1).describe("Soundscript name, not a .wav path."),
    volume: z.number().min(0).max(10).default(10).describe("`health` in L4D2."),
    radius: z.number().nonnegative().default(0),
    pitch: z.number().min(1).max(255).default(100),
    targetname: z.string().optional(),
    keyvalues: z.record(z.string()).default({}),
    outputs: z.array(OUTPUT).default([]),
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
    if (!insideWorld(args.origin)) throw new Error("the sound origin leaves Source's world");
    const keyvalues: Record<string, string> = {
      classname: "ambient_generic",
      origin: vec(args.origin),
      message: args.message,
      health: String(args.volume ?? 10),
      radius: String(args.radius ?? 0),
      pitch: String(args.pitch ?? 100),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      ...(args.keyvalues ?? {}),
    };
    const warnings = await fgdWarnings("ambient_generic", keyvalues, ctx);
    const [id = null] = await addEntities(path, [keyvalues], ctx);
    verifyEntities(path, [id], ["ambient_generic"]);
    await addOutputs(path, id!, args.outputs ?? [], ctx);
    return {
      path,
      entityId: id,
      classname: "ambient_generic",
      keyvalues,
      warnings,
      nextStep:
        "Compile and listen. A soundscript name that is not registered is silence, and " +
        "read_soundscript is the check for that.",
    };
  },
});

export const entityExtraTools = [
  writePropTool,
  writeConstraintTool,
  writeLadderTool,
  writeSceneTool,
  writeAmbientGenericTool,
];
