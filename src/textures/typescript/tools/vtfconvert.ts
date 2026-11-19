/**
 * VTF conversion and extraction: the half of VTFEdit that is not "make one from a PNG".
 *
 * A shipped texture often needs to become DXT1/DXT5, or be halved, or lose its mips for a
 * UI sheet. `write_vtf` starts from a PNG; this starts from the VTF itself, decodes it,
 * rebuilds the mip chain in the target format and verifies the result. `extract_vtf` is the
 * other direction: a PNG the agent can look at, without going through a material.
 */
import { existsSync, statSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";

const FORMAT = z.enum(["BGRA8888", "RGBA8888", "BGRX8888", "DXT1", "DXT5"]);

export const convertVtfTool = defineTool({
  name: "convert_vtf",
  description:
    "Rebuilds an existing 2D .vtf in another format or size: decode, optional resize " +
    "(power-of-two), re-encode as BGRA8888/RGBA8888/BGRX8888/DXT1/DXT5, regenerate the " +
    "mip chain, save and read back. The image is compared after the round-trip — byte for " +
    "byte for lossless formats, by measured mean error for DXT. This is how a 16 MB " +
    "uncompressed texture becomes a 2.7 MB DXT1 one without VTFCmd. Cubemaps, animated and " +
    "volume textures are refused; their tools are run_cubemap2hdr/run_tga2skybox/VTFCmd.",
  realm: "local",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Source .vtf."),
    output: z.string().describe("Destination .vtf. The suffix is added if missing."),
    format: FORMAT.optional().describe("Target format. Defaults to the source's format."),
    width: z.number().int().min(1).max(4096).optional().describe("Target width; power of two."),
    height: z.number().int().min(1).max(4096).optional().describe("Target height; power of two."),
    resize: z.enum(["nearest", "bilinear"]).default("bilinear"),
    version: z.string().default("7.4"),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    bytes: z.number(),
    source: z.string(),
    sourceFormat: z.string(),
    format: z.string(),
    version: z.string(),
    width: z.number(),
    height: z.number(),
    mipCount: z.number(),
    meanError: z.number(),
    maxError: z.number(),
    verified: z.boolean(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const source = resolveInput(args.path, ctx.config);
    if (!existsSync(source)) throw new Error(`${source} does not exist`);
    const requested = resolveInput(args.output, ctx.config);
    const output = requested.toLowerCase().endsWith(".vtf") ? requested : `${requested}.vtf`;
    assertWritable(output, ctx.config);
    const result = (await callSidecar(
      "vtf_convert",
      {
        path: source,
        out: output,
        format: args.format,
        width: args.width,
        height: args.height,
        resize: args.resize,
        version: args.version,
      },
      ctx.config,
      300_000,
    )) as Record<string, unknown>;
    ctx.audit.record({
      kind: "file_write",
      data: { path: output, created: true, bytes: statSync(output).size },
    });
    return result;
  },
});

export const extractVtfTool = defineTool({
  name: "extract_vtf",
  description:
    "Decodes a .vtf's first mip to a PNG the agent can look at, optionally downscaled and " +
    "written to `out`. This is the direct texture view: `preview_asset` resolves a material " +
    "first and only shows its base texture, while this works on any VTF - a decal, a UI " +
    "sprite, a texture that no VMT names. A cubemap takes `face` (right, left, back, front, " +
    "up, down) instead of being refused. Returns the format, dimensions and mip count with " +
    "the image, so 'is this DXT1 and is it the size I asked for' is answered in the same reply.",
  realm: "local",
  inputSchema: {
    path: z.string().describe("Source .vtf."),
    out: z.string().optional().describe("Write the PNG here instead of returning base64."),
    face: z
      .enum(["right", "left", "back", "front", "up", "down", "sphere"])
      .optional()
      .describe("Cubemap face to extract. Defaults to the first face; ignored for a 2D texture."),
    maxSize: z.number().int().min(32).max(4096).default(512),
  },
  outputSchema: {
    path: z.string(),
    format: z.string(),
    width: z.number(),
    height: z.number(),
    previewWidth: z.number(),
    previewHeight: z.number(),
    mipCount: z.number(),
    pngBytes: z.number(),
    out: z.string().optional(),
    pngBase64: z.string().optional(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const out = args.out ? assertWritable(resolveInput(args.out, ctx.config), ctx.config) : undefined;
    const result = (await callSidecar(
      "vtf_extract",
      { path, out, maxSize: args.maxSize, face: args.face },
      ctx.config,
      300_000,
    )) as Record<string, unknown> & { pngBase64?: string };
    if (out) {
      ctx.audit.record({ kind: "file_write", data: { path: out, created: true } });
    }
    return {
      ...result,
      ...(result.pngBase64 ? { _image: { data: result.pngBase64, mimeType: "image/png" } } : {}),
    };
  },
});

export const vtfConvertTools = [convertVtfTool, extractVtfTool];
