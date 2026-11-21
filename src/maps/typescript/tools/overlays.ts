/**
 * Compiled overlays: the 352-byte L4D2 `doverlay_t`, not the VMF entity.
 *
 * `write_overlay` writes an `info_overlay` in the source map; vbsp turns it into a record with
 * up to 64 face indices, two ranges, four UV points, an origin and a basis normal. The entity
 * is gone from the compiled entity lump, so this is the only way to see what the overlay
 * actually covers.
 */
import { z } from "zod";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { resolveInput } from "../../../core/typescript/tools/paths.js";
import { BspFormatError, readAt, readHeader } from "../bsp/header.js";
import { readMaterials } from "../bsp/materials.js";

const LUMP_OVERLAYS = 45;
const OVERLAY_BYTES = 352;
const MAX_OVERLAY_FACES = 64;

function vec(view: DataView, at: number): [number, number, number] {
  return [
    view.getFloat32(at, true),
    view.getFloat32(at + 4, true),
    view.getFloat32(at + 8, true),
  ];
}

export const readBspOverlaysTool = defineTool({
  name: "read_bsp_overlays",
  description:
    "Lists compiled overlays from a .bsp: id, texinfo/material, face count and indices, " +
    "render order, U/V ranges, four UV points, origin and basis normal. vbsp replaces the " +
    "`info_overlay` entity with this record, so `read_bsp_entities` cannot answer it. " +
    "L4D2's `doverlay_t` is 352 bytes; a lump that is not a multiple is named, not guessed.",
  realm: "map",
  guarded: false,
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    limit: z.number().int().min(1).max(5000).default(100),
    faceLimit: z.number().int().min(0).max(MAX_OVERLAY_FACES).default(16),
  },
  outputSchema: {
    path: z.string(),
    recordBytes: z.number(),
    count: z.number(),
    withFaces: z.number(),
    returned: z.number(),
    overlays: z.array(
      z.object({
        id: z.number(),
        texinfo: z.number(),
        texdata: z.number(),
        material: z.string(),
        faceCount: z.number(),
        renderOrder: z.number(),
        faces: z.array(z.number()),
        u: z.tuple([z.number(), z.number()]),
        v: z.tuple([z.number(), z.number()]),
        uvPoints: z.array(z.tuple([z.number(), z.number(), z.number()])),
        origin: z.tuple([z.number(), z.number(), z.number()]),
        normal: z.tuple([z.number(), z.number(), z.number()]),
      }),
    ),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const header = readHeader(path);
    const lump = header.lumps[LUMP_OVERLAYS];
    if (!lump || lump.length === 0) {
      return {
        path,
        recordBytes: OVERLAY_BYTES,
        count: 0,
        withFaces: 0,
        returned: 0,
        overlays: [],
        nextStep: "This map has no compiled overlays.",
      };
    }
    if (lump.compressed) {
      throw new BspFormatError(
        `${path}: OVERLAYS lump is LZMA-compressed; refusing to read it as 352-byte records`,
      );
    }
    if (lump.length % OVERLAY_BYTES !== 0) {
      throw new BspFormatError(
        `${path}: OVERLAYS lump is ${lump.length} bytes, not a multiple of ` +
          `${OVERLAY_BYTES}; the record layout differs in this BSP`,
      );
    }
    const raw = readAt(path, lump.offset, lump.length);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const materialReport = readMaterials(path);
    const nameByTexdata = new Map<number, string>();
    for (const material of materialReport.materials) {
      for (const texdata of material.texdataIndices) nameByTexdata.set(texdata, material.name);
    }
    const texinfoLump = header.lumps[6];
    if (!texinfoLump || texinfoLump.length % 72 !== 0 || texinfoLump.compressed) {
      throw new BspFormatError(
        `${path}: TEXINFO lump is missing, compressed or not a multiple of 72 bytes; ` +
          `overlay materials cannot be resolved`,
      );
    }
    const texinfoRaw = readAt(path, texinfoLump.offset, texinfoLump.length);
    const texinfoView = new DataView(
      texinfoRaw.buffer,
      texinfoRaw.byteOffset,
      texinfoRaw.byteLength,
    );

    const count = lump.length / OVERLAY_BYTES;
    const overlays: Array<{
      id: number;
      texinfo: number;
      texdata: number;
      material: string;
      faceCount: number;
      renderOrder: number;
      faces: number[];
      u: [number, number];
      v: [number, number];
      uvPoints: Array<[number, number, number]>;
      origin: [number, number, number];
      normal: [number, number, number];
    }> = [];
    let withFaces = 0;

    for (let index = 0; index < count; index += 1) {
      const at = index * OVERLAY_BYTES;
      const id = view.getInt32(at, true);
      const texinfo = view.getInt16(at + 4, true);
      const packed = view.getUint16(at + 6, true);
      const faceCount = packed & 0x3fff;
      const renderOrder = packed >> 14;
      if (faceCount === 0) continue;
      withFaces += 1;
      if (overlays.length >= args.limit) continue;
      const texdata =
        texinfo >= 0 && (texinfo + 1) * 72 <= texinfoView.byteLength
          ? texinfoView.getInt32(texinfo * 72 + 68, true)
          : -1;
      const faces: number[] = [];
      for (let i = 0; i < Math.min(faceCount, MAX_OVERLAY_FACES, args.faceLimit); i += 1) {
        faces.push(view.getInt32(at + 8 + i * 4, true));
      }
      overlays.push({
        id,
        texinfo,
        texdata,
        material: nameByTexdata.get(texdata) ?? "",
        faceCount,
        renderOrder,
        faces,
        u: [view.getFloat32(at + 264, true), view.getFloat32(at + 268, true)],
        v: [view.getFloat32(at + 272, true), view.getFloat32(at + 276, true)],
        uvPoints: [
          vec(view, at + 280),
          vec(view, at + 292),
          vec(view, at + 304),
          vec(view, at + 316),
        ],
        origin: vec(view, at + 328),
        normal: vec(view, at + 340),
      });
    }

    return {
      path,
      recordBytes: OVERLAY_BYTES,
      count,
      withFaces,
      returned: overlays.length,
      overlays,
      nextStep:
        "Check faces against read_bsp_faces for what the overlay covers; the material comes " +
        "from the face's texinfo because the compiled overlay stores only the index.",
    };
  },
});

export const overlayReadTools = [readBspOverlaysTool];
