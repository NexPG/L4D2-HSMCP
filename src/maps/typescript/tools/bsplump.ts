/**
 * Any BSP lump, read or replaced — including the LZMA-compressed ones.
 *
 * `read_map_geometry` and `read_bsp_entities` answer the questions the named tools know
 * how to ask. This is the primitive underneath: all 64 lumps, by name or index, with the
 * L4D2 field order respected and individually compressed lumps decoded. Without it a map
 * whose lumps vbsp compressed cannot be inspected at all — the old reader could only say
 * "this lump is compressed" and stop.
 *
 * Writing appends the new bytes and moves the descriptor, exactly like the pakfile writer:
 * every other lump stays byte-identical. A compressed write stores the uncompressed size in
 * the fourCC slot, which is what makes `read_bsp_lump` able to decode it again.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../../../core/typescript/fs/guard.js";
import { defineTool } from "../../../core/typescript/mcp/registry.js";
import { callSidecar } from "../../../core/typescript/sidecar/client.js";
import { CONFIRM, resolveInput } from "../../../core/typescript/tools/paths.js";
import { LUMP_COUNT, LUMP_NAMES, readHeader, setLumpDescriptor } from "../bsp/header.js";
import type { BspHeader, BspLump } from "../bsp/header.js";

const MAX_INLINE = 1 << 20;

function lumpOf(header: BspHeader, want: string | number): BspLump {
  const index =
    typeof want === "number"
      ? want
      : /^\d+$/.test(want.trim())
        ? Number(want.trim())
        : Object.entries(LUMP_NAMES).find(([, name]) => name === want.trim().toUpperCase())?.[0];
  const resolved = typeof index === "string" ? Number(index) : index;
  if (resolved === undefined || !Number.isInteger(resolved) || resolved < 0 || resolved >= LUMP_COUNT) {
    throw new Error(
      `${want} is not a lump. Use an index 0-${LUMP_COUNT - 1} or one of: ` +
        `${Object.values(LUMP_NAMES).join(", ")}.`,
    );
  }
  const lump = header.lumps[resolved];
  if (!lump) throw new Error(`lump ${resolved} is outside the header`);
  return lump;
}

function looksText(bytes: Buffer): boolean {
  const limit = Math.min(bytes.length, 4096);
  for (let i = 0; i < limit; i += 1) {
    const byte = bytes[i]!;
    if (byte === 0 && i === limit - 1) continue;
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) return false;
  }
  return true;
}

async function decompressSource(data: Buffer, ctx: { config: unknown }): Promise<Buffer> {
  const r = (await callSidecar(
    "lzma_decompress",
    { dataBase64: data.toString("base64") },
    ctx.config as never,
    300_000,
  )) as { dataBase64: string };
  return Buffer.from(r.dataBase64, "base64");
}

async function compressSource(
  data: Buffer,
  preset: number,
  ctx: { config: unknown },
): Promise<Buffer> {
  const r = (await callSidecar(
    "lzma_compress",
    { dataBase64: data.toString("base64"), preset },
    ctx.config as never,
    300_000,
  )) as { dataBase64: string };
  return Buffer.from(r.dataBase64, "base64");
}

const LUMP = z.union([z.number().int().min(0).max(LUMP_COUNT - 1), z.string().min(1)]);

export const readBspLumpTool = defineTool({
  name: "read_bsp_lump",
  description:
    "Reads any of a .bsp's 64 lumps by name (ENTITIES, PLANES, TEXDATA, …) or index, " +
    "decoding an individually LZMA-compressed lump instead of refusing it. Returns text " +
    "when the lump is text (`ENTITIES`), otherwise base64 up to `maxInline`, plus the " +
    "stored and uncompressed sizes, version, fourCC and a SHA-256. Use `out` to dump a " +
    "large lump to a file instead of inflating the reply. This is the primitive under the " +
    "named readers: map geometry, entity lump, pakfile and static props.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp."),
    lump: LUMP.describe("Lump name (case-insensitive) or index 0-63."),
    out: z
      .string()
      .optional()
      .describe("Write the decoded lump here and return only its metadata and hash."),
    maxInline: z
      .number()
      .int()
      .min(0)
      .max(64 << 20)
      .default(MAX_INLINE)
      .describe("Maximum bytes returned inline; 0 returns none. `out` overrides this."),
  },
  outputSchema: {
    path: z.string(),
    lump: z.object({
      index: z.number(),
      name: z.string().nullable(),
      version: z.number(),
      offset: z.number(),
      storedBytes: z.number(),
      uncompressedBytes: z.number(),
      compressed: z.boolean(),
      fourCC: z.number(),
    }),
    bytes: z.number(),
    sha256: z.string(),
    text: z.string().optional(),
    base64: z.string().optional(),
    out: z.string().optional(),
    truncated: z.boolean(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const header = readHeader(path);
    const lump = lumpOf(header, args.lump);
    const stored = readFileSync(path).subarray(lump.offset, lump.offset + lump.length);
    const bytes = lump.compressed ? await decompressSource(stored, ctx) : stored;
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    if (args.out) {
      const out = assertWritable(resolveInput(args.out, ctx.config), ctx.config);
      writeFileSync(out, bytes);
      ctx.audit.record({ kind: "file_write", data: { path: out, bytes: bytes.length } });
      return {
        path,
        lump: {
          index: lump.index,
          name: lump.name ?? null,
          version: lump.version,
          offset: lump.offset,
          storedBytes: lump.length,
          uncompressedBytes: bytes.length,
          compressed: lump.compressed,
          fourCC: lump.fourCC,
        },
        bytes: bytes.length,
        sha256,
        out,
        truncated: false,
        note:
          "Written decoded: a compressed lump is stored compressed in the BSP and this " +
          "file is the original bytes.",
      };
    }

    const take = Math.min(bytes.length, args.maxInline ?? MAX_INLINE);
    const slice = bytes.subarray(0, take);
    const text = looksText(slice) ? slice.toString("utf8") : undefined;
    return {
      path,
      lump: {
        index: lump.index,
        name: lump.name ?? null,
        version: lump.version,
        offset: lump.offset,
        storedBytes: lump.length,
        uncompressedBytes: bytes.length,
        compressed: lump.compressed,
        fourCC: lump.fourCC,
      },
      bytes: bytes.length,
      sha256,
      ...(text === undefined ? { base64: slice.toString("base64") } : { text }),
      truncated: take < bytes.length,
      note:
        "`storedBytes` is what the file occupies; `uncompressedBytes` is the content after " +
        "LZMA. `fourCC` carries the uncompressed size on a compressed lump, which is why it " +
        "is reported raw. Use out: to get a lump larger than maxInline.",
    };
  },
});

const DATA = z.object({
  source: z.string().optional().describe("File with the new lump bytes."),
  text: z.string().optional().describe("Text to encode as UTF-8."),
  base64: z.string().optional().describe("Base64 of the bytes."),
});

export const writeBspLumpTool = defineTool({
  name: "write_bsp_lump",
  description:
    "Replaces one lump of a .bsp: reads bytes from `source`, `text` or `base64`, optionally " +
    "LZMA-compresses them in Source's framing, appends them to the file and moves only that " +
    "lump's descriptor. Every other lump stays byte-identical and a `.bak` is written. The " +
    "result is read back, decompressed and hashed against the input, so `verified` is a " +
    "proof rather than a hope. A compressed write stores the uncompressed size in the lump's " +
    "fourCC, which is what the engine's own reader expects. Use it for lumps no named tool " +
    "can write — and remember that a wrong lump is a broken map, so keep the backup.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Target .bsp. Rewritten in place unless `out` is given."),
    lump: LUMP.describe("Lump name (case-insensitive) or index 0-63."),
    data: DATA,
    compress: z.boolean().default(false).describe("Store the lump LZMA-compressed."),
    preset: z.number().int().min(0).max(9).default(6).describe("LZMA preset when compressing."),
    out: z.string().optional().describe("Write to a copy instead of changing this file."),
    backup: z.boolean().default(true).describe("Write <bsp>.bak before changing it in place."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    out: z.string(),
    backup: z.string().nullable(),
    lump: z.object({
      index: z.number(),
      name: z.string().nullable(),
      version: z.number(),
      offset: z.number(),
      storedBytes: z.number(),
      uncompressedBytes: z.number(),
      compressed: z.boolean(),
    }),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    sha256: z.string(),
    verified: z.boolean(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    const source = readFileSync(path);
    const header = readHeader(path);
    const lump = lumpOf(header, args.lump);

    const provided = [args.data.source, args.data.text, args.data.base64].filter(
      (v) => v !== undefined,
    );
    if (provided.length !== 1) {
      throw new Error("give exactly one of data.source, data.text or data.base64");
    }
    let raw: Buffer;
    if (args.data.source !== undefined) {
      const file = resolveInput(args.data.source, ctx.config);
      if (!existsSync(file)) throw new Error(`${file} does not exist`);
      raw = readFileSync(file);
    } else if (args.data.text !== undefined) {
      raw = Buffer.from(args.data.text, "utf8");
    } else {
      raw = Buffer.from(args.data.base64!, "base64");
    }

    const compress = args.compress ?? false;
    const stored = compress ? await compressSource(raw, args.preset ?? 6, ctx) : raw;
    const offset = (source.length + 3) & ~3;
    const outBytes = Buffer.alloc(offset + stored.length);
    source.copy(outBytes, 0);
    stored.copy(outBytes, offset);

    setLumpDescriptor(outBytes, lump.index, header.layout, offset, stored.length);
    // The descriptor's version and fourCC are not offsets; write them in this file's order.
    const at = 8 + lump.index * 16;
    const fourCC = compress ? raw.length : lump.fourCC;
    if (header.layout === "l4d2") {
      outBytes.writeInt32LE(lump.version, at);
      outBytes.writeInt32LE(fourCC, at + 12);
    } else {
      outBytes.writeInt32LE(lump.version, at + 8);
      outBytes.writeInt32LE(fourCC, at + 12);
    }

    const out = args.out ? assertWritable(resolveInput(args.out, ctx.config), ctx.config) : assertWritable(path, ctx.config);
    let backup: string | null = null;
    if (args.out === undefined && (args.backup ?? true)) {
      backup = assertWritable(`${out}.bak`, ctx.config);
      copyFileSync(out, backup);
    }
    writeFileSync(out, outBytes);
    ctx.audit.record({
      kind: "file_write",
      data: { path: out, lump: lump.index, storedBytes: stored.length, backup },
    });

    // Read back through the same path the reader uses, decompress, and hash.
    const after = readHeader(out);
    const placed = after.lumps[lump.index]!;
    const readStored = readFileSync(out).subarray(placed.offset, placed.offset + placed.length);
    const readBack = placed.compressed ? await decompressSource(readStored, ctx) : readStored;
    const sha256 = createHash("sha256").update(raw).digest("hex");
    const verified =
      createHash("sha256").update(readBack).digest("hex") === sha256 &&
      placed.length === stored.length &&
      placed.offset === offset;

    return {
      path,
      out,
      backup,
      lump: {
        index: placed.index,
        name: placed.name ?? null,
        version: placed.version,
        offset: placed.offset,
        storedBytes: placed.length,
        uncompressedBytes: readBack.length,
        compressed: placed.compressed,
      },
      bytesBefore: source.length,
      bytesAfter: outBytes.length,
      sha256,
      verified,
    };
  },
});

export const bspLumpTools = [readBspLumpTool, writeBspLumpTool];
