"""Particle systems: what is inside a `.pcf`, and which materials it draws.

`read_game_content` can list the particle files a map may use, but not what one contains.
A particle name is chosen from a browser, and a map that points `info_particle_system` at a
missing or renamed system simply shows nothing. This reads the DMX-based PCF through
srctools' parser and reports systems, children, operator functions and materials, so a
choice can be checked before it ships.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any


def _scalar(attr: Any) -> Any:
    """One option value. Vectors, colours and times keep their DMX type.

    They are returned as `{type, value}` so the same JSON can go back into
    `write_particle`: a bare list of four numbers would become a `vector4`, and a
    colour written as a vector4 is a different attribute to the engine.
    """
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
        if kind in {"vector2", "vector3", "vector4"}:
            vector = getattr(attr, f"val_{kind}")
            return {"type": kind, "value": [round(float(item), 6) for item in vector]}
        if kind == "color":
            return {"type": "color", "value": [int(item) for item in attr.val_color]}
        if kind == "quaternion":
            return {"type": "quaternion", "value": [round(float(item), 6) for item in attr.val_quaternion]}
        if kind == "time":
            return {"type": "time", "value": round(float(attr.val_time), 6)}
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
    effect_name = str(req.get("effectName", "")).strip()
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
    effect: dict[str, Any] | None = None
    if effect_name:
        folded = effect_name.casefold()
        matches = [system for system in systems if system["name"].casefold() == folded]
        effect = {
            "name": effect_name,
            "pathStyle": any(sep in effect_name for sep in ("/", "\\")),
            "resolved": bool(matches),
            "matches": [
                {
                    "name": system["name"],
                    "file": system["file"],
                    "materials": system["materials"],
                }
                for system in matches
            ],
        }
        if effect["pathStyle"]:
            effect["hint"] = (
                "`info_particle_system.effect_name` takes the bare system name -- Valve's own "
                "maps use `window_glass`, not `fire_01L4D/window_glass`. A `pcf/system` path "
                "precaches as unknown and renders nothing."
            )
        elif not matches:
            effect["hint"] = (
                "no system has this name in the files scanned. A custom .pcf normally ships "
                "inside an addon with a `particles/particles_manifest.txt` entry; without "
                "that, the engine may never register its systems."
            )
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
        "effectName": effect,
        "note": (
            "`children` are other systems in the same file; an `info_particle_system` uses "
            "`cpoint1`..`cpoint8` for child control points. `materials` are the VMT names "
            "the systems draw."
        ),
    }


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def _attribute(name: str, spec: Any) -> Any:
    """One option value, inferred from JSON or stated with an explicit `type`."""
    from srctools.dmx import Attribute, Color, Quaternion, ValueType, Vec2, Vec4
    from srctools.math import FrozenVec

    if isinstance(spec, dict) and "type" in spec:
        kind = str(spec["type"]).lower()
        value = spec.get("value")
        aliases = {"vec2": "vector2", "vec3": "vector3", "vec4": "vector4", "matrix": "vmatrix"}
        kind = aliases.get(kind, kind)
        try:
            value_type = ValueType(kind)
        except ValueError as exc:
            raise ValueError(
                f"particle option {name!r} has type {kind!r}; known types are "
                + ", ".join(sorted(item.value for item in ValueType))
            ) from exc
        if value_type is ValueType.VEC2:
            value = Vec2(*value)
        elif value_type is ValueType.VEC3:
            value = FrozenVec(value)
        elif value_type is ValueType.VEC4:
            value = Vec4(*value)
        elif value_type is ValueType.QUATERNION:
            value = Quaternion(*value)
        elif value_type is ValueType.COLOR:
            value = Color(*value)
        return Attribute(name, value_type, value)

    if isinstance(spec, bool):
        return Attribute(name, ValueType.BOOL, spec)
    if isinstance(spec, int):
        return Attribute(name, ValueType.INT, spec)
    if isinstance(spec, float):
        return Attribute(name, ValueType.FLOAT, spec)
    if isinstance(spec, str):
        return Attribute(name, ValueType.STRING, spec)
    if isinstance(spec, list) and len(spec) in {2, 3, 4} and all(
        isinstance(item, (int, float)) for item in spec
    ):
        if len(spec) == 2:
            return Attribute(name, ValueType.VEC2, Vec2(*spec))
        if len(spec) == 3:
            return Attribute(name, ValueType.VEC3, FrozenVec(spec))
        return Attribute(name, ValueType.VEC4, Vec4(*spec))
    raise ValueError(
        f"particle option {name!r} is not a string, number, bool or numeric vector; "
        "use {type, value} for an explicit DMX type"
    )


def _operator(spec: dict[str, Any], where: str) -> Any:
    from srctools.particles import Operator

    if not isinstance(spec, dict):
        raise ValueError(f"{where}: an operator must be an object")
    name = str(spec.get("name") or "").strip()
    function = str(spec.get("function") or spec.get("functionName") or "").strip()
    if not name:
        raise ValueError(f"{where}: an operator needs a name")
    if not function:
        raise ValueError(f"{where}: operator {name!r} needs a function")
    options = {
        key: _attribute(key, value)
        for key, value in (spec.get("options") or {}).items()
        if key not in {"name", "function", "functionName"}
    }
    return Operator(name, function, options)


def particle_write(req: dict[str, Any]) -> dict[str, Any]:
    """Builds a binary PCF from JSON, then parses it back with the PCF reader.

    The PCF format is a DMX (`format=pcf`), and `srctools.particles.Particle.export`
    reconstructs the element graph with the child references pointing at the same system
    elements. Writing the file is therefore a tree build, not a byte layout reimplementation.
    """
    from srctools.particles import Child, Particle

    path = Path(str(req.get("path", ""))).resolve()
    systems_spec = req.get("systems")
    source_text = str(req.get("source", "")).strip()
    format_version = int(req.get("formatVersion", 2))
    if format_version not in {1, 2}:
        raise ValueError("formatVersion must be 1 or 2")
    overwrite = bool(req.get("overwrite", False))
    if path.exists() and not overwrite:
        raise ValueError(f"{path} already exists; pass overwrite:true to replace it")
    if source_text and isinstance(systems_spec, list) and systems_spec:
        raise ValueError("give either `source` (rewrite an existing PCF) or `systems`, not both")

    particles: list[Any] = []
    source_label: str | None = None
    if source_text:
        source_path = Path(source_text).resolve()
        if source_path.is_file():
            with source_path.open("rb") as fh:
                parsed_source = Particle.parse(fh)
            source_label = str(source_path)
        else:
            game_dir = str(req.get("gameDir", "")).strip()
            if not game_dir:
                raise ValueError(
                    f"{source_path} does not exist and no gameDir was given to look for "
                    f"{source_text!r} in the game's particles/"
                )
            from srctools.game import Game

            fsys = Game(game_dir).get_filesystem()
            rel = source_text.replace("\\", "/").lstrip("/")
            if not rel.lower().startswith("particles/"):
                rel = f"particles/{rel}"
            try:
                with fsys[rel].open_bin() as fh:
                    parsed_source = Particle.parse(fh)
            except Exception as exc:  # noqa: BLE001
                raise ValueError(f"{source_text}: {type(exc).__name__}: {exc}") from exc
            source_label = rel
        particles = list(parsed_source.values())
    else:
        if not isinstance(systems_spec, list) or not systems_spec:
            raise ValueError("systems must be a non-empty list (or give `source`)")
        names: set[str] = set()
        children_spec: dict[str, list[str]] = {}
        for index, spec in enumerate(systems_spec):
            if not isinstance(spec, dict):
                raise ValueError(f"system {index} must be an object")
            name = str(spec.get("name") or "").strip()
            if not name:
                raise ValueError(f"system {index} needs a name")
            folded = name.casefold()
            if folded in names:
                raise ValueError(f"system {name!r} appears twice; PCF names are case-insensitive")
            names.add(folded)
            options = {
                key: _attribute(key, value)
                for key, value in (spec.get("options") or {}).items()
                if key.casefold() != "name"
            }
            operators = {
                kind: [
                    _operator(item, f"system {name!r} {kind}")
                    for item in (spec.get(kind) or [])
                ]
                for kind in ("renderers", "operators", "initializers", "emitters", "forces", "constraints")
            }
            children_spec[folded] = [str(value) for value in (spec.get("children") or [])]
            particles.append(
                Particle(
                    name=name,
                    options=options,
                    renderers=operators["renderers"],
                    operators=operators["operators"],
                    initializers=operators["initializers"],
                    emitters=operators["emitters"],
                    forces=operators["forces"],
                    constraints=operators["constraints"],
                    children=[],
                )
            )

        for particle in particles:
            folded = particle.name.casefold()
            for child in children_spec.get(folded, []):
                if child.casefold() not in names:
                    raise ValueError(
                        f"system {particle.name!r} names child {child!r}, which is not in this file"
                    )
                particle.children.append(Child(child))

    warnings: list[str] = []
    if source_text:
        # A stock file can point at a system that is not in it (the engine silently shows
        # nothing). `Particle.export` cannot reference a non-existent element, so the
        # dangling child is dropped and named rather than turning the whole rewrite into a
        # KeyError.
        present = {particle.name.casefold() for particle in particles}
        for particle in particles:
            kept = []
            for child in particle.children:
                if child.particle.casefold() in present:
                    kept.append(child)
                else:
                    warnings.append(
                        f"{particle.name}: child {child.particle!r} is not in this file and was dropped"
                    )
            particle.children = kept

    renames_raw = req.get("renames") or {}
    if not isinstance(renames_raw, dict):
        raise ValueError("renames must be an object of old system name -> new system name")
    renames: dict[str, str] = {}
    if renames_raw:
        if not source_text:
            raise ValueError("renames applies to `source`; a file built from `systems` names its own systems")
        present = {particle.name.casefold(): particle.name for particle in particles}
        plan: dict[str, str] = {}
        for raw_old, raw_new in renames_raw.items():
            old = str(raw_old).strip()
            new = str(raw_new).strip()
            if not old or not new:
                raise ValueError("a rename needs a non-empty old and new name")
            if any(sep in new for sep in ("/", "\\")):
                raise ValueError(f"rename target {new!r} is a path; a system name is bare")
            if old.casefold() not in present:
                raise ValueError(f"no system {old!r} in {source_label} to rename")
            plan[old.casefold()] = new
        taken = {name.casefold() for name in plan.values()}
        if len(taken) != len(plan):
            raise ValueError("two systems were renamed to the same name")
        untouched = {folded for folded in present if folded not in plan}
        clash = taken & untouched
        if clash:
            raise ValueError(f"rename target {sorted(clash)[0]!r} already exists in {source_label}")

        def renamed(name: str) -> str:
            return plan.get(name.casefold(), name)

        # `Particle.export` copies `options` over the element, and the stock `name` option is
        # one of them -- setting `particle.name` alone leaves the old name in the file.
        from srctools.dmx import Attribute, ValueType

        for particle in particles:
            new_name = renamed(particle.name)
            if new_name != particle.name:
                particle.name = new_name
                particle.options["name"] = Attribute("name", ValueType.STRING, new_name)
            particle.children = [Child(renamed(child.particle)) for child in particle.children]
        renames = {present[old]: new for old, new in plan.items()}

    root = Particle.export(particles)
    buffer = io.BytesIO()
    try:
        root.export_binary(buffer, version=4, fmt_name="pcf", fmt_ver=format_version)
    except Exception as exc:  # noqa: BLE001 -- the boundary reports the reason
        raise ValueError(f"{type(exc).__name__}: {exc}") from exc
    data = buffer.getvalue()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)

    with path.open("rb") as fh:
        parsed = Particle.parse(fh)
    expected = {particle.name.casefold(): particle for particle in particles}
    verified = set(parsed) == set(expected)
    if verified:
        for folded, particle in expected.items():
            actual = parsed[folded]
            if (
                actual.name != particle.name
                or len(actual.children) != len(particle.children)
                or len(actual.renderers) != len(particle.renderers)
                or len(actual.operators) != len(particle.operators)
                or len(actual.initializers) != len(particle.initializers)
                or len(actual.emitters) != len(particle.emitters)
                or len(actual.forces) != len(particle.forces)
                or len(actual.constraints) != len(particle.constraints)
            ):
                verified = False
                break

    return {
        "path": str(path),
        "written": True,
        "source": source_label,
        "bytes": len(data),
        "format": "pcf",
        "formatVersion": format_version,
        "systemCount": len(particles),
        "systems": [
            {
                "name": particle.name,
                "optionKeys": sorted(particle.options),
                "children": [child.particle for child in particle.children],
                "renderers": len(particle.renderers),
                "initializers": len(particle.initializers),
                "emitters": len(particle.emitters),
                "forces": len(particle.forces),
                "constraints": len(particle.constraints),
                "operators": len(particle.operators),
            }
            for particle in particles
        ],
        "verified": verified,
        "warnings": warnings,
        "renames": renames,
        "note": (
            "A binary PCF (DMX format `pcf`, version 1 or 2) written through srctools' "
            "Particle.export and read back with its own parser. Child references point at "
            "the same system elements, not copies. Option values may be plain JSON scalars "
            "or {type, value} for an explicit DMX type."
        ),
    }
