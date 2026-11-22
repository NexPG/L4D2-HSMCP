/**
 * PNG → VTF without VTFCmd.
 *
 * `run_vtf_convert` is still the right tool for a TGA or a DDS, but it needs VTFEdit++
 * installed. This one is native: our PNG reader decodes the pixels, srctools writes the
 * header and mip chain, and our own range-fit encoder supplies DXT1/DXT5. Every result is
 * read back — exactly for lossless formats, by measured error for DXT.
 */
import { existsSync, statSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

export const writeVtfTool = defineTool({
  name: "write_vtf",
  description:
    "Turns one PNG, or an ordered set of PNG frames, into a .vtf the engine can load, " +
    "without VTFCmd or vtex. Decodes the PNG itself (non-interlaced, 8/16-bit, " +
    "grey/RGB/palette/RGBA), scales a non-power-of-two image to the next power of two when " +
    "asked, builds the full mip chain, and writes VTF 7.4 - the version every L4D2 material " +
    "uses, measured on the stock pak. `frames` writes an animated texture; every frame must " +
    "share dimensions. Formats are BGRA8888/RGBA8888 (lossless), BGRX8888 (opaque) and " +
    "DXT1/DXT5 (this server's encoder). The alpha flag (one-bit for DXT1, eight-bit " +
    "otherwise) and the average reflectivity are set, so transparency and bounced light are " +
    "not left at zero. The file is read back and pixels are compared - exactly for lossless, " +
    "by measured error for DXT - so `verified` means the round-trip matched. Needs the " +
    "Python sidecar.",
  realm: "local",
  guarded: true,
  inputSchema: {
    image: z
      .string()
      .optional()
      .describe("Path to the single source .png, absolute or relative to the repo root."),
    frames: z
      .array(z.string())
      .min(2)
      .optional()
      .describe(
        "Ordered PNG frames for an animated VTF. Give this instead of `image`; every frame " +
          "must share dimensions.",
      ),
    path: z
      .string()
      .describe("Where to write the .vtf. The .vtf suffix is added if missing."),
    format: z
      .enum(["BGRA8888", "RGBA8888", "BGRX8888", "DXT1", "DXT5"])
      .default("BGRA8888")
      .describe(
        "BGRA8888/RGBA8888 are lossless; BGRX keeps RGB and forces alpha to 255; " +
          "DXT1/DXT5 use this server's own range-fit encoder and are verified by measured " +
          "error, not byte equality. DXT is 4-8x smaller, which matters for a 2048² texture.",
      ),
    version: z.string().default("7.4").describe("VTF version, 7.2 through 7.5. L4D2 uses 7.4."),
    clampS: z.boolean().default(false).describe("Set CLAMP_S: no horizontal wrapping."),
    clampT: z.boolean().default(false).describe("Set CLAMP_T: no vertical wrapping."),
    resize: z
      .enum(["nearest", "bilinear", "none"])
      .default("nearest")
      .describe(
        "What to do with a non-power-of-two image. `none` refuses it; the VTF format requires powers of two.",
      ),
    overwrite: z.boolean().default(false),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    image: z.string(),
    images: z.array(z.string()),
    frameCount: z.number(),
    version: z.string(),
    width: z.number(),
    height: z.number(),
    originalWidth: z.number(),
    originalHeight: z.number(),
    resized: z.boolean(),
    format: z.string(),
    mipCount: z.number(),
    flags: z.number(),
    clampS: z.boolean(),
    clampT: z.boolean(),
    verified: z.boolean(),
    /** Mean absolute channel error after the round-trip; 0 for lossless formats. */
    meanError: z.number(),
    maxError: z.number(),
    alphaPreserved: z.boolean(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    if ((args.image === undefined) === (args.frames === undefined)) {
      throw new Error("give exactly one of `image` or `frames`");
    }
    const images = (args.frames ?? (args.image ? [args.image] : [])).map((item) =>
      resolveInput(item, ctx.config),
    );
    for (const image of images) {
      if (!existsSync(image)) throw new Error(`${image} does not exist`);
    }
    const requested = resolveInput(args.path, ctx.config);
    const path = requested.toLowerCase().endsWith(".vtf") ? requested : `${requested}.vtf`;
    if (existsSync(path) && !args.overwrite) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }
    const result = (await callSidecar(
      "vtf_write",
      {
        ...(args.frames ? { frames: images } : { image: images[0] }),
        path,
        format: args.format,
        version: args.version,
        clampS: args.clampS,
        clampT: args.clampT,
        resize: args.resize,
      },
      ctx.config,
      300_000,
    )) as Record<string, unknown>;
    ctx.audit.record({
      kind: "file_write",
      data: { path: result.path, created: true, bytes: statSync(result.path as string).size },
    });
    return result;
  },
});

export const vtfGenTools = [writeVtfTool];
