import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import type { ToolContext } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { maxId, readEntities } from "../vmf/edit.js";
import { parse } from "../../../formats/typescript/kv/parse.js";
import { readFgdClass } from "./vmf.js";
import { editVmf } from "./vmfedit.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);
const COLOR = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);

const vec = (v: readonly number[]): string => v.map((n) => String(Math.round(n * 1000) / 1000)).join(" ");

function insideWorld(origin: readonly number[]): boolean {
  return origin.every((n) => Math.abs(n) <= 16384);
}

/** Add one or more entities and return the ids `edit_vmf` assigned. */
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

/** The ids must read back as the classes they claimed, or the write is refused. */
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

/**
 * Best-effort FGD check. A missing sidecar or a class the FGD omits is a warning, not a
 * refusal: the map still compiles, and `read_vmf_lint` is the final authority.
 */
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
      if (["classname", "origin", "angles", "targetname", "spawnflags"].includes(low)) return false;
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

function nextName(path: string, prefix: string): string {
  const nodes = parse(readFileSync(path, "utf8"));
  return `${prefix}_${maxId(nodes) + 1}`;
}

export const writeLightTool = defineTool({
  name: "write_light",
  description:
    "Places a light of a named kind with the keys that make it work: a point `light`, a " +
    "`light_environment` with its sun angles and ambient colour, a `light_dynamic`, an " +
    "`env_sun`, or a `shadow_control`. Colour is 0-255; brightness is the fourth number " +
    "Source writes into `_light`. The environment kind writes `_ambient` and `pitch` as " +
    "well, because a sun with no angle is a sun pointing at the floor. Keys are checked " +
    "against the game's FGD when the sidecar is available; a missing FGD is a warning, " +
    "not a refusal. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z
      .enum(["point", "environment", "dynamic", "sun", "shadow"])
      .describe(
        "point=light, environment=light_environment, dynamic=light_dynamic, " +
          "sun=env_sun, shadow=shadow_control.",
      ),
    origin: VEC3.describe("Where the entity sits."),
    color: COLOR.default([255, 255, 255]).describe("Light colour, 0-255 per channel."),
    brightness: z.number().min(0).max(5000).default(200).describe("Brightness in `_light`."),
    ambient: COLOR.default([255, 255, 255]).describe("light_environment ambient colour."),
    ambientBrightness: z.number().min(0).max(5000).default(20).describe("Ambient brightness."),
    angles: VEC3.default([0, 0, 0]).describe("Pitch, yaw, roll for environment/sun."),
    distance: z.number().min(0).optional().describe("light/light_dynamic falloff distance."),
    spotlightRadius: z.number().min(0).optional().describe("light_dynamic spotlight radius."),
    cone: z.number().min(0).max(180).optional().describe("light_dynamic outer cone."),
    innerCone: z.number().min(0).max(180).optional().describe("light_dynamic inner cone."),
    style: z.number().int().min(0).max(11).optional().describe("Source light style number."),
    size: z.number().min(0).optional().describe("env_sun sprite size."),
    targetname: z.string().optional(),
    keyvalues: z.record(z.string()).default({}).describe("Extra keys, written last."),
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
    if (!insideWorld(args.origin)) throw new Error(`origin ${vec(args.origin)} leaves Source's world`);
    // Defaults live in the schema; a direct handler call does not apply them.
    const origin = args.origin;
    const color = args.color ?? [255, 255, 255];
    const ambient = args.ambient ?? [255, 255, 255];
    const angles = args.angles ?? [0, 0, 0];
    const brightness = args.brightness ?? 200;
    const ambientBrightness = args.ambientBrightness ?? 20;
    const [r, g, b] = color;
    const [ar, ag, ab] = ambient;
    const kindToClass = {
      point: "light",
      environment: "light_environment",
      dynamic: "light_dynamic",
      sun: "env_sun",
      shadow: "shadow_control",
    } as const;
    const className = kindToClass[args.kind];
    const keyvalues: Record<string, string> = {
      classname: className,
      origin: vec(origin),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
    };

    if (args.kind === "point") {
      keyvalues["_light"] = `${r} ${g} ${b} ${brightness}`;
      if (args.distance !== undefined) keyvalues["_distance"] = String(args.distance);
      if (args.style !== undefined) keyvalues["style"] = String(args.style);
    } else if (args.kind === "environment") {
      keyvalues["_light"] = `${r} ${g} ${b} ${brightness}`;
      keyvalues["_ambient"] = `${ar} ${ag} ${ab} ${ambientBrightness}`;
      keyvalues["angles"] = vec(angles);
      keyvalues["pitch"] = String(Math.round(angles[0]));
    } else if (args.kind === "dynamic") {
      keyvalues["_light"] = `${r} ${g} ${b} ${brightness}`;
      keyvalues["angles"] = vec(angles);
      keyvalues["pitch"] = String(Math.round(angles[0]));
      if (args.distance !== undefined) keyvalues["distance"] = String(args.distance);
      if (args.spotlightRadius !== undefined) keyvalues["spotlight_radius"] = String(args.spotlightRadius);
      if (args.cone !== undefined) keyvalues["_cone"] = String(args.cone);
      if (args.innerCone !== undefined) keyvalues["_inner_cone"] = String(args.innerCone);
    } else if (args.kind === "sun") {
      keyvalues["rendercolor"] = `${r} ${g} ${b}`;
      keyvalues["angles"] = vec(angles);
      keyvalues["pitch"] = String(Math.round(angles[0]));
      keyvalues["use_angles"] = "1";
      if (args.size !== undefined) keyvalues["size"] = String(args.size);
    } else {
      keyvalues["color"] = `${r} ${g} ${b}`;
      keyvalues["angles"] = vec(angles);
      if (args.distance !== undefined) keyvalues["distance"] = String(args.distance);
    }

    Object.assign(keyvalues, args.keyvalues ?? {});
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
        args.kind === "environment"
          ? "Compile with lighting. A sun that points at the floor is a wrong angle, not a broken light."
          : "Compile with lighting and look: a point light's shape is judged in the frame.",
    };
  },
});

export const writePostprocessTool = defineTool({
  name: "write_postprocess",
  description:
    "Places a postprocess entity: an `env_tonemap_controller` (with a `logic_auto` that sets " +
    "the requested exposure, bloom and rate inputs at map spawn), an `env_fade`, an " +
    "`env_shake`, or a `color_correction` volume. L4D2's colour-correction class is " +
    "`color_correction`, not the `colorcorrection` name from other Source games. The tonemap " +
    "controller has no keyvalues for its settings; writing keys instead of a `logic_auto` " +
    "produces a controller that does nothing. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z.enum(["tonemap", "fade", "shake", "colorcorrection"]),
    origin: VEC3.default([0, 0, 0]),
    targetname: z.string().optional(),
    exposureMin: z.number().positive().optional().describe("tonemap: SetAutoExposureMin."),
    exposureMax: z.number().positive().optional().describe("tonemap: SetAutoExposureMax."),
    bloomScale: z.number().positive().optional().describe("tonemap: SetBloomScale."),
    tonemapRate: z.number().nonnegative().optional().describe("tonemap: SetTonemapRate."),
    duration: z.number().nonnegative().default(2).describe("fade/shake duration."),
    holdTime: z.number().nonnegative().default(0).describe("fade hold time."),
    amount: z.number().int().min(0).max(255).default(255).describe("fade alpha."),
    color: COLOR.default([0, 0, 0]),
    amplitude: z.number().nonnegative().default(4).describe("shake amplitude."),
    frequency: z.number().nonnegative().default(2.5).describe("shake frequency."),
    radius: z.number().nonnegative().default(500).describe("shake radius."),
    correctionFile: z
      .string()
      .optional()
      .describe("colorcorrection: .raw file under materials/color_correction, without the extension."),
    minFalloff: z.number().nonnegative().default(0).describe("colorcorrection: minfalloff."),
    maxFalloff: z.number().nonnegative().default(0).describe("colorcorrection: maxfalloff."),
    maxWeight: z.number().nonnegative().default(1).describe("colorcorrection: maxweight."),
    fadeIn: z.number().nonnegative().default(0).describe("colorcorrection: fadeInDuration."),
    fadeOut: z.number().nonnegative().default(0).describe("colorcorrection: fadeOutDuration."),
    spawnflags: z.number().int().min(0).optional(),
    keyvalues: z.record(z.string()).default({}),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    entityId: z.number().nullable(),
    controllerId: z.number().nullable(),
    logicAutoId: z.number().nullable(),
    classname: z.string(),
    keyvalues: z.record(z.string()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const origin = args.origin ?? [0, 0, 0];
    if (!insideWorld(origin)) throw new Error(`origin ${vec(origin)} leaves Source's world`);
    const color = args.color ?? [0, 0, 0];
    const duration = args.duration ?? 2;
    const holdTime = args.holdTime ?? 0;
    const amount = args.amount ?? 255;
    const amplitude = args.amplitude ?? 4;
    const frequency = args.frequency ?? 2.5;
    const radius = args.radius ?? 500;
    const [r, g, b] = color;

    if (args.kind === "tonemap") {
      const name = args.targetname ?? nextName(path, "hsmcp_tonemap");
      const keyvalues: Record<string, string> = {
        classname: "env_tonemap_controller",
        origin: vec(origin),
        targetname: name,
        spawnflags: "1",
        ...(args.keyvalues ?? {}),
      };
      const values: Array<[string, number]> = [];
      if (args.exposureMin !== undefined) values.push(["SetAutoExposureMin", args.exposureMin]);
      if (args.exposureMax !== undefined) values.push(["SetAutoExposureMax", args.exposureMax]);
      if (args.bloomScale !== undefined) values.push(["SetBloomScale", args.bloomScale]);
      if (args.tonemapRate !== undefined) values.push(["SetTonemapRate", args.tonemapRate]);

      const logicAuto = { classname: "logic_auto", origin: vec(origin) };
      const warnings = [
        ...(await fgdWarnings("env_tonemap_controller", keyvalues, ctx)),
        ...(values.length > 0 ? await fgdWarnings("logic_auto", logicAuto, ctx) : []),
      ];
      const ids = await addEntities(path, values.length > 0 ? [keyvalues, logicAuto] : [keyvalues], ctx);
      verifyEntities(path, values.length > 0 ? [ids[0]!, ids[1]!] : [ids[0]!], values.length > 0 ? ["env_tonemap_controller", "logic_auto"] : ["env_tonemap_controller"]);

      // A VMF stores outputs in a `connections` block with repeated `OnMapSpawn` keys; a
      // flat keyvalue cannot express two of them. addOutput is the writer that appends to
      // that block, so the logic_auto is wired after it exists.
      if (values.length > 0) {
        await editVmf.handler(
          {
            path,
            ops: values.map(([input, value]) => ({
              op: "addOutput" as const,
              match: { id: ids[1]! },
              output: "OnMapSpawn",
              value: `${name},${input},${value},0,-1`,
            })),
            backup: false,
            dryRun: false,
            confirm: true,
          } as never,
          ctx as never,
        );
      }

      return {
        path,
        entityId: ids[0] ?? null,
        controllerId: ids[0] ?? null,
        logicAutoId: ids[1] ?? null,
        classname: "env_tonemap_controller",
        keyvalues,
        warnings,
        nextStep:
          values.length > 0
            ? "Compile with lighting; the logic_auto applies the exposure at map spawn."
            : "The controller has no settings; add exposureMin/exposureMax/bloomScale or wire it yourself.",
      };
    }

    if (args.kind === "colorcorrection") {
      const keyvalues: Record<string, string> = {
        classname: "color_correction",
        origin: vec(origin),
        ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
        "minfalloff": String(args.minFalloff ?? 0),
        "maxfalloff": String(args.maxFalloff ?? 0),
        "maxweight": String(args.maxWeight ?? 1),
        fadeInDuration: String(args.fadeIn ?? 0),
        fadeOutDuration: String(args.fadeOut ?? 0),
        ...(args.correctionFile !== undefined ? { filename: args.correctionFile } : {}),
        ...(args.spawnflags !== undefined ? { spawnflags: String(args.spawnflags) } : {}),
        ...(args.keyvalues ?? {}),
      };
      const warnings = await fgdWarnings("color_correction", keyvalues, ctx);
      if (!keyvalues["filename"]) {
        warnings.push(
          "no correctionFile: the volume reads the map's default colour correction, which is " +
            "whatever the engine falls back to",
        );
      } else if (!/\.raw$/i.test(keyvalues["filename"])) {
        warnings.push(
          `${keyvalues["filename"]} does not end in .raw; a colour-correction file is a .raw ` +
            `under materials/color_correction`,
        );
      }
      const [id = null] = await addEntities(path, [keyvalues], ctx);
      verifyEntities(path, [id], ["color_correction"]);
      return {
        path,
        entityId: id,
        controllerId: null,
        logicAutoId: null,
        classname: "color_correction",
        keyvalues,
        warnings,
        nextStep:
          "Color correction applies inside its falloff radius; put it where the player stands, " +
          "not at the skybox.",
      };
    }

    const className = args.kind === "fade" ? "env_fade" : "env_shake";
    const keyvalues: Record<string, string> = {
      classname: className,
      origin: vec(origin),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      ...(args.keyvalues ?? {}),
    };
    if (args.kind === "fade") {
      keyvalues["duration"] = String(duration);
      keyvalues["holdtime"] = String(holdTime);
      keyvalues["renderamt"] = String(amount);
      keyvalues["rendercolor"] = `${r} ${g} ${b}`;
    } else {
      keyvalues["amplitude"] = String(amplitude);
      keyvalues["frequency"] = String(frequency);
      keyvalues["duration"] = String(duration);
      keyvalues["radius"] = String(radius);
    }
    if (args.spawnflags !== undefined) keyvalues["spawnflags"] = String(args.spawnflags);
    const warnings = await fgdWarnings(className, keyvalues, ctx);
    const [id = null] = await addEntities(path, [keyvalues], ctx);
    verifyEntities(path, [id], [className]);
    return {
      path,
      entityId: id,
      controllerId: null,
      logicAutoId: null,
      classname: className,
      keyvalues,
      warnings,
      nextStep:
        args.kind === "fade"
          ? "Trigger the fade with an output; an env_fade does nothing on its own."
          : "Trigger the shake with an output; an env_shake does nothing on its own.",
    };
  },
});

export const writeDecalTool = defineTool({
  name: "write_decal",
  description:
    "Places `infodecal` entities at one or more points. A decal is projected onto the " +
    "surface under its origin, so the point must be on the face; the material is a decal " +
    "texture under `decals/`, not an overlay. Warns about a material outside `decals/`. " +
    "For a decal that spans a face with a chosen width and height, use write_overlay " +
    "instead. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    material: z.string().describe("Decal texture, e.g. decals/blood1."),
    positions: z.array(VEC3).min(1).max(64).describe("Points on the surface."),
    lowPriority: z.boolean().default(false).describe("Set LowPriority on every decal."),
    applyEntity: z.string().optional().describe("ApplyEntity targetname."),
    keyvalues: z.record(z.string()).default({}),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    ids: z.array(z.number().nullable()),
    count: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const warnings: string[] = [];
    if (!/^decals\//i.test(args.material)) {
      warnings.push(
        `${args.material} is not under decals/; most infodecal textures live there, and an ` +
          `overlay material belongs in write_overlay`,
      );
    }
    for (const position of args.positions) {
      if (!insideWorld(position)) throw new Error(`position ${vec(position)} leaves Source's world`);
    }
    const keyvalues = args.positions.map((position) => ({
      classname: "infodecal",
      origin: vec(position),
      texture: args.material,
      ...(args.lowPriority === true ? { LowPriority: "1" } : {}),
      ...(args.applyEntity !== undefined ? { ApplyEntity: args.applyEntity } : {}),
      ...(args.keyvalues ?? {}),
    }));
    warnings.push(...(await fgdWarnings("infodecal", keyvalues[0]!, ctx)));
    const ids = await addEntities(path, keyvalues, ctx);
    verifyEntities(path, ids, keyvalues.map(() => "infodecal"));
    return {
      path,
      ids,
      count: ids.length,
      warnings,
      nextStep: "Compile and look: a decal on the wrong surface is invisible or floats.",
    };
  },
});

export const writeRopeTool = defineTool({
  name: "write_rope",
  description:
    "Places a rope as the pair the engine expects: a `move_rope` at the start whose " +
    "`NextKey` names a `keyframe_rope` at the end. Both carry the material, width, slack " +
    "and subdivision, because a keyframe with different visual keys renders a different " +
    "rope. Names are generated unless given. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    start: VEC3,
    end: VEC3,
    material: z.string().default("cable/cable.vmt"),
    width: z.number().positive().default(2),
    slack: z.number().int().min(0).default(25),
    subdiv: z.number().int().min(0).default(2),
    type: z.enum(["rope", "semi-rigid", "rigid"]).default("rope"),
    barbed: z.boolean().default(false),
    collide: z.boolean().default(false),
    dangling: z.boolean().default(false),
    breakable: z.boolean().default(false),
    targetname: z.string().optional(),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    startId: z.number().nullable(),
    endId: z.number().nullable(),
    startName: z.string(),
    endName: z.string(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!insideWorld(args.start) || !insideWorld(args.end)) {
      throw new Error("a rope endpoint leaves Source's world");
    }
    const startName = args.targetname ?? nextName(path, "hsmcp_rope");
    const endName = `${startName}_end`;
    const visual: Record<string, string> = {
      RopeMaterial: args.material ?? "cable/cable.vmt",
      Width: String(args.width ?? 2),
      Slack: String(args.slack ?? 25),
      Subdiv: String(args.subdiv ?? 2),
      Type: String((args.type ?? "rope") === "rope" ? 0 : args.type === "semi-rigid" ? 1 : 2),
      Barbed: args.barbed === true ? "1" : "0",
      Collide: args.collide === true ? "1" : "0",
      Dangling: args.dangling === true ? "1" : "0",
      Breakable: args.breakable === true ? "1" : "0",
    };
    const start = {
      classname: "move_rope",
      targetname: startName,
      NextKey: endName,
      origin: vec(args.start),
      ...visual,
    };
    const end = {
      classname: "keyframe_rope",
      targetname: endName,
      origin: vec(args.end),
      ...visual,
    };
    const warnings = [
      ...(await fgdWarnings("move_rope", start, ctx)),
      ...(await fgdWarnings("keyframe_rope", end, ctx)),
    ];
    const ids = await addEntities(path, [start, end], ctx);
    verifyEntities(path, [ids[0]!, ids[1]!], ["move_rope", "keyframe_rope"]);
    return {
      path,
      startId: ids[0] ?? null,
      endId: ids[1] ?? null,
      startName,
      endName,
      warnings,
      nextStep:
        "Compile and look: a rope with no material or two points in the same place is invisible.",
    };
  },
});

export const writeSpriteTool = defineTool({
  name: "write_sprite",
  description:
    "Places a sprite, a beam or a laser with the targets those entities need. A sprite is " +
    "one `env_sprite`; a beam creates the two `info_target`s and the `env_beam` between " +
    "them; a laser creates its end target when one is not named. Colour and alpha are " +
    "written on the effect entity, and the beam/laser texture is checked for a `sprites/` " +
    "path. Guarded.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    kind: z.enum(["sprite", "beam", "laser"]),
    origin: VEC3.optional().describe("Sprite/laser origin; beam start."),
    start: VEC3.optional().describe("Beam start (alias of origin)."),
    end: VEC3.optional().describe("Beam/laser end when no target is named."),
    target: z.string().optional().describe("Existing targetname for a beam or laser end."),
    texture: z
      .string()
      .default("sprites/laserbeam.spr")
      .describe("Beam/laser sprite; a sprite's model is `model`."),
    model: z.string().default("sprites/glow01.spr").describe("env_sprite model."),
    color: COLOR.default([255, 255, 255]),
    alpha: z.number().int().min(0).max(255).default(255),
    scale: z.number().positive().default(1).describe("env_sprite scale."),
    width: z.number().positive().default(2).describe("Beam width / BoltWidth."),
    life: z.number().nonnegative().default(0).describe("Beam life; 0 is permanent."),
    noise: z.number().nonnegative().default(0).describe("Beam/laser noise amplitude."),
    damage: z.number().nonnegative().default(0).describe("Beam/laser damage per second."),
    spawnflags: z.number().int().min(0).optional(),
    targetname: z.string().optional(),
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
    const [r, g, b] = args.color ?? [255, 255, 255];
    const alpha = args.alpha ?? 255;
    const scale = args.scale ?? 1;
    const width = args.width ?? 2;
    const life = args.life ?? 0;
    const noise = args.noise ?? 0;
    const damage = args.damage ?? 0;
    const texture = args.texture ?? "sprites/laserbeam.spr";
    const model = args.model ?? "sprites/glow01.spr";
    const keyvalues: Array<Record<string, string>> = [];
    const classes: string[] = [];
    const warnings: string[] = [];
    const base = args.targetname ?? nextName(path, `hsmcp_${args.kind}`);
    const origin = args.origin ?? args.start;
    if (!origin) throw new Error("give origin (or start for a beam)");

    if (args.kind === "sprite") {
      if (!insideWorld(origin)) throw new Error("sprite origin leaves Source's world");
      const kv = {
        classname: "env_sprite",
        origin: vec(origin),
        model,
        scale: String(scale),
        rendercolor: `${r} ${g} ${b}`,
        renderamt: String(alpha),
        rendermode: "5",
        ...(args.spawnflags !== undefined ? { spawnflags: String(args.spawnflags) } : {}),
        ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      };
      warnings.push(...(await fgdWarnings("env_sprite", kv, ctx)));
      keyvalues.push(kv);
      classes.push("env_sprite");
    } else if (args.kind === "beam") {
      const end = args.end;
      if (!end) throw new Error("a beam needs end or an existing target");
      if (!insideWorld(origin) || !insideWorld(end)) throw new Error("a beam endpoint leaves Source's world");
      const startName = `${base}_start`;
      const endName = `${base}_end`;
      const startTarget = {
        classname: "info_target",
        targetname: startName,
        origin: vec(origin),
      };
      const endTarget = {
        classname: "info_target",
        targetname: endName,
        origin: vec(end),
      };
      const beam = {
        classname: "env_beam",
        origin: vec(origin),
        LightningStart: startName,
        LightningEnd: endName,
        texture,
        BoltWidth: String(args.width ?? 2),
        rendercolor: `${r} ${g} ${b}`,
        renderamt: String(alpha),
        life: String(life),
        NoiseAmplitude: String(noise),
        damage: String(damage),
        ...(args.spawnflags !== undefined ? { spawnflags: String(args.spawnflags) } : {}),
        ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      };
      warnings.push(...(await fgdWarnings("env_beam", beam, ctx)));
      keyvalues.push(startTarget, endTarget, beam);
      classes.push("info_target", "info_target", "env_beam");
    } else {
      if (!insideWorld(origin)) throw new Error("laser origin leaves Source's world");
      let targetName = args.target;
      if (!targetName) {
        if (!args.end) throw new Error("a laser needs target or end");
        if (!insideWorld(args.end)) throw new Error("laser end leaves Source's world");
        targetName = `${base}_end`;
        keyvalues.push({ classname: "info_target", targetname: targetName, origin: vec(args.end) });
        classes.push("info_target");
      }
      const laser = {
        classname: "env_laser",
        origin: vec(origin),
        LaserTarget: targetName,
        texture,
        width: String(width),
        NoiseAmplitude: String(noise),
        damage: String(damage),
        rendercolor: `${r} ${g} ${b}`,
        renderamt: String(alpha),
        ...(args.spawnflags !== undefined ? { spawnflags: String(args.spawnflags) } : {}),
        ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      };
      warnings.push(...(await fgdWarnings("env_laser", laser, ctx)));
      keyvalues.push(laser);
      classes.push("env_laser");
    }

    const ids = await addEntities(path, keyvalues, ctx);
    verifyEntities(path, ids, classes);
    return {
      path,
      ids,
      classes,
      warnings,
      nextStep:
        args.kind === "sprite"
          ? "Compile and look; a sprite is a card that always faces the camera."
          : "Compile and look; a beam without a visible texture is a line nobody sees.",
    };
  },
});

export const dressingTools = [
  writeLightTool,
  writePostprocessTool,
  writeDecalTool,
  writeRopeTool,
  writeSpriteTool,
];
