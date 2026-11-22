/**
 * Making a texture out of an image.
 *
 * The assertion that matters is not "a file appeared" but *what came out*: VTFCmd chooses
 * between `-format` and `-alphaformat` per texture, so asking for DXT1 on an image with an
 * alpha channel gives DXT5. Reading the header back is the only way to know which it took,
 * and a tool that reported the format it was asked for would be lying half the time.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readVtfTool, runVtfConvert } from "../../src/textures/typescript/tools/vtf.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-vtf-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A TGA with an alpha channel, top-down, uncompressed: the plainest DevIL will read. */
function writeTga(path: string, size = 64, bpp: 24 | 32 = 32): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const header = Buffer.alloc(18);
  header.writeUInt8(2, 2);
  header.writeUInt16LE(size, 12);
  header.writeUInt16LE(size, 14);
  header.writeUInt8(bpp, 16);
  header.writeUInt8(bpp === 32 ? 0x28 : 0x20, 17);
  const channels = bpp / 8;
  const body = Buffer.alloc(size * size * channels);
  for (let p = 0; p < body.length; p += channels) {
    body[p] = 64;
    body[p + 1] = 128;
    body[p + 2] = 192;
    if (channels === 4) body[p + 3] = 255;
  }
  writeFileSync(path, Buffer.concat([header, body]));
}

interface Converted {
  ok: boolean;
  vtf: string;
  header: { version: string; width: number; height: number; format: string; cubemap: boolean };
  bytes: number;
}

const convert = async (image: string, over: Record<string, unknown> = {}): Promise<Converted> =>
  (await runVtfConvert.handler(
    { image, noMipmaps: false, confirm: true, ...over } as never,
    ctx,
  )) as never;

describe("run_vtf_convert", () => {
  it("refuses a file VTFCmd cannot read, naming what it does read", async () => {
    // Its own answer is "Error loading input file", which says nothing about which part
    // it disliked -- and it says it after the process has started.
    const notAnImage = join(scratch, "notes.txt");
    writeFileSync(notAnImage, "this is not a texture\n");
    await expect(convert(notAnImage)).rejects.toThrow(/not an image VTFCmd reads/);
  });

  it.skipIf(!has.vtfcmd)("writes a .vtf beside the image, and reports what came out", async () => {
    const image = join(scratch, "wall.tga");
    writeTga(image);

    const r = await convert(image, { format: "DXT1" });
    expect(r.ok).toBe(true);
    expect(r.vtf).toBe(join(scratch, "wall.vtf"));
    expect(r.header.width).toBe(64);
    expect(r.header.height).toBe(64);
    expect(r.header.cubemap).toBe(false);

    // DXT1 was asked for. The image has an alpha channel, so VTFCmd used the alpha
    // format instead -- which is exactly why the header is read back rather than echoed.
    expect(r.header.format).toBe("DXT5");
    expect(r.bytes).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(!has.vtfcmd)("takes the plain format when there is no alpha to preserve", async () => {
    // The other half of the same claim: with a 24-bit source, `-format` is what applies.
    const image = join(scratch, "opaque.tga");
    writeTga(image, 64, 24);
    const r = await convert(image, { format: "DXT1" });
    expect(r.ok).toBe(true);
    expect(r.header.format).toBe("DXT1");
  }, 120_000);
});

describe("read_vtf", () => {
  it("reads a DXT1 cubemap header without decoding the image", async () => {
    const header = Buffer.alloc(80);
    header.write("VTF\0", 0, "latin1");
    header.writeUInt32LE(7, 4);
    header.writeUInt32LE(4, 8);
    header.writeUInt32LE(80, 12);
    header.writeUInt16LE(512, 16);
    header.writeUInt16LE(512, 18);
    header.writeUInt32LE(0x4000, 20);
    header.writeUInt16LE(1, 24);
    header.writeInt32LE(13, 52);
    const path = join(scratch, "sky.vtf");
    writeFileSync(path, header);
    const r = (await readVtfTool.handler({ path }, ctx)) as {
      width: number;
      height: number;
      cubemap: boolean;
      format: string;
      version: string;
    };
    expect(r).toMatchObject({
      width: 512,
      height: 512,
      cubemap: true,
      format: "DXT1",
      version: "7.4",
    });
  });
});

/**
 * A 7.4 VTF with a CRC integer resource and one particle-sheet sequence.
 *
 * `srctools` pops the particle resource out of the table and decodes it into `sheet_info`,
 * so this also proves that the resource table and the decoded sheets are reported separately.
 */
function writeResourceVtf(path: string): void {
  const headerSize = 112;
  const sheetOffset = headerSize;
  const sheet = Buffer.alloc(44);
  sheet.writeUInt32LE(0, 0); // Resource version 0.
  sheet.writeUInt32LE(1, 4); // One sequence.
  sheet.writeUInt32LE(0, 8); // Sequence 0.
  sheet.writeUInt8(0, 15); // clamp = false
  sheet.writeUInt32LE(1, 16); // One frame.
  sheet.writeFloatLE(1.0, 20); // Sequence duration.
  sheet.writeFloatLE(1.0, 24); // Frame duration.
  sheet.writeFloatLE(0.0, 28);
  sheet.writeFloatLE(0.0, 32);
  sheet.writeFloatLE(1.0, 36);
  sheet.writeFloatLE(1.0, 40);

  const file = Buffer.alloc(sheetOffset + 4 + sheet.length);
  file.write("VTF\0", 0, "latin1");
  file.writeUInt32LE(7, 4);
  file.writeUInt32LE(4, 8);
  file.writeUInt32LE(headerSize, 12);
  file.writeUInt16LE(64, 16);
  file.writeUInt16LE(64, 18);
  file.writeUInt32LE(0, 20);
  file.writeUInt16LE(1, 24);
  file.writeInt32LE(13, 52); // DXT1
  file.writeUInt8(1, 56); // one mipmap
  file.writeInt32LE(-1, 57); // no low-res image
  file.writeUInt16LE(1, 63); // depth
  file.writeUInt32LE(3, 68);

  let entry = 80;
  const put = (id: [number, number, number], flags: number, data: number): void => {
    file.set(id, entry);
    file.writeUInt8(flags, entry + 3);
    file.writeUInt32LE(data, entry + 4);
    entry += 8;
  };
  put([0x30, 0, 0], 0, sheetOffset); // HIGH_RES
  put([0x43, 0x52, 0x43], 2, 0x0badf00d); // CRC, inline integer
  put([0x10, 0, 0], 0, sheetOffset); // PARTICLE_SHEET

  file.writeUInt32LE(sheet.length, sheetOffset);
  sheet.copy(file, sheetOffset + 4);
  writeFileSync(path, file);
}

describe.skipIf(!has.sidecar)("read_vtf details", () => {
  it("reads the resource table and decodes particle-sheet sequences", async () => {
    const path = join(scratch, "particle.vtf");
    writeResourceVtf(path);
    const r = (await readVtfTool.handler({ path, details: true }, ctx)) as {
      version: string;
      resources: Array<{ id: string | null; flags: number; kind: string; value: number | null }>;
      sheetInfo: Array<{
        sequence: number;
        frameCount: number;
        frames?: Array<{ coords: number[][] }>;
      }>;
      hotspotInfo: unknown;
    };
    expect(r.version).toBe("7.4");
    expect(r.resources).toEqual([
      { id: "CRC", rawId: "435243", flags: 2, kind: "integer", value: 0x0badf00d, size: null },
    ]);
    expect(r.sheetInfo).toHaveLength(1);
    expect(r.sheetInfo[0]).toMatchObject({ sequence: 0, frameCount: 1 });
    expect(r.sheetInfo[0]!.frames![0]!.coords).toEqual([
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
    ]);
    expect(r.hotspotInfo).toBeNull();
  });

  it("still reads a header when details is false", async () => {
    const path = join(scratch, "particle.vtf");
    writeResourceVtf(path);
    const r = (await readVtfTool.handler({ path }, ctx)) as { resources?: unknown };
    expect(r.resources).toBeUndefined();
  });
});
