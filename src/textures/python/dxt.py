"""A DXT1/DXT5 encoder, because every VTF writer that ships textures needs one.

`srctools` decodes DXT but explicitly does not encode it ("highly complicated and very
slow"), and the C++ libraries this project used to carry call out to Compressonator — an
external binary, not code that can be ported. Without an encoder every texture this server
writes is uncompressed: a 2048² material becomes 16 MB instead of 2.7 MB.

This is a **range-fit** encoder: each 4×4 block takes the per-channel minimum and maximum
as the two endpoints and picks the nearest palette entry per pixel. It is not the highest
quality encoder that exists; it is a correct one, deterministic, and fast enough to run on
a mip chain in Python. The tool reports the measured error instead of claiming the source
came back byte for byte.

Formats, from `vtfpp/ImageFormats.h` and the S3TC specification:
- DXT1: two RGB565 endpoints + 16 two-bit indices. If all alpha is opaque, four colours;
  if the block has transparent pixels, three colours plus a transparent index.
- DXT5: two alpha endpoints + 16 three-bit indices, then a DXT1 colour block in
  four-colour mode.
"""

from __future__ import annotations

from typing import Any


def _pack565(r: int, g: int, b: int) -> int:
    return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)


def _unpack565(value: int) -> tuple[int, int, int]:
    r = (value >> 11) & 0x1F
    g = (value >> 5) & 0x3F
    b = value & 0x1F
    return (r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)


def _distance(r: int, g: int, b: int, colour: tuple[int, int, int]) -> int:
    dr = r - colour[0]
    dg = g - colour[1]
    db = b - colour[2]
    return dr * dr + dg * dg + db * db


def _block_pixels(rgba: bytes, width: int, height: int, bx: int, by: int) -> list[tuple[int, int, int, int]]:
    """The 4×4 block, clamping at the edges so partial blocks repeat the last row/column."""
    out: list[tuple[int, int, int, int]] = []
    for y in range(4):
        sy = min(height - 1, by * 4 + y)
        for x in range(4):
            sx = min(width - 1, bx * 4 + x)
            at = (sy * width + sx) * 4
            out.append((rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]))
    return out


def _endpoints(pixels: list[tuple[int, int, int, int]]) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """Two colours that span the block: farthest from the centroid, then farthest from that.

    Per-channel min/max picks colours that need not exist in the block (the reddest pixel
    and the greenest one), which is why the first version measured a 40/255 error on a
    gradient. Walking out from the centroid picks real extremes and costs three passes
    over sixteen pixels.
    """
    count = len(pixels)
    centre = [sum(p[i] for p in pixels) / count for i in range(3)]

    def dist2(a: tuple[int, int, int], b: list[float] | tuple[int, int, int]) -> float:
        return sum((a[i] - b[i]) ** 2 for i in range(3))

    first = max(pixels, key=lambda p: dist2(p[:3], centre))[:3]
    second = max(pixels, key=lambda p: dist2(p[:3], first))[:3]
    return first, second


def _colour_block(pixels: list[tuple[int, int, int, int]], allow_alpha: bool) -> bytes:
    """A DXT1 colour block. In alpha mode c0 <= c1, which reserves index 3 for transparent."""
    transparent = allow_alpha and any(p[3] < 128 for p in pixels)
    first, second = _endpoints(pixels)
    if transparent:
        # Three-colour mode: c0 <= c1, index 3 is transparent.
        c0 = _pack565(*first)
        c1 = _pack565(*second)
        if c0 > c1:
            c0, c1 = c1, c0
        p0, p1 = _unpack565(c0), _unpack565(c1)
        palette = [p0, p1, tuple((p0[i] + p1[i]) // 2 for i in range(3))]
    else:
        c0 = _pack565(*first)
        c1 = _pack565(*second)
        if c0 <= c1:
            # Four-colour mode needs c0 > c1. When the block is flat, nudge c1 down.
            if c0 == 0:
                c0, c1 = 1, 0
            else:
                c1 = c0 - 1
        p0, p1 = _unpack565(c0), _unpack565(c1)
        palette = [
            p0,
            p1,
            tuple((2 * p0[i] + p1[i]) // 3 for i in range(3)),
            tuple((p0[i] + 2 * p1[i]) // 3 for i in range(3)),
        ]

    indices = 0
    for i, (r, g, b, a) in enumerate(pixels):
        if transparent and a < 128:
            index = 3
        else:
            index = min(range(len(palette)), key=lambda k: _distance(r, g, b, palette[k]))
        indices |= index << (2 * i)
    return c0.to_bytes(2, "little") + c1.to_bytes(2, "little") + indices.to_bytes(4, "little")


def _alpha_block(pixels: list[tuple[int, int, int, int]]) -> bytes:
    alphas = [p[3] for p in pixels]
    a0, a1 = max(alphas), min(alphas)
    if a0 == a1:
        return bytes((a0, a1)) + bytes(6)
    palette = [a0, a1]
    if a0 > a1:
        palette += [((7 - i) * a0 + i * a1) // 7 for i in range(1, 7)]
    else:  # not produced by this encoder, but the format defines it
        palette += [((5 - i) * a0 + i * a1) // 5 for i in range(1, 5)] + [0, 255]
    bits = 0
    for i, value in enumerate(alphas):
        index = min(range(8), key=lambda k: abs(value - palette[k]))
        bits |= index << (3 * i)
    return bytes((a0, a1)) + bits.to_bytes(6, "little")


def encode_dxt1(rgba: bytes, width: int, height: int) -> bytes:
    if len(rgba) != width * height * 4:
        raise ValueError(f"expected {width * height * 4} RGBA bytes, got {len(rgba)}")
    out = bytearray()
    for by in range((height + 3) // 4):
        for bx in range((width + 3) // 4):
            out += _colour_block(_block_pixels(rgba, width, height, bx, by), allow_alpha=True)
    return bytes(out)


def encode_dxt5(rgba: bytes, width: int, height: int) -> bytes:
    if len(rgba) != width * height * 4:
        raise ValueError(f"expected {width * height * 4} RGBA bytes, got {len(rgba)}")
    out = bytearray()
    for by in range((height + 3) // 4):
        for bx in range((width + 3) // 4):
            pixels = _block_pixels(rgba, width, height, bx, by)
            out += _alpha_block(pixels)
            out += _colour_block(pixels, allow_alpha=False)
    return bytes(out)


# --- srctools save hooks ---------------------------------------------------------------
#
# `srctools.vtf` owns the header, resources, mip chain, cubemap faces and frames; the only
# missing piece is the per-block encoder. Registering these functions in its private save
# table lets a tested writer keep doing everything except the compression. The module is
# pinned (2.7.0), and the tests fail loudly if either name moves.


def save_dxt1(pixels: Any, data: Any, width: int, height: int) -> None:
    encoded = encode_dxt1(bytes(pixels), width, height)
    data[:] = encoded


def save_dxt5(pixels: Any, data: Any, width: int, height: int) -> None:
    encoded = encode_dxt5(bytes(pixels), width, height)
    data[:] = encoded


def install() -> None:
    """Registers both encoders with srctools' pure-Python backend, once.

    A wheel with `_cy_vtf_readwrite` (the normal install) already has libsquish and takes
    precedence inside `srctools.vtf`; patching the pure-Python tables changes nothing there
    and is harmless. On a source install without the extension this is what makes DXT
    writable at all.
    """
    from srctools import _py_vtf_readwrite as rw
    from srctools.vtf import ImageFormats

    rw._SAVE[ImageFormats.DXT1] = save_dxt1  # noqa: SLF001 -- the documented extension point
    rw._SAVE[ImageFormats.DXT1_ONEBITALPHA] = save_dxt1  # noqa: SLF001
    rw._SAVE[ImageFormats.DXT5] = save_dxt5  # noqa: SLF001
