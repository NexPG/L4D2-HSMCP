"""LZMA in the framing Source uses for individually compressed BSP lumps.

A compressed lump is not a `.xz` and not a raw LZMA stream. It is:

    "LZMA" | uint32 uncompressed size | 5 bytes of LZMA properties | raw stream

Python's `lzma` module can do the work, but only if the 13-byte "alone" header is rebuilt
from those five properties and the size — feeding it the Source block directly fails with
"input format not supported". This module is the one place that knows the difference, so
the BSP tools can offer compressed lumps instead of refusing them.

Compression goes the other way: `FORMAT_ALONE` emits the same five properties plus an
8-byte size, which is stripped and replaced by the Source uint32.
"""

from __future__ import annotations

import base64
import hashlib
import lzma
import struct
from pathlib import Path
from typing import Any

_MAGIC = b"LZMA"
# Valve's header (lzma_header_t): signature, actualSize, lzmaSize, properties[5].
_PROPS = 5
_HEADER = 4 + 4 + 4 + _PROPS


def decompress(data: bytes) -> bytes:
    """Decodes a Source-framed compressed lump."""
    if len(data) < _HEADER or data[:4] != _MAGIC:
        raise ValueError("not a Source LZMA lump: the LZMA magic is missing")
    size = struct.unpack_from("<I", data, 4)[0]
    # Valve's header (lzma_header_t): id, actualSize, lzmaSize, properties[5].
    # The compressed length is redundant; the stream runs to the end.
    props = data[12:17]
    payload = data[17:]
    if size == 0:
        return b""
    # A known size in an LZMA "alone" header tells the decoder to stop before the
    # end-of-stream marker. Valve's encoder writes the size out of band and may omit the
    # marker; feeding Python the real size made it reject the stream as corrupt. Unknown
    # size plus an output cap decodes both forms: with a marker (stops at it) and without
    # (stops at `max_length`).
    decoder = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE)
    try:
        raw = decoder.decompress(props + b"\xff" * 8 + payload, max_length=size)
        while len(raw) < size and not decoder.eof:
            chunk = decoder.decompress(b"", max_length=size - len(raw))
            if not chunk:
                break
            raw += chunk
    except lzma.LZMAError as exc:
        raise ValueError(f"LZMA stream does not decompress: {exc}") from exc
    if len(raw) != size:
        raise ValueError(
            f"LZMA header says {size} bytes but the stream produced {len(raw)}"
        )
    return raw


def compress(data: bytes, preset: int = 6) -> bytes:
    """Encodes bytes in the framing a Source BSP lump expects."""
    if not data:
        return b""
    if not 0 <= preset <= 9:
        raise ValueError("preset must be 0-9")
    alone = lzma.compress(data, format=lzma.FORMAT_ALONE, preset=preset)
    if len(alone) < 13 or alone[0] > 224:
        raise ValueError("the LZMA encoder produced an unexpected header")
    props = alone[:5]
    stream = alone[13:]
    return (
        _MAGIC
        + struct.pack("<I", len(data))
        + struct.pack("<I", len(stream))
        + props
        + stream
    )


def _payload(req: dict[str, Any]) -> bytes:
    if "dataBase64" in req:
        return base64.b64decode(str(req["dataBase64"]))
    path = Path(str(req.get("path", ""))).resolve()
    if not path.is_file():
        raise ValueError(f"{path} does not exist")
    data = path.read_bytes()
    offset = int(req.get("offset", 0))
    length = req.get("length")
    if offset < 0:
        raise ValueError("offset must not be negative")
    if length is None:
        return data[offset:]
    length = int(length)
    if length < 0 or offset + length > len(data):
        raise ValueError("offset/length run past the end of the file")
    return data[offset : offset + length]


def lzma_decompress(req: dict[str, Any]) -> dict[str, Any]:
    source = _payload(req)
    raw = decompress(source)
    out = req.get("out")
    result: dict[str, Any] = {
        "bytes": len(raw),
        "sourceBytes": len(source),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    if out:
        path = Path(str(out)).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        result["out"] = str(path)
    else:
        result["dataBase64"] = base64.b64encode(raw).decode("ascii")
    return result


def lzma_compress(req: dict[str, Any]) -> dict[str, Any]:
    source = _payload(req)
    raw = compress(source, int(req.get("preset", 6)))
    out = req.get("out")
    result: dict[str, Any] = {
        "bytes": len(raw),
        "sourceBytes": len(source),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    if out:
        path = Path(str(out)).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        result["out"] = str(path)
    else:
        result["dataBase64"] = base64.b64encode(raw).decode("ascii")
    return result
