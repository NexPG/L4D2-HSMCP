/**
 * PNG → VTF without VTFCmd.
 *
 * The writer's own `verified` flag compares the pixels after a round-trip through the VTF
 * reader, so these tests can assert something stronger than "the file exists": the image
 * came back. The edge cases are the ones that produce a texture the engine refuses or
 * renders wrong — a non-power-of-two size, a format that needs a compressor, a requested
 * version outside what L4D2 reads.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { crc32 } from "../../src/formats/typescript/formats/vpk.js";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { readVtfTool } from "../../src/textures/typescript/tools/vtf.js";
import { writeVtfTool } from "../../src/textures/typescript/tools/vtfgen.js";
import { config, has } from "../support/env.js";
import { ctx } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-vtf-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function chunk(tag: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(tag, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** An RGBA PNG built here, so the decoder is not tested on its own encoder's quirks. */
function png(width: number, height: number, rgba: Buffer): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]), rgba.subarray(y * width * 4, (y + 1) * width * 4));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function gradient(width: number, height: number): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      rgba[at] = (x * 37 + y * 3) & 0xff;
      rgba[at + 1] = (y * 53 + x * 5) & 0xff;
      rgba[at + 2] = (x * y * 11) & 0xff;
      rgba[at + 3] = (x + y) % 4 === 0 ? 128 : 255;
    }
  }
  return rgba;
}

interface WriteResult {
  path: string;
  written: boolean;
  bytes: number;
  version: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resized: boolean;
  format: string;
  mipCount: number;
  flags: number;
  clampS: boolean;
  clampT: boolean;
  verified: boolean;
}

const installed = has.sidecar;

describe.skipIf(!installed)("write_vtf", () => {
  it("writes L4D2's 7.4 with a full mip chain and verifies the pixels", async () => {
    const image = join(scratch, "gradient.png");
    writeFileSync(image, png(8, 8, gradient(8, 8)));
    const path = join(scratch, "gradient.vtf");

    const result = await callSidecar<WriteResult>(
      "vtf_write",
      { path, image, clampS: true, resize: "none" },
      config,
    );
    expect(result.verified).toBe(true);
    expect(result.version).toBe("7.4");
    expect(result.format).toBe("BGRA8888");
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    // 8, 4, 2, 1: a square chain includes the 1x1 level.
    expect(result.mipCount).toBe(4);
    expect(result.resized).toBe(false);
    expect(result.clampS).toBe(true);
    expect(result.clampT).toBe(false);
    expect(result.flags & 0x4).toBe(0x4);

    // The header tool the agent uses must agree with what the writer reported.
    const header = (await readVtfTool.handler({ path }, ctx as never)) as {
      version: string;
      width: number;
      height: number;
      format: string;
      bytes: number;
    };
    expect(header.version).toBe("7.4");
    expect(header.width).toBe(8);
    expect(header.height).toBe(8);
    expect(header.format).toBe("BGRA8888");
    expect(header.bytes).toBe(result.bytes);
    expect(readFileSync(path).length).toBe(result.bytes);
  });

  it("refuses a non-power-of-two image unless scaling is allowed", async () => {
    const image = join(scratch, "wide.png");
    writeFileSync(image, png(5, 3, gradient(5, 3)));

    await expect(
      callSidecar("vtf_write", { path: join(scratch, "wide.vtf"), image, resize: "none" }, config),
    ).rejects.toThrow(/power of two/);

    const scaled = await callSidecar<WriteResult>(
      "vtf_write",
      { path: join(scratch, "wide.vtf"), image, resize: "bilinear" },
      config,
    );
    expect(scaled.originalWidth).toBe(5);
    expect(scaled.originalHeight).toBe(3);
    expect(scaled.width).toBe(8);
    expect(scaled.height).toBe(4);
    expect(scaled.resized).toBe(true);
    expect(scaled.verified).toBe(true);
  });

  it("writes BGRX as an opaque copy and says so by verifying against that", async () => {
    const image = join(scratch, "alpha.png");
    const rgba = gradient(8, 8);
    rgba[3] = 40; // a transparent pixel the format cannot keep
    writeFileSync(image, png(8, 8, rgba));
    const result = await callSidecar<WriteResult>(
      "vtf_write",
      { path: join(scratch, "alpha.vtf"), image, format: "BGRX8888", resize: "none" },
      config,
    );
    expect(result.format).toBe("BGRX8888");
    expect(result.verified).toBe(true);
  });

  it("sets the alpha flag and reflectivity the engine reads", async () => {
    const image = join(scratch, "alpha.png");
    const rgba = Buffer.alloc(8 * 8 * 4);
    for (let i = 0; i < 8 * 8; i += 1) {
      rgba[i * 4] = 200;
      rgba[i * 4 + 1] = 100;
      rgba[i * 4 + 2] = 50;
      rgba[i * 4 + 3] = i < 8 ? 40 : 255;
    }
    writeFileSync(image, png(8, 8, rgba));

    const full = await callSidecar<WriteResult & { alphaMode: string; reflectivity: number[]; flags: number }>(
      "vtf_write",
      { path: join(scratch, "alpha.vtf"), image, format: "BGRA8888", resize: "none" },
      config,
    );
    expect(full.alphaMode).toBe("eightBit");
    expect(full.flags & 0x2000).toBe(0x2000);
    expect(full.reflectivity[0]).toBeGreaterThan(0);
    expect(full.reflectivity[0]).toBeLessThanOrEqual(1);

    const dxt1 = await callSidecar<WriteResult & { alphaMode: string; flags: number }>(
      "vtf_write",
      { path: join(scratch, "alpha_dxt1.vtf"), image, format: "DXT1", resize: "none" },
      config,
    );
    expect(dxt1.alphaMode).toBe("oneBit");
    expect(dxt1.flags & 0x1000).toBe(0x1000);
  });

  it("compresses to DXT1 and DXT5 and measures the loss instead of hiding it", async () => {
    const image = join(scratch, "dxt.png");
    writeFileSync(image, png(64, 64, gradient(64, 64)));

    const dxt1 = await callSidecar<WriteResult & { meanError: number; maxError: number; alphaPreserved: boolean }>(
      "vtf_write",
      { path: join(scratch, "dxt1.vtf"), image, format: "DXT1", resize: "none" },
      config,
    );
    expect(dxt1.format).toBe("DXT1");
    expect(dxt1.verified).toBe(true);
    expect(dxt1.meanError).toBeLessThan(48);
    expect(dxt1.alphaPreserved).toBe(true); // one bit of alpha, which this source preserves
    expect(dxt1.mipCount).toBe(7);

    const dxt5 = await callSidecar<WriteResult & { meanError: number }>(
      "vtf_write",
      { path: join(scratch, "dxt5.vtf"), image, format: "DXT5", resize: "none" },
      config,
    );
    expect(dxt5.format).toBe("DXT5");
    expect(dxt5.verified).toBe(true);
    expect(dxt5.meanError).toBeLessThan(48);

    const raw = await callSidecar<WriteResult>(
      "vtf_write",
      { path: join(scratch, "raw.vtf"), image, format: "BGRA8888", resize: "none" },
      config,
    );
    // The point of DXT: the same image is several times smaller.
    expect(dxt1.bytes * 4).toBeLessThan(raw.bytes);
    expect(dxt5.bytes * 2).toBeLessThan(raw.bytes);
  });

  it("refuses a version L4D2 does not read", async () => {
    const image = join(scratch, "small.png");
    writeFileSync(image, png(4, 4, gradient(4, 4)));
    await expect(
      callSidecar("vtf_write", { path: join(scratch, "small.vtf"), image, version: "7.9" }, config),
    ).rejects.toThrow(/7\.2 through 7\.5/);
  });
});

describe.skipIf(!installed)("write_vtf frames", () => {
  it("writes an animated VTF and verifies every frame", async () => {
    const first = join(scratch, "frame_a.png");
    const second = join(scratch, "frame_b.png");
    writeFileSync(first, png(8, 8, gradient(8, 8)));
    const flipped = gradient(8, 8);
    for (let at = 0; at < flipped.length; at += 4) {
      flipped[at] = 255 - flipped[at]!;
      flipped[at + 1] = 255 - flipped[at + 1]!;
    }
    writeFileSync(second, png(8, 8, flipped));
    const path = join(scratch, "animated.vtf");

    const result = await callSidecar<WriteResult & { frameCount: number; images: string[] }>(
      "vtf_write",
      { path, frames: [first, second], resize: "none" },
      config,
    );
    expect(result.frameCount).toBe(2);
    expect(result.images).toEqual([first, second]);
    expect(result.verified).toBe(true);
    expect(result.format).toBe("BGRA8888");

    const header = (await readVtfTool.handler({ path }, ctx as never)) as {
      frames: number;
      width: number;
      height: number;
    };
    expect(header.frames).toBe(2);
    expect(header.width).toBe(8);
    expect(header.height).toBe(8);
  });

  it("passes frames through the write_vtf tool", async () => {
    const first = join(scratch, "tool_a.png");
    const second = join(scratch, "tool_b.png");
    writeFileSync(first, png(8, 8, gradient(8, 8)));
    writeFileSync(second, png(8, 8, gradient(8, 8)));
    const path = join(scratch, "tool-animated.vtf");
    const result = (await writeVtfTool.handler(
      { path, frames: [first, second], confirm: true } as never,
      ctx as never,
    )) as { frameCount: number; images: string[]; verified: boolean };
    expect(result.frameCount).toBe(2);
    expect(result.images).toEqual([first, second]);
    expect(result.verified).toBe(true);
  });

  it("refuses frames that do not share dimensions", async () => {
    const first = join(scratch, "size_a.png");
    const second = join(scratch, "size_b.png");
    writeFileSync(first, png(8, 8, gradient(8, 8)));
    writeFileSync(second, png(4, 4, gradient(4, 4)));
    await expect(
      callSidecar(
        "vtf_write",
        { path: join(scratch, "size-mismatch.vtf"), frames: [first, second], resize: "none" },
        config,
      ),
    ).rejects.toThrow(/share dimensions/);
  });
});
