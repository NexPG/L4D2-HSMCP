"""Soundscripts: the names an entity plays, and the wave each one resolves to.

An addon can ship a perfect WAV and still be silent because nothing defines a soundscript,
or because the `wave` path omits `sound/` or keeps a sound character the engine strips.
The toolkit could package a file but not answer "is this sound registered, and does the
wave it names exist".

Reads the real hierarchy: `scripts/game_sounds_manifest.txt` lists the files the engine
precaches, `#base`/`#include` pull in more, and the first definition of a name wins exactly
as it does in the engine. Writes one entry with a wave that is checked against the mounted
game or a loose `sound/` tree, and reads the result back.
"""

from __future__ import annotations

import posixpath
from pathlib import Path
from typing import Any, Callable

_SOUND_CHARS = "*?!#><^@)(}$~&+"


def _children(node: Any) -> list[Any]:
    try:
        return list(node)
    except Exception:  # noqa: BLE001 -- a leaf Keyvalues has no children
        return []


def _text_value(node: Any) -> str | None:
    value = getattr(node, "value", None)
    return value if isinstance(value, str) else None


def _manifest_files(text: str) -> list[str]:
    from srctools.keyvalues import Keyvalues

    root = Keyvalues.parse(text)
    files: list[str] = []
    for block in root:
        for node in _children(block):
            key = node.name.lower()
            value = _text_value(node)
            if value and key.endswith("_file"):
                files.append(value.replace("\\", "/").lstrip("/"))
    return files


def _wave_file(wave: str) -> dict[str, Any]:
    """Strips sound characters and says whether the engine treats this as a sentence."""
    text = wave.strip()
    at = 0
    chars = ""
    while at < len(text) and text[at] in _SOUND_CHARS:
        if text[at] == "!":
            return {"wave": wave, "file": None, "sentence": True, "characters": "!"}
        chars += text[at]
        at += 1
    name = text[at:].replace("\\", "/").lstrip("/")
    return {
        "wave": wave,
        "file": f"sound/{name}" if name else None,
        "sentence": False,
        "characters": chars,
    }


def _entries(root: Any) -> list[Any]:
    """Sound blocks from a parsed file, unwrapping `SoundData` and skipping directives."""
    out: list[Any] = []
    for node in root:
        key = node.name.lower()
        if key in {"sounddata", "game_sounds"}:
            out.extend(_children(node))
        elif key.startswith("#"):
            continue
        elif key == "game_sounds_manifest":
            continue
        else:
            out.append(node)
    return out


def _load_script(
    path: str,
    loader: Callable[[str], str | None],
    depth: int,
    problems: list[str],
    seen: set[str],
) -> list[Any]:
    from srctools.keyvalues import KeyValError, Keyvalues

    if depth >= 8:
        problems.append(f"{path}: #base nested too deep")
        return []
    if path.lower() in seen:
        problems.append(f"{path}: included twice; skipped the second time")
        return []
    seen.add(path.lower())
    text = loader(path)
    if text is None:
        problems.append(f"{path}: not found")
        return []
    # srctools rejects `#base` as an unknown directive, while the engine treats it as an
    # include. Strip the directive lines first, resolve them, and parse the rest. A `#base`
    # inside a block is not a thing Valve's reader supports; a line start is what it does.
    body: list[str] = []
    bases: list[str] = []
    for line in text.splitlines():
        stripped = line.lstrip()
        lowered = stripped.lower()
        if lowered.startswith("#base") or lowered.startswith("#include"):
            parts = stripped.split(None, 1)
            if len(parts) > 1:
                bases.append(parts[1].strip().strip('"'))
            else:
                problems.append(f"{path}: {parts[0]} with no file")
            continue
        body.append(line)
    try:
        root = Keyvalues.parse("\n".join(body))
    except KeyValError as exc:
        problems.append(f"{path}: {exc}")
        return []

    result: list[Any] = []
    base_dir = posixpath.dirname(path)
    for target in bases:
        resolved = posixpath.normpath(posixpath.join(base_dir, target.replace("\\", "/")))
        result.extend(_load_script(resolved, loader, depth + 1, problems, seen))
    for node in root:
        result.append(node)
    return result


def _describe(entry: Any, script: str) -> dict[str, Any]:
    channel = None
    waves: list[dict[str, Any]] = []
    for child in _children(entry):
        key = child.name.lower()
        value = _text_value(child)
        if key == "channel" and value:
            channel = value
        elif key == "wave" and value:
            waves.append(_wave_file(value))
        elif key == "rndwave":
            for item in _children(child):
                item_value = _text_value(item)
                if item.name.lower() == "wave" and item_value:
                    waves.append(_wave_file(item_value))
    return {
        "name": str(entry.name),
        "script": script,
        "channel": channel,
        "waves": waves,
    }


def _mounted(game_dir: str | None) -> tuple[Any, str | None]:
    if not game_dir:
        return None, "no gameDir given"
    try:
        from srctools.game import Game

        return Game(game_dir).get_filesystem(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def soundscript_read(req: dict[str, Any]) -> dict[str, Any]:
    path = str(req.get("path", "")).strip()
    limit = max(1, min(int(req.get("limit", 200)), 10_000))
    needle = str(req.get("name", "")).strip().lower()

    problems: list[str] = []
    scripts: list[str] = []
    raw_entries: list[tuple[Any, str]] = []
    fsys = None

    if path:
        source = Path(path).resolve()
        if not source.is_file():
            return {"path": str(source), "read": False, "readError": "file does not exist"}
        scripts.append(str(source))

        def loader(name: str) -> str | None:
            target = Path(name)
            if not target.is_absolute():
                target = source.parent / target
            try:
                return target.read_text(encoding="utf-8", errors="replace")
            except OSError:
                return None

        for node in _load_script(str(source), loader, 0, problems, set()):
            for sound in _entries([node]):
                raw_entries.append((sound, str(source)))
    else:
        game_dir = req.get("gameDir")
        fsys, mount_error = _mounted(game_dir)
        if fsys is None:
            return {"read": False, "mounted": False, "mountError": mount_error, "sounds": []}

        def loader(name: str) -> str | None:
            try:
                with fsys[name].open_str() as fh:
                    return fh.read()
            except Exception:  # noqa: BLE001
                return None

        manifest_path = str(req.get("manifest", "scripts/game_sounds_manifest.txt"))
        manifest = loader(manifest_path)
        if manifest is None:
            problems.append(f"{manifest_path} not found; reading scripts/game_sounds*.txt")
            files = []
            for entry in fsys.walk_folder("scripts"):
                name = entry.path.replace("\\", "/")
                if name.lower().endswith(".txt") and "game_sounds" in name.lower():
                    files.append(name)
            files = sorted(set(files), key=str.lower)
        else:
            files = _manifest_files(manifest)

        for file in files:
            if loader(file) is None:
                problems.append(f"{file}: not found")
                continue
            scripts.append(file)
            for node in _load_script(file, loader, 0, problems, set()):
                for sound in _entries([node]):
                    raw_entries.append((sound, file))

    seen: set[str] = set()
    duplicates = 0
    sounds: list[dict[str, Any]] = []
    for entry, script in raw_entries:
        name = str(entry.name)
        key = name.lower()
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        if needle and needle not in key:
            continue
        described = _describe(entry, script)
        for wave in described["waves"]:
            file = wave.get("file")
            if fsys is not None and file:
                try:
                    fsys[file]
                    wave["exists"] = True
                except Exception:  # noqa: BLE001
                    wave["exists"] = False
            elif file:
                # A loose soundscript: look beside the script's `sound/` sibling.
                base = Path(scripts[0]).parent
                for parent in (base, base.parent, base.parent.parent):
                    candidate = parent / str(file)
                    if candidate.is_file():
                        wave["exists"] = True
                        break
                else:
                    wave["exists"] = False
        sounds.append(described)

    total = len(seen)
    return {
        "read": True,
        "mounted": fsys is not None,
        "mountError": None,
        "scripts": scripts,
        "scriptCount": len(scripts),
        "count": len(sounds),
        "total": total,
        "duplicates": duplicates,
        "problems": problems,
        "sounds": sounds[:limit],
        "truncated": len(sounds) > limit,
        "name": needle or None,
        "note": (
            "The first definition of a name wins, as in the engine. `waves[].file` is the "
            "path after the sound characters are stripped; `exists` says whether this "
            "install can find it. A sentence (`!name`) has no wave file."
        ),
    }


def _escape(value: str) -> str:
    if '"' in value:
        raise ValueError('a soundscript value cannot contain a double quote')
    return value.replace("\\", "/")


def soundscript_write(req: dict[str, Any]) -> dict[str, Any]:
    from srctools.keyvalues import Keyvalues

    path = Path(str(req.get("path", ""))).resolve()
    name = str(req.get("name", "")).strip()
    if not name:
        raise ValueError("name is required")
    waves = req.get("waves")
    if waves is None:
        wave = str(req.get("wave", "")).strip()
        if not wave:
            raise ValueError("wave is required")
        waves = [wave]
    waves = [str(w).strip() for w in waves if str(w).strip()]
    if not waves:
        raise ValueError("at least one wave is required")

    channel = str(req.get("channel", "CHAN_STATIC"))
    volume = float(req.get("volume", 1.0))
    soundlevel = req.get("soundlevel", "75dB")
    pitch = req.get("pitch", 100)

    overwrite = bool(req.get("overwrite", False))
    existing = ""
    if path.exists() and not overwrite:
        # Appending preserves comments and every other block; re-exporting a parsed tree
        # would not. The name check is case-insensitive, as the engine's is.
        existing = path.read_text(encoding="utf-8", errors="replace")
        if f'"{name.lower()}"' in existing.lower():
            raise ValueError(f"{path} already defines a sound named {name!r}")
        if existing and not existing.endswith("\n"):
            existing += "\n"

    lines = [f'"{_escape(name)}"', "{", f'\t"channel"\t\t"{_escape(channel)}"']
    if len(waves) == 1:
        lines.append(f'\t"wave"\t\t"{_escape(waves[0])}"')
    else:
        lines.append('\t"rndwave"')
        lines.append("\t{")
        for wave in waves:
            lines.append(f'\t\t"wave"\t\t"{_escape(wave)}"')
        lines.append("\t}")
    lines += [
        f'\t"volume"\t\t"{volume:g}"',
        f'\t"soundlevel"\t"{_escape(str(soundlevel))}"',
        f'\t"pitch"\t\t"{_escape(str(pitch))}"',
        "}",
    ]
    block = "\n".join(lines) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(existing + block, encoding="utf-8")

    # Parse the file back with the same reader; a block that only its writer understands
    # would be silent in game.
    back = soundscript_read({"path": str(path), "name": name})
    found = next((s for s in back.get("sounds", [])), None)
    return {
        "path": str(path),
        "written": True,
        "bytes": path.stat().st_size,
        "name": name,
        "waves": waves,
        "channel": channel,
        "verified": found is not None and found.get("name", "").lower() == name.lower(),
        "readBack": found,
        "note": (
            "Written as a standalone block. An existing file gets the block appended, so "
            "its comments and other entries survive; overwrite: true is not implemented as "
            "a re-export for that reason."
        ),
    }
