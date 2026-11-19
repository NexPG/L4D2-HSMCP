"""SMD: the text model source studiomdl compiles, read and written here.

A QC names an SMD per body part and sequence; the SMD holds the skeleton, the frames and
the triangles. `read_qc` could already tell an agent that `$body "studio" "crate.smd"`
points at a file, and `run_studiomdl` could compile it, but nothing could see inside the
file or create one. That made "make a prop from scratch" impossible without Blender.

The format is line-oriented and small enough to own:

    version 1
    nodes
    0 "root" -1
    ...
    end
    skeleton
    time 0
    0 0 0 0  0 0 0
    ...
    end
    triangles
    material
    0 x y z nx ny nz u v  1 0 1.0
    ... (three vertex lines per triangle)
    end

Two decisions are deliberate. Parsing is permissive about whitespace and comments because
exports from different tools differ, but it is strict about what it *reports*: an unknown
bone, a weight that does not sum to one or a triangle with two vertices is a diagnostic,
not a silent repair. Writing is canonical so two exporters of the same scene produce
diffable files.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

_SEVERITY_ERROR = "error"
_SEVERITY_WARNING = "warning"


def _diag(severity: str, rule: str, message: str, line: int | None = None) -> dict[str, Any]:
    return {"severity": severity, "rule": rule, "message": message, "line": line}


def _number(token: str) -> float:
    return float(token)


def _parse(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()

    diagnostics: list[dict[str, Any]] = []
    version: int | None = None
    nodes: list[dict[str, Any]] = []
    frames: list[dict[str, Any]] = []
    triangles: list[dict[str, Any]] = []
    materials: dict[str, int] = {}

    section: str | None = None
    current_material: str | None = None
    pending: list[dict[str, Any]] = []
    current_time = 0.0
    node_ids: dict[int, str] = {}
    seen_ids: set[int] = set()

    for index, raw in enumerate(lines, start=1):
        line = raw.split("//", 1)[0].strip()
        if not line:
            continue

        head = line.split(None, 1)[0]
        if head == "version" and section is None:
            try:
                version = int(line.split(None, 1)[1])
            except (IndexError, ValueError):
                diagnostics.append(_diag(_SEVERITY_ERROR, "version", "version is not a number", index))
                version = 0
            continue
        if head in {"nodes", "skeleton", "triangles"} and section is None:
            section = head
            current_material = None
            pending = []
            continue
        if head == "end" and section is not None:
            if section == "triangles" and pending:
                diagnostics.append(
                    _diag(
                        _SEVERITY_ERROR,
                        "triangle-incomplete",
                        f"material {current_material!r} ends with {len(pending)} loose vertices; "
                        "a triangle needs three",
                        index,
                    )
                )
                pending = []
            section = None
            current_material = None
            continue

        if section == "nodes":
            # id "name" parent
            parts = line.split(None, 2)
            if len(parts) < 3:
                diagnostics.append(_diag(_SEVERITY_ERROR, "node", "node line needs id, name and parent", index))
                continue
            try:
                node_id = int(parts[0])
            except ValueError:
                diagnostics.append(_diag(_SEVERITY_ERROR, "node", f"node id {parts[0]!r} is not an integer", index))
                continue
            name = parts[1]
            if name.startswith('"') and name.endswith('"') and len(name) >= 2:
                name = name[1:-1]
            try:
                parent = int(parts[2])
            except ValueError:
                diagnostics.append(_diag(_SEVERITY_ERROR, "node", f"parent of {name!r} is not an integer", index))
                continue
            if node_id in seen_ids:
                diagnostics.append(_diag(_SEVERITY_ERROR, "node-duplicate", f"node id {node_id} appears twice", index))
            seen_ids.add(node_id)
            node_ids[node_id] = name
            nodes.append({"id": node_id, "name": name, "parent": parent})
            continue

        if section == "skeleton":
            tokens = line.split()
            if head == "time":
                try:
                    current_time = float(tokens[1])
                except (IndexError, ValueError):
                    diagnostics.append(_diag(_SEVERITY_ERROR, "time", "time is not a number", index))
                    current_time = 0.0
                continue
            if len(tokens) < 7:
                diagnostics.append(_diag(_SEVERITY_ERROR, "frame", "a bone line needs id, 3 position and 3 rotation numbers", index))
                continue
            try:
                bone = int(tokens[0])
                values = [float(v) for v in tokens[1:7]]
            except ValueError:
                diagnostics.append(_diag(_SEVERITY_ERROR, "frame", "bone line has a non-numeric field", index))
                continue
            frames.append(
                {
                    "time": current_time,
                    "bone": bone,
                    "position": values[0:3],
                    "rotation": values[3:6],
                }
            )
            continue

        if section == "triangles":
            tokens = line.split()
            # A vertex starts with an integer bone and has at least nine fields:
            # bone, position(3), normal(3), uv(2). A material line starts with a name.
            is_vertex = False
            if len(tokens) >= 9:
                try:
                    int(tokens[0])
                    [float(v) for v in tokens[1:9]]
                    is_vertex = True
                except ValueError:
                    is_vertex = False
            if not is_vertex:
                if pending:
                    diagnostics.append(
                        _diag(
                            _SEVERITY_ERROR,
                            "triangle-incomplete",
                            f"material {current_material!r} has {len(pending)} loose vertices before "
                            f"the next material; a triangle needs three",
                            index,
                        )
                    )
                    pending = []
                current_material = line.strip().strip('"')
                materials.setdefault(current_material, 0)
                continue

            try:
                parent = int(tokens[0])
                position = [float(v) for v in tokens[1:4]]
                normal = [float(v) for v in tokens[4:7]]
                uv = [float(v) for v in tokens[7:9]]
            except ValueError:
                diagnostics.append(_diag(_SEVERITY_ERROR, "vertex", "vertex has a non-numeric field", index))
                continue

            rest = tokens[9:]
            links: list[dict[str, float]] = []
            if rest:
                try:
                    count = int(rest[0])
                except ValueError:
                    diagnostics.append(_diag(_SEVERITY_ERROR, "links", "link count is not an integer", index))
                    count = 0
                pairs = rest[1:]
                if len(pairs) < count * 2:
                    diagnostics.append(
                        _diag(
                            _SEVERITY_ERROR,
                            "links",
                            f"vertex claims {count} links but only {len(pairs) // 2} pairs follow",
                            index,
                        )
                    )
                for i in range(min(count, len(pairs) // 2)):
                    try:
                        links.append({"bone": int(pairs[i * 2]), "weight": float(pairs[i * 2 + 1])})
                    except ValueError:
                        diagnostics.append(_diag(_SEVERITY_ERROR, "links", "link pair is not numeric", index))
                        break
            if not links:
                links = [{"bone": parent, "weight": 1.0}]

            total = sum(link["weight"] for link in links)
            if abs(total - 1.0) > 1e-3:
                diagnostics.append(
                    _diag(
                        _SEVERITY_WARNING,
                        "weight-sum",
                        f"vertex weights sum to {total:.4f}, not 1.0, on line {index}",
                        index,
                    )
                )
            for link in links:
                if int(link["bone"]) not in node_ids:
                    diagnostics.append(
                        _diag(
                            _SEVERITY_WARNING,
                            "bone-unknown",
                            f"vertex references bone {int(link['bone'])}, which no node declares",
                            index,
                        )
                    )

            pending.append(
                {
                    "parent": parent,
                    "position": position,
                    "normal": normal,
                    "uv": uv,
                    "links": links,
                }
            )
            if current_material is None:
                current_material = ""
                materials.setdefault("", 0)
            if len(pending) == 3:
                triangles.append({"material": current_material, "vertices": pending})
                materials[current_material] = materials.get(current_material, 0) + 1
                pending = []
            continue

        diagnostics.append(_diag(_SEVERITY_WARNING, "stray", f"line outside any section: {line[:80]!r}", index))

    if section is not None:
        diagnostics.append(_diag(_SEVERITY_ERROR, "unterminated", f"{section} has no end", None))
    if version is None:
        diagnostics.append(_diag(_SEVERITY_ERROR, "version", "no version line", None))
    if not nodes:
        diagnostics.append(_diag(_SEVERITY_ERROR, "no-nodes", "no nodes; studiomdl needs a skeleton", None))
    if not triangles:
        diagnostics.append(_diag(_SEVERITY_WARNING, "no-triangles", "no triangles; the model would be empty", None))

    for node in nodes:
        if node["parent"] != -1 and node["parent"] not in node_ids:
            diagnostics.append(
                _diag(
                    _SEVERITY_ERROR,
                    "parent-unknown",
                    f"node {node['name']!r} has parent {node['parent']}, which does not exist",
                    None,
                )
            )
    if nodes and not any(node["parent"] == -1 for node in nodes):
        diagnostics.append(
            _diag(_SEVERITY_ERROR, "no-root", "no node has parent -1, so there is no root bone", None)
        )

    positions = [v["position"] for tri in triangles for v in tri["vertices"]]
    mins = [min(p[i] for p in positions) for i in range(3)] if positions else None
    maxs = [max(p[i] for p in positions) for i in range(3)] if positions else None

    times = sorted({frame["time"] for frame in frames})
    return {
        "path": str(path),
        "read": True,
        "version": version,
        "nodes": nodes,
        "bones": [node["name"] for node in nodes],
        "boneCount": len(nodes),
        "frameLines": len(frames),
        "frameTimes": times,
        "frameCount": len(times),
        "triangles": triangles,
        "triangleCount": len(triangles),
        "vertexCount": len(triangles) * 3,
        "materials": [
            {"name": name, "triangles": count}
            for name, count in sorted(materials.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "mins": mins,
        "maxs": maxs,
        "size": [round(maxs[i] - mins[i], 6) for i in range(3)] if mins and maxs else None,
        "diagnostics": diagnostics,
        "ok": not any(d["severity"] == _SEVERITY_ERROR for d in diagnostics),
    }


def smd_read(req: dict[str, Any]) -> dict[str, Any]:
    """Reads an SMD; `includeTriangles` decides whether every vertex is returned."""
    path = Path(str(req.get("path", ""))).resolve()
    if not path.is_file():
        return {"path": str(path), "read": False, "readError": "file does not exist"}
    result = _parse(path)
    include = bool(req.get("includeTriangles", False))
    total = len(result["triangles"])
    if include:
        limit = max(1, min(int(req.get("limit", 5000)), 50_000))
        result["triangles"] = result["triangles"][:limit]
        result["truncated"] = total > limit
    else:
        result.pop("triangles", None)
        result["trianglesOmitted"] = total
    result["note"] = (
        "Positions and normals are in the SMD's own space; a QC $scale or a bone offset "
        "moves what the engine sees. 'links' is the per-vertex bone weighting: a weight "
        "that does not sum to 1 is reported, because studiomdl accepts it and the vertex "
        "then behaves unlike either bone."
    )
    return result


def _format_float(value: float) -> str:
    return f"{float(value):.6f}"


def smd_write(req: dict[str, Any]) -> dict[str, Any]:
    """Builds an SMD from JSON, then reads it back and returns what the parser saw."""
    path = Path(str(req.get("path", ""))).resolve()
    nodes = req.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("nodes must be a non-empty list of {name, parent?}")

    ids: dict[str, int] = {}
    resolved: list[dict[str, Any]] = []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict) or not node.get("name"):
            raise ValueError(f"node {index} needs a name")
        name = str(node["name"])
        if name in ids:
            raise ValueError(f"node name {name!r} appears twice")
        ids[name] = index
        resolved.append({"id": index, "name": name, "parent": node.get("parent")})

    for node in resolved:
        parent = node["parent"]
        if parent is None or parent == -1:
            node["parent"] = -1
        elif isinstance(parent, str):
            if parent not in ids:
                raise ValueError(f"node {node['name']!r} has unknown parent {parent!r}")
            node["parent"] = ids[parent]
        else:
            node["parent"] = int(parent)

    frames = req.get("frames")
    if frames is None:
        frames = [{"time": 0.0, "bones": [{"bone": 0, "position": [0, 0, 0], "rotation": [0, 0, 0]}]}]
    if not isinstance(frames, list) or not frames:
        raise ValueError("frames must be a non-empty list")

    triangles = req.get("triangles")
    allow_empty = bool(req.get("allowEmptyTriangles", False))
    if triangles is None:
        triangles = []
    if not isinstance(triangles, list):
        raise ValueError("triangles must be a list of {material, vertices}")
    if not triangles and not allow_empty:
        raise ValueError(
            "triangles must be a non-empty list of {material, vertices}; pass "
            "allowEmptyTriangles:true only for an animation SMD, which carries frames and no mesh"
        )

    lines: list[str] = ["version 1", "nodes"]
    for node in resolved:
        lines.append(f'{node["id"]} "{node["name"]}" {node["parent"]}')
    lines.append("end")
    lines.append("skeleton")
    for frame in frames:
        lines.append(f'time {_format_float(frame.get("time", 0.0))}')
        for bone in frame.get("bones", []):
            position = [float(v) for v in bone.get("position", [0, 0, 0])]
            rotation = [float(v) for v in bone.get("rotation", [0, 0, 0])]
            if len(position) != 3 or len(rotation) != 3:
                raise ValueError("a frame bone needs 3 position and 3 rotation numbers")
            lines.append(
                " ".join(
                    [str(int(bone.get("bone", 0)))]
                    + [_format_float(v) for v in position]
                    + [_format_float(v) for v in rotation]
                )
            )
    lines.append("end")
    lines.append("triangles")
    for index, triangle in enumerate(triangles):
        if not isinstance(triangle, dict):
            raise ValueError(f"triangle {index} must be an object")
        material = str(triangle.get("material", ""))
        vertices = triangle.get("vertices")
        if not isinstance(vertices, list) or len(vertices) != 3:
            raise ValueError(f"triangle {index} needs exactly 3 vertices, got {len(vertices or [])}")
        lines.append(material)
        for vertex in vertices:
            position = [float(v) for v in vertex.get("position", [0, 0, 0])]
            normal = [float(v) for v in vertex.get("normal", [0, 0, 1])]
            uv = [float(v) for v in vertex.get("uv", [0, 0])]
            if len(position) != 3 or len(normal) != 3 or len(uv) != 2:
                raise ValueError(f"triangle {index}: a vertex needs 3 position, 3 normal and 2 uv numbers")
            links = vertex.get("links")
            if links is None:
                links = [{"bone": int(vertex.get("parent", 0)), "weight": 1.0}]
            if not links:
                raise ValueError(f"triangle {index}: a vertex needs at least one bone link")
            parent = int(links[0]["bone"])
            fields = (
                [str(parent)]
                + [_format_float(v) for v in position]
                + [_format_float(v) for v in normal]
                + [_format_float(v) for v in uv]
                + [str(len(links))]
            )
            for link in links:
                fields.append(str(int(link["bone"])))
                fields.append(_format_float(link["weight"]))
            lines.append(" ".join(fields))
    lines.append("end")

    text = "\n".join(lines) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")

    parsed = _parse(path)
    return {
        "path": str(path),
        "written": True,
        "bytes": len(text.encode("utf-8")),
        "boneCount": parsed["boneCount"],
        "triangleCount": parsed["triangleCount"],
        "materials": parsed["materials"],
        "diagnostics": parsed["diagnostics"],
        "verified": parsed["ok"],
    }
