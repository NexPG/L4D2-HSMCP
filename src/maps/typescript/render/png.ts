/**
 * Writing a PNG, in about sixty lines and with no dependency.
 *
 * A PNG is a signature, then chunks, each `length | type | data | crc32`. Only three are
 * needed: `IHDR` says how big and what kind, `IDAT` holds the pixels zlib-deflated with a
 * filter byte per row, `IEND` ends it. Node ships `zlib.deflateSync`, which is the only hard
 * part, so the rest is byte layout.
 *
 * The alternative was a dependency, and it would have been a strange one to take: this
 * server refuses to guess a lump's structure from memory and reads Valve's formats by their
 * documented layout instead. PNG is documented the same way, and it is smaller than the BSP
 * header reader already here.
 *
 * The filter byte is the trap. Every scanline is prefixed with one, and 0 means "no
 * filtering". Omit it and the encoder still produces a file, deflate still compresses, the
 * CRC still checks out -- and every row is shifted one byte further than the last, so the
 * image shears into diagonal noise. The test inflates its own output and compares it with
 * the framebuffer, which is the only way that fault shows up as a failure rather than as a
 * picture nobody looked at.
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The CRC-32 a PNG chunk needs is the same one the VPK and ZIP writers use.
import { crc32 } from "../../../formats/typescript/formats/crc32.js";

export { crc32 };

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Encodes an RGB framebuffer as a PNG.
 *
 * `rgb` is width * height * 3 bytes, row-major from the top left, which is the order both
 * PNG and this repository's rasteriser use.
 */
export function encodePng(rgb: Uint8Array, width: number, height: number): Buffer {
  if (rgb.length !== width * height * 3) {
    throw new Error(
      `framebuffer is ${rgb.length} bytes for ${width}x${height}, expected ${width * height * 3}`,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2: truecolour, no alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte per scanline, and it must be there even when it is zero.
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (width * 3 + 1);
    raw[at] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), at + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface DecodedPng {
  width: number;
  height: number;
  rgb: Uint8Array;
}

export interface PngLuminance {
  width: number;
  height: number;
  /** Mean relative luminance in the sampled region, 0..255. */
  mean: number;
  /** Standard deviation in the sampled region. A blank canvas is near zero. */
  stdDev: number;
  /** Brightest sampled pixel, 0..255. */
  max: number;
  sampledPixels: number;
}

/**
 * Mean, spread and peak luminance of a rectangle inside a PNG.
 *
 * `decodePng` below reads only what this module writes. Screenshots are not written by this
 * module -- they come from the Windows capture helper, which uses the platform encoder and
 * therefore every PNG filter type. This reader supports the eight-bit colour types and all
 * five filters, because the question it answers ("is this game window a black rectangle")
 * is asked about someone else's file, and a decoder that refuses the file cannot answer it.
 *
 * The region is given in fractions, so the caller can ask about the centre of a window
 * without knowing its pixel size. `stdDev` is the useful number: a black viewport and a
 * nearly-black render differ in spread, not in mean, and the panel chrome around a dead
 * canvas keeps the mean up.
 */
export function pngLuminance(
  buf: Buffer,
  region: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: 1, y1: 1 },
): PngLuminance {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG: bad signature");

  let at = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 2;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  if (width === 0 || height === 0) throw new Error("PNG has no IHDR");
  if (bitDepth !== 8) throw new Error(`only 8-bit PNGs are measured here, not ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNGs are not measured here");
  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const from = y * (stride + 1);
    const filter = raw[from]!;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const src = raw.subarray(from + 1, from + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels]! : 0;
      const up = prev[x]!;
      const upLeft = x >= channels ? prev[x - channels]! : 0;
      let value = src[x]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`scanline ${y} uses unknown filter ${filter}`);
      row[x] = value & 0xff;
    }
    prev = row;
  }

  const x0 = Math.max(0, Math.min(width - 1, Math.floor(region.x0 * width)));
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(region.x1 * width)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(region.y0 * height)));
  const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(region.y1 * height)));
  let sum = 0;
  let sumSq = 0;
  let max = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      const lum =
        channels === 1 || channels === 2
          ? pixels[i]!
          : 0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!;
      sum += lum;
      sumSq += lum * lum;
      if (lum > max) max = lum;
      count++;
    }
  }
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return { width, height, mean, stdDev: Math.sqrt(variance), max, sampledPixels: count };
}

/**
 * Reads back a PNG this module wrote, for the test that proves it wrote one.
 *
 * Deliberately narrow: colour type 2, bit depth 8, filter 0, no interlace. A general decoder
 * would be a second piece of software to be wrong in, and the question here is only whether
 * the bytes that went in come back out.
 */
export function decodePng(buf: Buffer): DecodedPng {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG: bad signature");

  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    const stated = buf.readUInt32BE(at + 8 + length);
    const actual = crc32(buf.subarray(at + 4, at + 8 + length));
    if (stated !== actual) throw new Error(`chunk ${type}: CRC ${stated} but computed ${actual}`);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2) throw new Error("only 8-bit truecolour is read here");
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const from = y * (width * 3 + 1);
    if (raw[from] !== 0) throw new Error(`scanline ${y} uses filter ${raw[from]}, only 0 is read`);
    rgb.set(raw.subarray(from + 1, from + 1 + width * 3), y * width * 3);
  }
  return { width, height, rgb };
}
