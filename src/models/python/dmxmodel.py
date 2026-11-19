"""The DMX model graph, shared by the glTF and FBX shape-key paths.

A Source DMX model is a Scene containing a DmeModel with joints, a DmeDag holding a
DmeMesh, a bind DmeVertexData, one DmeFaceSet per material, and -- when there are shape
keys -- DmeVertexDeltaData elements, DmeCombinationInputControl elements and a
DmeCombinationOperator. `studiomdl` turns that graph into flex descriptors, controllers and
rules without a `$flex` command.

The graph is a format fact, not a property of glTF: both importers build the same neutral
data and call `write_model_dmx` here. Keeping it in one place is what stops the two paths
from disagreeing on the detail that makes flexes work: `DmeMesh.deltaStateWeights` and
`deltaStateWeightsLagged` must carry one `(0, 0)` per control. With empty arrays studiomdl
writes the flex payload but no rules, so the flex is not driven.

What the writer does not do: scale on a bone (a DmeTransform has position and orientation
only), animations, or `$concave` collision. Those belong to the caller and the compiler.
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence


def safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._-")
    return cleaned or "shape"


def _diag(severity: str, rule: str, message: str) -> dict[str, Any]:
    return {"severity": severity, "rule": rule, "message": message}


class Dmx:
    """The small set of `srctools.dmx` calls the model graph needs."""

    def __init__(self) -> None:
        from srctools.dmx import Element

        self.Element = Element

    def element(self, name: str, kind: str) -> Any:
        return self.Element(name, kind)

    def string(self, element: Any, name: str, value: str) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute(name, ValueType.STRING, str(value))

    def boolean(self, element: Any, name: str, value: bool) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute(name, ValueType.BOOL, bool(value))

    def integer(self, element: Any, name: str, value: int) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute(name, ValueType.INT, int(value))

    def number(self, element: Any, name: str, value: float) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute(name, ValueType.FLOAT, float(value))

    def vec3(self, element: Any, name: str, value: Sequence[float]) -> None:
        from srctools.dmx import Attribute, ValueType
        from srctools.math import FrozenVec

        element[name] = Attribute(name, ValueType.VEC3, FrozenVec(value))

    def quat(self, element: Any, name: str, value: Sequence[float]) -> None:
        from srctools.dmx import Attribute, Quaternion, ValueType

        element[name] = Attribute(name, ValueType.QUATERNION, Quaternion(*value))

    def ref(self, element: Any, name: str, value: Any) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute(name, ValueType.ELEMENT, value)

    def refs(self, element: Any, name: str, values: Sequence[Any]) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute.array(name, ValueType.ELEMENT, list(values))

    def ints(self, element: Any, name: str, values: Sequence[int]) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute.array(name, ValueType.INT, [int(v) for v in values])

    def floats(self, element: Any, name: str, values: Sequence[float]) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute.array(name, ValueType.FLOAT, [float(v) for v in values])

    def strings(self, element: Any, name: str, values: Sequence[str]) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute.array(name, ValueType.STRING, [str(v) for v in values])

    def vec3s(self, element: Any, name: str, values: Sequence[Sequence[float]]) -> None:
        from srctools.dmx import Attribute, ValueType
        from srctools.math import FrozenVec

        element[name] = Attribute.array(name, ValueType.VEC3, [FrozenVec(value) for value in values])

    def vec2s(self, element: Any, name: str, values: Sequence[Sequence[float]]) -> None:
        from srctools.dmx import Attribute, ValueType

        element[name] = Attribute.array(name, ValueType.VEC2, [tuple(value) for value in values])


def _transform(dmx: Dmx, name: str, position: Sequence[float], quat: Sequence[float]) -> Any:
    element = dmx.element(name, "DmeTransform")
    dmx.string(element, "name", name)
    dmx.vec3(element, "position", position)
    dmx.quat(element, "orientation", quat)
    return element


@dataclass
class DmxBone:
    """One joint: a local transform relative to its parent, in bind pose."""

    name: str
    parent: int | None
    position: tuple[float, float, float]
    quaternion: tuple[float, float, float, float]


@dataclass
class DmxLoop:
    position: int
    normal: tuple[float, float, float]
    uv: tuple[float, float]


@dataclass
class DmxMeshData:
    positions: list[tuple[float, float, float]] = field(default_factory=list)
    position_links: list[list[dict[str, Any]]] = field(default_factory=list)
    loops: list[DmxLoop] = field(default_factory=list)
    faces_by_material: dict[str, list[int]] = field(default_factory=dict)
    materials: dict[str, str] = field(default_factory=dict)
    morphs: dict[str, dict[int, tuple[float, float, float]]] = field(default_factory=dict)
    morph_order: list[str] = field(default_factory=list)
    morph_notes: list[str] = field(default_factory=list)


def write_model_dmx(
    output: Path,
    bones: Sequence[DmxBone],
    mesh_data: DmxMeshData,
    *,
    overwrite: bool = False,
    max_flex_delta: float = 8.0,
) -> dict[str, Any]:
    """Write one binary DMX model and read it back. Returns `{verified, warnings}`."""
    from srctools.dmx import Element

    warnings: list[str] = []
    controls: list[Any] = []
    delta_states: list[Any] = []
    dmx = Dmx()

    joints: list[Any] = []
    transforms: list[Any] = []
    base_transforms: list[Any] = []
    children: dict[int, list[Any]] = {}
    for index, bone in enumerate(bones):
        joint = dmx.element(bone.name, "DmeJoint")
        dmx.string(joint, "name", bone.name)
        transform = _transform(dmx, bone.name, bone.position, bone.quaternion)
        base = _transform(dmx, bone.name, bone.position, bone.quaternion)
        dmx.ref(joint, "transform", transform)
        joints.append(joint)
        transforms.append(transform)
        base_transforms.append(base)
        if bone.parent is not None and 0 <= bone.parent < len(bones):
            children.setdefault(bone.parent, []).append(joint)
    for index, joint in enumerate(joints):
        dmx.refs(joint, "children", children.get(index, []))

    roots = [
        {"joint": joints[index], "transform": transforms[index]}
        for index, bone in enumerate(bones)
        if bone.parent is None or not (0 <= bone.parent < len(joints))
    ]

    for name in mesh_data.morph_order:
        deltas = mesh_data.morphs[name]
        indices = sorted(deltas)
        for delta in deltas.values():
            if any(abs(component) > max_flex_delta for component in delta):
                mesh_data.morph_notes.append(
                    f"{name}: a delta of {max(abs(c) for c in delta)} exceeds Source's "
                    f"{max_flex_delta}; studiomdl clamps it"
                )
        delta_element = dmx.element(name, "DmeVertexDeltaData")
        dmx.string(delta_element, "name", name)
        dmx.strings(delta_element, "vertexFormat", ["positions", "normals"])
        dmx.vec3s(delta_element, "positions", [deltas[index] for index in indices])
        dmx.ints(delta_element, "positionsIndices", indices)
        # The format permits empty normal arrays; the fixture proves it compiles.
        dmx.vec3s(delta_element, "normals", [])
        dmx.ints(delta_element, "normalsIndices", [])
        delta_states.append(delta_element)

        control = dmx.element(name, "DmeCombinationInputControl")
        dmx.string(control, "name", name)
        dmx.strings(control, "rawControlNames", [name])
        dmx.boolean(control, "stereo", False)
        dmx.boolean(control, "eyelid", False)
        dmx.number(control, "flexMax", 1.0)
        dmx.number(control, "flexMin", 0.0)
        dmx.floats(control, "wrinkleScales", [0.0])
        controls.append(control)
    warnings.extend(dict.fromkeys(mesh_data.morph_notes))

    joint_count = max((len(links) for links in mesh_data.position_links), default=1)
    if joint_count < 1:
        joint_count = 1
    position_indices = [loop.position for loop in mesh_data.loops]
    joint_weights: list[float] = []
    joint_indices: list[int] = []
    for links in mesh_data.position_links:
        padded = list(links) + [{"bone": 0, "weight": 0.0}] * (joint_count - len(links))
        for link in padded[:joint_count]:
            joint_indices.append(int(link["bone"]))
            joint_weights.append(float(link["weight"]))

    bind = dmx.element("bind", "DmeVertexData")
    dmx.string(bind, "name", "bind")
    dmx.strings(
        bind,
        "vertexFormat",
        ["positions", "normals", "textureCoordinates", "jointWeights", "jointIndices", "balance"],
    )
    dmx.boolean(bind, "flipVCoordinates", True)
    dmx.integer(bind, "jointCount", joint_count)
    dmx.vec3s(bind, "positions", mesh_data.positions)
    dmx.ints(bind, "positionsIndices", position_indices)
    dmx.vec3s(bind, "normals", [loop.normal for loop in mesh_data.loops])
    dmx.ints(bind, "normalsIndices", list(range(len(mesh_data.loops))))
    dmx.vec2s(bind, "textureCoordinates", [loop.uv for loop in mesh_data.loops])
    dmx.ints(bind, "textureCoordinatesIndices", list(range(len(mesh_data.loops))))
    dmx.floats(bind, "jointWeights", joint_weights)
    dmx.ints(bind, "jointIndices", joint_indices)
    dmx.floats(bind, "balance", [1.0] * len(mesh_data.positions))
    dmx.ints(bind, "balanceIndices", position_indices)

    mesh = dmx.element("body", "DmeMesh")
    dmx.string(mesh, "name", "body")
    dmx.boolean(mesh, "visible", True)
    dmx.ref(mesh, "bindState", bind)
    dmx.ref(mesh, "currentState", bind)
    dmx.refs(mesh, "baseStates", [bind])
    face_sets: list[Any] = []
    for material, faces in mesh_data.faces_by_material.items():
        short = material.rsplit("/", 1)[-1] or "material"
        face_set = dmx.element(short, "DmeFaceSet")
        dmx.string(face_set, "name", short)
        dmx.ints(face_set, "faces", faces)
        material_element = dmx.element(short, "DmeMaterial")
        dmx.string(material_element, "name", short)
        dmx.string(material_element, "mtlName", mesh_data.materials[material])
        dmx.ref(face_set, "material", material_element)
        face_sets.append(face_set)
    dmx.refs(mesh, "faceSets", face_sets)
    if controls:
        dmx.refs(mesh, "deltaStates", delta_states)
        dmx.vec2s(mesh, "deltaStateWeights", [[0.0, 0.0] for _ in controls])
        dmx.vec2s(mesh, "deltaStateWeightsLagged", [[0.0, 0.0] for _ in controls])

    mesh_transform = _transform(dmx, "body", [0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0])
    mesh_base_transform = _transform(dmx, "body", [0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0])
    mesh_dag = dmx.element("body", "DmeDag")
    dmx.string(mesh_dag, "name", "body")
    dmx.ref(mesh_dag, "transform", mesh_transform)
    dmx.ref(mesh_dag, "shape", mesh)
    dmx.refs(mesh_dag, "children", [])

    root = dmx.element("rig", "DmeModel")
    dmx.string(root, "name", "rig")
    dmx.refs(root, "children", [entry["joint"] for entry in roots] + [mesh_dag])
    base_list = dmx.element("base", "DmeTransformList")
    dmx.string(base_list, "name", "base")
    dmx.refs(base_list, "transforms", base_transforms + [mesh_base_transform])
    dmx.refs(root, "baseStates", [base_list])
    identity = _transform(dmx, "model", [0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0])
    dmx.ref(root, "transform", identity)
    dmx.refs(root, "jointList", joints + [mesh_dag])
    dmx.refs(root, "jointTransforms", transforms + [mesh_transform])

    scene = dmx.element("Scene", "DmElement")
    dmx.string(scene, "name", "Scene")
    dmx.ref(scene, "skeleton", root)
    dmx.ref(scene, "model", root)
    if controls:
        operator = dmx.element("combinationOperator", "DmeCombinationOperator")
        dmx.string(operator, "name", "combinationOperator")
        dmx.refs(operator, "controls", controls)
        dmx.vec3s(operator, "controlValues", [[0.0, 0.0, 0.5] for _ in controls])
        dmx.vec3s(operator, "controlValuesLagged", [[0.0, 0.0, 0.5] for _ in controls])
        dmx.boolean(operator, "usesLaggedValues", False)
        dmx.refs(operator, "dominators", [])
        dmx.refs(operator, "targets", [mesh])
        dmx.ref(scene, "combinationOperator", operator)

    if output.exists() and not overwrite:
        raise ValueError(f"{output} already exists; pass overwrite:true to replace it")
    output.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.BytesIO()
    scene.export_binary(buffer, version=4, fmt_name="model", fmt_ver=15)
    output.write_bytes(buffer.getvalue())
    with output.open("rb") as handle:
        back, _fmt, _version = Element.parse(handle)

    return {
        "verified": back.name == "Scene" and back.type == "DmElement",
        "warnings": warnings,
        "jointCount": len(bones),
        "vertexCount": len(mesh_data.loops),
    }
