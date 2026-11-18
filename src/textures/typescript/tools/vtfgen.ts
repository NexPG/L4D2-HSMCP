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
    "Turns a PNG into a .vtf the engine can load, without VTFCmd or vtex. Decodes the PNG " +
    "itself (non-interlaced, 8/16-bit, grey/RGB/palette/RGBA), scales a non-power-of-two " +
    "image to the next power of two when asked, builds the full mip chain, and writes VTF " +
    "7.4 — the version every L4D2 material uses, measured on the stock pak. Formats are " +
    "the uncompressed ones (BGRA8888 by default): DXT needs a compressor, and an " +
    "uncompressed VTF is exact rather than approximate. The file is read back and pixels " +
    "are compared, so `verified` means the round-trip matched. Needs the Python sidecar.",
  realm: "local",
  guarded: true,
  inputSchema: {
    image: z.string().describe("Path to the source .png, absolute or relative to the repo root."),
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
    const image = resolveInput(args.image, ctx.config);
    if (!existsSync(image)) throw new Error(`${image} does not exist`);
    const requested = resolveInput(args.path, ctx.config);
    const path = requested.toLowerCase().endsWith(".vtf") ? requested : `${requested}.vtf`;
    if (existsSync(path) && !args.overwrite) {
      throw new Error(`${path} already exists; pass overwrite: true to replace it`);
    }
    const result = (await callSidecar(
      "vtf_write",
      {
        image,
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
