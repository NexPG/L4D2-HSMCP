/**
 * Guided builders for the entity families a map needs after geometry: triggers, movers and
 * logic. `edit_vmf` can add any class, but it cannot know that `trigger_teleport` needs a
 * `target`, that a mover needs a brush volume, or that a `logic_auto` wants its outputs on
 * spawn. These three tools encode those rules and check the class against the game FGD.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import type { ToolContext } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { maxId, readEntities } from "../vmf/edit.js";
import { parse } from "../../../formats/typescript/kv/parse.js";
import { writeVmfSolidTool } from "./build.js";
import { editVmf } from "./vmfedit.js";
import { readFgdClass } from "./vmf.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);
const vec = (v: readonly number[]): string =>
  v.map((n) => String(Math.round(n * 1000) / 1000)).join(" ");

function insideWorld(point: readonly number[]): boolean {
  return point.every((n) => Math.abs(n) <= 16384);
}

const OUTPUT = z.object({
  output: z.string().describe("Output name, e.g. OnStartTouch."),
  target: z.string().describe("Targetname, or !activator / !self."),
  input: z.string().describe("Input name, e.g. Enable or Kill."),
  parameter: z.string().default(""),
  delay: z.number().nonnegative().default(0),
  times: z.number().int().default(-1).describe("-1 fires every time."),
});

type OutputSpec = z.infer<typeof OUTPUT>;

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

function verifyEntities(path: string, ids: Array<number | null>, classes: string[]): void {
  const entities = readEntities(readFileSync(path, "utf8")).entities;
  ids.forEach((id, index) => {
    const found = entities.find((entity) => entity.id === id);
    if (!found) throw new Error(`refusing to write: entity ${id} was not readable after the write`);
    if (found.classname.toLowerCase() !== classes[index]!.toLowerCase()) {
      throw new Error(
        `refusing to write: entity ${id} reads back as ${found.classname}, not ${classes[index]}`,
      );
    }
  });
}

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
  const written = (await writeVmfSolidTool.handler(
    {
      path,
      entityId: id,
      solids: [{ shape: "box", mins: [...bounds.mins], maxs: [...bounds.maxs] }],
      material,
      backup: false,
      dryRun: false,
      confirm: true,
    } as never,
    ctx as never,
  )) as { solidIds: number[] };
  return { id, solidIds: written.solidIds };
}

async function addOutputs(
  path: string,
  id: number,
  outputs: OutputSpec[],
  ctx: ToolContext,
): Promise<void> {
  if (outputs.length === 0) return;
  await editVmf.handler(
    {
      path,
      ops: outputs.map((entry) => ({
        op: "addOutput" as const,
        match: { id },
        output: entry.output,
        value: `${entry.target},${entry.input},${entry.parameter},${entry.delay},${entry.times}`,
      })),
      backup: false,
      dryRun: false,
      confirm: true,
    } as never,
    ctx as never,
  );
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
      if (low.startsWith("on")) return false;
      return !known.has(low);
    });
    return unknown.length
      ? [
          `${className} does not declare ${unknown.join(", ")} in the game FGD; ` +
            `the map still compiles, but read_vmf_lint is the check that will agree`,
        ]
      : [];
  } catch {
    return [`the FGD for ${className} could not be read, so its key names were not checked`];
  }
}

function nextName(path: string, prefix: string): string {
  return `${prefix}_${maxId(parse(readFileSync(path, "utf8"))) + 1}`;
}

const BOUNDS = z.object({ mins: VEC3, maxs: VEC3 });

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

const TRIGGERS = {
  multiple: "trigger_multiple",
  once: "trigger_once",
  hurt: "trigger_hurt",
  push: "trigger_push",
  teleport: "trigger_teleport",
  look: "trigger_look",
  gravity: "trigger_gravity",
} as const;

export const writeTriggerTool = defineTool({
  name: "write_trigger",
  description:
    "Writes a trigger as the brush entity it actually is: a sealed box tied to the class, " +
    "with the keys that class needs (a teleport's or look trigger's `target`, a hurt " +
    "trigger's damage and type, a push trigger's speed and direction, gravity's scale). " +
    "The volume uses `TOOLS/TOOLSTRIGGER` and outputs are attached to the new entity. " +
    "`trigger_multiple`/`once` default their hit filters from the FGD, not from a guess. " +
    "Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z.enum(["multiple", "once", "hurt", "push", "teleport", "look", "gravity"]),
    bounds: BOUNDS,
    targetname: z.string().optional(),
    spawnflags: z.number().int().min(0).optional(),
    damage: z.number().nonnegative().optional().describe("hurt: damage per touch."),
    damageType: z.number().int().min(0).optional().describe("hurt: damagetype bitfield."),
    speed: z.number().nonnegative().optional().describe("push: speed."),
    pushdir: VEC3.optional().describe("push: direction; angles are not the same thing."),
    target: z.string().optional().describe("teleport/look: destination targetname."),
    gravity: z.number().optional().describe("gravity: scale, 1 is normal."),
    wait: z.number().nonnegative().optional().describe("multiple: retrigger wait."),
    keyvalues: z.record(z.string()).default({}),
    outputs: z.array(OUTPUT).default([]),
    material: z.string().default("TOOLS/TOOLSTRIGGER"),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    entityId: z.number().nullable(),
    solidIds: z.array(z.number()),
    classname: z.string(),
    keyvalues: z.record(z.string()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!insideWorld(args.bounds.mins) || !insideWorld(args.bounds.maxs)) {
      throw new Error("the trigger volume leaves Source's world");
    }
    const classname = TRIGGERS[args.kind];
    const kv: Record<string, string> = {
      classname,
      ...(args.targetname !== undefined
        ? { targetname: args.targetname }
        : { targetname: nextName(path, `trigger_${args.kind}`) }),
      ...(args.spawnflags !== undefined ? { spawnflags: String(args.spawnflags) } : {}),
      ...(args.keyvalues ?? {}),
    };
    if (args.kind === "hurt") {
      kv.damage = String(args.damage ?? 10);
      kv.damagetype = String(args.damageType ?? 0);
    } else if (args.kind === "push") {
      kv.speed = String(args.speed ?? 40);
      kv.pushdir = vec(args.pushdir ?? [0, 0, 1]);
    } else if (args.kind === "gravity") {
      kv.gravity = String(args.gravity ?? 1);
    } else if (args.kind === "multiple") {
      kv.wait = String(args.wait ?? 1);
    }
    if (args.target !== undefined) kv.target = args.target;
    if ((args.kind === "teleport" || args.kind === "look") && !kv.target) {
      throw new Error(`${classname} needs target: the destination is not implied by the brush`);
    }
    const warnings = await fgdWarnings(classname, kv, ctx);
    const brush = await addBrushEntity(path, kv, args.bounds, args.material, ctx);
    await addOutputs(path, brush.id!, args.outputs ?? [], ctx);
    return {
      path,
      entityId: brush.id,
      solidIds: brush.solidIds,
      classname,
      keyvalues: kv,
      warnings,
      nextStep:
        "Compile and walk through it. A trigger whose volume is outside the playable space " +
        "is silent, not broken.",
    };
  },
});

// ---------------------------------------------------------------------------
// Movers
// ---------------------------------------------------------------------------

const MOVERS = {
  movelinear: "func_movelinear",
  rotating: "func_rotating",
  tracktrain: "func_tracktrain",
} as const;

export const writeMoverTool = defineTool({
  name: "write_mover",
  description:
    "Writes a brush mover with the volume it needs: `func_movelinear` (movedir, speed, " +
    "startposition), `func_rotating` (maxspeed, angles, axis flags) or `func_tracktrain` " +
    "(a `target` path of `path_track`s). The origin is the volume centre, which is what " +
    "rotation and the track train use. Outputs are attached to the new entity. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z.enum(["movelinear", "rotating", "tracktrain"]),
    bounds: BOUNDS,
    targetname: z.string().optional(),
    movedir: VEC3.optional().describe("movelinear: direction and distance sign."),
    speed: z.number().nonnegative().optional(),
    startPosition: z.number().optional().describe("movelinear: 0..1."),
    maxSpeed: z.number().nonnegative().optional().describe("rotating: maxspeed."),
    angles: VEC3.optional().describe("rotating/tracktrain: angles."),
    target: z.string().optional().describe("tracktrain: first path_track targetname."),
    spawnflags: z.number().int().min(0).optional(),
    keyvalues: z.record(z.string()).default({}),
    outputs: z.array(OUTPUT).default([]),
    material: z.string().default("TOOLS/TOOLSNODRAW"),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    entityId: z.number().nullable(),
    solidIds: z.array(z.number()),
    classname: z.string(),
    keyvalues: z.record(z.string()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!insideWorld(args.bounds.mins) || !insideWorld(args.bounds.maxs)) {
      throw new Error("the mover volume leaves Source's world");
    }
    const classname = MOVERS[args.kind];
    const centre: [number, number, number] = [
      (args.bounds.mins[0] + args.bounds.maxs[0]) / 2,
      (args.bounds.mins[1] + args.bounds.maxs[1]) / 2,
      (args.bounds.mins[2] + args.bounds.maxs[2]) / 2,
    ];
    const kv: Record<string, string> = {
      classname,
      origin: vec(centre),
      targetname:
        args.targetname ??
        (args.kind === "tracktrain" ? nextName(path, "tracktrain") : nextName(path, args.kind)),
      ...(args.spawnflags !== undefined ? { spawnflags: String(args.spawnflags) } : {}),
      ...(args.keyvalues ?? {}),
    };
    if (args.kind === "movelinear") {
      kv.movedir = vec(args.movedir ?? [0, 0, 1]);
      kv.speed = String(args.speed ?? 100);
      kv.startposition = String(args.startPosition ?? 0);
    } else if (args.kind === "rotating") {
      kv.maxspeed = String(args.maxSpeed ?? 100);
      kv.angles = vec(args.angles ?? [0, 0, 0]);
    } else {
      kv.speed = String(args.speed ?? 100);
      if (args.target === undefined && kv.target === undefined) {
        throw new Error("func_tracktrain needs target: the first path_track");
      }
      if (args.target !== undefined) kv.target = args.target;
      if (args.angles !== undefined) kv.angles = vec(args.angles);
    }
    const warnings = await fgdWarnings(classname, kv, ctx);
    const brush = await addBrushEntity(path, kv, args.bounds, args.material, ctx);
    await addOutputs(path, brush.id!, args.outputs ?? [], ctx);
    return {
      path,
      entityId: brush.id,
      solidIds: brush.solidIds,
      classname,
      keyvalues: kv,
      warnings,
      nextStep:
        args.kind === "tracktrain"
          ? "Place the path_track chain and give each the next target; a train with no path does not move."
          : "Compile and trigger it; a mover that is solid but never triggered stays still.",
    };
  },
});

// ---------------------------------------------------------------------------
// Logic
// ---------------------------------------------------------------------------

const LOGIC = {
  auto: "logic_auto",
  relay: "logic_relay",
  timer: "logic_timer",
  branch: "logic_branch",
  compare: "logic_compare",
  case: "logic_case",
  counter: "math_counter",
  remap: "math_remap",
} as const;

export const writeLogicTool = defineTool({
  name: "write_logic",
  description:
    "Writes a point logic entity with its origin and outputs: `logic_auto`, `logic_relay`, " +
    "`logic_timer`, `logic_branch`, `logic_compare`, `logic_case`, `math_counter` or " +
    "`math_remap`. Outputs go into the `connections` block, not into flat keyvalues. A " +
    "`logic_timer` gets `RefireTime`; a branch/compare gets an initial value; a counter " +
    "gets a start and max. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z.enum(["auto", "relay", "timer", "branch", "compare", "case", "counter", "remap"]),
    origin: VEC3.default([0, 0, 0]),
    targetname: z.string().optional(),
    refireTime: z.number().positive().optional().describe("timer: seconds."),
    startValue: z.number().optional().describe("branch/compare/counter start value."),
    initialValue: z.number().optional().describe("branch/compare initial value."),
    maxValue: z.number().optional().describe("counter maximum."),
    spawnflags: z.number().int().min(0).optional(),
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
    if (!insideWorld(origin)) throw new Error("the logic entity leaves Source's world");
    const classname = LOGIC[args.kind];
    const kv: Record<string, string> = {
      classname,
      origin: vec(origin),
      targetname: args.targetname ?? nextName(path, `logic_${args.kind}`),
      ...(args.spawnflags !== undefined ? { spawnflags: String(args.spawnflags) } : {}),
      ...(args.keyvalues ?? {}),
    };
    if (args.kind === "timer") kv.RefireTime = String(args.refireTime ?? 1);
    if (args.kind === "counter") {
      kv.startvalue = String(args.startValue ?? 0);
      if (args.maxValue !== undefined) kv.max = String(args.maxValue);
    }
    if (args.kind === "branch" || args.kind === "compare") {
      kv.InitialValue = String(args.initialValue ?? args.startValue ?? 0);
    }
    const warnings = await fgdWarnings(classname, kv, ctx);
    const [id = null] = await addEntities(path, [kv], ctx);
    verifyEntities(path, [id], [classname]);
    await addOutputs(path, id!, args.outputs ?? [], ctx);
    return {
      path,
      entityId: id,
      classname,
      keyvalues: kv,
      warnings,
      nextStep:
        args.kind === "auto"
          ? "logic_auto fires OnMapSpawn; the rest of the entity work happens in its outputs."
          : "Trigger it with an output; a logic entity that nothing fires is silent.",
    };
  },
});

export const entityFamilyTools = [writeTriggerTool, writeMoverTool, writeLogicTool];
