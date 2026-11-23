/**
 * The header of a `.vtf`, and nothing else.
 *
 * Written to check what a tool claimed to write, not to decode a texture: this server has
 * never needed a pixel and does not start now. Reading the first 80 bytes answers the
 * questions that actually come up -- is this a cubemap, what size, which format, which
 * version -- and every one of those is a field, not a decode.
 *
 * Layout from Valve's `vtf.h`, and the offsets are asserted against real files rather than
 * trusted: `cubemapdefault.vtf` out of `hmcp_probe.bsp` reads 7.5, 32x32; the cubemaps
 * packed in `gm_construct.bsp` read 7.4, 32x32, DXT1 for the LDR set and RGBA16161616F for
 * the `.hdr` one. Those four numbers are the calibration.
 */

/**
 * `IMAGE_FORMAT_*`. The full enum is from sourcepp/vtfpp (MIT, Copyright (c) 2023 Laura
 * Lewis); the numbers are Valve's format ids, not ours.
 */
export const VTF_FORMATS: Record<number, string> = {
  0: "RGBA8888",
  1: "ABGR8888",
  2: "RGB888",
  3: "BGR888",
  4: "RGB565",
  5: "I8",
  6: "IA88",
  7: "P8",
  8: "A8",
  9: "RGB888_BLUESCREEN",
  10: "BGR888_BLUESCREEN",
  11: "ARGB8888",
  12: "BGRA8888",
  13: "DXT1",
  14: "DXT3",
  15: "DXT5",
  16: "BGRX8888",
  17: "BGR565",
  18: "BGRX5551",
  19: "BGRA4444",
  20: "DXT1_ONE_BIT_ALPHA",
  21: "BGRA5551",
  22: "UV88",
  23: "UVWQ8888",
  24: "RGBA16161616F",
  25: "RGBA16161616",
  26: "UVLX8888",
  27: "R32F",
  28: "RGB323232F",
  29: "RGBA32323232F",
  30: "RG1616F",
  31: "RG3232F",
  32: "RGBX8888",
  33: "EMPTY",
  34: "ATI2N",
  35: "ATI1N",
  36: "RGBA1010102",
  37: "BGRA1010102",
  38: "R16F",
};

/** `TEXTUREFLAGS_ENVMAP`. The bit that makes a texture a cubemap rather than a picture. */
export const VTF_ENVMAP = 0x4000;

export interface VtfHeader {
  version: string;
  width: number;
  height: number;
  flags: number;
  /** True when `TEXTUREFLAGS_ENVMAP` is set: six faces, not one image. */
  cubemap: boolean;
  format: string;
  frames: number;
  /** Levels stored, including the smallest 1x1. 0 is an invalid file. */
  mipmaps: number;
}

/** Reads the header, or null when the bytes are not a `.vtf` at all. */
export function readVtfHeader(bytes: Buffer): VtfHeader | null {
  if (bytes.length < 64 || bytes.toString("latin1", 0, 4) !== "VTF\0") return null;
  const major = bytes.readUInt32LE(4);
  const minor = bytes.readUInt32LE(8);
  const width = bytes.readUInt16LE(16);
  const height = bytes.readUInt16LE(18);
  const flags = bytes.readUInt32LE(20);
  const frames = bytes.readUInt16LE(24);
  const format = bytes.readInt32LE(52);
  return {
    version: `${major}.${minor}`,
    width,
    height,
    flags,
    cubemap: (flags & VTF_ENVMAP) !== 0,
    format: VTF_FORMATS[format] ?? String(format),
    frames,
    mipmaps: bytes.readUInt8(56),
  };
}
