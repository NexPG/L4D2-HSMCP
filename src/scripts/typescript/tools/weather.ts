import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveVmfInput } from "../../../core/typescript/tools/paths.js";
import { editVmf } from "../../../maps/typescript/tools/vmfedit.js";
import { writeVmfSolidTool } from "../../../maps/typescript/tools/build.js";

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);
const COLOR = z.array(z.number().int().min(0).max(255)).length(3);

/**
 * `func_precipitation`'s `preciptype` values, read from the stock
 * `bin/left4dead2.fgd` with `read_fgd_class` on 17/11/2026. The names are the choices the
 * FGD displays; the numbers are what the engine stores.
 */
export const PRECIPITATION_TYPES = {
  rain: "0",
  snow: "1",
  ash: "2",
  snowfall: "3",
  "particle-rain": "4",
  "particle-ash": "5",
  "particle-rain-storm": "6",
  "particle-bugs": "7",
  "particle-smoke": "8",
} as const;

export type PrecipitationKind = keyof typeof PRECIPITATION_TYPES;

const Precipitation = z.object({
  kind: z
    .enum(Object.keys(PRECIPITATION_TYPES) as [PrecipitationKind, ...PrecipitationKind[]])
    .default("rain"),
  mins: VEC3.describe("Low corner of the volume the precipitation falls inside."),
  maxs: VEC3.describe("High corner of that volume."),
  density: z.number().int().min(0).max(100).default(100).describe("Density (0-100%)."),
  color: COLOR.default([100, 100, 100]).describe("Rain/snow colour, R G B."),
});

const Fog = z.object({
  enabled: z.boolean().default(true),
  color: COLOR.default([255, 255, 255]),
  color2: COLOR.optional().describe("Second colour for a blended fog. Defaults to `color`."),
  start: z.number().min(0).default(500),
  end: z.number().min(0).default(2000),
  maxDensity: z.number().min(0).max(1).default(1),
  blend: z.boolean().default(false),
  lerpTime: z.number().min(0).default(0),
});

const number = (value: number): string =>
  Number.isInteger(value) ? `${value}.0` : `${value}`;

export const writeWeather = defineTool({
  name: "write_weather",
  description:
    "Adds Left 4 Dead 2 weather to a map: a `func_precipitation` volume for rain, snow, " +
    "ash or one of the particle variants, and an `env_fog_controller` for distance fog. " +
    "The precipitation types are read from the stock FGD, the brush is checked by the same " +
    "independent solid reader as every other writer, and the fog controller is refused if " +
    "the map already has one rather than silently giving it a twin. Static checks only: " +
    "whether the rain looks right is an eye question. Guarded.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("The .vmf."),
    precipitation: Precipitation.optional().describe("A weather volume. Omit for fog alone."),
    fog: Fog.optional().describe("Distance fog. Omit for precipitation alone."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    precipitationEntityId: z.number().nullable(),
    solidIds: z.array(z.number()),
    fogEntityId: z.number().nullable(),
    warnings: z.array(z.string()),
  },
  handler: async (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    if (!args.precipitation && !args.fog) {
      throw new Error("nothing to add: pass precipitation, fog, or both");
    }

    const warnings: string[] = [];
    let precipitationEntityId: number | null = null;
    let fogEntityId: number | null = null;
    const solidIds: number[] = [];

    if (args.precipitation) {
      const p = args.precipitation;
      const kind = (p.kind ?? "rain") as PrecipitationKind;
      const density = p.density ?? 100;
      const color = p.color ?? [100, 100, 100];

      for (let axis = 0; axis < 3; axis++) {
        if (!(p.mins[axis]! < p.maxs[axis]!)) {
          throw new Error(
            `the precipitation volume is empty on the ${"xyz"[axis]} axis: ` +
              `${p.mins[axis]} must be below ${p.maxs[axis]}`,
          );
        }
      }
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(p.mins[axis]!) > 16384 || Math.abs(p.maxs[axis]!) > 16384) {
          throw new Error(`the precipitation volume leaves Source's world (-16384..16384)`);
        }
      }

      const entity = (await editVmf.handler(
        {
          path,
          ops: [
            {
              op: "add",
              keyvalues: {
                classname: "func_precipitation",
                preciptype: PRECIPITATION_TYPES[kind],
                renderamt: String(density),
                rendercolor: color.join(" "),
              },
            },
          ],
          backup: false,
          dryRun: false,
          confirm: true,
        },
        ctx,
      )) as { outcomes: Array<{ ids: number[] }> };
      precipitationEntityId = entity.outcomes[0]?.ids[0] ?? null;

      const solid = (await writeVmfSolidTool.handler(
        {
          path,
          entityId: precipitationEntityId ?? undefined,
          solids: [{ shape: "box", mins: p.mins, maxs: p.maxs }],
          material: "TOOLS/TOOLSNODRAW",
          backup: false,
          dryRun: false,
          confirm: true,
        },
        ctx,
      )) as { solidIds: number[] };
      solidIds.push(...solid.solidIds);

      warnings.push(
        "func_precipitation is a volume, not a visible surface: the brush itself is never " +
          "drawn, and its material does not affect the weather.",
      );
      if (p.maxs[0]! - p.mins[0]! < 64 || p.maxs[1]! - p.mins[1]! < 64) {
        warnings.push(
          "the volume is narrower than 64 units on a horizontal axis, so most of the map " +
            "will be outside the weather.",
        );
      }
      if (!/"skyname"\s+"[^"]+"/i.test(readFileSync(path, "utf8"))) {
        warnings.push(
          "worldspawn has no skyname: precipitation can still fall, but outside the map is " +
            "not drawn, so set a sky with set_map_properties if this is an outdoor area.",
        );
      }
    }

    if (args.fog) {
      const f = args.fog;
      const enabled = f.enabled ?? true;
      const start = f.start ?? 500;
      const end = f.end ?? 2000;
      const color = f.color ?? [255, 255, 255];
      const color2 = f.color2 ?? color;
      const blend = f.blend ?? false;
      const maxDensity = f.maxDensity ?? 1;
      const lerpTime = f.lerpTime ?? 0;

      if (end <= start) {
        throw new Error(
          `fog end (${end}) must be past fog start (${start}); an inverted range hides the map`,
        );
      }
      if (/"classname"\s+"env_fog_controller"/i.test(readFileSync(path, "utf8"))) {
        throw new Error(
          "this map already has an env_fog_controller; a second one fights the first. " +
            "Change the existing one with edit_vmf instead of adding another.",
        );
      }

      const keyvalues: Record<string, string> = {
        classname: "env_fog_controller",
        fogenable: enabled ? "1" : "0",
        fogcolor: color.join(" "),
        fogstart: number(start),
        fogend: number(end),
        fogmaxdensity: String(maxDensity),
        fogblend: blend ? "1" : "0",
        foglerptime: String(lerpTime),
      };
      if (blend) keyvalues["fogcolor2"] = color2.join(" ");

      const entity = (await editVmf.handler(
        {
          path,
          ops: [{ op: "add", keyvalues }],
          backup: false,
          dryRun: false,
          confirm: true,
        },
        ctx,
      )) as { outcomes: Array<{ ids: number[] }> };
      fogEntityId = entity.outcomes[0]?.ids[0] ?? null;

      if (!enabled) {
        warnings.push("the fog controller was added disabled; turn it on before shipping");
      }
    }

    return { path, precipitationEntityId, solidIds, fogEntityId, warnings };
  },
});

export const weatherTools = [writeWeather];
