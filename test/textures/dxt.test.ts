/**
 * The pure-Python DXT encoder: the fallback when srctools is installed without its
 * Cython/libsqush extension.
 *
 * On this machine srctools ships `_cy_vtf_readwrite` and `write_vtf` uses that, so the
 * VTF tests exercise libsquish, not these functions. That is exactly why this file drives
 * the encoder directly through the Python reader: an untested fallback is a fallback that
 * fails on a source install.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pythonPath } from "../../src/core/typescript/sidecar/client.js";
import { config, has, REPO } from "../support/env.js";

const SCRIPT = String.raw`
import array, json
from dxt import encode_dxt1, encode_dxt5
from srctools import _py_vtf_readwrite as rw
from srctools.vtf import ImageFormats

def decode(fmt, encoded, width, height):
    out = array.array('B', [0] * (width * height * 4))
    rw.load(fmt, out, encoded, width, height)
    return bytes(out)

def error(source, decoded, channels):
    total = 0
    peak = 0
    samples = 0
    for at in range(0, len(source), 4):
        for channel in range(channels):
            delta = abs(source[at + channel] - decoded[at + channel])
            total += delta
            peak = max(peak, delta)
            samples += 1
    return total / samples, peak

width = height = 16
flat = bytes((214, 44, 8, 255)) * (width * height)  # RGB565-exact
smooth = bytes(
    value
    for y in range(height)
    for x in range(width)
    for value in (x * 8, y * 8, 128, 255)
)

results = {}
for name, fmt, encoder in [
    ("dxt1", ImageFormats.DXT1, encode_dxt1),
    ("dxt5", ImageFormats.DXT5, encode_dxt5),
]:
    encoded = encoder(flat, width, height)
    decoded = decode(fmt, encoded, width, height)
    results[name + "-flat"] = decoded == flat
    results[name + "-size"] = len(encoded) == (width // 4) * (height // 4) * (8 if name == "dxt1" else 16)
    mean, peak = error(smooth, decode(fmt, encoder(smooth, width, height), width, height), 3)
    results[name + "-smooth-mean"] = mean
    results[name + "-smooth-peak"] = peak
    if name == "dxt5":
        results["dxt5-alpha"] = decode(fmt, encoded, width, height)[3::4] == flat[3::4]

print(json.dumps(results))
`;

describe.skipIf(!has.sidecar)("DXT encoder", () => {
  it("round-trips flat blocks exactly and a smooth gradient within a stated error", () => {
    const output = execFileSync(pythonPath(config), ["-c", SCRIPT], {
      env: {
        ...process.env,
        PYTHONPATH: join(REPO, "src", "textures", "python"),
        PYTHONWARNINGS: "ignore",
      },
      encoding: "utf8",
    });
    const r = JSON.parse(output.trim().split(/\r?\n/).at(-1)!) as Record<string, boolean | number>;
    expect(r["dxt1-flat"]).toBe(true);
    expect(r["dxt5-flat"]).toBe(true);
    expect(r["dxt1-size"]).toBe(true);
    expect(r["dxt5-size"]).toBe(true);
    expect(r["dxt5-alpha"]).toBe(true);
    // Range-fit, not a quality encoder: the claim is bounded error, not perfection.
    expect(r["dxt1-smooth-mean"]).toBeLessThan(20);
    expect(r["dxt5-smooth-mean"]).toBeLessThan(20);
    expect(r["dxt1-smooth-peak"]).toBeLessThan(80);
  });
});
