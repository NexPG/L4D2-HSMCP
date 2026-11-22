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

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);
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
    "Places a `prop_static`, `prop_dynamic` or `prop_physics` with its model, origin, " +
    "angles, skin and solid mode, and checks the model with read_model_info when the game " +
    "is available (a missing model is a warning, not a refusal). Outputs are attached to the " +
    "new entity. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z.enum(["static", "dynamic", "physics"]),
    origin: VEC3,
    model: z.string().min(1),
    angles: VEC3.default([0, 0, 0]),
    skin: z.number().int().min(0).default(0),
    solid: z.number().int().min(0).max(6).optional().describe("prop_static solid mode."),
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
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!insideWorld(args.origin)) throw new Error("the prop origin leaves Source's world");
    const classname =
      args.kind === "static"
        ? "prop_static"
        : args.kind === "dynamic"
          ? "prop_dynamic"
          : "prop_physics";
    const keyvalues: Record<string, string> = {
      classname,
      origin: vec(args.origin),
      angles: vec(args.angles ?? [0, 0, 0]),
      model: args.model,
      skin: String(args.skin ?? 0),
      ...(args.solid !== undefined ? { solid: String(args.solid) } : {}),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      ...(args.keyvalues ?? {}),
    };
    const warnings = await fgdWarnings(classname, keyvalues, ctx);
    if (args.validateModel !== false) {
      try {
        const info = (await readModelInfoTool.handler(
          { model: args.model } as never,
          ctx as never,
        )) as { found?: boolean; readError?: string; hasPhysics?: boolean };
        if (!info.found) {
          warnings.push(`model ${args.model} was not found: ${info.readError ?? "unknown reason"}`);
        } else if (classname === "prop_physics" && info.hasPhysics === false) {
          warnings.push(`${args.model} has no .phy; a prop_physics from it will not collide`);
        }
      } catch (error) {
        warnings.push(`the model could not be checked: ${(error as Error).message}`);
      }
    }
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
    "Writes `func_ladder` as a brush volume, optionally with the `func_useableladder` point " +
    "L4D2 uses for AI. `func_ladder` has no keyvalues of its own; the volume is the ladder. " +
    "Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    bounds: z.object({ mins: VEC3, maxs: VEC3 }),
    targetname: z.string().optional(),
    useable: z.boolean().default(true).describe("Also write func_useableladder for AI."),
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
    if (args.useable !== false) {
      const center = [
        (args.bounds.mins[0] + args.bounds.maxs[0]) / 2,
        (args.bounds.mins[1] + args.bounds.maxs[1]) / 2,
        (args.bounds.mins[2] + args.bounds.maxs[2]) / 2,
      ];
      const [id = null] = await addEntities(
        path,
        [
          {
            classname: "func_useableladder",
            origin: vec(center),
            point0: vec([center[0]!, center[1]!, args.bounds.mins[2]]),
            point1: vec([center[0]!, center[1]!, args.bounds.maxs[2]]),
            ...(args.targetname !== undefined ? { targetname: `${args.targetname}_use` } : {}),
          },
        ],
        ctx,
      );
      verifyEntities(path, [id], ["func_useableladder"]);
      useableId = id;
    }
    const warnings = await fgdWarnings("func_ladder", { classname: "func_ladder" }, ctx);
    return {
      path,
      entityId: brush.id,
      solidIds: brush.solidIds,
      useableId,
      warnings,
      nextStep:
        "Compile and walk into it; the brush is the climb volume. The useable point is what " +
        "bots path to on this engine.",
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
