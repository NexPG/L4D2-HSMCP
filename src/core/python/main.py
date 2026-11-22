#!/usr/bin/env python3
"""Sidecar for the Source file formats srctools already knows how to read.

One subprocess per call: a verb in argv[1], a JSON request on stdin, a JSON reply on
stdout, diagnostics on stderr. No daemon and no lock -- that is the point. hammer-mcp is
stateless, and the incident that produced gmod-mcp's daemon.lock is exactly what a
long-lived helper here would invite.

The boundary follows call frequency, not file format: what is hot and already proven
stays in TypeScript (BSP by offset, KeyValues with offsets preserved, the .lmp codec);
what is cold and expensive to rewrite lives here.

Every reply is a JSON object. Failures come back as {"error": {...}} with exit code 1,
never as a traceback on stdout: the caller parses this, and a half-JSON stream would
look like a protocol fault rather than a bad path.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

# The Python half of the toolkit is split by module, one `python/` directory per module
# (`src/assets/python`, `src/hammer/python`, `src/maps/python`, ...). This entry point is the
# only file that has to know that: every later import is by plain module name, which is how
# the modules were written before they were split. Adding the directories rather than
# rewriting a hundred imports keeps each module in charge of its own files.
_SRC = Path(__file__).resolve().parents[2]
for _directory in sorted(_SRC.glob("*/python")):
    if str(_directory) not in sys.path:
        sys.path.insert(0, str(_directory))

VERBS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {}


def verb(name: str) -> Callable[[Callable[[dict[str, Any]], dict[str, Any]]], Any]:
    def register(fn: Callable[[dict[str, Any]], dict[str, Any]]) -> Any:
        VERBS[name] = fn
        return fn

    return register


@verb("hammer_live")
def _hammer_live(req: dict[str, Any]) -> dict[str, Any]:
    """Live editor shell channel: status, send, batch, menu.

    The editor must already be running. This never launches a game and never touches one.
    """
    from hammer_live import batch, menu, send, status

    action = req.get("action", "status")
    if action == "status":
        return status()
    if action == "send":
        return send(int(req["pid"]), str(req["command"]))
    if action == "menu":
        return menu(int(req["pid"]), int(req["commandId"]))
    if action == "batch":
        return batch(int(req["pid"]), str(req["vmf"]), [str(c) for c in req["commands"]])
    raise ValueError(f"unknown hammer_live action {action!r}")


@verb("health")
def _health(_req: dict[str, Any]) -> dict[str, Any]:
    """Reports what this sidecar can actually do. Must never raise: hammer-mcp's own
    health tool calls it to describe a broken install rather than fail with it."""
    out: dict[str, Any] = {
        "python": sys.version.split()[0],
        "executable": sys.executable,
    }
    try:
        from importlib.metadata import version

        import srctools  # noqa: F401 -- imported to prove it loads, not for its names

        out["srctools"] = version("srctools")
        out["ok"] = True
    except Exception as exc:  # noqa: BLE001 -- reporting, not handling
        out["srctools"] = None
        out["ok"] = False
        out["reason"] = f"{type(exc).__name__}: {exc}"
    return out


@verb("pakfile")
def _pakfile(req: dict[str, Any]) -> dict[str, Any]:
    """Lists what a compiled map carries in lump 40, the embedded pakfile.

    It is a plain ZIP, so this is the audit of what actually ships with the map: custom
    materials and models a player will see, and the cubemap VTFs (`c-*.vtf`), whose
    presence is machine-checkable proof that buildcubemaps was run -- more reliable than
    trusting the compile settings.
    """
    from srctools.bsp import BSP

    path = req["path"]
    limit = int(req.get("limit", 200))

    bsp = BSP(path)
    entries: list[dict[str, Any]] = []
    by_ext: dict[str, int] = {}
    total_bytes = 0
    cubemaps = 0

    for info in bsp.pakfile.infolist():
        name = info.filename
        total_bytes += info.file_size
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        by_ext[ext] = by_ext.get(ext, 0) + 1
        base = name.rsplit("/", 1)[-1]
        if base.startswith("c") and base.endswith(".vtf") and "-" in base:
            cubemaps += 1
        entries.append(
            {"name": name, "bytes": info.file_size, "compressed": info.compress_size}
        )

    entries.sort(key=lambda e: -e["bytes"])
    return {
        "path": path,
        "fileCount": len(entries),
        "totalBytes": total_bytes,
        "byExtension": dict(sorted(by_ext.items(), key=lambda kv: -kv[1])),
        "cubemapTextures": cubemaps,
        "returned": min(len(entries), limit),
        "largest": entries[:limit],
    }


@verb("pakfile_extract")
def _pakfile_extract(req: dict[str, Any]) -> dict[str, Any]:
    """Pulls files out of lump 40, the map's embedded pakfile.

    `read_pakfile` says what is in there; nothing could get it out, so anything packed
    inside a map -- a cubemap, a soundscript, a custom material -- was readable only by
    unpacking the map by hand. That is the gap this closes.

    Two refusals, both about writing somewhere the caller did not ask for:

    * an entry whose name escapes the destination (`../`, an absolute path, a drive
      letter) is refused rather than sanitised. A pakfile is content that came from
      somewhere else, and quietly rewriting a path to something safe would extract a file
      the caller cannot then find by name.
    * an existing file is never overwritten. `overwrite` says otherwise explicitly.
    """
    import fnmatch
    import os

    from srctools.bsp import BSP

    path = req["path"]
    into = req["into"]
    pattern = req.get("pattern")
    limit = int(req.get("limit", 200))
    overwrite = bool(req.get("overwrite", False))

    bsp = BSP(path)
    root = os.path.realpath(into)
    os.makedirs(root, exist_ok=True)

    written: list[dict[str, Any]] = []
    refused: list[dict[str, str]] = []
    skipped = 0
    matched = 0

    for info in bsp.pakfile.infolist():
        name = info.filename
        if pattern and not fnmatch.fnmatch(name.lower(), pattern.lower()):
            continue
        matched += 1
        if len(written) >= limit:
            skipped += 1
            continue

        target = os.path.realpath(os.path.join(root, name))
        if target != root and not target.startswith(root + os.sep):
            refused.append({"name": name, "why": "escapes the destination directory"})
            continue
        if os.path.exists(target) and not overwrite:
            refused.append({"name": name, "why": "already exists; pass overwrite to replace"})
            continue

        os.makedirs(os.path.dirname(target), exist_ok=True)
        data = bsp.pakfile.read(name)
        with open(target, "wb") as fh:
            fh.write(data)
        written.append({"name": name, "path": target, "bytes": len(data)})

    return {
        "path": path,
        "into": root,
        "matched": matched,
        "written": written,
        "refused": refused,
        "skippedOverLimit": skipped,
    }


@verb("vpk_list")
def _vpk_list(req: dict[str, Any]) -> dict[str, Any]:
    """Lists entries of a VPK, optionally under one prefix.

    Read-only and index-only: a 1 GB addon is not unpacked to answer what is inside it.
    Used to check a campaign's maps and images without extracting anything.
    """
    from srctools.filesys import VPKFileSystem

    path = req["path"]
    prefix = str(req.get("prefix", "")).replace("\\", "/")
    limit = int(req.get("limit", 20_000))
    fs = VPKFileSystem(path)
    entries: list[str] = []
    truncated = False
    # `walk_folder` wants a Folder object; a bare string prefix returned nothing, which made
    # `run_nav_generate`'s shadow-archive search silently find no shadowing VPK. Walk the
    # root and filter the path prefix instead.
    for entry in fs.walk_folder(""):
        if prefix and not entry.path.replace("\\", "/").startswith(prefix):
            continue
        if len(entries) >= limit:
            truncated = True
            break
        entries.append(entry.path)
    entries.sort()
    return {
        "path": path,
        "prefix": prefix,
        "entries": entries,
        "returned": len(entries),
        "truncated": truncated,
    }


@verb("vpk_read")
def _vpk_read(req: dict[str, Any]) -> dict[str, Any]:
    """Reads one text entry from a VPK, by exact path.

    Text only, with a byte ceiling: this exists for campaign files and configs, not for
    pulling a map or a texture through the JSON channel.
    """
    from srctools.filesys import VPKFileSystem

    path = req["path"]
    entry_name = req["entry"]
    max_bytes = int(req.get("maxBytes", 4_000_000))
    fs = VPKFileSystem(path)
    try:
        entry = fs[entry_name]
    except KeyError:
        raise ValueError(f"{entry_name} is not in {path}") from None
    data = entry.open_bin().read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError(
            f"{entry_name} is larger than {max_bytes} bytes; this verb reads text files"
        )
    return {
        "path": path,
        "entry": entry_name,
        "bytes": len(data),
        "text": data.decode("utf8", errors="replace"),
    }


def _fgd_names(req: dict[str, Any]) -> tuple[str, ...]:
    """Which FGDs to check against, relative to `binDir` or absolute.

    A list rather than one name since Hammer++ ships its own. The caller decides -- it is
    the side that knows which files exist -- and the reply names what was loaded, so the
    schema can never widen without it being visible.
    """
    names = req.get("fgd") or ("left4dead2.fgd",)
    return (names,) if isinstance(names, str) else tuple(names)


def _load_vmf(path: str, req: dict[str, Any] | None = None) -> tuple[Any, dict[str, Any]]:
    """Parses a .vmf, optionally flattening its func_instances first.

    Off by default: expanding changes every count and every targetname in the reply, and
    that must be something the caller asked for rather than something that happens to a
    map one day because an option gained a default.
    """
    from srctools import VMF

    from vmftext import parse_vmf_keyvalues

    vmf = VMF.parse(parse_vmf_keyvalues(path))

    if not (req or {}).get("collapseInstances"):
        return vmf, {"collapsed": 0, "requested": False}

    from instances import collapse_instances

    info = collapse_instances(
        vmf,
        path,
        (req or {}).get("gameDir"),
        recur_limit=int((req or {}).get("recurLimit", 16)),
        instance_path=(req or {}).get("instancePath"),
    )
    info["requested"] = True
    return vmf, info


@verb("vmf_collapse")
def _vmf_collapse(req: dict[str, Any]) -> dict[str, Any]:
    """Writes a copy of a .vmf with every `func_instance` expanded.

    vbsp does not expand instances; run_compile used to hand it a map containing one and
    the compiler crashed with an access violation. Hammer expands them before compiling,
    and this is the same expansion srctools already performs for `vmf_read`.
    """
    vmf, info = _load_vmf(req["path"], {**req, "collapseInstances": True})
    out = req["out"]
    with open(out, "w", encoding="utf8", newline="\n") as handle:
        vmf.export(handle)
    return {
        "collapsed": info.get("collapsed", 0),
        "files": info.get("files", []),
        "depthLimit": info.get("depthLimit"),
        "out": out,
    }


@verb("carve_solids")
def _carve_solids(req: dict[str, Any]) -> dict[str, Any]:
    """Carve one brush out of one or more target brushes.

    The boolean itself is `srctools.geometry.Geometry.carve`; this verb only maps Hammer
    ids to solids, keeps the result in the target's owner (world or brush entity) and
    exports the map. The carver is removed unless `keepCarver` is set, matching Hammer's
    Carve tool.
    """
    from srctools.geometry import Geometry

    vmf, _info = _load_vmf(req["path"])
    owner_by_id: dict[int, Any] = {}
    for ent in [vmf.spawn, *vmf.entities]:
        for solid in ent.solids:
            owner_by_id[solid.id] = ent

    target_ids = [int(value) for value in req["targets"]]
    carver_id = int(req["carver"])
    if len(set(target_ids)) != len(target_ids):
        raise ValueError("targets contains a duplicate id")
    if carver_id in target_ids:
        raise ValueError("the carver cannot also be a target")
    missing = [value for value in [*target_ids, carver_id] if value not in owner_by_id]
    if missing:
        raise ValueError(f"no solid with id {', '.join(map(str, missing))} in this map")

    targets = [next(s for s in owner_by_id[target_id].solids if s.id == target_id) for target_id in target_ids]
    carver = next(s for s in owner_by_id[carver_id].solids if s.id == carver_id)
    owner = owner_by_id[target_ids[0]]
    if any(owner_by_id[target_id] is not owner for target_id in target_ids):
        raise ValueError("all targets must belong to the same world or brush entity")

    material = str(req.get("material") or "TOOLS/TOOLSNODRAW")
    geometries = [Geometry.from_brush(solid) for solid in targets]
    result = Geometry.carve(geometries, Geometry.from_brush(carver))
    rebuilt = [geometry.rebuild(vmf, material) for geometry in result]
    for solid in rebuilt:
        solid.group_id = targets[0].group_id
        solid.visgroup_ids = set(targets[0].visgroup_ids)
        solid.editor_color = targets[0].editor_color

    for solid in targets:
        if solid in owner.solids:
            owner.solids.remove(solid)
    owner.solids.extend(rebuilt)

    carver_owner = owner_by_id[carver_id]
    if not req.get("keepCarver", False) and carver in carver_owner.solids:
        carver_owner.solids.remove(carver)

    out = req["out"]
    with open(out, "w", encoding="utf8", newline="\n") as handle:
        vmf.export(handle)
    return {
        "targets": target_ids,
        "carver": carver_id,
        "keepCarver": bool(req.get("keepCarver", False)),
        "newSolidIds": [solid.id for solid in rebuilt],
        "removedTargetCount": len(targets),
        "removedCarver": not bool(req.get("keepCarver", False)),
        "owner": owner["classname", "worldspawn"],
        "out": out,
    }


@verb("hull_solids")
def _hull_solids(req: dict[str, Any]) -> dict[str, Any]:
    """Build one convex brush around the vertices of some brushes, or around points.

    The hull uses srctools' `quickhull` and `Geometry.from_dup_planes`; the note below
    explains why that is not `Geometry.from_points`. This verb only collects vertices, keeps
    the result in the first source's owner and exports the map. Sources are kept unless
    `keepSources` is false, so an accidental hull cannot delete geometry.
    """
    from srctools.geometry import Geometry, Plane
    from srctools.math import Vec, quickhull

    vmf, _info = _load_vmf(req["path"])
    owner_by_id: dict[int, Any] = {}
    for ent in [vmf.spawn, *vmf.entities]:
        for solid in ent.solids:
            owner_by_id[solid.id] = ent

    source_ids = [int(value) for value in req.get("solidIds") or []]
    if len(set(source_ids)) != len(source_ids):
        raise ValueError("solidIds contains a duplicate id")
    missing = [value for value in source_ids if value not in owner_by_id]
    if missing:
        raise ValueError(f"no solid with id {', '.join(map(str, missing))} in this map")

    sources = [next(s for s in owner_by_id[sid].solids if s.id == sid) for sid in source_ids]
    owner = owner_by_id[source_ids[0]] if sources else vmf.spawn
    if any(owner_by_id[sid] is not owner for sid in source_ids):
        raise ValueError("all solidIds must belong to the same world or brush entity")

    points: list[Vec] = []
    for solid in sources:
        for poly in Geometry.from_brush(solid):
            points.extend(poly.vertices)
    points.extend(Vec(float(p[0]), float(p[1]), float(p[2])) for p in (req.get("points") or []))
    if not points:
        raise ValueError("give solidIds, points, or both: a hull needs vertices")

    unique = {(round(p.x, 6), round(p.y, 6), round(p.z, 6)) for p in points}
    if len(unique) < 4:
        raise ValueError(f"a hull needs at least 4 distinct points, got {len(unique)}")
    span = [max(v[i] for v in unique) - min(v[i] for v in unique) for i in range(3)]
    flat = [axis for axis, size in zip("XYZ", span) if size < 1e-6]
    if flat:
        raise ValueError(
            f"the points are coplanar (zero extent on {', '.join(flat)}); a hull needs volume"
        )

    try:
        # `Geometry.from_points` is the obvious call, but in srctools 2.7.0 its planes come
        # out facing inward and `from_dup_planes` then keeps no polygon at all (a cube's
        # corners yield an empty Geometry). Use the library's `quickhull` directly and give
        # each plane the outward orientation `from_dup_planes` expects: the centroid of a
        # convex hull is behind every face.
        cloud = [Vec(*p) for p in unique]
        centroid = sum(cloud, Vec(0.0, 0.0, 0.0)) / len(cloud)
        planes = []
        for a, b, c in quickhull(cloud):
            normal = Vec.cross(a - b, b - c).norm()
            if normal.dot(centroid - a) > 0:
                normal = -normal
            planes.append(Plane(normal, a.dot(normal)))
        geometry = Geometry.from_dup_planes(planes)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"convex hull failed: {type(exc).__name__}: {exc}") from exc
    if len(geometry.polys) < 4:
        raise ValueError(
            f"the hull has {len(geometry.polys)} faces, so it is not a closed volume"
        )

    material = str(req.get("material") or "TOOLS/TOOLSNODRAW")
    solid = geometry.rebuild(vmf, material)
    if sources:
        solid.group_id = sources[0].group_id
        solid.visgroup_ids = set(sources[0].visgroup_ids)
        solid.editor_color = sources[0].editor_color

    if not req.get("keepSources", True):
        for source in sources:
            if source in owner.solids:
                owner.solids.remove(source)
    owner.solids.append(solid)

    out = req["out"]
    with open(out, "w", encoding="utf8", newline="\n") as handle:
        vmf.export(handle)
    return {
        "solidIds": source_ids,
        "newSolidId": solid.id,
        "pointCount": len(unique),
        "planeCount": len(solid.sides),
        "keepSources": bool(req.get("keepSources", True)),
        "removedSourceCount": 0 if req.get("keepSources", True) else len(sources),
        "owner": owner["classname", "worldspawn"],
        "out": out,
    }


@verb("send_console_command")
def _send_console_command(req: dict[str, Any]) -> dict[str, Any]:
    """Types a console command into a running Source game.

    The transport is `srctools.run.send_engine_command`, the same `WM_COPYDATA` to the
    `Valve001` window that the engine's own `-hijack` path uses. It is not synthetic
    keyboard input: the game need not be focused, and a command the console would reject is
    rejected by the console.
    """
    from srctools.run import send_engine_command

    command = req.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ValueError("command must be a non-empty string")
    classname = str(req.get("classname") or "Valve001")
    try:
        send_engine_command(command.encode("utf-8"), classname=classname)
    except LookupError as exc:
        raise ValueError(
            f"no window with class {classname!r} was found; is the game running?"
        ) from exc
    except OSError as exc:
        raise ValueError(f"the engine console transport is unavailable: {exc}") from exc
    except ValueError as exc:
        raise ValueError(f"the game did not accept the command: {exc}") from exc
    return {"command": command, "classname": classname, "sent": True}


@verb("check_assets")
def _check_assets(req: dict[str, Any]) -> dict[str, Any]:
    """Checks a source .vmf's asset references against the game's mount chain.

    The resolver, the material walker and the model walker are the ones
    `map_dependencies` already uses on a compiled BSP; this verb only collects the
    references from the source and reports what the game cannot supply.
    """
    from dependencies import check_assets

    vmf, info = _load_vmf(req["path"], req)
    return check_assets(vmf, req, info)


@verb("read_choreo")
def _read_choreo(req: dict[str, Any]) -> dict[str, Any]:
    """Reads a text VCD choreography scene through `srctools.choreo.Scene`.

    A `.vcd` is the timeline a scene uses: events on actor channels, their times, sounds and
    parameters. The parser is srctools'; this verb only selects the fields a caller can act
    on and builds one timeline sorted by start time.
    """
    from srctools.choreo import Scene
    from srctools.tokenizer import Tokenizer

    path = req["path"]
    raw = Path(path).read_bytes()
    if raw[:4] == b"VSIF":
        raise ValueError(f"{path} is a scenes.image, not a VCD; use read_scenes_image")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1251", "replace")
    scene = Scene.parse_text(Tokenizer(text, path))
    limit = max(1, min(int(req.get("limit", 200)), 5000))

    def event_json(event: Any, actor: str | None = None, channel: str | None = None) -> dict[str, Any]:
        return {
            "name": event.name,
            "type": event.type.name.lower(),
            "start": event.start_time,
            "end": event.end_time if event.has_end_time else None,
            "parameters": list(event.parameters),
            "flags": event.flags.value,
            **({"actor": actor} if actor else {}),
            **({"channel": channel} if channel else {}),
        }

    timeline = [event_json(event) for event in scene.events]
    for actor in scene.actors:
        for channel in actor.channels:
            for event in channel.events:
                timeline.append(event_json(event, actor.name, channel.name))
    timeline.sort(key=lambda event: (event["start"], event["name"]))
    sounds = sorted(set(scene.used_sounds()))
    return {
        "path": path,
        "mapName": scene.map_name,
        "fps": scene.fps,
        "duration": scene.duration(),
        "eventCount": len(timeline),
        "events": timeline[:limit],
        "eventsTruncated": len(timeline) > limit,
        "actorCount": len(scene.actors),
        "actors": [
            {
                "name": actor.name,
                "active": actor.active,
                "faceposerModel": actor.faceposer_model,
                "channels": [
                    {
                        "name": channel.name,
                        "active": channel.active,
                        "eventCount": len(channel.events),
                    }
                    for channel in actor.channels
                ],
            }
            for actor in scene.actors
        ],
        "sounds": sounds[:limit],
        "soundCount": len(sounds),
        "ignorePhonemes": scene.ignore_phonemes,
    }


@verb("read_scenes_image")
def _read_scenes_image(req: dict[str, Any]) -> dict[str, Any]:
    """Reads `scenes/scenes.image` through `srctools.choreo.parse_scenes_image`.

    The image is a CRC-keyed summary of every VCD: duration, the last spoken line and the
    sounds. The filenames are not stored, so the checksum is the key; with `details` each
    embedded scene is parsed for its event and actor counts.
    """
    from srctools.choreo import parse_scenes_image

    path = req["path"]
    limit = max(1, min(int(req.get("limit", 200)), 5000))
    details = bool(req.get("details", False))
    with open(path, "rb") as handle:
        scenes = parse_scenes_image(handle)
    entries = sorted(scenes.values(), key=lambda entry: entry.checksum)
    result = []
    for entry in entries[:limit]:
        item: dict[str, Any] = {
            "checksum": f"{entry.checksum:08x}",
            "filename": entry.filename or None,
            "durationMs": entry.duration_ms,
            "lastSpeakMs": entry.last_speak_ms,
            "sounds": entry.sounds,
            "soundCount": len(entry.sounds),
        }
        if details:
            try:
                scene = entry.data
                item["eventCount"] = len(scene.events) + sum(
                    len(channel.events)
                    for actor in scene.actors
                    for channel in actor.channels
                )
                item["actorCount"] = len(scene.actors)
            except Exception as exc:  # noqa: BLE001
                item["detailError"] = f"{type(exc).__name__}: {exc}"
        result.append(item)
    return {
        "path": path,
        "count": len(entries),
        "returned": len(result),
        "truncated": len(entries) > limit,
        "entries": result,
    }


@verb("vtf_resources")
def _vtf_resources(req: dict[str, Any]) -> dict[str, Any]:
    """Reads a VTF's version 7.3+ resources, particle-sheet frames and hotspot rectangles.

    `srctools.vtf.VTF` owns the format, including `SheetSequence` and `HotspotRect`; this verb
    only turns their fields into JSON. `header_only` avoids decoding the image itself.
    """
    from srctools.vtf import ResourceID, VTF

    path = req["path"]
    with open(path, "rb") as handle:
        vtf = VTF.read(handle, header_only=True)

    resources = []
    for rid, resource in vtf.resources.items():
        if isinstance(rid, ResourceID):
            resource_id = rid.name
            raw_id = rid.value.hex()
        else:
            resource_id = None
            raw_id = rid.hex()
        data = resource.data
        resources.append(
            {
                "id": resource_id,
                "rawId": raw_id,
                "flags": resource.flags,
                "kind": "integer" if isinstance(data, int) else "bytes",
                "value": data if isinstance(data, int) else None,
                "size": None if isinstance(data, int) else len(data),
            }
        )
    resources.sort(key=lambda item: (item["id"] or "", item["rawId"]))

    include_frames = bool(req.get("frames", False))
    sheets = []
    for sequence, sheet in sorted(vtf.sheet_info.items()):
        item: dict[str, Any] = {
            "sequence": sequence,
            "clamp": sheet.clamp,
            "duration": sheet.duration,
            "frameCount": len(sheet.frames),
        }
        if include_frames:
            item["frames"] = [
                {
                    "duration": frame[0],
                    "coords": [
                        [coord.left, coord.top, coord.right, coord.bottom]
                        for coord in frame[1:]
                    ],
                }
                for frame in sheet.frames
            ]
        sheets.append(item)

    hotspots = None
    if vtf.hotspot_info is not None:
        hotspots = [
            {
                "minX": rect.min_x,
                "minY": rect.min_y,
                "maxX": rect.max_x,
                "maxY": rect.max_y,
                "randomRotation": rect.random_rotation,
                "randomReflection": rect.random_reflection,
                "alternate": rect.is_alternate,
            }
            for rect in vtf.hotspot_info
        ]

    return {
        "resources": resources,
        "sheetInfo": sheets,
        "hotspotInfo": hotspots,
        "hotspotFlags": vtf.hotspot_flags,
    }


@verb("map_dependencies")
def _map_dependencies(req: dict[str, Any]) -> dict[str, Any]:
    """Every asset a compiled map references, and where each one will come from."""
    from dependencies import map_dependencies

    return map_dependencies(req)


@verb("search_content")
def _search_content(req: dict[str, Any]) -> dict[str, Any]:
    """Materials and models the game actually has, by name."""
    from content import search_content

    return search_content(req)


@verb("model_info")
def _model_info(req: dict[str, Any]) -> dict[str, Any]:
    """Bounds, skins and materials of one .mdl -- what Hammer's model browser shows."""
    from content import model_info

    return model_info(req)


@verb("particle_read")
def _particle_read(req: dict[str, Any]) -> dict[str, Any]:
    """Systems, children, operators and materials inside a .pcf."""
    from particles import particle_read

    return particle_read(req)


@verb("particle_write")
def _particle_write(req: dict[str, Any]) -> dict[str, Any]:
    """Builds a binary .pcf from JSON and reads it back with the PCF reader."""
    from particles import particle_write

    return particle_write(req)


@verb("dmx_read")
def _dmx_read(req: dict[str, Any]) -> dict[str, Any]:
    """A .dmx model source as a JSON tree an agent can inspect."""
    from dmx import dmx_read

    return dmx_read(req)


@verb("dmx_write")
def _dmx_write(req: dict[str, Any]) -> dict[str, Any]:
    """Builds a .dmx from a JSON tree, then reads it back."""
    from dmx import dmx_write

    return dmx_write(req)


@verb("smd_read")
def _smd_read(req: dict[str, Any]) -> dict[str, Any]:
    """Skeleton, frames, materials and triangles of a .smd model source."""
    from smd import smd_read

    return smd_read(req)


@verb("smd_write")
def _smd_write(req: dict[str, Any]) -> dict[str, Any]:
    """Builds a .smd from JSON, then reads it back."""
    from smd import smd_write

    return smd_write(req)


@verb("dmx_to_smd")
def _dmx_to_smd(req: dict[str, Any]) -> dict[str, Any]:
    """Converts a static DMX mesh export to SMD geometry."""
    from dmxsmd import dmx_to_smd

    return dmx_to_smd(req)


@verb("gltf_read")
def _gltf_read(req: dict[str, Any]) -> dict[str, Any]:
    """A glTF 2.0 / GLB document as a JSON summary an agent can inspect."""
    from gltf import gltf_read

    return gltf_read(req)


@verb("gltf_to_smd")
def _gltf_to_smd(req: dict[str, Any]) -> dict[str, Any]:
    """Converts glTF/GLB geometry and a skeleton to the SMD studiomdl reads."""
    from gltf import gltf_to_smd

    return gltf_to_smd(req)


@verb("gltf_to_dmx")
def _gltf_to_dmx(req: dict[str, Any]) -> dict[str, Any]:
    """Converts glTF/GLB shape keys to a DMX model source with flexes."""
    from gltfdmx import gltf_to_dmx

    return gltf_to_dmx(req)


@verb("fbx_read")
def _fbx_read(req: dict[str, Any]) -> dict[str, Any]:
    """An FBX (binary 7.x or ASCII) as a JSON summary an agent can inspect."""
    from fbx import fbx_read

    return fbx_read(req)


@verb("fbx_to_smd")
def _fbx_to_smd(req: dict[str, Any]) -> dict[str, Any]:
    """Converts FBX geometry, skeleton and skin weights to the SMD studiomdl reads."""
    from fbx import fbx_to_smd

    return fbx_to_smd(req)


@verb("fbx_to_dmx")
def _fbx_to_dmx(req: dict[str, Any]) -> dict[str, Any]:
    """Converts FBX shape keys and a skeleton to a DMX model source with flexes."""
    from fbxdmx import fbx_to_dmx

    return fbx_to_dmx(req)


@verb("vtf_write")
def _vtf_write(req: dict[str, Any]) -> dict[str, Any]:
    """PNG to VTF without VTFCmd: header, mip chain and a pixel round-trip."""
    from vtfgen import vtf_write

    return vtf_write(req)


@verb("vtf_convert")
def _vtf_convert(req: dict[str, Any]) -> dict[str, Any]:
    """Rebuilds an existing VTF in another format or size, then verifies it."""
    from vtfgen import vtf_convert

    return vtf_convert(req)


@verb("vtf_extract")
def _vtf_extract(req: dict[str, Any]) -> dict[str, Any]:
    """Decodes a VTF's first mip to a PNG the agent can look at."""
    from vtfgen import vtf_extract

    return vtf_extract(req)


@verb("vtf_cubemap_write")
def _vtf_cubemap_write(req: dict[str, Any]) -> dict[str, Any]:
    """Builds a six-face cubemap VTF and verifies every face."""
    from vtfgen import vtf_cubemap_write

    return vtf_cubemap_write(req)


@verb("wav_read")
def _wav_read(req: dict[str, Any]) -> dict[str, Any]:
    """Format, duration, loop and whether a WAV is ready for L4D2."""
    from wav import read_wav

    return read_wav(req)


@verb("wav_convert")
def _wav_convert(req: dict[str, Any]) -> dict[str, Any]:
    """Converts a WAV to 16-bit PCM mono/stereo at the requested rate."""
    from wav import convert_wav

    return convert_wav(req)


@verb("soundscript_read")
def _soundscript_read(req: dict[str, Any]) -> dict[str, Any]:
    """Named sounds, their channels and the wave each one resolves to."""
    from soundscripts import soundscript_read

    return soundscript_read(req)


@verb("soundscript_write")
def _soundscript_write(req: dict[str, Any]) -> dict[str, Any]:
    """Adds one sound block, appending to an existing script rather than rewriting it."""
    from soundscripts import soundscript_write

    return soundscript_write(req)


@verb("soundscape_read")
def _soundscape_read(req: dict[str, Any]) -> dict[str, Any]:
    """Reads soundscape definitions from one file or the game."""
    from soundscapes import soundscape_read

    return soundscape_read(req)


@verb("soundscape_write")
def _soundscape_write(req: dict[str, Any]) -> dict[str, Any]:
    """Builds one soundscape block and appends it without rewriting the file."""
    from soundscapes import soundscape_write

    return soundscape_write(req)


@verb("lzma_decompress")
def _lzma_decompress(req: dict[str, Any]) -> dict[str, Any]:
    """Decodes a Source-framed LZMA block (BSP lump compression)."""
    from lzma_codec import lzma_decompress

    return lzma_decompress(req)


@verb("lzma_compress")
def _lzma_compress(req: dict[str, Any]) -> dict[str, Any]:
    """Encodes bytes in the framing a Source BSP lump uses."""
    from lzma_codec import lzma_compress

    return lzma_compress(req)


@verb("asset_catalog")
def _asset_catalog(req: dict[str, Any]) -> dict[str, Any]:
    """The stock model categories Hammer++ shows, grouped by what they are."""
    from content import asset_catalog

    return asset_catalog(req)


@verb("material_preview")
def _material_preview(req: dict[str, Any]) -> dict[str, Any]:
    """The base texture of one material as a PNG the agent can look at."""
    from preview import material_preview

    return material_preview(req)


@verb("static_props")
def _static_props(req: dict[str, Any]) -> dict[str, Any]:
    """Static prop collision modes and missing .phy files."""
    from staticprops import static_props

    return static_props(req)


@verb("static_props_edit")
def _static_props_edit(req: dict[str, Any]) -> dict[str, Any]:
    """Edits or adds static props in a compiled BSP."""
    from staticprop_edit import static_props_edit

    return static_props_edit(req)


@verb("vmf_displacements")
def _vmf_displacements(req: dict[str, Any]) -> dict[str, Any]:
    """Displacements as srctools reads them -- the oracle for our own reader."""
    from displacements import vmf_displacements

    return vmf_displacements(req)


@verb("fgd_class")
def _fgd_class(req: dict[str, Any]) -> dict[str, Any]:
    """Describes one class as the game's own FGD declares it, or lists the classes."""
    from fgd_support import describe_class, load_fgds

    fgd, tolerated = load_fgds(req["binDir"], _fgd_names(req))
    name = req.get("classname")

    if not name:
        prefix = (req.get("prefix") or "").lower()
        search = (req.get("search") or "").strip().lower()
        names = [c for c in fgd.entities if c.lower().startswith(prefix)]
        if search:
            matched = []
            for classname in names:
                entity = fgd.entities[classname]
                fields = [classname, entity.desc or "", str(entity.type)]
                for key in entity.kv:
                    kv = entity.kv[key]
                    fields.append(getattr(kv, "name", None) or key)
                    fields.append(getattr(kv, "disp_name", "") or "")
                for key in entity.inp:
                    fields.append(getattr(entity.inp[key], "name", None) or key)
                for key in entity.out:
                    fields.append(getattr(entity.out[key], "name", None) or key)
                if any(search in field.lower() for field in fields):
                    matched.append(classname)
            names = matched
        names.sort()
        limit = int(req.get("limit", 200))
        return {
            "classCount": len(fgd.entities),
            "toleratedHelpers": tolerated,
            "classnames": names[:limit],
            "returned": min(len(names), limit),
            "matched": len(names),
            **({"search": search} if search else {}),
        }

    entity = fgd.entities.get(name)
    if entity is None:
        # Substring matching misses the mistake people actually make: a single wrong
        # letter. "prop_dynamik" contains no class as a substring and is contained by
        # none, yet it is one edit from prop_dynamic.
        import difflib

        near = difflib.get_close_matches(name, list(fgd.entities), n=8, cutoff=0.6)
        near += [c for c in sorted(fgd.entities) if name.lower() in c.lower() and c not in near]
        near = near[:10]
        raise KeyError(
            f"no class {name!r} in this FGD"
            + (f"; did you mean {', '.join(near)}?" if near else "")
        )
    return {
        "classCount": len(fgd.entities),
        "toleratedHelpers": tolerated,
        **describe_class(entity),
    }


@verb("fgd_autovisgroups")
def _fgd_autovisgroups(req: dict[str, Any]) -> dict[str, Any]:
    """Lists the FGD's `@AutoVisgroup` tree and the entities each group contains."""
    from fgd_support import load_fgds

    fgd, tolerated = load_fgds(req["binDir"], _fgd_names(req))
    groups = [
        {
            "name": group.name,
            "parent": group.parent or None,
            "entities": sorted(group.ents),
        }
        for group in fgd.auto_visgroups.values()
    ]
    groups.sort(key=lambda group: (group["parent"] or "", group["name"]))
    limit = int(req.get("limit", 500))
    return {
        "groupCount": len(groups),
        "toleratedHelpers": tolerated,
        "groups": groups[:limit],
        "returned": min(len(groups), limit),
        "truncated": len(groups) > limit,
    }


@verb("vmf_read")
def _vmf_read(req: dict[str, Any]) -> dict[str, Any]:
    """Entities, brushes and counts of a .vmf, without judging any of it."""
    from vmf_lint import count_vmf

    vmf, instances = _load_vmf(req["path"], req)
    limit = int(req.get("limit", 200))
    wanted = req.get("classname")

    entities = []
    for ent in vmf.entities:
        classname = ent["classname", ""]
        if wanted and classname != wanted:
            continue
        bounds = []
        for solid in ent.solids:
            try:
                lo, hi = solid.get_bbox()
                bounds.append({"lo": [float(lo.x), float(lo.y), float(lo.z)],
                               "hi": [float(hi.x), float(hi.y), float(hi.z)]})
            except Exception:  # noqa: BLE001
                continue
        entities.append(
            {
                "id": int(ent.id),
                "classname": classname,
                "targetname": ent["targetname", ""] or None,
                "origin": [float(v) for v in ent.get_origin()] if ent.is_brush() is False else None,
                "solidCount": len(list(ent.solids)),
                "solidBounds": bounds,
                "keyvalues": {k: str(v) for k, v in ent.items()},
                "outputs": [
                    {
                        "output": o.output,
                        "target": o.target,
                        "input": o.input,
                        "params": o.params,
                        "delay": o.delay,
                        "times": o.times,
                    }
                    for o in ent.outputs
                ],
            }
        )

    histogram: dict[str, int] = {}
    for ent in vmf.entities:
        c = ent["classname", ""]
        histogram[c] = histogram.get(c, 0) + 1

    return {
        "path": req["path"],
        "counts": count_vmf(vmf),
        "instances": instances,
        "histogram": dict(sorted(histogram.items(), key=lambda kv: -kv[1])),
        "matched": len(entities),
        "returned": min(len(entities), limit),
        "entities": entities[:limit],
    }


@verb("vmf_lint")
def _vmf_lint(req: dict[str, Any]) -> dict[str, Any]:
    """Checks a .vmf against the FGD and against what the compilers accept."""
    from fgd_support import load_fgds
    from vmf_lint import count_vmf, lint_vmf, model_bounds

    names = _fgd_names(req)
    fgd, tolerated = load_fgds(req["binDir"], names)
    vmf, instances = _load_vmf(req["path"], req)
    findings = lint_vmf(vmf, fgd, req.get("gameDir"))
    # Not a finding: the raw halves of one. Whether a prop sinks into the floor is a
    # question about the floor, and the tracer that answers it is in TypeScript.
    props = model_bounds(vmf, req.get("gameDir"))

    by_rule: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    for f in findings:
        by_rule[f["rule"]] = by_rule.get(f["rule"], 0) + 1
        by_severity[f["severity"]] = by_severity.get(f["severity"], 0) + 1

    limit = int(req.get("limit", 200))
    return {
        "path": req["path"],
        "counts": count_vmf(vmf),
        "props": props,
        "instances": instances,
        "toleratedHelpers": tolerated,
        "fgdsLoaded": list(names),
        "total": len(findings),
        "bySeverity": by_severity,
        "byRule": dict(sorted(by_rule.items(), key=lambda kv: -kv[1])),
        "returned": min(len(findings), limit),
        "findings": findings[:limit],
    }


def main() -> int:
    if len(sys.argv) < 2:
        json.dump({"error": {"kind": "usage", "message": "missing verb"}}, sys.stdout)
        return 1

    name = sys.argv[1]
    fn = VERBS.get(name)
    if fn is None:
        json.dump(
            {
                "error": {
                    "kind": "unknown_verb",
                    "message": f"unknown verb {name!r}",
                    "known": sorted(VERBS),
                }
            },
            sys.stdout,
        )
        return 1

    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        json.dump(
            {"error": {"kind": "bad_request", "message": f"stdin is not JSON: {exc}"}},
            sys.stdout,
        )
        return 1

    try:
        json.dump(fn(req), sys.stdout)
    except Exception as exc:  # noqa: BLE001 -- the boundary turns anything into JSON
        traceback.print_exc(file=sys.stderr)
        json.dump(
            {"error": {"kind": type(exc).__name__, "message": str(exc)}},
            sys.stdout,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
