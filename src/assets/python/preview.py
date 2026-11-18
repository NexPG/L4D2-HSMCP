"""A material's base texture as a PNG the agent can look at.

The asset browser answers "does this name exist"; it does not answer "what does it look
like". Picking a facade by name alone is how a concrete map gets a metal texture. This
module reads the VMT, finds its `$basetexture`, decodes the VTF through srctools and returns
a PNG (RGBA composited over a checkerboard) as base64. Pillow is not needed.
"""
from __future__ import annotations

import base64
import struct
import zlib
from typing import Any


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_png(width: int, height: int, rgba: bytes) -> bytes:
    """A PNG from RGBA bytes, no dependencies."""
    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)  # filter: none
        rows.extend(rgba[y * stride : (y + 1) * stride])
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + _chunk(b"IEND", b"")
    )


def _mount(game_dir: str | None) -> tuple[Any, str | None]:
    if not game_dir:
        return None, "no gameDir given"
    try:
        from srctools.game import Game

        return Game(game_dir).get_filesystem(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def _vtf_for_material(fsys: Any, material: str) -> tuple[str | None, str | None, str | None]:
    """Return (vtf_path, material_path, error) for a VMT name or path."""
    from srctools.vmt import Material

    name = material.replace("\\", "/").strip().lower()
    if name.startswith("materials/"):
        name = name[len("materials/") :]
    if name.endswith(".vmt"):
        vmt_path = f"materials/{name}"
    else:
        vmt_path = f"materials/{name}.vmt"
    try:
        with fsys[vmt_path].open_str() as fh:
            mat = Material.parse(fh)
        base = mat.get("$basetexture")
        if base is None:
            base = mat.get("$hdrbasetexture")
        if base is not None:
            base = str(base).replace("\\", "/").lstrip("/").lower()
            if base.startswith("materials/"):
                base = base[len("materials/") :]
            vtf_path = f"materials/{base}.vtf"
            if vtf_path in fsys or _present(fsys, vtf_path):
                return vtf_path, vmt_path, None
        # Fall back to a texture named like the material.
        stem = vmt_path[:-4] if vmt_path.endswith(".vmt") else vmt_path
        for candidate in (f"{stem}.vtf", f"{stem}.hdr.vtf"):
            if _present(fsys, candidate):
                return candidate, vmt_path, None
        return None, vmt_path, f"{vmt_path} has no $basetexture VTF this install can find"
    except Exception as exc:  # noqa: BLE001
        return None, vmt_path, f"{type(exc).__name__}: {exc}"


def _present(fsys: Any, path: str) -> bool:
    try:
        fsys[path]
        return True
    except Exception:  # noqa: BLE001
        return False


def _downsample_rgba(data: bytes, width: int, height: int, max_size: int) -> tuple[bytes, int, int]:
    """Nearest-neighbour downsample, composited over a checkerboard."""
    step = max(1, (max(width, height) + max_size - 1) // max_size)
    out_w = max(1, width // step)
    out_h = max(1, height // step)
    out = bytearray(out_w * out_h * 4)
    for oy in range(out_h):
        sy = min(height - 1, oy * step)
        for ox in range(out_w):
            sx = min(width - 1, ox * step)
            i = (sy * width + sx) * 4
            r, g, b, a = data[i], data[i + 1], data[i + 2], data[i + 3]
            # Composite over a light checker so alpha does not read as a black hole.
            base = 96 if ((ox // 8) + (oy // 8)) % 2 == 0 else 72
            af = a / 255.0
            o = (oy * out_w + ox) * 4
            out[o] = int(r * af + base * (1 - af))
            out[o + 1] = int(g * af + base * (1 - af))
            out[o + 2] = int(b * af + base * (1 - af))
            out[o + 3] = 255
    return bytes(out), out_w, out_h


def material_preview(req: dict[str, Any]) -> dict[str, Any]:
    game_dir = req.get("gameDir")
    material = str(req.get("material", "")).strip()
    max_size = min(max(int(req.get("maxSize", 512)), 32), 1024)
    if not material:
        return {"found": False, "refused": "no material given"}

    fsys, mount_error = _mount(game_dir)
    if fsys is None:
        return {"found": False, "mounted": False, "mountError": mount_error}
    vtf_path, vmt_path, error = _vtf_for_material(fsys, material)
    if vtf_path is None:
        return {
            "found": False,
            "mounted": True,
            "material": material,
            "vmt": vmt_path,
            "error": error,
        }

    try:
        from srctools.vtf import VTF

        with fsys[vtf_path].open_bin() as fh:
            vtf = VTF.read(fh)
            frame = vtf.get()
            frame.load()
        rgba = bytes(frame._data)  # type: ignore[attr-defined]
        width, height = frame.width, frame.height
        png_rgba, out_w, out_h = _downsample_rgba(rgba, width, height, max_size)
        png = encode_png(out_w, out_h, png_rgba)
    except Exception as exc:  # noqa: BLE001
        return {
            "found": False,
            "mounted": True,
            "material": material,
            "vtf": vtf_path,
            "error": f"{type(exc).__name__}: {exc}",
        }

    return {
        "found": True,
        "mounted": True,
        "material": material,
        "vmt": vmt_path,
        "vtf": vtf_path,
        "format": str(vtf.format),
        "width": width,
        "height": height,
        "previewWidth": out_w,
        "previewHeight": out_h,
        "pngBase64": base64.b64encode(png).decode("ascii"),
        "note": (
            "Base texture of the VMT, largest mip, composited over a light checker. "
            "This is the texture the face will draw; it is not a lit render of the surface."
        ),
    }
