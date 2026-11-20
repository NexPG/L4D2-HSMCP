"""glTF shape keys -> a DMX model source with flexes.

`studiomdl` does not read glTF, but L4D2's DMX importer does read shape keys and turns them
into flex descriptors, controllers and rules without a single `$flex` command in the QC.
The probe in this project compiled BlenderSourceTools' `blender_shapes.dmx` to
`flexdesc=2, controllers=2, rules=2`; this module writes the same graph from a glTF.

The important detail, found by A/B compiling: `DmeMesh.deltaStateWeights` and
`deltaStateWeightsLagged` must have one `(0, 0)` per control. With empty arrays the compiler
still reports the flex payload but writes `flexrules=0`, so the flex is not driven; with the
weights it writes one rule per control. `controlValues`/`controlValuesLagged` are the
BlenderSourceTools `(0, 0, 0.5)` triple per control.

What is written:

* the bind skeleton, with local positions and quaternions (a DMX `DmeTransform` has no
  scale, so a non-unit bone scale is reported and dropped, exactly as in the SMD path);
* one `DmeMesh` with a position table, per-loop normals/UVs, face sets per material and
  per-position weights;
* one `DmeVertexDeltaData` per glTF morph target, with position deltas only (the format
  permits empty normal arrays, and the fixture proves it compiles);
* one `DmeCombinationInputControl` and the operator that pairs them.

Animations are not written here: the SMD path already produces one animation SMD per
animation. A DMX can carry animation logs too, but that is a separate piece of work.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any, Sequence

from dmxmodel import (
    DmxBone,
    DmxLoop,
    DmxMeshData,
    write_model_dmx,
)
from modelmath import (
    Mat4,
    mat3_normal,
    mat4_axis_scale,
    mat4_decompose,
    mat4_inverse,
    mat4_mul,
    mat4_transform_direction,
    mat4_transform_point,
)

from gltf import (
    GltfError,
    _animation_targets,
    _bind_worlds,
    _indices,
    _instances,
    _kept_nodes,
    _load_document,
    _material_name,
    _parent_table,
    _scene_roots,
    _triangle_count,
    _triangles,
    _unique_names,
    _vector2,
    _vector3,
    _vector4,
    _world_matrices,
)

_SEVERITY_WARNING = "warning"
_MAX_FLEX_DELTA = 8.0  # studiomdl clamps a vertanim component beyond this


def _diag(severity: str, rule: str, message: str) -> dict[str, Any]:
    return {"severity": severity, "rule": rule, "message": message}


def _safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._-")
    return cleaned or "shape"


def _translation_and_quaternion(local: Mat4) -> tuple[tuple[float, float, float], tuple[float, float, float, float], bool]:
    translation, quaternion, scale, mirrored = mat4_decompose(local)
    return translation, quaternion, mirrored or any(abs(value - 1.0) > 1e-3 for value in scale)


def gltf_to_dmx(req: dict[str, Any]) -> dict[str, Any]:

    source = Path(str(req.get("path", ""))).resolve()
    if not source.is_file():
        raise GltfError(f"{source} does not exist")
    document, buffers, diagnostics, fmt = _load_document(source, strict=True)

    axis = str(req.get("axis", "z")).lower()
    if axis in {"y", "yup", "y-up"}:
        axis_y = True
    elif axis in {"z", "zup", "z-up"}:
        axis_y = False
    else:
        raise GltfError(f"axis {axis!r} is not 'z' or 'y'")
    scale = float(req.get("scale", 1.0))
    if not math.isfinite(scale) or scale <= 0.0:
        raise GltfError("scale must be a positive finite number")
    use_transforms = bool(req.get("useNodeTransforms", False))
    flip_v = bool(req.get("flipV", True))
    fallback_material = str(req.get("material") or "debug/debugempty")
    parts = [str(part) for part in (req.get("parts") or [])]

    parents = _parent_table(document)
    roots = _scene_roots(document, parents)
    instances = _instances(document, parts)
    if not instances:
        raise GltfError(
            f"{source}: no mesh is selected"
            + (f" by parts {parts!r}" if parts else " (the file has no mesh-bearing nodes)")
        )

    worlds = _world_matrices(document, parents)
    bind_worlds = _bind_worlds(document, buffers)
    kept = _kept_nodes(document, parents, instances, roots, _animation_targets(document))
    if not kept:
        raise GltfError(f"{source}: the selected meshes produced no nodes")
    names = _unique_names(document, kept)
    bone_of = {node: bone for bone, node in enumerate(kept)}
    axis_matrix = mat4_axis_scale(axis_y, scale)

    pose_world: dict[int, Mat4] = {
        node: mat4_mul(axis_matrix, bind_worlds.get(node, worlds[node])) for node in kept
    }

    warnings: list[str] = []
    bones: list[DmxBone] = []
    scale_notes = 0
    for node in kept:
        local = pose_world[node]
        parent = parents[node]
        parent_index = bone_of.get(parent)
        if parent_index is not None:
            inverse_parent = mat4_inverse(pose_world[parent])
            local = mat4_mul(inverse_parent, pose_world[node]) if inverse_parent else pose_world[node]
        translation, quaternion, questionable = _translation_and_quaternion(local)
        if parent_index is not None and questionable:
            scale_notes += 1
        bones.append(DmxBone(names[node], parent_index, translation, quaternion))
    if scale_notes:
        warnings.append(
            f"{scale_notes} bone(s) carry a scale other than 1; a DMX DmeTransform has no "
            "scale, so only position and rotation were written"
        )

    # One merged mesh: position table, loops and face sets per material.
    positions: list[tuple[float, float, float]] = []
    position_index: dict[tuple[float, float, float], int] = {}
    position_links: list[list[dict[str, Any]]] = []
    loops: list[dict[str, Any]] = []
    faces_by_material: dict[str, list[int]] = {}
    materials: dict[str, str] = {}
    morphs: dict[str, dict[int, tuple[float, float, float]]] = {}
    morph_normals: dict[str, dict[int, tuple[float, float, float]]] = {}
    morph_order: list[str] = []
    morph_notes: list[str] = []
    used_morph_names: set[str] = set()
    skinned_any = False
    triangle_count = 0
    bad_weight_vertices = 0
    ignored_animations = len(document.get("animations") or [])
    if ignored_animations:
        warnings.append(
            f"{ignored_animations} animation(s) are not written to the DMX; use gltf_to_smd "
            "for one SMD per animation"
        )
    meshes = document.get("meshes") or []
    nodes = document.get("nodes") or []
    skins = document.get("skins") or []

    for node_index, mesh_index in instances:
        node = nodes[node_index]
        mesh = meshes[mesh_index]
        skin_index = node.get("skin")
        skin = skins[int(skin_index)] if skin_index is not None else None
        joint_nodes = [int(v) for v in (skin.get("joints") or [])] if skin else []
        fallback_bone = bone_of.get(joint_nodes[0]) if joint_nodes else bone_of.get(node_index)
        if fallback_bone is None:
            fallback_bone = 0
        mesh_world = worlds[node_index]
        apply_node = use_transforms and skin is None
        mesh_name = str(mesh.get("name") or f"mesh_{mesh_index}")
        target_names = (mesh.get("extras") or {}).get("targetNames")
        if not isinstance(target_names, list):
            target_names = []

        for primitive in mesh.get("primitives") or []:
            mode = int(primitive.get("mode", 4))
            if mode not in {4, 5, 6}:
                continue
            attributes = primitive.get("attributes") or {}
            position_accessor = attributes.get("POSITION")
            if position_accessor is None:
                warnings.append(f"{mesh_name}: a primitive has no POSITION and was skipped")
                continue
            raw_positions = _vector3(document, buffers, int(position_accessor))
            normals = (
                _vector3(document, buffers, int(attributes["NORMAL"]))
                if attributes.get("NORMAL") is not None
                else None
            )
            uvs = (
                _vector2(document, buffers, int(attributes["TEXCOORD_0"]))
                if attributes.get("TEXCOORD_0") is not None
                else None
            )
            joints = (
                _vector4(document, buffers, int(attributes["JOINTS_0"]))
                if attributes.get("JOINTS_0") is not None
                else None
            )
            weights = (
                _vector4(document, buffers, int(attributes["WEIGHTS_0"]))
                if attributes.get("WEIGHTS_0") is not None
                else None
            )
            if joints is None or weights is None:
                if skin is not None:
                    warnings.append(
                        f"{mesh_name}: the skinned primitive has no JOINTS_0/WEIGHTS_0; every "
                        "vertex falls back to one bone at weight 1"
                    )
                joints = None
                weights = None
            else:
                skinned_any = True

            material = _material_name(document, primitive, fallback_material)
            materials.setdefault(material, f"materials/{material}.vmt")
            vertex_to_position: dict[int, int] = {}

            # A position table entry is created once per glTF vertex, so a morph target's
            # per-vertex delta can be mapped to the right position index.
            for vertex_index, point in enumerate(raw_positions):
                if apply_node:
                    point = mat4_transform_point(mesh_world, point)
                point = mat4_transform_point(axis_matrix, point)
                key = (round(point[0], 6), round(point[1], 6), round(point[2], 6))
                position = position_index.get(key)
                if position is None:
                    position = len(positions)
                    position_index[key] = position
                    positions.append(key)
                    position_links.append([])
                vertex_to_position[vertex_index] = position

                links: list[dict[str, Any]] = []
                if joints is not None and weights is not None and vertex_index < len(joints) and vertex_index < len(weights):
                    total_weight = 0.0
                    for slot in range(4):
                        weight = float(weights[vertex_index][slot])
                        joint_index = int(joints[vertex_index][slot])
                        if weight <= 1e-6:
                            continue
                        if joint_index < 0 or joint_index >= len(joint_nodes):
                            continue
                        bone = bone_of.get(joint_nodes[joint_index])
                        if bone is None:
                            continue
                        links.append({"bone": bone, "weight": round(weight, 6)})
                        total_weight += weight
                    if abs(total_weight - 1.0) > 1e-3:
                        bad_weight_vertices += 1
                if not links:
                    links = [{"bone": fallback_bone, "weight": 1.0}]
                if not position_links[position]:
                    position_links[position] = links
                elif position_links[position] != links:
                    warnings.append(
                        f"{mesh_name}: two vertices at the same position have different "
                        "weights; the first set was kept"
                    )

            # Morph targets are position deltas in the source mesh's space.
            for target_index, target in enumerate(primitive.get("targets") or []):
                target_positions = target.get("POSITION")
                if target_positions is None:
                    warnings.append(
                        f"{mesh_name}: morph target {target_index} has no POSITION and was skipped"
                    )
                    continue
                deltas = _vector3(document, buffers, int(target_positions))
                raw_name = str(target_names[target_index]) if target_index < len(target_names) else f"{mesh_name}_{target_index}"
                name = _safe_name(raw_name)
                if name.lower() in used_morph_names:
                    suffix = 2
                    base = name
                    while f"{base}_{suffix}".lower() in used_morph_names:
                        suffix += 1
                    name = f"{base}_{suffix}"
                used_morph_names.add(name.lower())
                if name not in morphs:
                    morphs[name] = {}
                    morph_order.append(name)
                for vertex_index, delta in enumerate(deltas):
                    position = vertex_to_position.get(vertex_index)
                    if position is None:
                        continue
                    if apply_node:
                        delta = mat4_transform_direction(mesh_world, delta)
                    delta = mat4_transform_direction(axis_matrix, delta)
                    rounded = (round(delta[0], 6), round(delta[1], 6), round(delta[2], 6))
                    if any(abs(component) > _MAX_FLEX_DELTA for component in rounded):
                        morph_notes.append(
                            f"{mesh_name}/{name}: a delta of {max(abs(c) for c in rounded)} "
                            f"exceeds Source's {_MAX_FLEX_DELTA}; studiomdl clamps it"
                        )
                    previous = morphs[name].get(position)
                    if previous is None:
                        morphs[name][position] = rounded
                    elif previous != rounded:
                        warnings.append(
                            f"{mesh_name}/{name}: two vertices at one position have different "
                            "deltas; the first was kept"
                        )

                target_normals = target.get("NORMAL")
                if target_normals is not None:
                    normal_deltas = _vector3(document, buffers, int(target_normals))
                    normal_map = morph_normals.setdefault(name, {})
                    for vertex_index, delta in enumerate(normal_deltas):
                        position = vertex_to_position.get(vertex_index)
                        if position is None:
                            continue
                        if apply_node:
                            delta = mat4_transform_direction(mesh_world, delta)
                        delta = mat4_transform_direction(axis_matrix, delta)
                        rounded = (
                            round(delta[0], 6),
                            round(delta[1], 6),
                            round(delta[2], 6),
                        )
                        normal_map.setdefault(position, rounded)
            indices = _indices(
                document,
                buffers,
                None if primitive.get("indices") is None else int(primitive["indices"]),
                len(raw_positions),
            )
            for triangle in _triangles(mode, indices):
                face = faces_by_material.setdefault(material, [])
                for vertex_index in triangle:
                    position = vertex_to_position.get(vertex_index)
                    if position is None:
                        raise GltfError(
                            f"{mesh_name}: vertex {vertex_index} is outside the "
                            f"{len(raw_positions)}-vertex POSITION accessor"
                        )
                    normal = (
                        normals[vertex_index]
                        if normals is not None and vertex_index < len(normals)
                        else (0.0, 0.0, 1.0)
                    )
                    if apply_node:
                        inverse_transpose = mat3_normal(mesh_world)
                        normal = (
                            inverse_transpose[0][0] * normal[0]
                            + inverse_transpose[0][1] * normal[1]
                            + inverse_transpose[0][2] * normal[2],
                            inverse_transpose[1][0] * normal[0]
                            + inverse_transpose[1][1] * normal[1]
                            + inverse_transpose[1][2] * normal[2],
                            inverse_transpose[2][0] * normal[0]
                            + inverse_transpose[2][1] * normal[1]
                            + inverse_transpose[2][2] * normal[2],
                        )
                    normal = mat4_transform_direction(axis_matrix, normal)
                    length = math.sqrt(sum(component * component for component in normal)) or 1.0
                    normal = tuple(component / length for component in normal)
                    if uvs is not None and vertex_index < len(uvs):
                        u, v = uvs[vertex_index]
                    else:
                        u, v = 0.0, 0.0
                    if flip_v:
                        v = 1.0 - v
                    face.append(len(loops))
                    loops.append(
                        {
                            "position": position,
                            "normal": tuple(round(component, 6) for component in normal),
                            "uv": (round(float(u), 6), round(float(v), 6)),
                        }
                    )
                face.append(-1)
                triangle_count += 1

    if triangle_count == 0:
        raise GltfError(f"{source}: no triangles were produced; see warnings")
    if bad_weight_vertices:
        warnings.append(
            f"{bad_weight_vertices} vertex/vertices have weights that do not sum to 1; "
            "studiomdl accepts this but the vertex then behaves unlike either bone"
        )

    mesh_data = DmxMeshData(
        positions=positions,
        position_links=position_links,
        loops=[DmxLoop(**loop) for loop in loops],
        faces_by_material=faces_by_material,
        materials=materials,
        morphs=morphs,
        morph_normals=morph_normals,
        morph_order=morph_order,
        morph_notes=list(morph_notes),
    )

    output = Path(str(req.get("out", "") or req.get("output", ""))).resolve()
    if output.suffix.lower() != ".dmx":
        output = output.with_suffix(".dmx")
    overwrite = bool(req.get("overwrite", False))
    try:
        written = write_model_dmx(output, bones, mesh_data, overwrite=overwrite)
    except ValueError as error:
        raise GltfError(str(error)) from error
    warnings.extend(written.get("warnings", []))
    warnings = list(dict.fromkeys(warnings))

    return {
        "path": str(output),
        "written": True,
        "source": str(source),
        "format": "dmx",
        "encoding": "binary",
        "encodingVersion": 4,
        "formatVersion": 15,
        "triangles": triangle_count,
        "vertices": len(loops),
        "positions": len(positions),
        "materials": [
            # One DmeFaceSet per material; `faces` is the loop-index list, not a set count.
            {"name": name, "mtlName": materials[name], "faceSets": 1}
            for name in faces_by_material
        ],
        "morphTargets": [
            {
                "name": name,
                "deltas": len(morphs[name]),
                "maxDelta": round(max((abs(c) for delta in morphs[name].values() for c in delta), default=0.0), 4),
            }
            for name in morph_order
        ],
        "morphTargetCount": len(morph_order),
        "flexNormalDeltas": written.get("flexNormalDeltas", 0),
        "boneCount": len(kept),
        "skinned": skinned_any,
        "ignoredAnimations": ignored_animations,
        "warnings": warnings,
        "diagnostics": diagnostics,
        "verified": written["verified"],
        "note": (
            "A DMX model with shape keys. L4D2's studiomdl reads it directly and writes "
            "flexdesc/controller/rule records; the QC needs no $flex command. The mesh is "
            "one body with face sets per material; animations are not written (use "
            "gltf_to_smd for one SMD per animation). A morph delta beyond ±8 is clamped by "
            "studiomdl and reported."
        ),
    }
