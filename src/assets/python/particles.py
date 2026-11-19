"""Particle systems: what is inside a `.pcf`, and which materials it draws.

`read_game_content` can list the particle files a map may use, but not what one contains.
A particle name is chosen from a browser, and a map that points `info_particle_system` at a
missing or renamed system simply shows nothing. This reads the DMX-based PCF through
srctools' parser and reports systems, children, operator functions and materials, so a
choice can be checked before it ships.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def _scalar(attr: Any) -> Any:
    try:
        kind = attr.type.value
        if kind == "string":
            value = attr.val_string
            return value[:512]
        if kind == "int":
            return int(attr.val_int)
        if kind == "float":
            return round(float(attr.val_float), 6)
        if kind == "bool":
            return bool(attr.val_bool)
    except Exception:  # noqa: BLE001
        return None
    return None


def _summary(particle: Any, file: str, include_operators: bool) -> dict[str, Any]:
    materials: set[str] = set()
    options: dict[str, Any] = {}
    for key, attr in particle.options.items():
        value = _scalar(attr)
        if value is None:
            continue
        if "material" in key.lower() and isinstance(value, str):
            materials.add(value.replace("\\", "/"))
        if key not in {"name"}:
            options[key] = value

    def operators(items: list[Any]) -> list[dict[str, Any]]:
        if not include_operators:
            return []
        return [
            {
                "name": operator.name,
                "function": operator.function,
                "options": {
                    key: value
                    for key, value in (
                        (key, _scalar(attr)) for key, attr in operator.options.items()
                    )
                    if value is not None and key != "name"
                },
            }
            for operator in items
        ]

    return {
        "name": particle.name,
        "file": file,
        "materials": sorted(materials),
        "children": [child.particle for child in particle.children],
        "optionKeys": sorted(particle.options),
        "options": options,
        "renderers": operators(particle.renderers),
        "initializers": operators(particle.initializers),
        "emitters": operators(particle.emitters),
        "forces": operators(particle.forces),
        "constraints": operators(particle.constraints),
        "operators": operators(particle.operators),
    }


def _parse_file(path: Path, include_operators: bool) -> list[dict[str, Any]]:
    from srctools.particles import Particle

    with path.open("rb") as fh:
        systems = Particle.parse(fh)
    return [_summary(system, str(path), include_operators) for system in systems.values()]


def _mounted(game_dir: str | None) -> tuple[Any, str | None]:
    if not game_dir:
        return None, "no gameDir given"
    try:
        from srctools.game import Game

        return Game(game_dir).get_filesystem(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def particle_read(req: dict[str, Any]) -> dict[str, Any]:
    path = str(req.get("path", "")).strip()
    needle = str(req.get("name", "")).strip().lower()
    limit = max(1, min(int(req.get("limit", 200)), 10_000))
    include_operators = bool(req.get("includeOperators", True))
    fsys = None
    files: list[str] = []
    systems: list[dict[str, Any]] = []
    problems: list[str] = []

    if path:
        source = Path(path).resolve()
        if not source.is_file():
            return {"path": str(source), "read": False, "readError": "file does not exist"}
        try:
            systems = _parse_file(source, include_operators)
        except Exception as exc:  # noqa: BLE001
            return {"path": str(source), "read": False, "readError": f"{type(exc).__name__}: {exc}"}
        files.append(str(source))
    else:
        fsys, mount_error = _mounted(req.get("gameDir"))
        if fsys is None:
            return {"read": False, "mounted": False, "mountError": mount_error, "systems": []}
        pattern = str(req.get("filePattern", "")).strip().lower()
        for entry in fsys.walk_folder("particles"):
            name = entry.path.replace("\\", "/")
            if not name.lower().endswith(".pcf"):
                continue
            if pattern and pattern not in name.lower():
                continue
            files.append(name)
        files.sort(key=str.lower)
        for file in files[: max(1, min(int(req.get("maxFiles", 200)), 2000))]:
            try:
                from srctools.particles import Particle

                with fsys[file].open_bin() as fh:
                    parsed = Particle.parse(fh)
                systems.extend(
                    _summary(system, file, include_operators) for system in parsed.values()
                )
            except Exception as exc:  # noqa: BLE001
                problems.append(f"{file}: {type(exc).__name__}: {exc}")

    total = len(systems)
    if needle:
        systems = [system for system in systems if needle in system["name"].lower()]
    return {
        "read": True,
        "mounted": fsys is not None,
        "mountError": None,
        "files": files,
        "fileCount": len(files),
        "total": total,
        "count": len(systems),
        "problems": problems,
        "systems": systems[:limit],
        "truncated": len(systems) > limit,
        "name": needle or None,
        "note": (
            "`children` are other systems in the same file; an `info_particle_system` uses "
            "`cpoint1`..`cpoint8` for child control points. `materials` are the VMT names "
            "the systems draw."
        ),
    }
