/**
 * The actual baked luxels, not just the lightmap footprint.
 *
 * `read_lightmap_budget` answers how many luxels vrad allocated; this reads the RGB bytes it
 * wrote. Hammer++'s lighting preview is an editor view of the same data, and a headless
 * toolkit can inspect it directly: average colour, darkest/brightest luxel, a few samples,
 * and — for one face — the lightmap as a PNG.
 *
 * Source stores four bytes per luxel in the LIGHTING lump (RGB plus alpha for LDR, RGBE for
 * HDR); the first three bytes are the visible RGB. Compressed BSPs are refused rather than
 * decoded as records.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { readAt, readHeader } from "../bsp/header.js";
import { readLightmapBudget } from "../bsp/lightmap.js";
import { encodePng } from "../render/png.js";

const LUMP_LIGHTING = 8;
const LUMP_LIGHTING_HDR = 53;

function average(rgb: Uint8Array): [number, number, number] {
  if (rgb.length === 0) return [0, 0, 0];
  let r = 0;
  let g = 0;
  let b = 0;
  const count = rgb.length / 3;
  for (let i = 0; i < rgb.length; i += 3) {
    r += rgb[i]!;
    g += rgb[i + 1]!;
    b += rgb[i + 2]!;
  }
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

export const readBspLightmapsTool = defineTool({
  name: "read_bsp_lightmaps",
  description:
    "Reads baked lightmap RGB samples from a compiled .bsp: per-face average colour, darkest " +
    "and brightest luxel, a few sample values, and the total sampled luxels. With `face` and " +
    "`out`, writes that face's lightmap as a PNG (width/height are the face's luxel " +
    "dimensions). `hdr: 'auto'` uses LDR when present, otherwise the HDR lump. " +
    "Compressed lumps are refused. Use read_lightmap_budget for the allocation budget.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    face: z.number().int().min(0).optional().describe("One face index; optional."),
    hdr: z
      .enum(["auto", "ldr", "hdr"])
      .default("auto")
      .describe("Lighting lump: auto picks LDR if non-empty, otherwise HDR."),
    limit: z.number().int().min(1).max(5000).default(50),
    samples: z.number().int().min(0).max(256).default(8),
    out: z.string().optional().describe("PNG path; requires `face`."),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    path: z.string(),
    source: z.enum(["ldr", "hdr"]),
    lightingBytes: z.number(),
    faceCount: z.number(),
    sampledFaces: z.number(),
    totalLuxels: z.number(),
    average: z.tuple([z.number(), z.number(), z.number()]),
    faces: z.array(
      z.object({
        index: z.number(),
        sizeLuxels: z.tuple([z.number(), z.number()]),
        luxels: z.number(),
        average: z.tuple([z.number(), z.number(), z.number()]),
        minLuminance: z.number(),
        maxLuminance: z.number(),
        samples: z.array(z.tuple([z.number(), z.number(), z.number()])),
      }),
    ),
    screenshotPath: z.string().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const wantedSource = args.hdr ?? "auto";
    const header = readHeader(path);
    const ldr = header.lumps[LUMP_LIGHTING];
    const hdr = header.lumps[LUMP_LIGHTING_HDR];
    const useHdr =
      wantedSource === "hdr" ||
      (wantedSource === "auto" && (!ldr || ldr.length === 0));
    const budget = readLightmapBudget(path, useHdr ? 58 : 7);
    const lump = useHdr ? hdr : ldr;
    if (!lump || lump.length === 0) {
      throw new Error(
        `${path} has no ${useHdr ? "HDR" : "LDR"} LIGHTING lump; run vrad with the other mode`,
      );
    }
    if (lump.compressed) {
      throw new Error(
        `${path}: the ${useHdr ? "HDR" : "LDR"} LIGHTING lump is LZMA-compressed; ` +
          `refusing to read it as raw RGB`,
      );
    }
    const bytes = readAt(path, lump.offset, lump.length);
    const stride = 4;
    const pack = (raw: Uint8Array, luxels: number): Uint8Array => {
      const rgb = new Uint8Array(luxels * 3);
      for (let i = 0; i < luxels; i += 1) {
        rgb[i * 3] = raw[i * 4]!;
        rgb[i * 3 + 1] = raw[i * 4 + 1]!;
        rgb[i * 3 + 2] = raw[i * 4 + 2]!;
      }
      return rgb;
    };
    const selected =
      args.face !== undefined
        ? budget.faces.filter((face) => face.index === args.face)
        : budget.faces.filter((face) => face.hasLightmap).slice(0, args.limit ?? 50);
    if (args.face !== undefined && selected.length === 0) {
      throw new Error(`face ${args.face} does not exist in ${path}`);
    }

    const faces: Array<{
      index: number;
      sizeLuxels: [number, number];
      luxels: number;
      average: [number, number, number];
      minLuminance: number;
      maxLuminance: number;
      samples: Array<[number, number, number]>;
    }> = [];
    let weighted = [0, 0, 0];
    let totalLuxels = 0;
    let png: { face: (typeof budget.faces)[number]; rgb: Uint8Array } | null = null;

    for (const face of selected) {
      if (!face.hasLightmap) continue;
      const length = face.luxels * stride;
      if (face.lightofs < 0 || face.lightofs + length > bytes.length) {
        throw new Error(
          `face ${face.index}: lightofs ${face.lightofs} + ${length} bytes is past the ` +
            `${bytes.length}-byte LIGHTING lump`,
        );
      }
      const raw = bytes.subarray(face.lightofs, face.lightofs + length);
      const rgb = pack(raw, face.luxels);
      const avg = average(rgb);
      let minLuminance = 765;
      let maxLuminance = 0;
      for (let at = 0; at < rgb.length; at += 3) {
        const luminance = rgb[at]! + rgb[at + 1]! + rgb[at + 2]!;
        if (luminance < minLuminance) minLuminance = luminance;
        if (luminance > maxLuminance) maxLuminance = luminance;
      }
      const sampleCount = Math.min(args.samples ?? 8, face.luxels);
      const samples: Array<[number, number, number]> = [];
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const at = sample * 3;
        samples.push([rgb[at]!, rgb[at + 1]!, rgb[at + 2]!]);
      }
      faces.push({
        index: face.index,
        sizeLuxels: face.sizeLuxels,
        luxels: face.luxels,
        average: avg,
        minLuminance: Math.round(minLuminance / 3),
        maxLuminance: Math.round(maxLuminance / 3),
        samples,
      });
      totalLuxels += face.luxels;
      weighted = [
        weighted[0]! + avg[0] * face.luxels,
        weighted[1]! + avg[1] * face.luxels,
        weighted[2]! + avg[2] * face.luxels,
      ];
      if (args.face !== undefined) png = { face, rgb };
    }

    if (faces.length === 0) {
      throw new Error(
        `${path} has no face with baked lightmap data in the ${useHdr ? "HDR" : "LDR"} lump`,
      );
    }

    let screenshotPath: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (args.out !== undefined) {
      if (args.face === undefined || png === null) {
        throw new Error("out needs a face; one lightmap image is one face");
      }
      const out = resolveInput(args.out, ctx.config);
      mkdirSync(dirname(out), { recursive: true });
      width = png.face.sizeLuxels[0] + 1;
      height = png.face.sizeLuxels[1] + 1;
      writeFileSync(out, encodePng(png.rgb, width, height));
      screenshotPath = out;
    }

    return {
      path,
      source: useHdr ? ("hdr" as const) : ("ldr" as const),
      lightingBytes: bytes.length,
      faceCount: budget.faceCount,
      sampledFaces: faces.length,
      totalLuxels,
      average: [
        Math.round(weighted[0]! / totalLuxels),
        Math.round(weighted[1]! / totalLuxels),
        Math.round(weighted[2]! / totalLuxels),
      ] as [number, number, number],
      faces,
      screenshotPath,
      width,
      height,
      nextStep:
        "Use read_lightmap_budget for allocation and read_bsp_faces for the face material. " +
        "A dark average is a lighting decision, not a reader failure.",
    };
  },
});

export const lightmapReadTools = [readBspLightmapsTool];
