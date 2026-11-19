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

import dxt
from png import ImageError, decode_png, encode_png

# Lossless formats keep RGBA exactly; BGRX keeps RGB and forces alpha to 255. DXT1/DXT5
# are lossy and are verified with a measured error, not a false claim of equality.
_WRITABLE = {"RGBA8888", "BGRA8888", "BGRX8888", "DXT1", "DXT5"}


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
            f"format {fmt_name!r} is not one this writer supports. Choose one of "
            + ", ".join(sorted(_WRITABLE))
            + ". Lossless formats are exact; DXT1/DXT5 are measured; other quantisers are "
            "left to vtex/VTFCmd."
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

    # VTFEdit/sourcepp set the alpha flag so the engine knows the texture has transparency.
    # Without it an alpha-tested material can render opaque on some shaders. BGRX stores no
    # alpha, so it is never flagged; DXT1 keeps one bit, DXT5 and the 32-bit formats eight.
    has_alpha = fmt_name != "BGRX8888" and any(rgba[at] < 255 for at in range(3, len(rgba), 4))
    alpha_mode = "none"
    if has_alpha:
        if fmt_name == "DXT1":
            flags |= VTFFlags.ONEBITALPHA
            alpha_mode = "oneBit"
        else:
            flags |= VTFFlags.EIGHTBITALPHA
            alpha_mode = "eightBit"

    # Reflectivity is the average colour the engine uses for bounced light. Zero is legal
    # but makes a bright texture light its surroundings as if it were black.
    pixels = max(1, len(rgba) // 4)
    reflectivity = (
        round(sum(rgba[at] for at in range(0, len(rgba), 4)) / (255 * pixels), 4),
        round(sum(rgba[at] for at in range(1, len(rgba), 4)) / (255 * pixels), 4),
        round(sum(rgba[at] for at in range(2, len(rgba), 4)) / (255 * pixels), 4),
    )

    if fmt_name in {"DXT1", "DXT5"}:
        dxt.install()
    vtf = VTF(
        width,
        height,
        version=(major, minor),
        ref=reflectivity,
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
    expected = rgba
    if fmt_name == "BGRX8888":
        opaque = bytearray(rgba)
        opaque[3::4] = b"\xff" * (len(rgba) // 4)
        expected = bytes(opaque)

    if fmt_name in {"DXT1", "DXT5"}:
        # A DXT block is lossy by definition. Comparing bytes would report every correct
        # write as a failure; comparing nothing would make `verified` meaningless. Measure
        # the error and state it. DXT1 stores one bit of alpha, so a pixel the source marks
        # transparent has no meaningful RGB — comparing it would measure the colour of
        # "transparent", not the encoder.
        total = 0
        peak = 0
        samples = 0
        alpha_bits_kept = True
        for at in range(0, len(expected), 4):
            source_alpha = expected[at + 3]
            if fmt_name == "DXT1":
                if source_alpha < 128:
                    if written_rgba[at + 3] >= 128:
                        alpha_bits_kept = False
                    continue
                if written_rgba[at + 3] < 128:
                    alpha_bits_kept = False
            channels = 3 if fmt_name == "DXT1" else 4
            for channel in range(channels):
                delta = abs(expected[at + channel] - written_rgba[at + channel])
                total += delta
                peak = max(peak, delta)
                samples += 1
        mean_error = round(total / samples, 3) if samples else 0.0
        max_error = peak
        verified = mean_error <= 48 and alpha_bits_kept
        alpha_preserved = alpha_bits_kept
    else:
        mean_error = 0.0
        max_error = 0
        verified = written_rgba == expected
        alpha_preserved = True

    note = (
        "Pixels were compared with the source after a round-trip through the VTF reader. "
        "A BGRX8888 copy is opaque: alpha was forced to 255 before comparing."
        if fmt_name == "BGRX8888"
        else (
            "DXT is lossy, so `verified` means the measured mean error is at most 48/255 "
            f"({mean_error}); `maxError` is the worst single channel. DXT1 keeps at most "
            "one bit of alpha. vtex or VTFCmd produce a higher-quality DXT from the same "
            "source if quality matters more than independence."
            if fmt_name in {"DXT1", "DXT5"}
            else "Pixels were compared with the source after a round-trip through the VTF "
            "reader. An uncompressed VTF is larger than DXT1/DXT5; vtex or VTFCmd can "
            "compress the same image if the addon's size matters."
        )
    )

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
        "alphaMode": alpha_mode,
        "reflectivity": [round(v, 4) for v in back.reflectivity],
        "verified": verified,
        "meanError": mean_error,
        "maxError": max_error,
        "alphaPreserved": alpha_preserved,
        "note": note,
    }

def _read_vtf_frame(path: Path, face: str | None = None):
    from srctools.vtf import CubeSide, VTF
    data = path.read_bytes()
    import io
    stream = io.BytesIO(data)
    vtf = VTF.read(stream)
    frame = vtf.get(side=CubeSide[face.upper()]) if face else vtf.get()
    frame.load()
    return vtf, frame, bytes(frame._data)


def _compare_rgba(source: bytes, decoded: bytes, lossy: bool) -> tuple[bool, float, int]:
    if not lossy:
        return source == decoded, 0.0, 0
    total = 0
    peak = 0
    samples = 0
    for at in range(0, len(source), 4):
        for channel in range(3):
            delta = abs(source[at + channel] - decoded[at + channel])
            total += delta
            peak = max(peak, delta)
            samples += 1
    mean = round(total / samples, 3) if samples else 0.0
    return mean <= 48, mean, peak


def vtf_convert(req: dict[str, Any]) -> dict[str, Any]:
    from array import array
    from srctools.vtf import ImageFormats, VTF, VTFFlags

    source = Path(str(req.get("path", ""))).resolve()
    if not source.is_file():
        raise ValueError(f"{source} does not exist")
    vtf, frame, rgba = _read_vtf_frame(source)
    if vtf.frame_count > 1 or vtf.depth > 1 or (int(vtf.flags.value) & VTFFlags.ENVMAP.value):
        raise ValueError(
            "this is a cubemap or an animated texture; convert_vtf handles 2D single-frame "
            "textures. run_cubemap2hdr, run_tga2skybox and VTFCmd cover the rest."
        )

    width, height = vtf.width, vtf.height
    target_width = int(req.get("width", width))
    target_height = int(req.get("height", height))
    if not (_is_pot(target_width) and _is_pot(target_height)):
        raise ValueError("width and height must be powers of two")
    if (target_width, target_height) != (width, height):
        rgba = _resize(rgba, width, height, target_width, target_height, str(req.get("resize", "bilinear")))

    fmt_name = str(req.get("format", vtf.format.name)).upper()
    if fmt_name not in _WRITABLE:
        raise ValueError(
            f"format {fmt_name!r} is not writable. Choose one of " + ", ".join(sorted(_WRITABLE))
        )
    if fmt_name in {"DXT1", "DXT5"}:
        dxt.install()
    version_text = str(req.get("version", f"{vtf.version[0]}.{vtf.version[1]}"))
    major, minor = (int(part) for part in version_text.split(".", 1))
    flags = VTFFlags(int(vtf.flags.value) & ~VTFFlags.ENVMAP.value)
    new = VTF(
        target_width,
        target_height,
        version=(major, minor),
        flags=flags,
        fmt=ImageFormats[fmt_name],
        thumb_fmt=ImageFormats.NONE,
    )
    new.get()._data = array("B", rgba)  # noqa: SLF001
    new.mipmap_count = max(key[2] for key in new._frames) + 1

    path = Path(str(req.get("out", "") or req.get("output", ""))).resolve()
    if path.suffix.lower() != ".vtf":
        path = path.with_suffix(".vtf")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        new.save(fh, version=(major, minor))

    back, back_frame, back_rgba = _read_vtf_frame(path)
    lossy = fmt_name in {"DXT1", "DXT5"}
    verified, mean_error, max_error = _compare_rgba(rgba, back_rgba, lossy)
    return {
        "path": str(path),
        "written": True,
        "bytes": path.stat().st_size,
        "source": str(source),
        "sourceFormat": vtf.format.name,
        "format": back.format.name,
        "version": f"{back.version[0]}.{back.version[1]}",
        "width": back.width,
        "height": back.height,
        "mipCount": back.mipmap_count,
        "meanError": mean_error,
        "maxError": max_error,
        "verified": verified,
        "note": (
            "The image was decoded to RGBA and rebuilt in the target format; the mip chain "
            "is regenerated. Lossless formats are compared byte for byte, DXT by measured "
            "error (<= 48/255). Animation, cubemaps and volume textures are refused: this "
            "is the 2D material path."
        ),
    }


def vtf_cubemap_write(req: dict[str, Any]) -> dict[str, Any]:
    """Builds a six-face cubemap VTF, then reads every face back."""
    from array import array

    from srctools.vtf import CubeSide, ImageFormats, VTF, VTFFlags

    faces_req = req.get("faces")
    if not isinstance(faces_req, dict):
        raise ValueError("faces must be an object with right/left/back/front/up/down")
    names = ("right", "left", "back", "front", "up", "down")
    missing = [name for name in names if not faces_req.get(name)]
    if missing:
        raise ValueError("missing cubemap faces: " + ", ".join(missing))

    resize = str(req.get("resize", "nearest")).lower()
    if resize not in {"nearest", "bilinear"}:
        raise ValueError("resize must be nearest or bilinear")

    decoded: dict[str, tuple[int, int, bytes]] = {}
    for name in names:
        path = Path(str(faces_req[name])).resolve()
        if not path.is_file():
            raise ValueError(f"{path} does not exist")
        try:
            png = decode_png(path.read_bytes())
        except ImageError as exc:
            raise ValueError(f"{path.name}: {exc}") from exc
        decoded[name] = (int(png["width"]), int(png["height"]), png["rgba"])

    side = max(max(w, h) for w, h, _ in decoded.values())
    side = _next_pot(side)
    images = {
        name: _resize(rgba, width, height, side, side, resize)
        for name, (width, height, rgba) in decoded.items()
    }

    fmt_name = str(req.get("format", "BGRA8888")).upper()
    if fmt_name not in _WRITABLE:
        raise ValueError(
            f"format {fmt_name!r} is not writable. Choose one of " + ", ".join(sorted(_WRITABLE))
        )
    if fmt_name in {"DXT1", "DXT5"}:
        dxt.install()
    version_text = str(req.get("version", "7.4"))
    major, minor = (int(part) for part in version_text.split(".", 1))
    if major != 7 or not 2 <= minor <= 5:
        raise ValueError("VTF version must be 7.2 through 7.5")

    vtf = VTF(
        side,
        side,
        version=(major, minor),
        flags=VTFFlags.ENVMAP,
        fmt=ImageFormats[fmt_name],
        thumb_fmt=ImageFormats.NONE,
    )
    for name in names:
        vtf.get(side=CubeSide[name.upper()])._data = array("B", images[name])  # noqa: SLF001

    sphere_path = faces_req.get("sphere")
    if sphere_path:
        try:
            png = decode_png(Path(str(sphere_path)).read_bytes())
        except (OSError, ImageError) as exc:
            raise ValueError(f"{sphere_path}: {exc}") from exc
        sphere = _resize(
            png["rgba"], int(png["width"]), int(png["height"]), side, side, resize
        )
    else:
        # Version 7.4 has a seventh "sphere" face. Leaving it blank is legal but makes
        # spheremapped reflections black; the front face is a better default than nothing.
        sphere = images["front"]
    vtf.get(side=CubeSide.SPHERE)._data = array("B", sphere)  # noqa: SLF001
    vtf.mipmap_count = max(key[2] for key in vtf._frames) + 1

    path = Path(str(req.get("out", "") or req.get("output", ""))).resolve()
    if path.suffix.lower() != ".vtf":
        path = path.with_suffix(".vtf")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        vtf.save(fh, version=(major, minor))

    from srctools.vtf import VTF as Reader

    with path.open("rb") as fh:
        back = Reader.read(fh)
        read_frames: dict[str, bytes] = {}
        for name in names:
            frame = back.get(side=CubeSide[name.upper()])
            frame.load()
            read_frames[name] = bytes(frame._data)  # noqa: SLF001

    lossy = fmt_name in {"DXT1", "DXT5"}
    checks = {name: _compare_rgba(images[name], read_frames[name], lossy) for name in names}
    return {
        "path": str(path),
        "written": True,
        "bytes": path.stat().st_size,
        "version": f"{back.version[0]}.{back.version[1]}",
        "width": back.width,
        "height": back.height,
        "format": back.format.name,
        "mipCount": back.mipmap_count,
        "cubemap": True,
        "faces": [
            {
                "name": name,
                "meanError": checks[name][1],
                "maxError": checks[name][2],
                "verified": checks[name][0],
            }
            for name in names
        ],
        "verified": all(check[0] for check in checks.values()),
        "note": (
            "Faces are written by name in the VTF CubeSide order (right, left, back, front, "
            "up, down); the engine's order is the enum's, not a guess. The 7.4 sphere face "
            "copies the front unless one is supplied. DXT is verified by measured error."
        ),
    }

def vtf_extract(req: dict[str, Any]) -> dict[str, Any]:
    source = Path(str(req.get("path", ""))).resolve()
    if not source.is_file():
        raise ValueError(f"{source} does not exist")
    face = str(req.get("face", "")).strip().lower() or None
    if face is not None and face not in {"right", "left", "back", "front", "up", "down", "sphere"}:
        raise ValueError("face must be right, left, back, front, up, down or sphere")
    vtf, frame, rgba = _read_vtf_frame(source, face)

    max_size = max(32, min(int(req.get("maxSize", 512)), 4096))
    width, height = frame.width, frame.height
    step = max(1, (max(width, height) + max_size - 1) // max_size)
    out_w, out_h = max(1, width // step), max(1, height // step)
    if step > 1:
        small = bytearray(out_w * out_h * 4)
        for y in range(out_h):
            sy = min(height - 1, y * step)
            for x in range(out_w):
                sx = min(width - 1, x * step)
                src = (sy * width + sx) * 4
                dst = (y * out_w + x) * 4
                small[dst : dst + 4] = rgba[src : src + 4]
        png = encode_png(out_w, out_h, bytes(small))
    else:
        png = encode_png(width, height, rgba)

    out = req.get("out")
    result: dict[str, Any] = {
        "path": str(source),
        "format": vtf.format.name,
        "width": width,
        "height": height,
        "previewWidth": out_w,
        "previewHeight": out_h,
        "mipCount": vtf.mipmap_count,
        "face": face,
        "pngBytes": len(png),
    }
    if out:
        target = Path(str(out)).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(png)
        result["out"] = str(target)
    else:
        import base64 as _b64

        result["pngBase64"] = _b64.b64encode(png).decode("ascii")
    return result
