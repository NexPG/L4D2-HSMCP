/**
 * The screenshot reader behind the HLMV blank test.
 *
 * The files here are built by the test, not by `encodePng`, and each row uses a different
 * PNG filter. That matters because the question this reader answers -- "is the game window
 * a black rectangle?" -- is asked about a file written by the Windows capture helper, not
 * by this module, and a decoder tested on its own encoder's filter 0 proves nothing about
 * filter 4.
 */
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, pngLuminance } from "../../src/maps/typescript/render/png.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
}

/** `rows` are unfiltered scanlines; `filters` picks the PNG filter per row. */
function buildPng(
  width: number,
  rows: Buffer[],
  channels: 1 | 3 | 4,
  filters: number[],
): Buffer {
  const height = rows.length;
  const stride = width * channels;
  const filtered: number[] = [];
  let previous: Uint8Array<ArrayBufferLike> = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    const filter = filters[y] ?? 0;
    filtered.push(filter);
    const out = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels]! : 0;
      const up = previous[i]!;
      const upLeft = i >= channels ? previous[i - channels]! : 0;
      const predictor =
        filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0;
      out[i] = (row[i]! - predictor) & 0xff;
    }
    filtered.push(...out);
    previous = row;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(filtered))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("pngLuminance", () => {
  it("reconstructs rows written with every filter type", () => {
    const red = [...Array(4)].flatMap(() => [255, 0, 0]);
    const green = [...Array(4)].flatMap(() => [0, 255, 0]);
    const blue = [...Array(4)].flatMap(() => [0, 0, 255]);
    const grey = [...Array(4)].flatMap(() => [64, 64, 64]);
    const white = [...Array(4)].flatMap(() => [255, 255, 255]);
    const png = buildPng(
      4,
      [red, green, blue, grey, white].map((row) => Buffer.from(row)),
      3,
      [0, 1, 2, 3, 4],
    );
    const stats = pngLuminance(png);
    // 0.2126 + 0.7152 + 0.0722 + 64/255 + 1, times 255, divided by 5 rows.
    const expected =
      (0.2126 * 255 + 0.7152 * 255 + 0.0722 * 255 + 64 + 255) / 5;
    expect(stats.mean).toBeCloseTo(expected, 3);
    expect(stats.max).toBeCloseTo(255, 6);
    expect(stats.width).toBe(4);
    expect(stats.height).toBe(5);
  });

  it("calls a flat black image blank and a gradient not blank", () => {
    const black = buildPng(8, Array.from({ length: 8 }, () => Buffer.alloc(24, 0)), 3, [0]);
    expect(pngLuminance(black).stdDev).toBe(0);

    const ramp = Buffer.alloc(24);
    for (let x = 0; x < 8; x++) {
      ramp[x * 3] = x * 32;
      ramp[x * 3 + 1] = x * 32;
      ramp[x * 3 + 2] = x * 32;
    }
    const gradient = buildPng(8, [ramp], 3, [0]);
    expect(pngLuminance(gradient).stdDev).toBeGreaterThan(3);
  });

  it("measures only the requested region", () => {
    const row = Buffer.concat([Buffer.alloc(24, 0), Buffer.alloc(24, 255)]);
    const png = buildPng(16, [row], 3, [0]);
    expect(pngLuminance(png, { x0: 0, y0: 0, x1: 0.5, y1: 1 }).mean).toBe(0);
    expect(pngLuminance(png, { x0: 0.5, y0: 0, x1: 1, y1: 1 }).mean).toBeCloseTo(255, 6);
  });

  it("reads grey and RGBA captures the same way", () => {
    const grey = buildPng(4, [Buffer.from([10, 20, 30, 40])], 1, [0]);
    expect(pngLuminance(grey).mean).toBe(25);
    const rgba = buildPng(
      2,
      [Buffer.from([10, 10, 10, 0, 20, 20, 20, 255])],
      4,
      [0],
    );
    expect(pngLuminance(rgba).mean).toBeCloseTo(15, 6);
  });
});
