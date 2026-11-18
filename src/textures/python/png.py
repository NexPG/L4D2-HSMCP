"""PNG in, RGBA out; RGBA in, PNG out — without Pillow.

`preview_asset` has always encoded a PNG by hand, because the sidecar installs srctools
and nothing else. The other direction was missing: an agent that draws or downloads a
texture could not turn it into a `.vtf` without an external converter. This module is the
half that reads, plus the existing encoder moved to one home.

Only the PNG a texture pipeline actually produces is supported: non-interlaced, 8 or 16 bit,
grey/RGB/palette/grey+alpha/RGBA. Interlaced and 1/2/4-bit files are refused with a
message that says which feature was found, not decoded incorrectly.
"""

from __future__ import annotations

import struct
import zlib

_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class ImageError(ValueError):
    """A file that is not a PNG this decoder can read, with the reason."""


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_png(width: int, height: int, rgba: bytes, *, level: int = 9) -> bytes:
    """A PNG from RGBA bytes, one filter per row (none), no dependencies."""
    if width <= 0 or height <= 0:
        raise ValueError("PNG dimensions must be positive")
    if len(rgba) != width * height * 4:
        raise ValueError(f"expected {width * height * 4} RGBA bytes, got {len(rgba)}")
    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)  # filter: none
        rows.extend(rgba[y * stride : (y + 1) * stride])
    return (
        _SIGNATURE
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(bytes(rows), level))
        + _chunk(b"IEND", b"")
    )


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _unfilter(data: bytes, height: int, stride: int, bpp: int) -> bytes:
    """Reverses the per-row filters (0 none, 1 sub, 2 up, 3 average, 4 paeth)."""
    out = bytearray(height * stride)
    offset = 0
    for y in range(height):
        if offset >= len(data):
            raise ImageError("PNG image data ends in the middle of a row")
        method = data[offset]
        offset += 1
        row = bytearray(data[offset : offset + stride])
        if len(row) != stride:
            raise ImageError("PNG image data ends in the middle of a row")
        offset += stride
        previous = out[(y - 1) * stride : y * stride] if y > 0 else bytes(stride)
        if method == 0:
            pass
        elif method == 1:
            for i in range(bpp, stride):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif method == 2:
            for i in range(stride):
                row[i] = (row[i] + previous[i]) & 0xFF
        elif method == 3:
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + ((left + previous[i]) >> 1)) & 0xFF
        elif method == 4:
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                upper_left = previous[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + _paeth(left, previous[i], upper_left)) & 0xFF
        else:
            raise ImageError(f"PNG row {y} uses filter {method}, which is not defined")
        out[y * stride : (y + 1) * stride] = row
    return bytes(out)


def decode_png(data: bytes) -> dict[str, object]:
    """Decodes a PNG into RGBA8888. Returns width, height, rgba and the source layout."""
    if not data.startswith(_SIGNATURE):
        raise ImageError("not a PNG: the 8-byte signature is missing")

    at = len(_SIGNATURE)
    width = height = bit_depth = color_type = interlace = 0
    palette = b""
    transparency = b""
    idat = bytearray()
    seen_ihdr = False
    while at + 8 <= len(data):
        length = struct.unpack_from(">I", data, at)[0]
        tag = data[at + 4 : at + 8]
        body = data[at + 8 : at + 8 + length]
        if len(body) != length:
            raise ImageError(f"PNG chunk {tag!r} is truncated")
        at += 12 + length
        if tag == b"IHDR":
            if length != 13:
                raise ImageError("PNG IHDR is not 13 bytes")
            width, height, bit_depth, color_type, _compression, _filter, interlace = struct.unpack(
                ">IIBBBBB", body
            )
            seen_ihdr = True
        elif tag == b"PLTE":
            palette = body
        elif tag == b"tRNS":
            transparency = body
        elif tag == b"IDAT":
            idat.extend(body)
        elif tag == b"IEND":
            break
    if not seen_ihdr:
        raise ImageError("PNG has no IHDR")
    if width == 0 or height == 0:
        raise ImageError("PNG is zero-sized")
    if interlace != 0:
        raise ImageError("interlaced (Adam7) PNG is not supported; export a non-interlaced PNG")
    if bit_depth not in (8, 16):
        raise ImageError(f"{bit_depth}-bit PNG is not supported; export 8-bit")
    if color_type not in (0, 2, 3, 4, 6):
        raise ImageError(f"PNG colour type {color_type} is not defined")

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    sample_bytes = bit_depth // 8
    bpp = max(1, channels * sample_bytes)
    stride = width * channels * sample_bytes
    if not idat:
        raise ImageError("PNG has no IDAT")
    try:
        raw = zlib.decompress(bytes(idat))
    except zlib.error as exc:
        raise ImageError(f"PNG image data does not inflate: {exc}") from exc
    rows = _unfilter(raw, height, stride, bpp)

    out = bytearray(width * height * 4)
    palette_entries = [palette[i : i + 3] for i in range(0, len(palette), 3)]
    alpha_table = list(transparency) if color_type == 3 and transparency else []
    transparent_gray = (
        struct.unpack(">H", transparency[:2])[0] if color_type == 0 and len(transparency) >= 2 else None
    )
    transparent_rgb = (
        struct.unpack(">HHH", transparency[:6]) if color_type == 2 and len(transparency) >= 6 else None
    )
    step = sample_bytes

    for y in range(height):
        row = rows[y * stride : (y + 1) * stride]
        for x in range(width):
            i = x * channels * step
            o = (y * width + x) * 4
            if bit_depth == 16:
                sample = [row[i + k * 2] for k in range(channels)]
                gray_value = struct.unpack_from(">H", row, i)[0] if color_type == 0 else None
                rgb_value = struct.unpack_from(">HHH", row, i) if color_type == 2 else None
            else:
                sample = [row[i + k] for k in range(channels)]
                gray_value = sample[0] if color_type == 0 else None
                rgb_value = tuple(sample) if color_type == 2 else None

            if color_type == 0:
                grey = sample[0]
                alpha = 0 if transparent_gray is not None and gray_value == transparent_gray else 255
                out[o : o + 4] = bytes((grey, grey, grey, alpha))
            elif color_type == 2:
                alpha = 0 if transparent_rgb is not None and rgb_value == transparent_rgb else 255
                out[o : o + 4] = bytes((sample[0], sample[1], sample[2], alpha))
            elif color_type == 3:
                index = sample[0]
                if index >= len(palette_entries):
                    raise ImageError(f"palette index {index} is outside the PLTE table")
                r, g, b = palette_entries[index]
                alpha = alpha_table[index] if index < len(alpha_table) else 255
                out[o : o + 4] = bytes((r, g, b, alpha))
            elif color_type == 4:
                grey, alpha = sample[0], sample[1]
                out[o : o + 4] = bytes((grey, grey, grey, alpha))
            else:
                out[o : o + 4] = bytes((sample[0], sample[1], sample[2], sample[3]))

    return {
        "width": width,
        "height": height,
        "rgba": bytes(out),
        "bitDepth": bit_depth,
        "colorType": color_type,
        "interlaced": False,
    }
