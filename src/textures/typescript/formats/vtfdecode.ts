/**
 * Decode the first mip of a VTF to RGB(A), without VTFCmd.
 *
 * Materials are the largest visual difference between a flat-shaded preview and the game, and
 * the formats stock L4D2 actually uses are few: DXT1, DXT5, BGRA8888 and a handful of
 * uncompressed RGB layouts. Cubemaps, animated sheets and the high-precision HDR formats are
 * refused rather than decoded as if they were a 2D texture.
 */
import { VTF_FORMATS, readVtfHeader } from "../bsp/vtf.js";

export interface DecodedVtf {
  width: number;
  height: number;
  format: string;
  /** RGB, three bytes per pixel, row-major from the top left. */
  rgb: Uint8Array;
}

const FORMAT_DXT1 = 13;
const FORMAT_DXT3 = 14;
const FORMAT_DXT5 = 15;
const FORMAT_DXT1_ONE_BIT_ALPHA = 20;
const FORMAT_RGBA8888 = 0;
const FORMAT_ABGR8888 = 1;
const FORMAT_RGB888 = 2;
const FORMAT_BGR888 = 3;
const FORMAT_BGRA8888 = 12;
const FORMAT_BGRX8888 = 16;

function rgb565(value: number): [number, number, number] {
  const r = (value >> 11) & 0x1f;
  const g = (value >> 5) & 0x3f;
  const b = value & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

function dxtColorBlock(block: Uint8Array): Array<[number, number, number, number]> {
  const c0 = block[0]! | (block[1]! << 8);
  const c1 = block[2]! | (block[3]! << 8);
  const a = rgb565(c0);
  const b = rgb565(c1);
  const palette: Array<[number, number, number, number]> = [
    [a[0], a[1], a[2], 255],
    [b[0], b[1], b[2], 255],
  ];
  if (c0 > c1) {
    palette.push([
      Math.round((2 * a[0] + b[0]) / 3),
      Math.round((2 * a[1] + b[1]) / 3),
      Math.round((2 * a[2] + b[2]) / 3),
      255,
    ]);
    palette.push([
      Math.round((a[0] + 2 * b[0]) / 3),
      Math.round((a[1] + 2 * b[1]) / 3),
      Math.round((a[2] + 2 * b[2]) / 3),
      255,
    ]);
  } else {
    palette.push([
      Math.round((a[0] + b[0]) / 2),
      Math.round((a[1] + b[1]) / 2),
      Math.round((a[2] + b[2]) / 2),
      255,
    ]);
    palette.push([0, 0, 0, 0]);
  }
  return palette;
}

function decodeDxt(
  data: Buffer,
  width: number,
  height: number,
  format: number,
): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const blockBytes = format === FORMAT_DXT1 || format === FORMAT_DXT1_ONE_BIT_ALPHA ? 8 : 16;
  let at = 0;
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      if (at + blockBytes > data.length) return rgb;
      const block = data.subarray(at, at + blockBytes);
      at += blockBytes;
      const colourOffset = format === FORMAT_DXT1 || format === FORMAT_DXT1_ONE_BIT_ALPHA ? 0 : 8;
      const colours = dxtColorBlock(block.subarray(colourOffset, colourOffset + 8));
      let alpha: number[] = new Array(16).fill(255);
      if (format === FORMAT_DXT3) {
        for (let i = 0; i < 16; i += 1) {
          const nibble = i % 2 === 0 ? block[i >> 1]! & 0x0f : block[i >> 1]! >> 4;
          alpha[i] = nibble * 17;
        }
      } else if (format === FORMAT_DXT5) {
        const a0 = block[0]!;
        const a1 = block[1]!;
        const table: number[] = [a0, a1];
        if (a0 > a1) {
          for (let i = 1; i <= 6; i += 1) table.push(Math.round(((7 - i) * a0 + i * a1) / 7));
        } else {
          for (let i = 1; i <= 4; i += 1) table.push(Math.round(((5 - i) * a0 + i * a1) / 5));
          table.push(0, 255);
        }
        let bits = 0n;
        for (let i = 0; i < 6; i += 1) bits |= BigInt(block[2 + i]!) << BigInt(i * 8);
        for (let i = 0; i < 16; i += 1) {
          alpha[i] = table[Number((bits >> BigInt(i * 3)) & 7n)] ?? 255;
        }
      }
      const indices = block[colourOffset + 4]! |
        (block[colourOffset + 5]! << 8) |
        (block[colourOffset + 6]! << 16) |
        (block[colourOffset + 7]! << 24);
      for (let py = 0; py < 4; py += 1) {
        for (let px = 0; px < 4; px += 1) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const index = (indices >> ((py * 4 + px) * 2)) & 3;
          const colour = colours[index]!;
          const out = (y * width + x) * 3;
          rgb[out] = colour[0];
          rgb[out + 1] = colour[1];
          rgb[out + 2] = colour[2];
          if (format === FORMAT_DXT1_ONE_BIT_ALPHA && colour[3] === 0) {
            // One-bit alpha is not part of the RGB image; the colour is still the palette.
          }
        }
      }
      void alpha;
    }
  }
  return rgb;
}

function decodeUncompressed(
  data: Buffer,
  width: number,
  height: number,
  format: number,
): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  const bytesPerPixel =
    format === FORMAT_RGB888 || format === FORMAT_BGR888 ? 3 : 4;
  for (let i = 0; i < width * height; i += 1) {
    const at = i * bytesPerPixel;
    if (at + bytesPerPixel > data.length) break;
    const out = i * 3;
    if (format === FORMAT_BGRA8888 || format === FORMAT_BGRX8888) {
      rgb[out] = data[at + 2]!;
      rgb[out + 1] = data[at + 1]!;
      rgb[out + 2] = data[at]!;
    } else if (format === FORMAT_BGR888) {
      rgb[out] = data[at + 2]!;
      rgb[out + 1] = data[at + 1]!;
      rgb[out + 2] = data[at]!;
    } else if (format === FORMAT_RGBA8888) {
      rgb[out] = data[at]!;
      rgb[out + 1] = data[at + 1]!;
      rgb[out + 2] = data[at + 2]!;
    } else if (format === FORMAT_ABGR8888) {
      rgb[out] = data[at + 3]!;
      rgb[out + 1] = data[at + 2]!;
      rgb[out + 2] = data[at + 1]!;
    } else {
      rgb[out] = data[at]!;
      rgb[out + 1] = data[at + 1]!;
      rgb[out + 2] = data[at + 2]!;
    }
  }
  return rgb;
}

/**
 * Decode the first mip of a 2D VTF. Returns null for a cubemap, a volume texture or a format
 * this decoder does not know, so the caller can fall back to the material colour.
 */
export function decodeVtf(bytes: Buffer): DecodedVtf | null {
  const header = readVtfHeader(bytes);
  if (!header || header.cubemap) return null;
  const width = header.width;
  const height = header.height;
  if (width <= 0 || height <= 0) return null;
  const headerSize = bytes.readUInt32LE(12);
  const formatId = bytes.readInt32LE(52);
  const lowResFormat = bytes.readInt32LE(57);
  const lowResWidth = bytes[61] ?? 0;
  const lowResHeight = bytes[62] ?? 0;
  const blockBytes = (fmt: number): number =>
    fmt === FORMAT_DXT1 || fmt === FORMAT_DXT1_ONE_BIT_ALPHA
      ? 8
      : fmt === FORMAT_DXT3 || fmt === FORMAT_DXT5
        ? 16
        : 0;
  const lowResSize = (() => {
    const block = blockBytes(lowResFormat);
    if (block > 0 && lowResWidth > 0 && lowResHeight > 0) {
      return Math.ceil(lowResWidth / 4) * Math.ceil(lowResHeight / 4) * block;
    }
    if (lowResWidth > 0 && lowResHeight > 0) {
      const bpp = lowResFormat === FORMAT_RGB888 || lowResFormat === FORMAT_BGR888 ? 3 : 4;
      return lowResWidth * lowResHeight * bpp;
    }
    return 0;
  })();
  const start = headerSize + lowResSize;
  if (start >= bytes.length) return null;
  const format = VTF_FORMATS[formatId] ?? String(formatId);

  if (formatId === FORMAT_DXT1 || formatId === FORMAT_DXT1_ONE_BIT_ALPHA || formatId === FORMAT_DXT3 || formatId === FORMAT_DXT5) {
    return { width, height, format, rgb: decodeDxt(bytes.subarray(start), width, height, formatId) };
  }
  if (
    formatId === FORMAT_BGRA8888 ||
    formatId === FORMAT_BGRX8888 ||
    formatId === FORMAT_RGBA8888 ||
    formatId === FORMAT_ABGR8888 ||
    formatId === FORMAT_RGB888 ||
    formatId === FORMAT_BGR888
  ) {
    return {
      width,
      height,
      format,
      rgb: decodeUncompressed(bytes.subarray(start), width, height, formatId),
    };
  }
  return null;
}
