/**
 * The PNG decoder, against files built by the test rather than by our encoder.
 *
 * A decoder tested only on its own encoder's output proves that the pair agrees, not that
 * it reads PNG. Every scanline filter has a hand-built case here, plus the colour types a
 * texture pipeline meets (grey, RGB, palette, grey+alpha, RGBA) and a 16-bit file. The
 * expected pixels are computed in the test, so a wrong filter reconstruction cannot pass
 * by producing the same wrong thing twice.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pythonPath } from "../../src/core/typescript/sidecar/client.js";
import { config, has, REPO } from "../support/env.js";

const SCRIPT = String.raw`
import json, struct, zlib
from png import decode_png, encode_png

def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else (b if pb <= pc else c)

def build(width, height, rows, color_type, bit_depth=8, palette=b"", trns=b"", filters=None):
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    bpp = max(1, channels * (bit_depth // 8))
    filtered = bytearray()
    previous = bytes(len(rows[0]))
    for y, row in enumerate(rows):
        method = filters[y] if filters else 0
        if method == 0:
            filtered.append(0); filtered.extend(row); previous = row; continue
        out = bytearray(len(row))
        for i, value in enumerate(row):
            left = row[i - bpp] if i >= bpp else 0
            up = previous[i]
            upper_left = previous[i - bpp] if i >= bpp else 0
            if method == 1: predictor = left
            elif method == 2: predictor = up
            elif method == 3: predictor = (left + up) >> 1
            else: predictor = paeth(left, up, upper_left)
            out[i] = (value - predictor) & 0xFF
        filtered.append(method); filtered.extend(out); previous = row
    header = struct.pack(">IIBBBBB", width, height, bit_depth, color_type, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
    if palette: png += chunk(b"PLTE", palette)
    if trns: png += chunk(b"tRNS", trns)
    png += chunk(b"IDAT", zlib.compress(bytes(filtered), 9)) + chunk(b"IEND", b"")
    return png

results = {}

# RGBA with every filter in turn.
width, height = 4, 5
rgba = bytearray()
for y in range(height):
    for x in range(width):
        rgba += bytes(((x * 37 + y) & 255, (y * 53 + x) & 255, (x * y * 11) & 255, (x * 29 + y * 7) & 255))
rows = [bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height)]
for method in range(5):
    decoded = decode_png(build(width, height, rows, 6, filters=[method] * height))
    results[f"filter{method}"] = decoded["rgba"] == bytes(rgba)

# Grey 8-bit.
G = 3
grey_rows = [bytes([10, 20, 30]), bytes([40, 50, 60])]
decoded = decode_png(build(G, 2, grey_rows, 0))
results["grey"] = decoded["rgba"] == bytes(v for g in (10, 20, 30, 40, 50, 60) for v in (g, g, g, 255))

# RGB 8-bit.
rgb_rows = [bytes([255, 0, 0, 0, 255, 0]), bytes([0, 0, 255, 1, 2, 3])]
decoded = decode_png(build(2, 2, rgb_rows, 2))
results["rgb"] = decoded["rgba"] == bytes((255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 255))

# Palette with alpha.
decoded = decode_png(build(3, 1, [bytes([0, 1, 0])], 3, palette=bytes([10, 20, 30, 40, 50, 60]), trns=bytes([255, 0])))
results["palette"] = decoded["rgba"] == bytes((10, 20, 30, 255, 40, 50, 60, 0, 10, 20, 30, 255))

# Grey + alpha.
decoded = decode_png(build(2, 1, [bytes([7, 128, 9, 255])], 4))
results["grey-alpha"] = decoded["rgba"] == bytes((7, 7, 7, 128, 9, 9, 9, 255))

# 16-bit RGBA: the decoder keeps the high byte.
decoded = decode_png(build(1, 1, [bytes([0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0])], 6, bit_depth=16))
results["rgba16"] = decoded["rgba"] == bytes((0x12, 0x56, 0x9A, 0xDE))

# Our encoder's output decodes to the same pixels.
roundtrip = decode_png(encode_png(2, 2, bytes(range(16))))
results["encoder-roundtrip"] = roundtrip["rgba"] == bytes(range(16))

print(json.dumps(results))
`;

describe.skipIf(!has.sidecar)("PNG decoder", () => {
  it("reconstructs every filter and colour type", () => {
    const output = execFileSync(
      pythonPath(config),
      ["-c", SCRIPT],
      {
        env: {
          ...process.env,
          PYTHONPATH: join(REPO, "src", "textures", "python"),
          PYTHONWARNINGS: "ignore",
        },
        encoding: "utf8",
      },
    );
    const results = JSON.parse(output.trim().split(/\r?\n/).at(-1)!) as Record<string, boolean>;
    const failures = Object.entries(results)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    expect(failures, "cases that did not round-trip").toEqual([]);
    expect(Object.keys(results).length).toBe(11);
  });
});
