/**
 * Turning an image into a texture the engine can load.
 *
 * The last hole in "make a material without leaving this server": `read_game_content` finds
 * what the game already has, `run_tga2skybox` builds a cubemap, `run_pack` ships it -- and
 * nothing turned a PNG or a TGA into a `.vtf`. That step lived in a GUI.
 *
 * VTFCmd is the command-line half of ficool2's VTFEdit++, and it is a plain argv tool: no
 * prompts, no "press any key". Two things about driving it were measured on 14/08/2026 and
 * are why this file looks the way it does:
 *
 * * **`-output` fails**, with `System Error: 0x00000003: Path not found`, for a
 *   directory that exists -- short path, long path, trailing separator, all the same. So
 *   the `.vtf` is written beside its source, which is VTFCmd's own default and works.
 * * **`-shader` refuses to write a `.vmt`** unless the texture sits under a `materials/`
 *   folder: `Error creating vmt: texture is not in a ...\materials\ folder.` Reported
 *   rather than worked around -- moving the caller's file to satisfy a tool is not this
 *   server's business.
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { readVtfHeader } from "../bsp/vtf.js";
import {
  VTF_RESOURCE_HOTSPOT,
  VTF_RESOURCE_PARTICLE_SHEET,
  buildVtfHotspot,
  buildVtfParticleSheet,
  hotspotFlags,
  particleSheetVersion,
  readVtfResourcePayload,
  writeVtfResource,
} from "../formats/vtfresources.js";
import type { VtfHotspotRect, VtfSheetFrameCoords } from "../formats/vtfresources.js";
import { runExternalTool } from "../../../maps/typescript/compile/external.js";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import type { ToolContext } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import {
  BACKUP,
  BACKUP_PATH,
  CONFIRM,
  DRY_RUN,
  resolveInput,
} from "../../../core/typescript/tools/paths.js";

export const VTFCMD_EXE = "VTFCmd.exe";

/** What DevIL reads. Anything else is refused here rather than failing inside the tool. */
const READABLE = [".tga", ".png", ".bmp", ".jpg", ".jpeg", ".gif", ".dds", ".psd"];

export const runVtfConvert = defineTool({
  name: "run_vtf_convert",
  description:
    "Converts an image (.tga, .png, .bmp, .jpg ...) into a .vtf the engine can load, " +
    "written beside the source. The step that used to need a GUI: read_game_content finds " +
    "what the game ships, this makes what it does not. Drives VTFCmd from ficool2's " +
    "VTFEdit++, a separate download; health says whether it is installed. Reads the result " +
    "back and reports its real format and size rather than the ones asked for.",
  realm: "local",
  guarded: true,
  inputSchema: {
    image: z.string().describe("Path to the source image, absolute or relative to the repo root."),
    format: z
      .string()
      .optional()
      .describe(
        "Format for textures with no alpha: DXT1, BGR888, RGBA8888 ... VTFCmd's default " +
          "is DXT1, which is what a wall texture should be.",
      ),
    alphaFormat: z
      .string()
      .optional()
      .describe("Format for textures that have an alpha channel. VTFCmd's default is DXT5."),
    version: z
      .string()
      .optional()
      .describe("VTF version to write, e.g. 7.4. Left alone unless a target needs one."),
    noMipmaps: z
      .boolean()
      .default(false)
      .describe("Skip mipmaps. Right for a UI texture, wrong for anything in the world."),
    flags: z
      .array(z.string())
      .optional()
      .describe("VTF flags to set, e.g. NOLOD, CLAMPS, CLAMPT. Passed through one by one."),
    confirm: CONFIRM,
  },
  outputSchema: {
    image: z.string(),
    vtf: z.string(),
    written: z.boolean(),
    /** Read back from the file: the format that came out, which is not always the one asked for. */
    header: z
      .object({
        version: z.string(),
        width: z.number(),
        height: z.number(),
        cubemap: z.boolean(),
        format: z.string(),
      })
      .nullable(),
    bytes: z.number().nullable(),
    exitCode: z.number().nullable(),
    ok: z.boolean(),
    tool: z.string(),
    stdoutTail: z.string(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const image = resolveInput(args.image, ctx.config);
    if (!existsSync(image)) throw new Error(`${image} does not exist`);

    const ext = extname(image).toLowerCase();
    if (!READABLE.includes(ext)) {
      throw new Error(
        `${ext || "a file with no extension"} is not an image VTFCmd reads. It takes ` +
          `${READABLE.join(", ")} -- and answers anything else with "Error loading input ` +
          `file", which says nothing about which part it disliked.`,
      );
    }

    const vtf = join(dirname(image), `${basename(image, extname(image))}.vtf`);
    assertWritable(vtf, ctx.config);

    // No -output: it fails for a directory that exists (measured 14/08/2026),
    // and VTFCmd's own default is to write beside the source, which works.
    const argv = [
      "-file",
      image.replace(/\//g, "\\"),
      ...(args.format ? ["-format", args.format] : []),
      ...(args.alphaFormat ? ["-alphaformat", args.alphaFormat] : []),
      ...(args.version ? ["-version", args.version] : []),
      ...(args.noMipmaps ? ["-nomipmaps"] : []),
      ...(args.flags ?? []).flatMap((f) => ["-flag", f]),
    ];

    const run = await runExternalTool(ctx.config, VTFCMD_EXE, argv, { timeoutMs: 300_000 });

    const header = existsSync(vtf) ? readVtfHeader(readFileSync(vtf)) : null;
    const written = header !== null;
    ctx.audit.record({ kind: "file_write", data: { path: vtf, written, created: true } });

    return {
      image,
      vtf,
      written,
      header:
        header === null
          ? null
          : {
              version: header.version,
              width: header.width,
              height: header.height,
              cubemap: header.cubemap,
              format: header.format,
            },
      bytes: written ? statSync(vtf).size : null,
      exitCode: run.code,
      ok: written,
      tool: run.binary,
      stdoutTail: run.stdout.split(/\r?\n/).slice(-20).join("\n").slice(0, 2000),
      note:
        `The format in 'header' is the one that came out. Asking for DXT1 on an image with ` +
        `an alpha channel gives the alpha format instead -- VTFCmd chooses per texture, and ` +
        `reading it back is the only way to know which it took. A .vmt is not written: ` +
        `VTFCmd only does that under a materials/ folder, and read_game_content shows what ` +
        `an existing one looks like.`,
    };
  },
});

export const readVtfTool = defineTool({
  name: "read_vtf",
  description:
    "Reads a `.vtf` header: version, dimensions, flags, frames, format name and whether it " +
    "is a cubemap. This is the texture-side answer Hammer's texture browser does not give " +
    "as data: it tells an agent whether a texture is DXT1 or DXT5, six faces or one, and " +
    "whether the size is what the material expects. It reads 80 bytes, not the image. " +
    "`details: true` also reads the version 7.3+ resource table, particle-sheet sequences " +
    "and hotspot rectangles through `srctools.vtf`; that needs the Python sidecar.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vtf, absolute or relative to the repo root."),
    details: z
      .boolean()
      .optional()
      .describe(
        "Also read the resource table, particle-sheet sequences and hotspots. " +
          "Default false, which is a header read only.",
      ),
  },
  outputSchema: {
    path: z.string(),
    bytes: z.number(),
    version: z.string(),
    width: z.number(),
    height: z.number(),
    flags: z.number(),
    cubemap: z.boolean(),
    format: z.string(),
    frames: z.number(),
    resources: z
      .array(
        z.object({
          id: z.string().nullable(),
          rawId: z.string(),
          flags: z.number(),
          kind: z.string(),
          value: z.number().nullable(),
          size: z.number().nullable(),
        }),
      )
      .optional(),
    sheetInfo: z
      .array(
        z.object({
          sequence: z.number(),
          clamp: z.boolean(),
          duration: z.number(),
          frameCount: z.number(),
          frames: z
            .array(
              z.object({
                duration: z.number(),
                coords: z.array(z.array(z.number())),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
    hotspotInfo: z
      .array(
        z.object({
          minX: z.number(),
          minY: z.number(),
          maxX: z.number(),
          maxY: z.number(),
          randomRotation: z.boolean(),
          randomReflection: z.boolean(),
          alternate: z.boolean(),
        }),
      )
      .nullable()
      .optional(),
    hotspotFlags: z.number().optional(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const bytes = readFileSync(path);
    const header = readVtfHeader(bytes);
    if (!header) throw new Error(`${path} is not a VTF (no VTF\\0 signature)`);
    const base = { path, bytes: bytes.length, ...header };
    if (!args.details) return base;
    const details = (await callSidecar("vtf_resources", { path, frames: true }, ctx.config, 120_000)) as {
      resources: unknown;
      sheetInfo: unknown;
      hotspotInfo: unknown;
      hotspotFlags: number;
    };
    return { ...base, ...details };
  },
});

const SHEET_COORDS = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const SHEET_FRAME = z.object({
  duration: z.number().min(0).describe("Seconds this frame is held."),
  coords: z
    .array(SHEET_COORDS)
    .length(4)
    .optional()
    .describe(
      "Four corners as [left, top, right, bottom], matching read_vtf's frame shape. " +
        "Omitted means the single left/top/right/bottom rectangle is repeated four times.",
    ),
  left: z.number().optional(),
  top: z.number().optional(),
  right: z.number().optional(),
  bottom: z.number().optional(),
});

const SHEET_SEQUENCE = z.object({
  sequence: z.number().int().min(0).max(63).describe("Engine sequence number, 0..63."),
  clamp: z.boolean().default(false).describe("Hold the last frame instead of wrapping."),
  duration: z.number().min(0).describe("Total sequence time in seconds."),
  frames: z.array(SHEET_FRAME).min(1),
});

function sheetCoords(frame: z.infer<typeof SHEET_FRAME>, at: number): VtfSheetFrameCoords {
  if (frame.coords) {
    return frame.coords as unknown as VtfSheetFrameCoords;
  }
  if ([frame.left, frame.top, frame.right, frame.bottom].some((value) => value === undefined)) {
    throw new Error(
      `frame ${at} needs either coords or all four of left/top/right/bottom`,
    );
  }
  const rect: [number, number, number, number] = [
    frame.left!,
    frame.top!,
    frame.right!,
    frame.bottom!,
  ];
  return [rect, rect, rect, rect];
}

function validateSheetCoords(coords: VtfSheetFrameCoords, label: string): void {
  for (const [corner, rect] of coords.entries()) {
    for (const value of rect) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${label} corner ${corner} coordinate ${value} is outside 0..1`);
      }
    }
    if (rect[0] > rect[2] || rect[1] > rect[3]) {
      throw new Error(`${label} corner ${corner} has left/right or top/bottom reversed`);
    }
  }
}

function commitVtf(
  path: string,
  bytes: Buffer,
  backup: boolean,
  dryRun: boolean,
  ctx: ToolContext,
): { target: string; backup: string | null } {
  const target = assertWritable(path, ctx.config);
  if (dryRun) return { target, backup: null };
  let backupPath: string | null = null;
  if (backup) {
    backupPath = assertWritable(`${target}.bak`, ctx.config);
    copyFileSync(target, backupPath);
  }
  writeFileSync(target, bytes);
  ctx.audit.record({ kind: "file_write", data: { path: target, backup: backupPath } });
  return { target, backup: backupPath };
}

const HOTSPOT_RECT = z.object({
  minX: z.number().int().min(0).max(65535),
  minY: z.number().int().min(0).max(65535),
  maxX: z.number().int().min(0).max(65535),
  maxY: z.number().int().min(0).max(65535),
  randomRotation: z.boolean().default(false),
  randomReflection: z.boolean().default(false),
  alternate: z.boolean().default(false),
});

export const writeVtfHotspotTool = defineTool({
  name: "write_vtf_hotspot",
  description:
    "Writes the Strata Source hotspot resource into a .vtf: rectangles in pixels that " +
    "Strata uses to retexture a brush face from a texture atlas. Replaces the rectangle " +
    "list, optionally with the implementation flags byte. The image and every mip stay " +
    "byte-identical: only the resource directory and an appended block change, so a DXT " +
    "texture is not recompressed. Stock L4D2 ships no hotspot resource; the reader that " +
    "decodes it is the same srctools reader this is verified against. A backup is written " +
    "and the payload is read back.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vtf, absolute or relative to the repo root."),
    rects: z.array(HOTSPOT_RECT).min(1),
    flags: z
      .number()
      .int()
      .min(0)
      .max(255)
      .optional()
      .describe("Implementation flags byte. Kept from an existing resource when omitted."),
    backup: BACKUP,
    dryRun: DRY_RUN,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    backup: BACKUP_PATH,
    written: z.boolean(),
    rects: z.number(),
    flags: z.number(),
    verified: z.boolean(),
    bytes: z.number(),
    version: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const bytes = readFileSync(path);
    const header = readVtfHeader(bytes);
    if (!header) throw new Error(`${path} is not a VTF (no VTF\\0 signature)`);

    for (const [index, rect] of args.rects.entries()) {
      if (rect.maxX <= rect.minX || rect.maxY <= rect.minY) {
        throw new Error(`rectangle ${index} is empty: max must be greater than min`);
      }
      if (rect.maxX > header.width || rect.maxY > header.height) {
        throw new Error(
          `rectangle ${index} reaches (${rect.maxX}, ${rect.maxY}) in a ` +
            `${header.width}x${header.height} texture`,
        );
      }
    }
    const existing = readVtfResourcePayload(bytes, VTF_RESOURCE_HOTSPOT);
    const flags = args.flags ?? hotspotFlags(existing);
    const rects: VtfHotspotRect[] = args.rects;
    const payload = buildVtfHotspot(rects, flags);
    const next = writeVtfResource(bytes, VTF_RESOURCE_HOTSPOT, payload);
    const readBack = readVtfResourcePayload(next, VTF_RESOURCE_HOTSPOT);
    const inMemory = readBack !== null && readBack.equals(payload);
    if (!inMemory) throw new Error("the hotspot payload did not survive the rewrite");
    const after = readVtfHeader(next);
    if (
      after === null ||
      after.version !== header.version ||
      after.width !== header.width ||
      after.height !== header.height ||
      after.format !== header.format
    ) {
      throw new Error("the image header changed while writing the resource");
    }

    const written = commitVtf(path, next, args.backup ?? true, args.dryRun ?? false, ctx);
    const onDisk = args.dryRun
      ? inMemory
      : readVtfResourcePayload(readFileSync(written.target), VTF_RESOURCE_HOTSPOT)?.equals(payload) ??
        false;
    return {
      path: written.target,
      backup: written.backup,
      written: !args.dryRun,
      rects: rects.length,
      flags,
      verified: onDisk,
      bytes: next.length,
      version: header.version,
    };
  },
});

export const writeVtfParticleSheetTool = defineTool({
  name: "write_vtf_particle_sheet",
  description:
    "Writes the particle-spritesheet resource into a .vtf: named sequences of frame " +
    "rectangles that the particle system samples instead of a whole texture. Replaces the " +
    "sequence list; `coords` matches read_vtf's four-corner frame shape, and a single " +
    "left/top/right/bottom rectangle is repeated four times when coords is omitted. Version " +
    "1 of the payload is written unless the file already uses version 0. Only the resource " +
    "directory and an appended block change: the image and its mips stay byte-identical. A " +
    "backup is written and the payload is read back.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vtf, absolute or relative to the repo root."),
    sequences: z.array(SHEET_SEQUENCE).min(1).max(64),
    version: z
      .union([z.literal(0), z.literal(1)])
      .optional()
      .describe("Payload version. Kept from an existing resource when omitted, else 1."),
    backup: BACKUP,
    dryRun: DRY_RUN,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    backup: BACKUP_PATH,
    written: z.boolean(),
    sequences: z.number(),
    frames: z.number(),
    version: z.number(),
    verified: z.boolean(),
    bytes: z.number(),
    headerVersion: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const bytes = readFileSync(path);
    const header = readVtfHeader(bytes);
    if (!header) throw new Error(`${path} is not a VTF (no VTF\\0 signature)`);

    const existing = readVtfResourcePayload(bytes, VTF_RESOURCE_PARTICLE_SHEET);
    const version = args.version ?? particleSheetVersion(existing) ?? 1;
    const sequences = args.sequences.map((sequence) => ({
      sequence: sequence.sequence,
      clamp: sequence.clamp,
      duration: sequence.duration,
      frames: sequence.frames.map((frame, index) => {
        const coords = sheetCoords(frame, index);
        validateSheetCoords(coords, `sequence ${sequence.sequence} frame ${index}`);
        return { duration: frame.duration, coords };
      }),
    }));
    const payload = buildVtfParticleSheet(sequences, version);
    const next = writeVtfResource(bytes, VTF_RESOURCE_PARTICLE_SHEET, payload);
    const readBack = readVtfResourcePayload(next, VTF_RESOURCE_PARTICLE_SHEET);
    const inMemory = readBack !== null && readBack.equals(payload);
    if (!inMemory) throw new Error("the particle-sheet payload did not survive the rewrite");
    const after = readVtfHeader(next);
    if (
      after === null ||
      after.version !== header.version ||
      after.width !== header.width ||
      after.height !== header.height ||
      after.format !== header.format
    ) {
      throw new Error("the image header changed while writing the resource");
    }

    const written = commitVtf(path, next, args.backup ?? true, args.dryRun ?? false, ctx);
    const onDisk = args.dryRun
      ? inMemory
      : readVtfResourcePayload(
          readFileSync(written.target),
          VTF_RESOURCE_PARTICLE_SHEET,
        )?.equals(payload) ?? false;
    return {
      path: written.target,
      backup: written.backup,
      written: !args.dryRun,
      sequences: sequences.length,
      frames: sequences.reduce((sum, sequence) => sum + sequence.frames.length, 0),
      version,
      verified: onDisk,
      bytes: next.length,
      headerVersion: header.version,
    };
  },
});

export const vtfTools = [
  runVtfConvert,
  readVtfTool,
  writeVtfHotspotTool,
  writeVtfParticleSheetTool,
];

