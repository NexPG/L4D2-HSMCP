"""WAV read and conversion: the sound half of an addon.

The toolkit could put a sound into a VPK but not look at it or make it game-ready. L4D2
wants PCM WAV, usually 16-bit mono at 22050 or 44100 Hz; anything else still works on some
systems and then fails on one. This module reads the header and every sample, converts the
encoding, resamples and mixes channels, and writes a canonical 16-bit PCM file.

Decoding covers the encodings a sound editor exports: PCM 8/16/24/32, IEEE float 32/64 and
WAVE_FORMAT_EXTENSIBLE. Compressed WAV (ADPCM, mu-law) is refused with the format name
rather than played as noise; those need a decoder this project does not carry.

`read_wav` also reports the `smpl` loop, because a looping ambient that does not loop is a
silent failure that no file listing reveals.
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

_PCM = 1
_FLOAT = 3
_EXTENSIBLE = 0xFFFE


def _chunks(data: bytes) -> dict[bytes, list[bytes]]:
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a WAV: expected RIFF/WAVE")
    at = 12
    found: dict[bytes, list[bytes]] = {}
    while at + 8 <= len(data):
        tag = data[at : at + 4]
        size = struct.unpack_from("<I", data, at + 4)[0]
        body = data[at + 8 : at + 8 + size]
        if len(body) != size:
            raise ValueError(f"WAV chunk {tag!r} is truncated")
        found.setdefault(tag, []).append(body)
        at += 8 + size + (size & 1)
    return found


def _format(chunks: dict[bytes, list[bytes]]) -> dict[str, Any]:
    if b"fmt " not in chunks:
        raise ValueError("WAV has no fmt chunk")
    fmt = chunks[b"fmt "][0]
    if len(fmt) < 16:
        raise ValueError("WAV fmt chunk is shorter than 16 bytes")
    tag, channels, rate, _byte_rate, block_align, bits = struct.unpack_from("<HHIIHH", fmt, 0)
    if tag == _EXTENSIBLE:
        if len(fmt) < 40:
            raise ValueError("WAVE_FORMAT_EXTENSIBLE fmt chunk is too short")
        tag = struct.unpack_from("<H", fmt, 24)[0]
    return {
        "format": tag,
        "formatName": {_PCM: "PCM", _FLOAT: "IEEE float"}.get(tag, f"0x{tag:04X}"),
        "channels": channels,
        "sampleRate": rate,
        "blockAlign": block_align,
        "bitsPerSample": bits,
    }


def _decode(data: bytes, fmt: dict[str, Any]) -> list[list[float]]:
    """Samples as floats in [-1, 1], one list per channel."""
    tag = int(fmt["format"])
    channels = int(fmt["channels"])
    bits = int(fmt["bitsPerSample"])
    if channels <= 0 or channels > 8:
        raise ValueError(f"{channels} channels is not a sound this tool will guess at")
    if tag == _PCM:
        if bits == 8:
            values = [(b - 128) / 128.0 for b in data]
        elif bits == 16:
            values = [v / 32768.0 for v in struct.unpack(f"<{len(data) // 2}h", data)]
        elif bits == 24:
            values = []
            for i in range(0, len(data) - 2, 3):
                raw = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16)
                if raw & 0x800000:
                    raw -= 1 << 24
                values.append(raw / 8388608.0)
        elif bits == 32:
            values = [v / 2147483648.0 for v in struct.unpack(f"<{len(data) // 4}i", data)]
        else:
            raise ValueError(f"{bits}-bit PCM is not a WAV this tool decodes")
    elif tag == _FLOAT:
        if bits == 32:
            values = list(struct.unpack(f"<{len(data) // 4}f", data))
        elif bits == 64:
            values = list(struct.unpack(f"<{len(data) // 8}d", data))
        else:
            raise ValueError(f"{bits}-bit float WAV is not supported")
    else:
        raise ValueError(
            f"{fmt['formatName']} WAV is compressed; export PCM or IEEE float instead"
        )

    frames = len(values) // channels
    decoded: list[list[float]] = [[] for _ in range(channels)]
    for frame in range(frames):
        base = frame * channels
        for channel in range(channels):
            decoded[channel].append(values[base + channel])
    return decoded


def _resample(samples: list[float], source_rate: int, target_rate: int) -> list[float]:
    if source_rate == target_rate or not samples:
        return samples
    count = max(1, int(round(len(samples) * target_rate / source_rate)))
    ratio = source_rate / target_rate
    out: list[float] = []
    last = len(samples) - 1
    for i in range(count):
        position = i * ratio
        left = int(position)
        if left >= last:
            out.append(samples[last])
            continue
        fraction = position - left
        out.append(samples[left] * (1.0 - fraction) + samples[left + 1] * fraction)
    return out


def _mix(channels: list[list[float]], target: int) -> list[list[float]]:
    if len(channels) == target:
        return channels
    if target == 1:
        length = min(len(c) for c in channels)
        return [[sum(c[i] for c in channels) / len(channels) for i in range(length)]]
    if target == 2 and len(channels) == 1:
        return [channels[0], list(channels[0])]
    raise ValueError(f"cannot mix {len(channels)} channels into {target}")


def _loop(chunks: dict[bytes, list[bytes]]) -> dict[str, int] | None:
    if b"smpl" not in chunks:
        return None
    body = chunks[b"smpl"][0]
    if len(body) < 36 + 24:
        return None
    loops = struct.unpack_from("<I", body, 28)[0]
    if loops == 0 or len(body) < 36 + 24:
        return None
    start, end = struct.unpack_from("<II", body, 36 + 8)
    return {"start": start, "end": end}


def _smpl_chunk(rate: int, start: int, end: int) -> bytes:
    """A one-loop `smpl` chunk: sample period in ns, MIDI note 60, one forward loop."""
    body = struct.pack(
        "<9I",
        0,  # manufacturer
        0,  # product
        max(1, round(1_000_000_000 / max(1, rate))),
        60,  # MIDI unity note
        0,  # pitch fraction
        0,  # SMPTE format
        0,  # SMPTE offset
        1,  # one loop
        0,  # sampler data
    )
    body += struct.pack("<6I", 0, 0, start, end, 0, 0)
    return b"smpl" + struct.pack("<I", len(body)) + body


def read_wav(req: dict[str, Any]) -> dict[str, Any]:
    path = Path(str(req.get("path", ""))).resolve()
    if not path.is_file():
        return {"path": str(path), "read": False, "readError": "file does not exist"}
    data = path.read_bytes()
    try:
        chunks = _chunks(data)
        fmt = _format(chunks)
        if b"data" not in chunks:
            raise ValueError("WAV has no data chunk")
        payload = chunks[b"data"][0]
    except ValueError as exc:
        return {"path": str(path), "read": False, "readError": str(exc)}

    frames = len(payload) // max(1, int(fmt["blockAlign"]))
    duration = frames / int(fmt["sampleRate"]) if fmt["sampleRate"] else 0.0
    return {
        "path": str(path),
        "read": True,
        "bytes": len(data),
        **fmt,
        "frames": frames,
        "duration": round(duration, 4),
        "dataBytes": len(payload),
        "loop": _loop(chunks),
        "chunks": sorted(tag.decode("latin1", "replace") for tag in chunks),
        "gameReady": (
            int(fmt["format"]) == _PCM
            and int(fmt["bitsPerSample"]) == 16
            and int(fmt["channels"]) in (1, 2)
            and int(fmt["sampleRate"]) in (22050, 44100)
        ),
        "note": (
            "gameReady means 16-bit PCM, mono or stereo, at 22050 or 44100 Hz. Other "
            "formats still load through some soundscripts and then fail on a machine whose "
            "decoder is stricter; convert_wav makes the safe one."
        ),
    }


def convert_wav(req: dict[str, Any]) -> dict[str, Any]:
    source = Path(str(req.get("path", ""))).resolve()
    target = Path(str(req.get("out", req.get("output", "")))).resolve()
    if not source.is_file():
        raise ValueError(f"{source} does not exist")
    data = source.read_bytes()
    chunks = _chunks(data)
    fmt = _format(chunks)
    if b"data" not in chunks:
        raise ValueError("WAV has no data chunk")
    channels = _decode(chunks[b"data"][0], fmt)

    target_rate = int(req.get("sampleRate", 22050))
    if target_rate < 8000 or target_rate > 192000:
        raise ValueError("sampleRate must be between 8000 and 192000")
    target_channels = int(req.get("channels", 1))
    if target_channels not in (1, 2):
        raise ValueError("channels must be 1 or 2")
    target_bits = int(req.get("bitDepth", 16))
    if target_bits != 16:
        raise ValueError(
            "bitDepth must be 16: L4D2's soundscripts and decoder are built around 16-bit "
            "PCM, and an 8/24-bit file that plays on one machine is a support ticket on another"
        )

    mixed = _mix(channels, target_channels)
    resampled = [_resample(channel, int(fmt["sampleRate"]), target_rate) for channel in mixed]
    frames = min(len(channel) for channel in resampled) if resampled else 0
    if frames == 0:
        raise ValueError("the source has no audio frames")

    pcm = bytearray()
    peak = 0.0
    energy = 0.0
    for frame in range(frames):
        for channel in resampled:
            value = max(-1.0, min(1.0, channel[frame]))
            peak = max(peak, abs(value))
            energy += value * value
            pcm += struct.pack("<h", int(round(value * 32767)))
    rms = (energy / (frames * target_channels)) ** 0.5

    block_align = target_channels * 2
    source_loop = _loop(chunks)
    loop: dict[str, int] | None = None
    if req.get("keepLoop", True) is not False and frames > 0:
        requested = req.get("loop")
        if isinstance(requested, dict):
            loop = {
                "start": max(0, min(frames - 1, int(requested.get("start", 0)))),
                "end": max(0, min(frames - 1, int(requested.get("end", frames - 1)))),
            }
        elif source_loop:
            ratio = target_rate / max(1, int(fmt["sampleRate"]))
            loop = {
                "start": max(0, min(frames - 1, round(source_loop["start"] * ratio))),
                "end": max(0, min(frames - 1, round(source_loop["end"] * ratio))),
            }
        if loop and loop["end"] <= loop["start"]:
            loop = None
    smpl = _smpl_chunk(target_rate, loop["start"], loop["end"]) if loop else b""

    header = b"RIFF" + struct.pack("<I", 36 + len(pcm) + len(smpl)) + b"WAVE"
    header += b"fmt " + struct.pack(
        "<IHHIIHH", 16, _PCM, target_channels, target_rate, target_rate * block_align, block_align, 16
    )
    header += b"data" + struct.pack("<I", len(pcm))

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(header + bytes(pcm) + smpl)

    # Read back the way a consumer would, and compare the shape rather than trusting the
    # writer: a WAV whose header disagrees with its data clicks or is silent.
    back = read_wav({"path": str(target)})
    return {
        "path": str(target),
        "written": True,
        "bytes": target.stat().st_size,
        "source": str(source),
        "sourceFormat": fmt["formatName"],
        "sourceChannels": fmt["channels"],
        "sourceSampleRate": fmt["sampleRate"],
        "channels": target_channels,
        "sampleRate": target_rate,
        "bitDepth": 16,
        "frames": frames,
        "duration": round(frames / target_rate, 4),
        "peak": round(peak, 4),
        "rms": round(rms, 4),
        "loop": loop,
        "verified": bool(back.get("read")) and back.get("frames") == frames,
        "note": (
            "Resampling is linear and channel mixing is an average; that is enough to make "
            "a sound game-ready, not a mastering chain. A clipped peak of 1.0 means the "
            "source was already at full scale. A `smpl` loop is scaled to the new rate and "
            "kept unless keepLoop is false."
        ),
    }
