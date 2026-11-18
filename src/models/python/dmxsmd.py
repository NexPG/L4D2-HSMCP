"""DMX mesh → SMD, for the static prop path.

An artist exports a `.dmx`; `studiomdl` wants `.smd`. The datamodel reader could only show
the tree. This walks the DmeMesh/DmeVertexData/DmeFaceSet graph, applies the DAG transform,
triangulates the polygons, and writes an SMD through the same writer `write_smd` uses.

**Static only, and it says so.** Every vertex is weighted to one root bone. A mesh with an
armature compiles and then does not deform; that is a warning in the result, not a silent
surprise. Skeletal conversion needs the joint hierarchy, bind-pose transforms and weight
expansion, and a wrong Euler/quaternion convention produces a model that compiles sideways —
so it is a separate task with its own probe, not a flag on this one.

Face sets are polygon lists terminated by `-1` (`0 1 2 3 -1`), and are fan-triangulated in
their written order. `flipVCoordinates` is honoured: BlenderSourceTools writes `1`, and the
SMD UV then matches the DMX.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any


def _children(element: Any) -> list[Any]:
    out: list[Any] = []
    for attr in element.values():
        if attr.type.value != "element":
            continue
        for child in attr.iter_elem():
            if not getattr(child, "is_stub", False) and not getattr(child, "is_null", False):
                out.append(child)
    return out


def _collect(root: Any) -> list[Any]:
    seen: set[str] = set()
    out: list[Any] = []
    stack = [root]
    while stack:
        element = stack.pop()
        key = str(element.uuid)
        if key in seen:
            continue
        seen.add(key)
        out.append(element)
        stack.extend(_children(element))
    return out


def _attribute(element: Any, name: str) -> Any | None:
    try:
        return element[name]
    except Exception:  # noqa: BLE001 -- missing attribute is normal
        return None


def _scalar(element: Any, name: str, default: Any) -> Any:
    attr = _attribute(element, name)
    if attr is None or attr.is_array:
        return default
    try:
        return attr.val_bool if attr.type.value == "bool" else attr.val_int
    except Exception:  # noqa: BLE001
        return default


def _array(element: Any, name: str, kind: str) -> list[Any]:
    attr = _attribute(element, name)
    if attr is None or not attr.is_array:
        return []
    if kind == "vec3":
        return [tuple(float(v) for v in item) for item in attr.iter_vec3()]
    if kind == "vec2":
        return [tuple(float(v) for v in item) for item in attr.iter_vec2()]
    if kind == "int":
        return [int(v) for v in attr.iter_int()]
    if kind == "float":
        return [float(v) for v in attr.iter_float()]
    return []


def _element_ref(element: Any, name: str) -> Any | None:
    attr = _attribute(element, name)
    if attr is None or attr.is_array or attr.type.value != "element":
        return None
    try:
        return attr.val_elem
    except Exception:  # noqa: BLE001
        return None


def _rotate(quat: tuple[float, float, float, float], vector: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z, w = quat
    vx, vy, vz = vector
    # t = 2 * (q.xyz × v); v' = v + w*t + q.xyz × t
    tx = 2.0 * (y * vz - z * vy)
    ty = 2.0 * (z * vx - x * vz)
    tz = 2.0 * (x * vy - y * vx)
    return (
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    )


def _transform(element: Any) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
    transform = _element_ref(element, "transform")
    if transform is None:
        return (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)
    position = _attribute(transform, "position")
    orientation = _attribute(transform, "orientation")
    offset = (0.0, 0.0, 0.0)
    quat = (0.0, 0.0, 0.0, 1.0)
    try:
        if position is not None and not position.is_array:
            offset = tuple(float(v) for v in position.val_vec3)
    except Exception:  # noqa: BLE001
        pass
    try:
        if orientation is not None and not orientation.is_array:
            quat = tuple(float(v) for v in orientation.val_quaternion)
    except Exception:  # noqa: BLE001
        pass
    return offset, quat


def _compose(
    parent_offset: tuple[float, float, float],
    parent_quat: tuple[float, float, float, float],
    child_offset: tuple[float, float, float],
    child_quat: tuple[float, float, float, float],
) -> tuple[tuple[float, float, float], tuple[float, float, float, float]]:
    rotated = _rotate(parent_quat, child_offset)
    offset = tuple(parent_offset[i] + rotated[i] for i in range(3))
    # q = parent * child
    px, py, pz, pw = parent_quat
    cx, cy, cz, cw = child_quat
    quat = (
        pw * cx + px * cw + py * cz - pz * cy,
        pw * cy - px * cz + py * cw + pz * cx,
        pw * cz + px * cy - py * cx + pz * cw,
        pw * cw - px * cx - py * cy - pz * cz,
    )
    length = math.sqrt(sum(v * v for v in quat)) or 1.0
    return offset, tuple(v / length for v in quat)


def _mesh_transforms(model: Any) -> dict[str, tuple[tuple[float, float, float], tuple[float, float, float, float]]]:
    out: dict[str, tuple[tuple[float, float, float], tuple[float, float, float, float]]] = {}

    def walk(element: Any, offset: tuple[float, float, float], quat: tuple[float, float, float, float], depth: int) -> None:
        if depth > 64:
            return
        for child in _children(element):
            child_offset, child_quat = _transform(child)
            resolved = _compose(offset, quat, child_offset, child_quat)
            out[str(child.uuid)] = resolved
            walk(child, *resolved, depth + 1)

    walk(model, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0), 0)
    return out


def _material_name(face_set: Any, fallback: str) -> str:
    material = _element_ref(face_set, "material")
    name = fallback
    if material is not None:
        attr = _attribute(material, "mtlname")
        if attr is not None and not attr.is_array and attr.type.value == "string":
            name = attr.val_string
        else:
            attr = _attribute(material, "name")
            if attr is not None and not attr.is_array and attr.type.value == "string":
                name = attr.val_string
    name = re.sub(r"^materials[\\/]", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\.vmt$", "", name, flags=re.IGNORECASE)
    return name.replace("\\", "/")


def dmx_to_smd(req: dict[str, Any]) -> dict[str, Any]:
    from srctools.dmx import Element

    from smd import smd_write

    source = Path(str(req.get("path", ""))).resolve()
    if not source.is_file():
        raise ValueError(f"{source} does not exist")
    with source.open("rb") as fh:
        root, _fmt, _version = Element.parse(fh)

    elements = _collect(root)
    meshes = [element for element in elements if element.type == "DmeMesh"]
    if not meshes:
        raise ValueError(f"{source}: no DmeMesh; this is not a model export")
    model = next((e for e in elements if e.type == "DmeModel"), root)
    transforms = _mesh_transforms(model)
    scale = float(req.get("scale", 1.0))
    if scale <= 0:
        raise ValueError("scale must be positive")
    flip_override = req.get("flipV")

    warnings: list[str] = []
    triangles: list[dict[str, Any]] = []
    materials: dict[str, int] = {}
    used_meshes = 0
    applied_transforms = 0

    for mesh in meshes:
        visible = _scalar(mesh, "visible", 1) != 0
        if not visible:
            continue
        vertex_data = _element_ref(mesh, "currentstate") or _element_ref(mesh, "bindstate")
        if vertex_data is None:
            warnings.append(f"{mesh.name}: no currentState/bindState; skipped")
            continue
        positions = _array(vertex_data, "positions", "vec3")
        if not positions:
            warnings.append(f"{mesh.name}: no positions; skipped")
            continue
        position_indices = _array(vertex_data, "positionsindices", "int")
        if not position_indices:
            position_indices = list(range(len(positions)))
        normals = _array(vertex_data, "normals", "vec3")
        normal_indices = _array(vertex_data, "normalsindices", "int")
        uvs = _array(vertex_data, "texturecoordinates", "vec2")
        uv_indices = _array(vertex_data, "texturecoordinatesindices", "int")
        flip_v = bool(_scalar(vertex_data, "flipvcoordinates", 0))
        if flip_override is not None:
            flip_v = bool(flip_override)
        joint_count = _scalar(vertex_data, "jointcount", 1)

        offset, quat = transforms.get(str(mesh.uuid), ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)))
        if offset != (0.0, 0.0, 0.0) or quat != (0.0, 0.0, 0.0, 1.0):
            applied_transforms += 1
        if int(joint_count) > 1:
            warnings.append(
                f"{mesh.name}: {joint_count} joints; every vertex is weighted to the root "
                "(static conversion)"
            )

        face_sets = [
            child for child in _children(mesh) if child.type == "DmeFaceSet"
        ]
        if not face_sets:
            warnings.append(f"{mesh.name}: no face sets; skipped")
            continue

        def corner(loop: int) -> dict[str, Any] | None:
            if loop < 0 or loop >= len(position_indices):
                return None
            position_index = position_indices[loop]
            if position_index < 0 or position_index >= len(positions):
                return None
            raw = positions[position_index]
            rotated = _rotate(quat, raw)
            position = [round((rotated[i] + offset[i]) * scale, 6) for i in range(3)]

            if normals:
                ni = normal_indices[loop] if loop < len(normal_indices) else loop
                normal = _rotate(quat, normals[ni]) if 0 <= ni < len(normals) else (0.0, 0.0, 1.0)
            else:
                normal = (0.0, 0.0, 1.0)

            if uvs:
                ui = uv_indices[loop] if loop < len(uv_indices) else loop
                uv = uvs[ui] if 0 <= ui < len(uvs) else (0.0, 0.0)
            else:
                uv = (0.0, 0.0)
            if flip_v:
                uv = (uv[0], 1.0 - uv[1])

            return {
                "position": position,
                "normal": [round(v, 6) for v in normal],
                "uv": [round(float(uv[0]), 6), round(float(uv[1]), 6)],
                "links": [{"bone": 0, "weight": 1.0}],
            }

        for face_set in face_sets:
            faces = _array(face_set, "faces", "int")
            if not faces:
                continue
            material = _material_name(face_set, face_set.name)
            groups: list[list[int]] = []
            current: list[int] = []
            for index in faces:
                if index == -1:
                    if current:
                        groups.append(current)
                        current = []
                else:
                    current.append(index)
            if current:
                groups.append(current)
            if len(groups) == 1 and len(groups[0]) % 3 == 0 and len(groups[0]) > 3:
                # Some exporters omit the -1 terminator and write plain triangles.
                flat = groups[0]
                groups = [flat[i : i + 3] for i in range(0, len(flat), 3)]

            for group in groups:
                if len(group) < 3:
                    warnings.append(f"{mesh.name}/{material}: polygon with {len(group)} vertices ignored")
                    continue
                for k in range(1, len(group) - 1):
                    corners = [corner(group[0]), corner(group[k]), corner(group[k + 1])]
                    if any(c is None for c in corners):
                        warnings.append(f"{mesh.name}/{material}: face index outside the vertex data")
                        continue
                    triangles.append({"material": material, "vertices": corners})
                    materials[material] = materials.get(material, 0) + 1
        used_meshes += 1

    if not triangles:
        raise ValueError(f"{source}: no triangles were produced; see warnings")

    out = Path(str(req.get("out", "") or req.get("output", ""))).resolve()
    if out.suffix.lower() != ".smd":
        out = out.with_suffix(".smd")
    written = smd_write(
        {
            "path": str(out),
            "nodes": [{"name": "root", "parent": None}],
            "triangles": triangles,
        }
    )

    positions = [v["position"] for tri in triangles for v in tri["vertices"]]
    mins = [min(p[i] for p in positions) for i in range(3)]
    maxs = [max(p[i] for p in positions) for i in range(3)]
    return {
        "path": str(out),
        "written": True,
        "source": str(source),
        "meshes": used_meshes,
        "triangles": len(triangles),
        "vertices": len(triangles) * 3,
        "materials": [
            {"name": name, "triangles": count}
            for name, count in sorted(materials.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "mins": [round(v, 3) for v in mins],
        "maxs": [round(v, 3) for v in maxs],
        "appliedTransforms": applied_transforms,
        "warnings": warnings,
        "diagnostics": written.get("diagnostics", []),
        "verified": bool(written.get("verified")),
        "note": (
            "Static conversion: one root bone, every vertex weight 1. The DAG transform and "
            "flipVCoordinates are applied; skin weights are not. A model with an armature "
            "needs Blender's SMD export until skeletal conversion has its own probe."
        ),
    }
