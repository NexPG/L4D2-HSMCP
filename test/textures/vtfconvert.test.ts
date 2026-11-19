/**
 * Converting and extracting an existing VTF.
 *
 * The source is built by `write_vtf` (our PNG path), then converted and extracted, so the
 * test knows every pixel and can check the round-trip instead of trusting the header. The
 * compression claim is the one that matters: a BGRA texture must actually become smaller,
 * and the decoded image must be within the stated error.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { crc32 } from "../../src/formats/typescript/formats/vpk.js";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { config, FIXTURES, has } from "../support/env.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-vtfconv-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function chunk(tag: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(tag, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

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
      rgba[at] = (x * 9 + y) & 0xff;
      rgba[at + 1] = (y * 11) & 0xff;
      rgba[at + 2] = (x * y) & 0xff;
      rgba[at + 3] = 255;
    }
  }
  return rgba;
}

interface ConvertResult {
  written: boolean;
  bytes: number;
  sourceFormat: string;
  format: string;
  width: number;
  height: number;
  mipCount: number;
  verified: boolean;
  meanError: number;
}

const installed = has.sidecar;

describe.skipIf(!installed)("convert_vtf / extract_vtf", () => {
  it("recompresses to DXT1, halves the size and verifies the pixels", async () => {
    const image = join(scratch, "source.png");
    writeFileSync(image, png(64, 64, gradient(64, 64)));
    const raw = join(scratch, "raw.vtf");
    const dxt = join(scratch, "dxt.vtf");

    const written = await callSidecar<{ bytes: number }>(
      "vtf_write",
      { path: raw, image, format: "BGRA8888", resize: "none" },
      config,
    );
    const converted = await callSidecar<ConvertResult>(
      "vtf_convert",
      { path: raw, out: dxt, format: "DXT1" },
      config,
    );

    expect(converted.written).toBe(true);
    expect(converted.sourceFormat).toBe("BGRA8888");
    expect(converted.format).toBe("DXT1");
    expect(converted.width).toBe(64);
    expect(converted.height).toBe(64);
    expect(converted.mipCount).toBe(7);
    expect(converted.verified).toBe(true);
    expect(converted.meanError).toBeLessThan(48);
    expect(converted.bytes * 4).toBeLessThan(written.bytes);
    expect(readFileSync(dxt).length).toBe(converted.bytes);
  });

  it("resizes to a power of two and keeps the mip chain consistent", async () => {
    const image = join(scratch, "big.png");
    writeFileSync(image, png(64, 64, gradient(64, 64)));
    const raw = join(scratch, "big.vtf");
    await callSidecar("vtf_write", { path: raw, image, format: "BGRA8888", resize: "none" }, config);

    const converted = await callSidecar<ConvertResult>(
      "vtf_convert",
      { path: raw, out: join(scratch, "small.vtf"), format: "BGRA8888", width: 16, height: 16 },
      config,
    );
    expect(converted.width).toBe(16);
    expect(converted.height).toBe(16);
    expect(converted.mipCount).toBe(5);
    expect(converted.verified).toBe(true);
    expect(converted.meanError).toBe(0);
  });

  it("extracts a cubemap face instead of refusing the file", async () => {
    const extracted = await callSidecar<{
      written: { name: string; path: string }[];
    }>("pakfile_extract", {
      path: join(FIXTURES, "hmcp_probe.bsp"),
      into: join(scratch, "cube"),
      pattern: "*cubemapdefault.vtf",
    }, config);
    expect(extracted.written.length).toBe(1);
    const vtf = extracted.written[0]!.path;
    const out = join(scratch, "cube_down.png");

    const face = await callSidecar<{
      format: string;
      width: number;
      height: number;
      face: string;
      pngBytes: number;
    }>("vtf_extract", { path: vtf, out, maxSize: 256, face: "down" }, config);

    expect(face.face).toBe("down");
    expect(face.width).toBe(32);
    expect(face.height).toBe(32);
    expect(face.pngBytes).toBeGreaterThan(0);
    expect(readFileSync(out).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("extracts a PNG the decoder reads back at the requested size", async () => {
    const image = join(scratch, "extract.png");
    writeFileSync(image, png(64, 64, gradient(64, 64)));
    const raw = join(scratch, "extract.vtf");
    await callSidecar("vtf_write", { path: raw, image, format: "DXT5", resize: "none" }, config);

    const out = join(scratch, "extracted.png");
    const extracted = await callSidecar<{
      format: string;
      width: number;
      height: number;
      previewWidth: number;
      previewHeight: number;
      mipCount: number;
      pngBytes: number;
      out: string;
    }>("vtf_extract", { path: raw, out, maxSize: 32 }, config);

    expect(extracted.format).toBe("DXT5");
    expect(extracted.width).toBe(64);
    expect(extracted.previewWidth).toBe(32);
    expect(extracted.previewHeight).toBe(32);
    expect(extracted.mipCount).toBe(7);
    expect(readFileSync(out).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(readFileSync(out).length).toBe(extracted.pngBytes);
  });
});
