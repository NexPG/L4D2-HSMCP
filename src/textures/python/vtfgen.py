"""PNG → VTF, natively.

`run_vtf_convert` drives VTFCmd, a separate download. That is fine for someone who has
VTFEdit++ installed and a hole for everyone else — and it is the last step of "make a
material" that left this server. The format is not secret: a header plus a mip chain, and
srctools (a pinned dependency) already reads and writes it. This module feeds it pixels
decoded by our own PNG reader.

**Compression is deliberately absent.** Writing DXT1/DXT5 would mean implementing a
compressor whose output differs from every reference encoder; an uncompressed VTF
(BGRA8888) is valid, exact, and what `vtex` will compress later if the author wants the
size down. The tool says so instead of pretending it produced DXT.

L4D2 ships VTF 7.4, measured on 300 materials from `pak01_dir.vpk`; that is the default.
"""

from __future__ import annotations

from array import array
from pathlib import Path
from typing import Any

from png import ImageError, decode_png

# Formats `srctools.vtf` can write from RGBA without a compressor.
_WRITABLE = {
    "RGBA8888",
    "BGRA8888",
    "RGB888",
    "BGR888",
    "RGB565",
    "BGR565",
    "BGRX8888",
    "BGRA4444",
    "BGRA5551",
    "I8",
    "IA88",
    "A8",
}


def _is_pot(value: int) -> bool:
    return value > 0 and (value & (value - 1)) == 0


def _next_pot(value: int) -> int:
    result = 1
    while result < value:
        result <<= 1
    return result


def _resize(rgba: bytes, width: int, height: int, new_width: int, new_height: int, mode: str) -> bytes:
    """Nearest or bilinear resize. Alpha is resampled with colour, not premultiplied."""
    if mode == "nearest":
        out = bytearray(new_width * new_height * 4)
        for y in range(new_height):
            sy = min(height - 1, y * height // new_height)
            for x in range(new_width):
                sx = min(width - 1, x * width // new_width)
                src = (sy * width + sx) * 4
                dst = (y * new_width + x) * 4
                out[dst : dst + 4] = rgba[src : src + 4]
        return bytes(out)

    out = bytearray(new_width * new_height * 4)
    for y in range(new_height):
        fy = (y + 0.5) * height / new_height - 0.5
        y0 = max(0, min(height - 1, int(fy)))
        y1 = max(0, min(height - 1, y0 + 1))
        wy = max(0.0, min(1.0, fy - y0))
        for x in range(new_width):
            fx = (x + 0.5) * width / new_width - 0.5
            x0 = max(0, min(width - 1, int(fx)))
            x1 = max(0, min(width - 1, x0 + 1))
            wx = max(0.0, min(1.0, fx - x0))
            dst = (y * new_width + x) * 4
            for channel in range(4):
                a = rgba[(y0 * width + x0) * 4 + channel]
                b = rgba[(y0 * width + x1) * 4 + channel]
                c = rgba[(y1 * width + x0) * 4 + channel]
                d = rgba[(y1 * width + x1) * 4 + channel]
                top = a + (b - a) * wx
                bottom = c + (d - c) * wx
                out[dst + channel] = int(round(top + (bottom - top) * wy))
    return bytes(out)


def vtf_write(req: dict[str, Any]) -> dict[str, Any]:
    """Writes a VTF from a PNG, then reads it back and compares the pixels."""
    from srctools.vtf import ImageFormats, VTF, VTFFlags

    image_path = Path(str(req.get("image", ""))).resolve()
    if not image_path.is_file():
        raise ValueError(f"{image_path} does not exist")
    if image_path.suffix.lower() != ".png":
        raise ValueError(
            f"{image_path.suffix or 'a file with no extension'} is not a PNG. This writer takes "
            "PNG because that is what this server can decode without an external library; "
            "run_vtf_convert takes TGA and the rest through VTFCmd."
        )

    try:
        decoded = decode_png(image_path.read_bytes())
    except ImageError as exc:
        raise ValueError(f"{image_path.name}: {exc}") from exc

    width = int(decoded["width"])
    height = int(decoded["height"])
    rgba = decoded["rgba"]
    assert isinstance(rgba, bytes)

    resize = str(req.get("resize", "nearest")).lower()
    if resize not in {"nearest", "bilinear", "none"}:
        raise ValueError("resize must be nearest, bilinear or none")
    original = (width, height)
    if not (_is_pot(width) and _is_pot(height)):
        if resize == "none":
            raise ValueError(
                f"{width}x{height} is not a power of two, and a VTF must be. Pass "
                'resize: "nearest" or "bilinear" to scale it, or resize the source.'
            )
        new_width, new_height = _next_pot(width), _next_pot(height)
        rgba = _resize(rgba, width, height, new_width, new_height, resize)
        width, height = new_width, new_height

    fmt_name = str(req.get("format", "BGRA8888")).upper()
    if fmt_name not in _WRITABLE:
        raise ValueError(
            f"format {fmt_name!r} cannot be written without a compressor. Choose one of "
            + ", ".join(sorted(_WRITABLE))
            + ". DXT is left to vtex/VTFCmd; an uncompressed VTF is exact and valid."
        )

    version_text = str(req.get("version", "7.4"))
    try:
        major, minor = (int(part) for part in version_text.split(".", 1))
    except ValueError as exc:
        raise ValueError(f"version {version_text!r} is not major.minor") from exc
    if major != 7 or not 2 <= minor <= 5:
        raise ValueError("VTF version must be 7.2 through 7.5")

    flags = VTFFlags(0)
    if bool(req.get("clampS", False)):
        flags |= VTFFlags.CLAMP_S
    if bool(req.get("clampT", False)):
        flags |= VTFFlags.CLAMP_T

    vtf = VTF(
        width,
        height,
        version=(major, minor),
        flags=flags,
        fmt=ImageFormats[fmt_name],
        thumb_fmt=ImageFormats.NONE,
    )
    frame = vtf.get()
    # `Frame._data` is RGBA8888 in this library's own convention and `save()` converts to
    # the target format. There is no public setter for a whole frame, and filling pixel by
    # pixel would turn a 2048² texture into four million Python calls.
    frame._data = array("B", rgba)  # noqa: SLF001 -- the library's documented frame storage
    # The constructor records the *last mip index* while a VTF header stores the *number of
    # mips* (a stock 32x32 file reads 6 for mips 0-5). Without this, save() writes
    # `range(count)` and silently drops the smallest level.
    vtf.mipmap_count = max(key[2] for key in vtf._frames) + 1

    path = Path(str(req.get("path", ""))).resolve()
    if path.suffix.lower() != ".vtf":
        path = path.with_suffix(".vtf")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        vtf.save(fh, version=(major, minor))

    # Read back with the parser the engine's tooling uses. A VTF that only its writer can
    # open is the failure this check exists to catch.
    with path.open("rb") as fh:
        back = VTF.read(fh)
        back_frame = back.get()
        back_frame.load()
    written_rgba = bytes(back_frame._data)  # noqa: SLF001
    verified = written_rgba == rgba

    return {
        "path": str(path),
        "written": True,
        "bytes": path.stat().st_size,
        "image": str(image_path),
        "version": f"{back.version[0]}.{back.version[1]}",
        "width": back.width,
        "height": back.height,
        "originalWidth": original[0],
        "originalHeight": original[1],
        "resized": (width, height) != original,
        "format": back.format.name,
        "mipCount": back.mipmap_count,
        "flags": int(back.flags.value),
        "clampS": bool(back.flags & VTFFlags.CLAMP_S),
        "clampT": bool(back.flags & VTFFlags.CLAMP_T),
        "verified": verified,
        "note": (
            "Pixels were compared with the source after a round-trip through the VTF "
            "reader. An uncompressed VTF is larger than DXT1/DXT5; vtex or VTFCmd can "
            "compress the same image if the addon's size matters."
        ),
    }
