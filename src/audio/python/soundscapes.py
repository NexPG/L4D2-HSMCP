"""Soundscapes: the ambient bed a map plays through `env_soundscape`.

A map can have perfect geometry and still sound dead. The engine's soundscape files
(`scripts/soundscapes_<name>.txt`) define looping beds and random one-shots; an
`env_soundscape` entity names one. Nothing in the toolkit could read or create them.

The format is parsed and written by `srctools.sndscape`, which is a dependency rather than
vendored code. This module is the boundary: it turns a soundscape into JSON for the agent,
builds one from parameters, checks that each wave exists under `sound/`, and appends a new
definition without rewriting the rest of the file (comments and other scapes survive).
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any


def _pair(value: Any, default: float) -> tuple[float, float]:
    if value is None:
        return (default, default)
    if isinstance(value, (list, tuple)):
        if len(value) != 2:
            raise ValueError("an interval needs exactly two numbers")
        return (float(value[0]), float(value[1]))
    return (float(value), float(value))


def _position(value: Any) -> Any:
    from srctools.sndscape import PosType

    if value is None:
        return PosType.AMBIENT
    text = str(value).strip().lower()
    if text in {"ambient", "random"}:
        return PosType(text)
    if text.isdigit():
        return int(text)
    raise ValueError("position must be ambient, random or an entity index")


def _summary(scape: Any, source: str) -> dict[str, Any]:
    def pair(value: Any) -> list[float]:
        try:
            return [round(float(value[0]), 4), round(float(value[1]), 4)]
        except Exception:  # noqa: BLE001
            return [0.0, 0.0]

    def position(value: Any) -> Any:
        try:
            return value.value
        except AttributeError:
            pass
        try:
            return [round(float(value.x), 3), round(float(value.y), 3), round(float(value.z), 3)]
        except Exception:  # noqa: BLE001
            return str(value)

    return {
        "name": scape.name,
        "source": source,
        "fadetime": round(float(scape.fadetime), 4),
        "dsp": scape.dsp,
        "dspSpatial": scape.dsp_spatial,
        "dspVolume": round(float(scape.dsp_volume), 4),
        "soundmixer": scape.soundmixer,
        "loopSounds": [
            {
                "wave": sound.sound,
                "radius": round(float(sound.radius), 4),
                "volume": pair(sound.volume),
                "pitch": pair(sound.pitch),
                "level": [str(v) for v in sound.level],
                "position": position(sound.position),
                "noRestore": bool(sound.no_restore),
            }
            for sound in scape.loop_sounds
        ],
        "randomSounds": [
            {
                "waves": list(sound.sounds),
                "time": pair(sound.time),
                "volume": pair(sound.volume),
                "pitch": pair(sound.pitch),
                "level": [str(v) for v in sound.level],
                "position": position(sound.position),
                "noRestore": bool(sound.no_restore),
            }
            for sound in scape.rand_sounds
        ],
        "children": [
            {
                "name": child.name,
                "volume": pair(child.volume),
                "position": child.pos_offset,
                "positionOverride": child.pos_override,
            }
            for child in scape.children
        ],
    }


def _parse_text(text: str, source: str) -> list[dict[str, Any]]:
    from srctools.keyvalues import Keyvalues
    from srctools.sndscape import Soundscape

    root = Keyvalues.parse(text)
    return [_summary(scape, source) for scape in Soundscape.parse(root).values()]


def _mounted(game_dir: str | None) -> tuple[Any, str | None]:
    if not game_dir:
        return None, "no gameDir given"
    try:
        from srctools.game import Game

        return Game(game_dir).get_filesystem(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def _check_waves(fsys: Any, scapes: list[dict[str, Any]]) -> list[str]:
    from srctools.sndscript import SoundChars

    missing: list[str] = []
    waves: list[str] = []
    for scape in scapes:
        waves.extend(sound["wave"] for sound in scape["loopSounds"])
        for sound in scape["randomSounds"]:
            waves.extend(sound["waves"])
    for wave in waves:
        chars, name = SoundChars.from_fname(wave)
        if SoundChars.sentence in chars or not name:
            continue
        path = f"sound/{name}".replace("\\", "/")
        try:
            fsys[path]
        except Exception:  # noqa: BLE001
            missing.append(path)
    return sorted(set(missing))


def soundscape_read(req: dict[str, Any]) -> dict[str, Any]:
    path = str(req.get("path", "")).strip()
    needle = str(req.get("name", "")).strip().lower()
    limit = max(1, min(int(req.get("limit", 100)), 10_000))
    problems: list[str] = []
    fsys = None
    scapes: list[dict[str, Any]] = []
    files: list[str] = []

    if path:
        source = Path(path).resolve()
        if not source.is_file():
            return {"path": str(source), "read": False, "readError": "file does not exist"}
        try:
            scapes = _parse_text(source.read_text(encoding="utf-8", errors="replace"), str(source))
        except Exception as exc:  # noqa: BLE001
            return {"path": str(source), "read": False, "readError": f"{type(exc).__name__}: {exc}"}
        files.append(str(source))
    else:
        fsys, mount_error = _mounted(req.get("gameDir"))
        if fsys is None:
            return {"read": False, "mounted": False, "mountError": mount_error, "soundscapes": []}
        for entry in fsys.walk_folder("scripts"):
            name = entry.path.replace("\\", "/")
            base = name.rsplit("/", 1)[-1].lower()
            if (
                base.startswith("soundscapes_")
                and base.endswith(".txt")
                and base != "soundscapes_manifest.txt"
            ):
                files.append(name)
        files.sort(key=str.lower)
        for file in files:
            try:
                with fsys[file].open_str() as fh:
                    text = fh.read()
                scapes.extend(_parse_text(text, file))
            except Exception as exc:  # noqa: BLE001
                problems.append(f"{file}: {type(exc).__name__}: {exc}")

    total = len(scapes)
    if needle:
        scapes = [scape for scape in scapes if needle in scape["name"].lower()]
    missing = _check_waves(fsys, scapes) if fsys is not None else []
    return {
        "read": True,
        "mounted": fsys is not None,
        "mountError": None,
        "files": files,
        "fileCount": len(files),
        "total": total,
        "count": len(scapes),
        "problems": problems,
        "missingWaves": missing,
        "soundscapes": scapes[:limit],
        "truncated": len(scapes) > limit,
        "name": needle or None,
        "note": (
            "A soundscape is selected by an env_soundscape entity's `soundscape` key. "
            "`missingWaves` lists sound/<path> entries this install does not have; a "
            "soundscript name is not a wave path and will show as missing here."
        ),
    }


def _build(scape: Any, req: dict[str, Any]) -> Any:
    from srctools.sndscape import LoopSound, PosType, RandSound, Soundscape, SubScape

    loops = []
    for item in req.get("loopSounds") or []:
        if not isinstance(item, dict) or not item.get("wave"):
            raise ValueError("each loopSounds entry needs a wave")
        loops.append(
            LoopSound(
                sound=str(item["wave"]),
                volume=_pair(item.get("volume"), 1.0),
                pitch=_pair(item.get("pitch"), 100.0),
                level=_pair(item.get("level"), 75.0),
                position=_position(item.get("position")),
                radius=float(item.get("radius", 0.0)),
                no_restore=bool(item.get("noRestore", False)),
            )
        )

    randoms = []
    for item in req.get("randomSounds") or []:
        if not isinstance(item, dict):
            raise ValueError("each randomSounds entry must be an object")
        waves = [str(w) for w in (item.get("waves") or []) if str(w).strip()]
        if not waves:
            raise ValueError("each randomSounds entry needs at least one wave")
        randoms.append(
            RandSound(
                sounds=waves,
                time=_pair(item.get("time"), 5.0),
                volume=_pair(item.get("volume"), 1.0),
                pitch=_pair(item.get("pitch"), 100.0),
                level=_pair(item.get("level"), 75.0),
                position=_position(item.get("position")),
                no_restore=bool(item.get("noRestore", False)),
            )
        )

    children = []
    for item in req.get("children") or []:
        if not isinstance(item, dict) or not item.get("name"):
            raise ValueError("each children entry needs a soundscape name")
        children.append(
            SubScape(
                name=str(item["name"]),
                volume=_pair(item.get("volume"), 1.0),
                pos_offset=int(item.get("position", 0) or 0),
                pos_override=item.get("positionOverride"),
                ambient_pos_override=item.get("ambientPositionOverride"),
            )
        )

    return Soundscape(
        name=str(req["name"]),
        loop_sounds=loops,
        rand_sounds=randoms,
        children=children,
        dsp=int(req["dsp"]) if req.get("dsp") is not None else None,
        dsp_spatial=int(req["dspSpatial"]) if req.get("dspSpatial") is not None else None,
        dsp_volume=float(req.get("dspVolume", 1.0)),
        fadetime=float(req.get("fadetime", 0.0)),
        soundmixer=req.get("soundmixer"),
    )


def soundscape_write(req: dict[str, Any]) -> dict[str, Any]:
    path = Path(str(req.get("path", ""))).resolve()
    name = str(req.get("name", "")).strip()
    if not name:
        raise ValueError("name is required")
    text = req.get("_text")
    scape = _build(scape=None, req=req)
    block = io.StringIO()
    scape.export(block)
    rendered = block.getvalue()
    if not rendered.endswith("\n"):
        rendered += "\n"

    existing = ""
    if path.exists():
        existing = path.read_text(encoding="utf-8", errors="replace")
        defined = {item["name"].lower() for item in _parse_text(existing, str(path))}
        if name.lower() in defined:
            raise ValueError(f"{path} already defines a soundscape named {name!r}")
        if existing and not existing.endswith("\n"):
            existing += "\n"

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(existing + rendered, encoding="utf-8")

    back = _parse_text(path.read_text(encoding="utf-8", errors="replace"), str(path))
    match = next((item for item in back if item["name"].lower() == name.lower()), None)

    missing: list[str] = []
    fsys, _ = _mounted(req.get("gameDir"))
    if fsys is not None and match is not None:
        missing = _check_waves(fsys, [match])

    return {
        "path": str(path),
        "written": True,
        "bytes": path.stat().st_size,
        "name": name,
        "loops": len(scape.loop_sounds),
        "randoms": len(scape.rand_sounds),
        "children": len(scape.children),
        "verified": match is not None,
        "missingWaves": missing,
        "soundscape": match,
        "note": (
            "An existing file is appended to, so comments and other scapes survive. "
            "Point an env_soundscape entity at `name`; missingWaves is checked when gameDir "
            "is given."
        ),
    }
