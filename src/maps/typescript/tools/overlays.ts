/**
 * Compiled overlays: the 352-byte L4D2 `doverlay_t`, not the VMF entity.
 *
 * `write_overlay` writes an `info_overlay` in the source map; vbsp turns it into a record with
 * up to 64 face indices, two ranges, four UV points, an origin and a basis normal. The entity
 * is gone from the compiled entity lump, so this is the only way to see what the overlay
 * actually covers. `write_bsp_overlay` patches fields in place: the record size and every
 * other offset stay where they were.
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "../../../core/typescript/tools/paths.js";
import { BspFormatError, readAt, readHeader } from "../bsp/header.js";
import { readMaterials } from "../bsp/materials.js";

const LUMP_OVERLAYS = 45;
const OVERLAY_BYTES = 352;
const MAX_OVERLAY_FACES = 64;

const VEC3 = z.tuple([z.number(), z.number(), z.number()]);

function vec(view: DataView, at: number): [number, number, number] {
  return [
    view.getFloat32(at, true),
    view.getFloat32(at + 4, true),
    view.getFloat32(at + 8, true),
  ];
}

export interface OverlayRecord {
  /** Byte offset inside the OVERLAYS lump. */
  offset: number;
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
}

export interface OverlayLump {
  path: string;
  header: ReturnType<typeof readHeader>;
  lump: NonNullable<ReturnType<typeof readHeader>["lumps"][number]>;
  texinfoCount: number;
  records: OverlayRecord[];
  /** Records including the ones with no faces; `records` omits those. */
  count: number;
}

/** Reads every compiled overlay. Shared by the reader and the in-place writer. */
export function readOverlayRecords(path: string): OverlayLump {
  const header = readHeader(path);
  const lump = header.lumps[LUMP_OVERLAYS];
  if (!lump || lump.length === 0) {
    return { path, header, lump: null as never, texinfoCount: 0, records: [], count: 0 };
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
  const texinfoCount = texinfoLump.length / 72;

  const count = lump.length / OVERLAY_BYTES;
  const records: OverlayRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const back = index * OVERLAY_BYTES;
    const faceCount = view.getUint16(back + 6, true) & 0x3fff;
    if (faceCount === 0) continue;
    const texinfo = view.getInt16(back + 4, true);
    const texdata =
      texinfo >= 0 && (texinfo + 1) * 72 <= texinfoView.byteLength
        ? texinfoView.getInt32(texinfo * 72 + 68, true)
        : -1;
    const faces: number[] = [];
    for (let i = 0; i < Math.min(faceCount, MAX_OVERLAY_FACES); i += 1) {
      faces.push(view.getInt32(back + 8 + i * 4, true));
    }
    records.push({
      offset: back,
      id: view.getInt32(back, true),
      texinfo,
      texdata,
      material: nameByTexdata.get(texdata) ?? "",
      faceCount,
      renderOrder: view.getUint16(back + 6, true) >> 14,
      faces,
      u: [view.getFloat32(back + 264, true), view.getFloat32(back + 268, true)],
      v: [view.getFloat32(back + 272, true), view.getFloat32(back + 276, true)],
      uvPoints: [0, 1, 2, 3].map(
        (point) => vec(view, back + 280 + point * 12) as [number, number, number],
      ),
      origin: vec(view, back + 328),
      normal: vec(view, back + 340),
    });
  }
  return { path, header, lump, texinfoCount, records, count };
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
    const parsed = readOverlayRecords(path);
    if (parsed.records.length === 0) {
      return {
        path,
        recordBytes: OVERLAY_BYTES,
        count: parsed.count,
        withFaces: 0,
        returned: 0,
        overlays: [],
        nextStep: "This map has no compiled overlays.",
      };
    }
    return {
      path,
      recordBytes: OVERLAY_BYTES,
      count: parsed.count,
      withFaces: parsed.records.length,
      returned: Math.min(parsed.records.length, args.limit),
      overlays: parsed.records.slice(0, args.limit).map((overlay) => ({
        ...overlay,
        faces: overlay.faces.slice(0, args.faceLimit),
        offset: undefined,
      })),
      nextStep:
        "Check faces against read_bsp_faces for what the overlay covers; the material comes " +
        "from the face's texinfo because the compiled overlay stores only the index. " +
        "write_bsp_overlay changes the record in place.",
    };
  },
});

export const writeBspOverlayTool = defineTool({
  name: "write_bsp_overlay",
  description:
    "Patches one compiled overlay record in place: texinfo/material index, render order, " +
    "U/V ranges, four UV points, origin or basis normal. The record stays 352 bytes and no " +
    "lump or face offset moves, so this is a compiled-map fix that does not need vbsp. The " +
    "result is read back and every changed field is compared. `out`, `backup` and `dryRun` " +
    "work as on the other compiled-map writers.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    overlay: z
      .number()
      .int()
      .describe("Overlay id, as read_bsp_overlays reports it (not the record index)."),
    texinfo: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("TEXINFO index. The material is whatever that texinfo resolves to."),
    renderOrder: z.number().int().min(0).max(3).optional(),
    u: z.tuple([z.number(), z.number()]).optional().describe("U start and end."),
    v: z.tuple([z.number(), z.number()]).optional().describe("V start and end."),
    uvPoints: z.array(VEC3).length(4).optional().describe("Four UV points, in order."),
    origin: VEC3.optional(),
    normal: VEC3.optional().describe("Basis normal; must not be zero."),
    out: z.string().optional().describe("Write a copy instead of changing the source .bsp."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    overlay: z.number(),
    before: z.object({
      texinfo: z.number(),
      material: z.string(),
      renderOrder: z.number(),
      u: z.tuple([z.number(), z.number()]),
      v: z.tuple([z.number(), z.number()]),
      uvPoints: z.array(z.tuple([z.number(), z.number(), z.number()])),
      origin: z.tuple([z.number(), z.number(), z.number()]),
      normal: z.tuple([z.number(), z.number(), z.number()]),
    }),
    after: z.object({
      texinfo: z.number(),
      material: z.string(),
      renderOrder: z.number(),
      u: z.tuple([z.number(), z.number()]),
      v: z.tuple([z.number(), z.number()]),
      uvPoints: z.array(z.tuple([z.number(), z.number(), z.number()])),
      origin: z.tuple([z.number(), z.number(), z.number()]),
      normal: z.tuple([z.number(), z.number(), z.number()]),
    }),
    written: z.boolean(),
    unchanged: z.boolean(),
    backupPath: BACKUP_PATH,
    bytes: z.number(),
    verified: z.boolean(),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const parsed = readOverlayRecords(path);
    const record = parsed.records.find((candidate) => candidate.id === args.overlay);
    if (!record) {
      throw new Error(
        `overlay id ${args.overlay} is not in ${path}; ids are ` +
          `${parsed.records.slice(0, 20).map((candidate) => candidate.id).join(", ")}` +
          `${parsed.records.length > 20 ? ", ..." : ""}`,
      );
    }
    if (args.texinfo !== undefined && args.texinfo >= parsed.texinfoCount) {
      throw new Error(`texinfo ${args.texinfo} is outside 0..${parsed.texinfoCount - 1}`);
    }
    if (args.normal && Math.hypot(...args.normal) === 0) {
      throw new Error("a zero normal makes the overlay invisible; give a real basis normal");
    }
    const changed =
      args.texinfo !== undefined ||
      args.renderOrder !== undefined ||
      args.u !== undefined ||
      args.v !== undefined ||
      args.uvPoints !== undefined ||
      args.origin !== undefined ||
      args.normal !== undefined;
    if (!changed) throw new Error("nothing to change: give at least one overlay field");

    const source = readFileSync(path);
    const bytes = Buffer.from(source);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const at = parsed.lump.offset + record.offset;
    if (args.texinfo !== undefined) view.setInt16(at + 4, args.texinfo, true);
    if (args.renderOrder !== undefined) {
      const packed = view.getUint16(at + 6, true);
      view.setUint16(at + 6, (packed & 0x3fff) | (args.renderOrder << 14), true);
    }
    if (args.u) {
      view.setFloat32(at + 264, args.u[0], true);
      view.setFloat32(at + 268, args.u[1], true);
    }
    if (args.v) {
      view.setFloat32(at + 272, args.v[0], true);
      view.setFloat32(at + 276, args.v[1], true);
    }
    if (args.uvPoints) {
      args.uvPoints.forEach((point, index) => {
        view.setFloat32(at + 280 + index * 12, point[0], true);
        view.setFloat32(at + 280 + index * 12 + 4, point[1], true);
        view.setFloat32(at + 280 + index * 12 + 8, point[2], true);
      });
    }
    if (args.origin) {
      view.setFloat32(at + 328, args.origin[0], true);
      view.setFloat32(at + 332, args.origin[1], true);
      view.setFloat32(at + 336, args.origin[2], true);
    }
    if (args.normal) {
      view.setFloat32(at + 340, args.normal[0], true);
      view.setFloat32(at + 344, args.normal[1], true);
      view.setFloat32(at + 348, args.normal[2], true);
    }

    const target = args.out ? assertWritable(resolveInput(args.out, ctx.config), ctx.config) : assertWritable(path, ctx.config);
    const unchanged = bytes.equals(source);
    let backupPath: string | null = null;
    let written = false;
    if (args.dryRun !== true && !unchanged) {
      if (target === path && (args.backup ?? true)) {
        backupPath = assertWritable(`${target}.bak`, ctx.config);
        copyFileSync(target, backupPath);
      }
      writeFileSync(target, bytes);
      ctx.audit.record({
        kind: "file_write",
        data: { path: target, action: "patch_overlay", overlay: args.overlay, backup: backupPath },
      });
      written = true;
    }

    let verified = false;
    let after = record;
    if (written) {
      after = readOverlayRecords(target).records.find((candidate) => candidate.id === args.overlay)!;
      verified =
        (args.texinfo === undefined || after.texinfo === args.texinfo) &&
        (args.renderOrder === undefined || after.renderOrder === args.renderOrder) &&
        (args.u === undefined || (after.u[0] === args.u[0] && after.u[1] === args.u[1])) &&
        (args.v === undefined || (after.v[0] === args.v[0] && after.v[1] === args.v[1])) &&
        (args.uvPoints === undefined ||
          args.uvPoints.every((point, index) =>
            point.every((value, axis) => after.uvPoints[index]![axis] === value),
          )) &&
        (args.origin === undefined ||
          args.origin.every((value, axis) => after.origin[axis] === value)) &&
        (args.normal === undefined ||
          args.normal.every((value, axis) => after.normal[axis] === value));
      if (!verified) {
        throw new Error(`refusing to report success: overlay ${args.overlay} did not read back with the requested fields`);
      }
    }

    return {
      path,
      out: target,
      overlay: args.overlay,
      before: {
        texinfo: record.texinfo,
        material: record.material,
        renderOrder: record.renderOrder,
        u: record.u,
        v: record.v,
        uvPoints: record.uvPoints,
        origin: record.origin,
        normal: record.normal,
      },
      after: {
        texinfo: after.texinfo,
        material: after.material,
        renderOrder: after.renderOrder,
        u: after.u,
        v: after.v,
        uvPoints: after.uvPoints,
        origin: after.origin,
        normal: after.normal,
      },
      written,
      unchanged,
      backupPath,
      bytes: existsSync(target) ? statSync(target).size : statSync(path).size,
      verified,
      note:
        args.dryRun === true
          ? "dry run: the record was patched in memory and nothing was written"
          : unchanged
            ? "the requested values are already in the record; nothing was written"
            : "the record stayed 352 bytes and no other offset moved",
    };
  },
});

export const overlayTools = [readBspOverlaysTool, writeBspOverlayTool];
