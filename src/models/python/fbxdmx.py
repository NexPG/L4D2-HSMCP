"""FBX shape keys -> a DMX model source with Source flexes.

`studiomdl` cannot read an FBX, and an SMD has no morph target. The DMX path is the one the
compiler does understand: a DmeVertexDeltaData per shape, a DmeCombinationInputControl, and
the operator that pairs them; `flexdesc`, `flexcontroller` and `flexrule` are written without
a `$flex` command in the QC.

The graph itself lives in `dmxmodel.py`, shared with the glTF path. This module only turns
the FBX graph into that neutral data: the bound geometry, its loops and materials, the bind
skeleton, and the per-control-point deltas.

FBX shape keys are a second copy of the geometry, not a delta array. A `BlendShapeChannel`
owns one or more `Shape` geometries; each Shape's `Vertices` are the mesh in that expression
and its `Indexes` name the control points that moved. The delta is the difference between
that copy and the base mesh, in the same space, so the same mesh transform that places the
geometry also places the delta. A channel with several shapes is an in-between chain; this
path exports the shape with the largest `FullWeights` entry as the flex and names the
omission in `warnings`.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Sequence

from dmxmodel import DmxBone, DmxLoop, DmxMeshData, write_model_dmx
from modelmath import (
    mat3_normal,
    mat4_axis_scale,
    mat4_decompose,
    mat4_identity,
    mat4_inverse,
    mat4_mul,
    mat4_transform_direction,
    mat4_transform_point,
    normalize3,
)

from fbx import (
    FbxError,
    Scene,
    _bone_plan,
    _geometric_offset,
    _load,
    _mapping,
    _model_parent,
    _numbers,
    _object_name,
    _object_type,
    _polygons,
    _vertex_normals,
    _vertex_uvs,
)

_MAX_FLEX_DELTA = 8.0


def _diag(severity: str, rule: str, message: str) -> dict[str, Any]:
    return {"severity": severity, "rule": rule, "message": message}


def _safe_name(name: str, used: set[str]) -> str:
    import re

    base = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._-") or "shape"
    candidate = base
    suffix = 2
    while candidate.lower() in used:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used.add(candidate.lower())
    return candidate


def _shape_deltas(
    scene: Scene,
    geometry_id: int,
    base_positions: Sequence[float],
) -> tuple[dict[str, dict[int, tuple[float, float, float]]], list[str]]:
    """One delta map per BlendShapeChannel, keyed by control point index."""
    morphs: dict[str, dict[int, tuple[float, float, float]]] = {}
    notes: list[str] = []
    for blend_shape in scene.blend_shapes_of_geometry.get(geometry_id, []):
        for channel in scene.children.get(blend_shape, []):
            node = scene.objects.get(channel)
            if node is None or node.name != "Deformer" or _object_type(node) != "BlendShapeChannel":
                continue
            shapes = [
                child
                for child in scene.children.get(channel, [])
                if scene.objects.get(child) is not None
                and scene.objects[child].name == "Geometry"
            ]
            if not shapes:
                continue
            weights = _numbers(node.find("FullWeights"))
            chosen = max(
                range(len(shapes)),
                key=lambda index: weights[index] if index < len(weights) else 1.0,
            )
            if len(shapes) > 1:
                notes.append(
                    f"{_object_name(node)}: {len(shapes)} in-between shapes; each is exported "
                    "as its own flex, since Source flexes are one control each"
                )
            for shape_index, shape_id in enumerate(shapes):
                shape = scene.objects[shape_id]
                indices = _numbers(shape.find("Indexes"))
                vertices = _numbers(shape.find("Vertices"))
                if not indices or not vertices:
                    notes.append(
                        f"{_object_name(node)}: shape {shape_index + 1} has no "
                        "Indexes/Vertices; skipped"
                    )
                    continue
                deltas: dict[int, tuple[float, float, float]] = {}
                # Most exporters write one position per affected control point; a few write
                # the whole mesh. The lengths distinguish them.
                full = len(vertices) == len(base_positions)
                for slot, raw_index in enumerate(indices):
                    control = int(raw_index)
                    if control < 0 or control * 3 + 2 >= len(base_positions):
                        continue
                    if full:
                        offset = control * 3
                    else:
                        offset = slot * 3
                        if offset + 2 >= len(vertices):
                            continue
                    delta = (
                        vertices[offset] - base_positions[control * 3],
                        vertices[offset + 1] - base_positions[control * 3 + 1],
                        vertices[offset + 2] - base_positions[control * 3 + 2],
                    )
                    if any(abs(component) > 1e-9 for component in delta):
                        deltas[control] = delta
                if not deltas:
                    continue
                if shape_index == chosen:
                    name = _object_name(node)
                else:
                    weight = weights[shape_index] if shape_index < len(weights) else shape_index + 1
                    suffix = f"{weight:g}".replace(".", "_")
                    name = f"{_object_name(node)}_{suffix}"
                morphs[name] = deltas
    return morphs, notes


def fbx_to_dmx(req: dict[str, Any]) -> dict[str, Any]:
    source = Path(str(req.get("path", ""))).resolve()
    if not source.is_file():
        raise FbxError(f"{source} does not exist")
    root, version, fmt, diagnostics = _load(source)
    scene = Scene(root)

    axis_option = str(req.get("axis", "auto")).lower()
    if axis_option not in ("auto", "y", "z"):
        raise FbxError("axis must be 'auto', 'y' or 'z'")
    file_up = 1
    settings = root.find("GlobalSettings")
    if settings is not None:
        for entry in (settings.find("Properties70").all("P") if settings.find("Properties70") else []):
            if entry.props and str(entry.props[0]) == "UpAxis" and len(entry.props) >= 5:
                try:
                    file_up = int(entry.props[4])
                except (TypeError, ValueError):
                    file_up = 1
    axis_y = file_up == 1 if axis_option == "auto" else axis_option == "y"
    scale = float(req.get("scale", 1.0))
    if not math.isfinite(scale) or scale <= 0.0:
        raise FbxError("scale must be a positive finite number")
    flip_v = bool(req.get("flipV", True))
    use_transforms = bool(req.get("useNodeTransforms", True))
    fallback_material = str(req.get("material") or "debug/debugempty")
    include = [str(name).lower() for name in (req.get("models") or [])]

    mesh_models = [
        identifier
        for identifier in scene.models()
        if identifier in scene.geometry_of
        and (not include or scene.names[identifier].lower() in include)
    ]
    if not mesh_models:
        raise FbxError(
            f"{source}: no mesh model is selected"
            + (f" by models {include!r}" if include else " (no Model has a connected Geometry)")
        )

    plan = _bone_plan(scene, mesh_models, axis_y, scale, diagnostics)
    bone_order = plan["bone_order"]
    bone_names = plan["bone_names"]
    bone_parent = plan["bone_parent"]
    bone_of_model = plan["bone_of_model"]
    bind_world = plan["bind_world"]
    cluster_bone = plan["cluster_bone"]
    scene_matrix = plan["scene_matrix"]
    world = plan["world"]

    bones: list[DmxBone] = []
    for index, identifier in enumerate(bone_order):
        current = mat4_mul(scene_matrix, bind_world[identifier])
        parent = bone_parent[index]
        if parent is None:
            local = current
        else:
            inverse = mat4_inverse(mat4_mul(scene_matrix, bind_world[bone_order[parent]]))
            local = mat4_identity() if inverse is None else mat4_mul(inverse, current)
        translation, quaternion, _bone_scale, _mirrored = mat4_decompose(local)
        bones.append(
            DmxBone(
                bone_names[index],
                parent,
                translation,
                quaternion,
            )
        )

    mesh_data = DmxMeshData()
    used_morph_names: set[str] = set()
    triangle_count = 0
    skinned = False
    for model in mesh_models:
        geometry_id = scene.geometry_of[model]
        geometry = scene.objects[geometry_id]
        positions = _numbers(geometry.find("Vertices"))
        indices = _numbers(geometry.find("PolygonVertexIndex"))
        if not positions or not indices:
            diagnostics.append(
                _diag(
                    "warning",
                    "fbx-empty-geometry",
                    f"{scene.names[model]}: Vertices or PolygonVertexIndex is empty; skipped",
                )
            )
            continue

        mesh_world = mat4_mul(scene_matrix, world(model)) if use_transforms else scene_matrix
        mesh_world = mat4_mul(mesh_world, _geometric_offset(scene.objects[model]))
        normal_matrix = mat3_normal(mesh_world)
        position_base = len(mesh_data.positions)

        material_ids = scene.materials_of.get(model, [])
        material_names = [scene.material_name.get(identifier, "material") for identifier in material_ids]
        if not material_names:
            material_names = [fallback_material]
        for name in material_names:
            mesh_data.materials.setdefault(name, f"materials/{name}.vmt")

        normal_layer = geometry.find("LayerElementNormal")
        normal_mapping, normal_reference = _mapping(normal_layer)
        normals = _numbers(normal_layer.find("Normals")) if normal_layer else []
        normal_indices = _numbers(normal_layer.find("NormalsIndex")) if normal_layer else []
        uv_layer = geometry.find("LayerElementUV")
        uv_mapping, uv_reference = _mapping(uv_layer)
        uvs = _numbers(uv_layer.find("UV")) if uv_layer else []
        uv_indices = _numbers(uv_layer.find("UVIndex")) if uv_layer else []
        material_layer = geometry.find("LayerElementMaterial")
        material_mapping, _ = _mapping(material_layer)
        material_slots = _numbers(material_layer.find("Materials")) if material_layer else []

        weights: dict[int, list[dict[str, Any]]] = {}
        for skin_id, geometry_key in scene.skin_of_geometry.items():
            if geometry_key != geometry_id:
                continue
            skinned = True
            for cluster_id in scene.clusters_of_skin.get(skin_id, []):
                cluster = scene.objects.get(cluster_id)
                model_id = cluster_bone.get(cluster_id)
                if cluster is None or model_id is None or model_id not in bone_of_model:
                    continue
                bone = bone_of_model[model_id]
                cluster_indices = _numbers(cluster.find("Indexes"))
                cluster_weights = _numbers(cluster.find("Weights"))
                for slot, vertex_index in enumerate(cluster_indices):
                    if slot >= len(cluster_weights):
                        break
                    weight = float(cluster_weights[slot])
                    if weight <= 1e-6:
                        continue
                    weights.setdefault(int(vertex_index), []).append(
                        {"bone": bone, "weight": weight}
                    )

        fallback_bone = bone_of_model.get(model, 0)
        for vertex in range(len(positions) // 3):
            point = mat4_transform_point(
                mesh_world,
                (positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]),
            )
            mesh_data.positions.append(
                (round(point[0], 6), round(point[1], 6), round(point[2], 6))
            )
            links = weights.get(vertex)
            if not links:
                links = [{"bone": fallback_bone, "weight": 1.0}]
            else:
                total = sum(link["weight"] for link in links)
                links = (
                    [
                        {"bone": link["bone"], "weight": round(link["weight"] / total, 6)}
                        for link in links
                    ]
                    if total > 0.0
                    else links
                )
            mesh_data.position_links.append(links)

        morphs, morph_notes = _shape_deltas(scene, geometry_id, positions)
        for raw_name, deltas in morphs.items():
            name = _safe_name(raw_name, used_morph_names)
            transformed: dict[int, tuple[float, float, float]] = {}
            for control, delta in deltas.items():
                vector = mat4_transform_direction(mesh_world, delta)
                rounded = (
                    round(vector[0], 6),
                    round(vector[1], 6),
                    round(vector[2], 6),
                )
                if any(abs(component) > _MAX_FLEX_DELTA for component in rounded):
                    morph_notes.append(
                        f"{name}: a delta of {max(abs(c) for c in rounded)} exceeds Source's "
                        f"{_MAX_FLEX_DELTA}; studiomdl clamps it"
                    )
                transformed[control + position_base] = rounded
            if transformed:
                mesh_data.morphs[name] = transformed
                mesh_data.morph_order.append(name)
        mesh_data.morph_notes.extend(morph_notes)

        polygon_start = 0
        for polygon_index, polygon in enumerate(_polygons(indices)):
            slot = (
                int(material_slots[polygon_index])
                if polygon_index < len(material_slots) and material_mapping != "AllSame"
                else 0
            )
            material = material_names[slot] if 0 <= slot < len(material_names) else material_names[0]
            face = mesh_data.faces_by_material.setdefault(material, [])
            for corner in range(1, len(polygon) - 1):
                for offset, vertex in enumerate((polygon[0], polygon[corner], polygon[corner + 1])):
                    polygon_vertex = polygon_start + (0 if offset == 0 else corner + offset - 1)
                    if vertex < 0 or vertex * 3 + 2 >= len(positions):
                        raise FbxError(
                            f"{scene.names[model]}: vertex {vertex} is outside the "
                            f"{len(positions) // 3}-vertex Vertices array"
                        )
                    normal = _vertex_normals(
                        normals,
                        normal_indices,
                        normal_mapping,
                        normal_reference,
                        polygon_vertex,
                        vertex,
                        (0.0, 0.0, 1.0),
                    )
                    normal = (
                        normal_matrix[0][0] * normal[0]
                        + normal_matrix[0][1] * normal[1]
                        + normal_matrix[0][2] * normal[2],
                        normal_matrix[1][0] * normal[0]
                        + normal_matrix[1][1] * normal[1]
                        + normal_matrix[1][2] * normal[2],
                        normal_matrix[2][0] * normal[0]
                        + normal_matrix[2][1] * normal[1]
                        + normal_matrix[2][2] * normal[2],
                    )
                    normal = normalize3(normal)
                    u, v = _vertex_uvs(
                        uvs, uv_indices, uv_mapping, uv_reference, polygon_vertex, vertex
                    )
                    if flip_v:
                        v = 1.0 - v
                    face.append(len(mesh_data.loops))
                    mesh_data.loops.append(
                        DmxLoop(
                            position=position_base + vertex,
                            normal=tuple(round(component, 6) for component in normal),
                            uv=(round(u, 6), round(v, 6)),
                        )
                    )
                face.append(-1)
                triangle_count += 1
            polygon_start += len(polygon)

    if triangle_count == 0:
        raise FbxError(f"{source}: no triangles were produced; see diagnostics")

    output = Path(str(req.get("out", "") or req.get("output", ""))).resolve()
    if output.suffix.lower() != ".dmx":
        output = output.with_suffix(".dmx")
    try:
        written = write_model_dmx(
            output,
            bones,
            mesh_data,
            overwrite=bool(req.get("overwrite", False)),
        )
    except ValueError as error:
        raise FbxError(str(error)) from error
    diagnostics.extend(
        _diag("warning", "fbx-dmx", message) for message in written.get("warnings", [])
    )
    if not mesh_data.morph_order:
        diagnostics.append(
            _diag(
                "info",
                "fbx-no-blend-shapes",
                "no BlendShapeChannel produced a delta; the DMX has geometry and a skeleton "
                "but no flex",
            )
        )

    return {
        "path": str(output),
        "written": True,
        "source": str(source),
        "format": "dmx",
        "encoding": "binary",
        "encodingVersion": 4,
        "formatVersion": 15,
        "triangles": triangle_count,
        "vertices": len(mesh_data.loops),
        "positions": len(mesh_data.positions),
        "materials": [
            {"name": name, "mtlName": mesh_data.materials[name], "faceSets": 1}
            for name in mesh_data.faces_by_material
        ],
        "morphTargets": [
            {
                "name": name,
                "deltas": len(mesh_data.morphs[name]),
                "maxDelta": round(
                    max(
                        (abs(component) for delta in mesh_data.morphs[name].values() for component in delta),
                        default=0.0,
                    ),
                    4,
                ),
            }
            for name in mesh_data.morph_order
        ],
        "morphTargetCount": len(mesh_data.morph_order),
        "boneCount": len(bones),
        "skinned": skinned,
        "warnings": list(dict.fromkeys(written.get("warnings", []))),
        "diagnostics": diagnostics,
        "verified": written["verified"],
        "note": (
            "A DMX model with shape keys. L4D2's studiomdl reads it directly and writes "
            "flexdesc/controller/rule records; the QC needs no $flex command. One body with "
            "face sets per material; animations are not written (use fbx_to_smd). A channel "
            "with several in-between shapes exports the largest weight only."
        ),
    }
