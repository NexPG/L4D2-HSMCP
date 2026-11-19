"""glTF 2.0 / GLB -> SMD, the source `studiomdl` actually reads.

The game's 2009 compiler has no glTF loader (its extension probe chain is
``fbx xml obj vta phys sma smd mpp dmx vrm``), so a `.glb` from Blender cannot be compiled
directly. Before this module the only bridge was a DCC re-export to SMD/DMX, or `the adapter`
for people who had installed a separate compiler. This closes that gap without a third-party
library: the JSON document, the GLB chunks, the accessors (including sparse ones) and the
buffer views are all read here, and the result is written through the same `smd_write` the
rest of the toolkit uses.

What is deliberately true:

* **Geometry is mesh space.** A Blender export with the default ``+Y up`` keeps the mesh
  POSITION array in Z-up model space and puts the axis change on the scene root; the raw
  accessor is therefore already what Source expects. `axis: "z"` (the default) keeps it.
  Hand-written Y-up data needs `axis: "y"`, which applies ``(x, y, z) -> (x, -z, y)``.
* **Node transforms are not applied by default.** That is the verified behavior of the
  reference glTF oracle: a scene's object placement belongs to the DCC, and applying the
  exporter's root rotation would tip a Blender model on its side. `useNodeTransforms: true`
  asks for them explicitly; it is the right flag for a hand-authored multi-object scene and
  should be paired with `axis: "y"` when the file really is Y-up.
* **The bind pose comes from `inverseBindMatrices`, not node TRS.** A Blender file exported
  with "Use Rest Position Armature" off has node TRS in the current pose while the IBMs stay
  in rest; taking TRS would put the mesh and the skeleton in different spaces. The IBM is
  the spec's own definition of the bind pose, so the skeleton is built from its inverse.
* **UVs are flipped on the way into SMD.** glTF stores the final engine-space V; SMD's
  reader (`studiomdl`'s ``v1support.cpp``) inverts V while parsing. Writing ``1 - v`` makes
  the compiled model match the glTF. `flipV: false` is available for a source that already
  compensated.
* **Not silently dropped:** morph targets and animations are counted and reported. SMD has
  no per-vertex morph target and this first path exports one bind-pose skeleton; a caller
  who needs animation should export it as its own SMD. The report says how many were left.

The conventions above were cross-checked against the compiler's published glTF oracle (GPL-3.0-only;
its findings, not its code, were used, and this implementation is independent).
"""

from __future__ import annotations

import base64
import bisect
import json
import math
import re
import struct
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence
from urllib.parse import unquote, unquote_to_bytes

from modelmath import (
    Mat4,
    euler_xyz,
    mat3_normal,
    mat4_axis_scale,
    mat4_decompose,
    mat4_from_gltf,
    mat4_from_trs,
    mat4_identity,
    mat4_inverse,
    mat4_mul,
    mat4_transform_direction,
    mat4_transform_point,
    normalize3,
    quat_slerp,
    vec3_lerp,
)

_SEVERITY_ERROR = "error"
_SEVERITY_WARNING = "warning"

_GLB_MAGIC = 0x46546C67
_GLB_JSON = 0x4E4F534A
_GLB_BIN = 0x004E4942

_COMPONENT = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}
_TYPE_COMPONENTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}
_MODE_NAMES = {
    0: "POINTS",
    1: "LINES",
    2: "LINE_LOOP",
    3: "LINE_STRIP",
    4: "TRIANGLES",
    5: "TRIANGLE_STRIP",
    6: "TRIANGLE_FAN",
}
_REQUIRED_EXTENSIONS = {
    "KHR_draco_mesh_compression": "Draco-compressed geometry",
    "EXT_meshopt_compression": "meshopt-compressed geometry",
}


class GltfError(ValueError):
    """A file the importer refuses, with a message an author can act on."""


def _diag(severity: str, rule: str, message: str) -> dict[str, Any]:
    return {"severity": severity, "rule": rule, "message": message}


# ---------------------------------------------------------------------------
# Container and buffers
# ---------------------------------------------------------------------------


def _decode_data_uri(uri: str) -> bytes:
    if not uri.startswith("data:"):
        raise GltfError("not a data URI")
    header, comma, payload = uri[5:].partition(",")
    if not comma:
        raise GltfError("a data URI has no comma before its payload")
    if ";base64" in header.lower():
        compact = re.sub(r"\s+", "", payload)
        try:
            return base64.b64decode(compact, validate=True)
        except Exception as exc:  # noqa: BLE001 - the message is the product
            raise GltfError(f"a base64 data URI did not decode: {exc}") from exc
    return unquote_to_bytes(payload)


def _parse_glb(raw: bytes) -> tuple[dict[str, Any], bytes | None]:
    if len(raw) < 12:
        raise GltfError("a .glb is shorter than its 12-byte header")
    magic, version, length = struct.unpack_from("<III", raw, 0)
    if magic != _GLB_MAGIC:
        raise GltfError("this is not a .glb: the magic is not 'glTF'")
    if version != 2:
        raise GltfError(f"GLB version {version} is not supported; this reads glTF 2.0")
    if length > len(raw):
        raise GltfError(f"the .glb header claims {length} bytes but the file has {len(raw)}")
    offset = 12
    document: dict[str, Any] | None = None
    binary: bytes | None = None
    while offset + 8 <= length:
        chunk_length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        if offset + chunk_length > length:
            raise GltfError(f"a GLB chunk at {offset} runs past the declared length")
        chunk = raw[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == _GLB_JSON and document is None:
            try:
                document = json.loads(chunk.decode("utf-8-sig").rstrip("\x00 "))
            except Exception as exc:  # noqa: BLE001
                raise GltfError(f"the GLB JSON chunk is not JSON: {exc}") from exc
        elif chunk_type == _GLB_BIN and binary is None:
            binary = chunk
    if document is None:
        raise GltfError("the .glb has no JSON chunk")
    return document, binary


def _load_document(path: Path, *, strict: bool) -> tuple[dict[str, Any], list[bytes | None], list[dict[str, Any]], str]:
    """Reads the JSON and every buffer. ``strict`` turns a missing buffer into an error."""
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise GltfError(f"{path} could not be read: {exc}") from exc

    diagnostics: list[dict[str, Any]] = []
    if raw[:4] == b"glTF":
        document, binary = _parse_glb(raw)
        fmt = "glb"
    else:
        try:
            document = json.loads(raw.decode("utf-8-sig"))
        except Exception as exc:  # noqa: BLE001
            raise GltfError(f"{path} is neither a .glb nor JSON: {exc}") from exc
        binary = None
        fmt = "gltf"

    if not isinstance(document, dict):
        raise GltfError(f"{path}: the glTF root is not a JSON object")
    asset = document.get("asset")
    if not isinstance(asset, dict) or str(asset.get("version", "")).split(".")[0] != "2":
        raise GltfError(f"{path}: asset.version is not 2.x; this reads glTF 2.0")

    required = document.get("extensionsRequired") or []
    for name in required:
        if name in _REQUIRED_EXTENSIONS:
            message = (
                f"{name} is required ({_REQUIRED_EXTENSIONS[name]}), and this importer "
                "does not decode compressed geometry. Export without compression."
            )
            if strict:
                raise GltfError(f"{path}: {message}")
            diagnostics.append(_diag(_SEVERITY_ERROR, "gltf-unsupported-extension", message))
            continue
        diagnostics.append(
            _diag(
                _SEVERITY_WARNING,
                "gltf-required-extension",
                f"extensionsRequired lists {name}; it is not understood and the file may not read as intended",
            )
        )

    buffers: list[bytes | None] = []
    for index, buffer in enumerate(document.get("buffers") or []):
        uri = buffer.get("uri")
        declared = int(buffer.get("byteLength", 0))
        data: bytes | None = None
        if uri is None:
            if index == 0 and binary is not None:
                data = binary
            else:
                message = f"buffer {index} has no uri and the file has no GLB BIN chunk"
                if strict:
                    raise GltfError(f"{path}: {message}")
                diagnostics.append(_diag(_SEVERITY_ERROR, "gltf-buffer-missing", message))
                buffers.append(None)
                continue
        elif str(uri).startswith("data:"):
            try:
                data = _decode_data_uri(str(uri))
            except GltfError as exc:
                if strict:
                    raise
                diagnostics.append(_diag(_SEVERITY_ERROR, "gltf-data-uri", f"buffer {index}: {exc}"))
                buffers.append(None)
                continue
        else:
            target = (path.parent / unquote(str(uri))).resolve()
            if not target.is_file():
                message = f"buffer {index} points at {target}, which does not exist"
                if strict:
                    raise GltfError(f"{path}: {message}")
                diagnostics.append(_diag(_SEVERITY_ERROR, "gltf-buffer-missing", message))
                buffers.append(None)
                continue
            data = target.read_bytes()
        if data is not None and len(data) < declared:
            message = f"buffer {index} declares {declared} bytes but only {len(data)} were read"
            if strict:
                raise GltfError(f"{path}: {message}")
            diagnostics.append(_diag(_SEVERITY_ERROR, "gltf-buffer-short", message))
        buffers.append(data)

    return document, buffers, diagnostics, fmt


# ---------------------------------------------------------------------------
# Accessors
# ---------------------------------------------------------------------------


def _layout(component_type: int, type_name: str) -> tuple[int, int, int]:
    """``(component_count, component_size, element_size)`` including matrix padding."""
    if component_type not in _COMPONENT:
        raise GltfError(f"componentType {component_type} is not a glTF component type")
    _, component_size = _COMPONENT[component_type]
    components = _TYPE_COMPONENTS.get(type_name)
    if components is None:
        raise GltfError(f"accessor type {type_name!r} is not a glTF type")
    if type_name in {"MAT2", "MAT3", "MAT4"}:
        columns = {"MAT2": 2, "MAT3": 3, "MAT4": 4}[type_name]
        rows = {"MAT2": 2, "MAT3": 3, "MAT4": 4}[type_name]
        column_size = rows * component_size
        if component_size < 4:
            column_size = ((column_size + 3) // 4) * 4
        return components, component_size, columns * column_size
    return components, component_size, components * component_size


def _view_slice(
    document: dict[str, Any], buffers: Sequence[bytes | None], view_index: int
) -> tuple[bytes, int, int]:
    views = document.get("bufferViews") or []
    if view_index < 0 or view_index >= len(views):
        raise GltfError(f"bufferView {view_index} does not exist")
    view = views[view_index]
    buffer_index = int(view.get("buffer", -1))
    if buffer_index < 0 or buffer_index >= len(buffers):
        raise GltfError(f"bufferView {view_index} points at buffer {buffer_index}, which does not exist")
    data = buffers[buffer_index]
    if data is None:
        raise GltfError(f"buffer {buffer_index} was not loaded")
    offset = int(view.get("byteOffset", 0))
    length = int(view.get("byteLength", 0))
    if offset < 0 or length < 0 or offset + length > len(data):
        raise GltfError(
            f"bufferView {view_index} spans {offset}..{offset + length}, outside its "
            f"{len(data)}-byte buffer"
        )
    return data, offset, length


def _unpack(data: bytes, offset: int, component_type: int, type_name: str) -> tuple[float, ...]:
    components, component_size, element_size = _layout(component_type, type_name)
    if offset < 0 or offset + element_size > len(data):
        raise GltfError(f"an element at byte {offset} runs past its bufferView")
    if type_name in {"MAT2", "MAT3", "MAT4"}:
        columns = {"MAT2": 2, "MAT3": 3, "MAT4": 4}[type_name]
        rows = {"MAT2": 2, "MAT3": 3, "MAT4": 4}[type_name]
        column_size = rows * component_size
        if component_size < 4:
            column_size = ((column_size + 3) // 4) * 4
        values: list[float] = []
        fmt = _COMPONENT[component_type][0]
        for column in range(columns):
            base = offset + column * column_size
            values.extend(struct.unpack_from("<" + fmt * rows, data, base))
        return tuple(values)
    fmt = _COMPONENT[component_type][0]
    return tuple(struct.unpack_from("<" + fmt * components, data, offset))


def _normalize(value: float, component_type: int) -> float:
    if component_type == 5120:
        return max(value / 127.0, -1.0)
    if component_type == 5121:
        return value / 255.0
    if component_type == 5122:
        return max(value / 32767.0, -1.0)
    if component_type == 5123:
        return value / 65535.0
    if component_type == 5125:
        return value / 4294967295.0
    return value


def _accessor(
    document: dict[str, Any],
    buffers: Sequence[bytes | None],
    index: int,
) -> tuple[list[tuple[float, ...]], dict[str, Any]]:
    accessors = document.get("accessors") or []
    if index < 0 or index >= len(accessors):
        raise GltfError(f"accessor {index} does not exist")
    accessor = accessors[index]
    count = int(accessor.get("count", 0))
    type_name = str(accessor.get("type", "SCALAR"))
    component_type = int(accessor.get("componentType", 0))
    components, component_size, element_size = _layout(component_type, type_name)
    if count < 0:
        raise GltfError(f"accessor {index} has a negative count")
    if count == 0:
        return [], accessor

    normalized = bool(accessor.get("normalized", False))
    values: list[tuple[float, ...]] = []
    if "bufferView" in accessor:
        data, view_offset, view_length = _view_slice(document, buffers, int(accessor["bufferView"]))
        view = (document.get("bufferViews") or [])[int(accessor["bufferView"])]
        stride = int(view.get("byteStride", element_size))
        if stride < element_size:
            raise GltfError(
                f"accessor {index}: bufferView {accessor['bufferView']} has byteStride "
                f"{stride}, smaller than the {element_size}-byte element"
            )
        start = view_offset + int(accessor.get("byteOffset", 0))
        end = start + stride * (count - 1) + element_size
        if end > view_offset + view_length:
            raise GltfError(
                f"accessor {index} runs past its bufferView: {start}..{end} vs "
                f"{view_offset}..{view_offset + view_length}"
            )
        for item in range(count):
            raw = _unpack(data, start + item * stride, component_type, type_name)
            values.append(tuple(_normalize(v, component_type) for v in raw) if normalized else raw)
    else:
        # The spec says a missing bufferView means all zeros. Blender writes this for a
        # normal-offset morph target that does not move normals.
        values = [tuple(0.0 for _ in range(components)) for _ in range(count)]

    sparse = accessor.get("sparse")
    if sparse:
        sparse_count = int(sparse.get("count", 0))
        if sparse_count < 0 or sparse_count > count:
            raise GltfError(f"accessor {index}: sparse.count {sparse_count} is outside 0..{count}")
        indices_info = sparse.get("indices") or {}
        values_info = sparse.get("values") or {}
        index_type = int(indices_info.get("componentType", 0))
        if index_type not in {5121, 5123, 5125}:
            raise GltfError(f"accessor {index}: sparse indices use componentType {index_type}")
        _, index_size, _ = _layout(index_type, "SCALAR")
        index_data, index_view_offset, index_view_length = _view_slice(
            document, buffers, int(indices_info.get("bufferView", -1))
        )
        index_start = index_view_offset + int(indices_info.get("byteOffset", 0))
        value_data, value_view_offset, value_view_length = _view_slice(
            document, buffers, int(values_info.get("bufferView", -1))
        )
        value_stride = int(
            (document.get("bufferViews") or [])[int(values_info.get("bufferView", -1))].get(
                "byteStride", element_size
            )
        )
        value_start = value_view_offset + int(values_info.get("byteOffset", 0))
        if index_start + index_size * sparse_count > index_view_offset + index_view_length:
            raise GltfError(f"accessor {index}: sparse indices run past their bufferView")
        if value_start + value_stride * (sparse_count - 1) + element_size > (
            value_view_offset + value_view_length
        ):
            raise GltfError(f"accessor {index}: sparse values run past their bufferView")
        fmt = _COMPONENT[index_type][0]
        for item in range(sparse_count):
            (target,) = struct.unpack_from("<" + fmt, index_data, index_start + item * index_size)
            target = int(target)
            if target < 0 or target >= count:
                raise GltfError(f"accessor {index}: sparse index {target} is outside 0..{count - 1}")
            raw = _unpack(value_data, value_start + item * value_stride, component_type, type_name)
            values[target] = (
                tuple(_normalize(v, component_type) for v in raw) if normalized else raw
            )

    return values, accessor


def _vector3(
    document: dict[str, Any], buffers: Sequence[bytes | None], accessor_index: int
) -> list[tuple[float, float, float]]:
    values, accessor = _accessor(document, buffers, accessor_index)
    if str(accessor.get("type", "")) != "VEC3":
        raise GltfError(f"accessor {accessor_index} is {accessor.get('type')}, not VEC3")
    return [(float(v[0]), float(v[1]), float(v[2])) for v in values]


def _vector2(
    document: dict[str, Any], buffers: Sequence[bytes | None], accessor_index: int
) -> list[tuple[float, float]]:
    values, accessor = _accessor(document, buffers, accessor_index)
    if str(accessor.get("type", "")) != "VEC2":
        raise GltfError(f"accessor {accessor_index} is {accessor.get('type')}, not VEC2")
    return [(float(v[0]), float(v[1])) for v in values]


def _vector4(
    document: dict[str, Any], buffers: Sequence[bytes | None], accessor_index: int
) -> list[tuple[float, float, float, float]]:
    values, accessor = _accessor(document, buffers, accessor_index)
    if str(accessor.get("type", "")) != "VEC4":
        raise GltfError(f"accessor {accessor_index} is {accessor.get('type')}, not VEC4")
    return [(float(v[0]), float(v[1]), float(v[2]), float(v[3])) for v in values]


def _indices(
    document: dict[str, Any], buffers: Sequence[bytes | None], accessor_index: int | None, vertex_count: int
) -> list[int]:
    if accessor_index is None:
        return list(range(vertex_count))
    values, accessor = _accessor(document, buffers, accessor_index)
    if str(accessor.get("type", "")) != "SCALAR":
        raise GltfError(f"accessor {accessor_index} is the index buffer but is not SCALAR")
    out = [int(v[0]) for v in values]
    for value in out:
        if value < 0 or value >= vertex_count:
            raise GltfError(
                f"index {value} is outside the {vertex_count}-vertex POSITION accessor; "
                "the file's index accessor and POSITION count disagree"
            )
    return out


def _matrices(
    document: dict[str, Any], buffers: Sequence[bytes | None], accessor_index: int
) -> list[Mat4]:
    values, accessor = _accessor(document, buffers, accessor_index)
    if str(accessor.get("type", "")) != "MAT4":
        raise GltfError(f"accessor {accessor_index} is {accessor.get('type')}, not MAT4")
    return [mat4_from_gltf(v) for v in values]


# ---------------------------------------------------------------------------
# Nodes and the scene graph
# ---------------------------------------------------------------------------


def _node_transform(node: dict[str, Any]) -> Mat4:
    matrix = node.get("matrix")
    if matrix is not None:
        return mat4_from_gltf([float(v) for v in matrix])
    translation = node.get("translation") or [0.0, 0.0, 0.0]
    rotation = node.get("rotation") or [0.0, 0.0, 0.0, 1.0]
    scale = node.get("scale") or [1.0, 1.0, 1.0]
    if len(translation) != 3 or len(rotation) != 4 or len(scale) != 3:
        raise GltfError("a node has a TRS component with the wrong length")
    return mat4_from_trs(translation, rotation, scale)


def _parent_table(document: dict[str, Any]) -> list[int]:
    nodes = document.get("nodes") or []
    parents = [-1] * len(nodes)
    for index, node in enumerate(nodes):
        for child in node.get("children") or []:
            child = int(child)
            if child < 0 or child >= len(nodes):
                raise GltfError(f"node {index} lists child {child}, which does not exist")
            if parents[child] != -1:
                raise GltfError(f"node {child} is a child of more than one node")
            parents[child] = index
    return parents


def _scene_roots(document: dict[str, Any], parents: Sequence[int]) -> list[int]:
    scenes = document.get("scenes") or []
    scene_index = int(document.get("scene", 0))
    if scenes and 0 <= scene_index < len(scenes):
        roots = [int(v) for v in (scenes[scene_index].get("nodes") or [])]
        return roots
    return [index for index, parent in enumerate(parents) if parent < 0]


def _world_matrices(document: dict[str, Any], parents: Sequence[int]) -> list[Mat4]:
    locals_ = [_node_transform(node) for node in (document.get("nodes") or [])]
    cache: dict[int, Mat4] = {}
    visiting: set[int] = set()

    def world(index: int) -> Mat4:
        if index in cache:
            return cache[index]
        if index in visiting:
            raise GltfError(f"the node hierarchy has a cycle through node {index}")
        visiting.add(index)
        parent = parents[index]
        local = locals_[index]
        value = local if parent < 0 else mat4_mul(world(parent), local)
        visiting.discard(index)
        cache[index] = value
        return value

    return [world(index) for index in range(len(locals_))]


def _node_name(document: dict[str, Any], index: int) -> str:
    node = (document.get("nodes") or [])[index]
    name = str(node.get("name") or f"bone_{index}")
    name = re.sub(r'["\r\n]', "_", name).strip()
    return name or f"bone_{index}"


def _mesh_name(document: dict[str, Any], index: int) -> str:
    mesh = (document.get("meshes") or [])[index]
    return str(mesh.get("name") or f"mesh_{index}")


def _material_name(document: dict[str, Any], primitive: dict[str, Any], fallback: str) -> str:
    material_index = primitive.get("material")
    if material_index is not None:
        materials = document.get("materials") or []
        if 0 <= int(material_index) < len(materials):
            name = materials[int(material_index)].get("name")
            if name:
                name = re.sub(r"^materials[\\/]", "", str(name), flags=re.IGNORECASE)
                name = re.sub(r"\.vmt$", "", name, flags=re.IGNORECASE)
                return name.replace("\\", "/")
    return fallback


def _is_selected(document: dict[str, Any], node_index: int, parts: Sequence[str]) -> bool:
    if not parts:
        return True
    node = (document.get("nodes") or [])[node_index]
    names = [str(node.get("name") or "")]
    mesh_index = node.get("mesh")
    if mesh_index is not None and 0 <= int(mesh_index) < len(document.get("meshes") or []):
        names.append(_mesh_name(document, int(mesh_index)))
    wanted = {part.lower() for part in parts}
    return any(name.lower() in wanted for name in names)


def _instances(
    document: dict[str, Any], parts: Sequence[str]
) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for index, node in enumerate(document.get("nodes") or []):
        mesh_index = node.get("mesh")
        if mesh_index is None:
            continue
        if not _is_selected(document, index, parts):
            continue
        mesh_index = int(mesh_index)
        if mesh_index < 0 or mesh_index >= len(document.get("meshes") or []):
            raise GltfError(f"node {index} points at mesh {mesh_index}, which does not exist")
        out.append((index, mesh_index))
    return out


def _dfs_order(
    document: dict[str, Any], parents: Sequence[int], kept: set[int], roots: Sequence[int]
) -> list[int]:
    children: list[list[int]] = [[] for _ in parents]
    for index, parent in enumerate(parents):
        if parent >= 0:
            children[parent].append(index)
    order: list[int] = []
    seen: set[int] = set()

    def walk(index: int) -> None:
        if index in seen or index not in kept:
            return
        seen.add(index)
        order.append(index)
        for child in children[index]:
            walk(child)

    for root in roots:
        walk(root)
    # A kept node outside the active scene still has to appear, or a weight would point
    # at a bone the SMD never declares. Walk its topmost kept ancestor first: glTF does
    # not promise that a parent has a smaller index than its child, and SMD does.
    for index in sorted(kept):
        top = index
        while parents[top] >= 0 and parents[top] in kept:
            top = parents[top]
        walk(top)
    return order


def _kept_nodes(
    document: dict[str, Any],
    parents: Sequence[int],
    instances: Sequence[tuple[int, int]],
    roots: Sequence[int],
    extra_nodes: Iterable[int] = (),
) -> list[int]:
    kept: set[int] = set(extra_nodes)
    for node_index, _ in instances:
        node = (document.get("nodes") or [])[node_index]
        skin_index = node.get("skin")
        if skin_index is None:
            kept.add(node_index)
        else:
            skins = document.get("skins") or []
            if int(skin_index) < 0 or int(skin_index) >= len(skins):
                raise GltfError(f"node {node_index} points at skin {skin_index}, which does not exist")
            for joint in skins[int(skin_index)].get("joints") or []:
                joint = int(joint)
                if joint < 0 or joint >= len(parents):
                    raise GltfError(f"skin {skin_index} lists joint {joint}, which does not exist")
                kept.add(joint)
    for index in list(kept):
        parent = parents[index]
        while parent >= 0 and parent not in kept:
            kept.add(parent)
            parent = parents[parent]
    return _dfs_order(document, parents, kept, roots)


def _unique_names(document: dict[str, Any], order: Sequence[int]) -> dict[int, str]:
    used: dict[str, int] = {}
    names: dict[int, str] = {}
    for index in order:
        base = _node_name(document, index)
        name = base
        if name in used:
            used[base] += 1
            name = f"{base}_{used[base]}"
        else:
            used[base] = 0
        names[index] = name
    return names


def _bind_worlds(
    document: dict[str, Any], buffers: Sequence[bytes | None]
) -> dict[int, Mat4]:
    out: dict[int, Mat4] = {}
    for skin in document.get("skins") or []:
        accessor_index = skin.get("inverseBindMatrices")
        if accessor_index is None:
            continue
        matrices = _matrices(document, buffers, int(accessor_index))
        joints = [int(j) for j in skin.get("joints") or []]
        if len(matrices) < len(joints):
            raise GltfError(
                f"a skin lists {len(joints)} joints but its inverseBindMatrices accessor "
                f"only has {len(matrices)} matrices"
            )
        for joint, inverse_bind in zip(joints, matrices):
            world = mat4_inverse(inverse_bind)
            if world is not None:
                out.setdefault(joint, world)
    return out


# ---------------------------------------------------------------------------
# Triangle modes
# ---------------------------------------------------------------------------


def _triangles(mode: int, indices: Sequence[int]) -> Iterator[tuple[int, int, int]]:
    if mode == 4:
        for index in range(0, len(indices) - 2, 3):
            yield indices[index], indices[index + 1], indices[index + 2]
    elif mode == 5:
        for index in range(len(indices) - 2):
            if index % 2 == 0:
                yield indices[index], indices[index + 1], indices[index + 2]
            else:
                # The spec flips odd triangles so the strip's winding stays consistent.
                yield indices[index + 1], indices[index], indices[index + 2]
    elif mode == 6:
        for index in range(1, len(indices) - 1):
            yield indices[0], indices[index], indices[index + 1]


def _triangle_count(mode: int, vertices: int) -> int:
    if mode == 4:
        return vertices // 3
    if mode in {5, 6}:
        return max(0, vertices - 2)
    return 0


# ---------------------------------------------------------------------------
# Animations
# ---------------------------------------------------------------------------


def _animation_targets(document: dict[str, Any]) -> set[int]:
    """Every node any animation channel drives, for the shared bone table."""
    out: set[int] = set()
    for animation in document.get("animations") or []:
        for channel in animation.get("channels") or []:
            node = (channel.get("target") or {}).get("node")
            if node is not None:
                out.add(int(node))
    return out


def _animation_tracks(
    document: dict[str, Any],
    buffers: Sequence[bytes | None],
    animation: dict[str, Any],
) -> tuple[dict[int, dict[str, dict[str, Any]]], list[str]]:
    """Channels as per-node tracks of ``(times, values, interpolation)``.

    A channel is a sampler plus a target; the accessor values are already the final local
    TRS values. Cubic-spline output carries three values per key (in-tangent, value,
    out-tangent); the tangents are not used, so the middle value is resampled linearly and
    the caller is told. Morph-weight channels are counted, not exported.
    """
    tracks: dict[int, dict[str, dict[str, Any]]] = {}
    notes: list[str] = []
    samplers = animation.get("samplers") or []
    name = str(animation.get("name") or "")
    for channel in animation.get("channels") or []:
        target = channel.get("target") or {}
        node = target.get("node")
        path = target.get("path")
        if node is None or path not in {"translation", "rotation", "scale", "weights"}:
            continue
        if path == "weights":
            notes.append(f"{name}: morph-target weight channel is not exported")
            continue
        sampler_index = channel.get("sampler")
        if sampler_index is None or not (0 <= int(sampler_index) < len(samplers)):
            notes.append(f"{name}: a channel points at sampler {sampler_index}, which does not exist")
            continue
        sampler = samplers[int(sampler_index)]
        input_index = sampler.get("input")
        output_index = sampler.get("output")
        if input_index is None or output_index is None:
            notes.append(f"{name}: a sampler has no input or output accessor")
            continue
        times = [float(value[0]) for value in _accessor(document, buffers, int(input_index))[0]]
        values, accessor = _accessor(document, buffers, int(output_index))
        interpolation = str(sampler.get("interpolation", "LINEAR")).upper()
        if interpolation == "CUBICSPLINE":
            if len(values) == len(times) * 3:
                values = [values[index * 3 + 1] for index in range(len(times))]
            else:
                notes.append(
                    f"{name}: CubicSpline output has {len(values)} values for {len(times)} "
                    "keys; it cannot be resampled and the channel is skipped"
                )
                continue
            notes.append(f"{name}: CubicSpline is resampled linearly (tangents are ignored)")
        if len(times) != len(values):
            notes.append(
                f"{name}: channel has {len(times)} times but {len(values)} values; "
                "only the shorter run is used"
            )
            count = min(len(times), len(values))
            times = times[:count]
            values = values[:count]
        if not times:
            continue
        pairs = sorted(zip(times, values), key=lambda pair: pair[0])
        ordered_times = [pair[0] for pair in pairs]
        ordered_values = [pair[1] for pair in pairs]
        if path == "rotation" and any(len(value) < 4 for value in ordered_values):
            notes.append(f"{name}: a rotation channel has a value that is not VEC4")
            continue
        if path in {"translation", "scale"} and any(len(value) < 3 for value in ordered_values):
            notes.append(f"{name}: a {path} channel has a value that is not VEC3")
            continue
        tracks.setdefault(int(node), {})[path] = {
            "path": path,
            "times": ordered_times,
            "values": ordered_values,
            "interpolation": interpolation,
            "_type": str(accessor.get("type", "")),
        }
    return tracks, notes


def _sample_track(track: dict[str, Any], time: float) -> tuple[float, ...] | None:
    times: list[float] = track["times"]
    values: list[tuple[float, ...]] = track["values"]
    if not times:
        return None
    if time <= times[0]:
        return values[0]
    if time >= times[-1]:
        return values[-1]
    index = bisect.bisect_right(times, time) - 1
    if index >= len(times) - 1:
        return values[-1]
    if track["interpolation"] == "STEP":
        return values[index]
    span = times[index + 1] - times[index]
    blend = 0.0 if span <= 0.0 else (time - times[index]) / span
    if track["path"] == "rotation":
        return quat_slerp(values[index], values[index + 1], blend)
    count = min(len(values[index]), len(values[index + 1]))
    return tuple(
        float(values[index][i]) + (float(values[index + 1][i]) - float(values[index][i])) * blend
        for i in range(count)
    )


def _animation_frame(
    document: dict[str, Any],
    kept: Sequence[int],
    parents: Sequence[int],
    tracks: dict[int, dict[str, dict[str, Any]]],
    time: float,
    axis_matrix: Mat4,
) -> tuple[list[dict[str, Any]], int]:
    """One SMD skeleton block: local bone transforms at ``time``.

    Worlds are accumulated in glTF space, then the same ``axis_matrix`` used for the bind
    pose is pre-multiplied before the parent is divided out. That is what makes
    ``axis:'y'`` and a global scale apply to animation exactly as they do to the mesh,
    instead of rotating the skeleton differently.
    """
    nodes = document.get("nodes") or []
    world: dict[int, Mat4] = {}
    for node in kept:
        data = nodes[node]
        if data.get("matrix") is not None:
            # glTF forbids animating a matrix node; the caller reports the ignored track.
            local = mat4_from_gltf([float(v) for v in data["matrix"]])
        else:
            translation = [float(v) for v in (data.get("translation") or [0.0, 0.0, 0.0])]
            rotation = [float(v) for v in (data.get("rotation") or [0.0, 0.0, 0.0, 1.0])]
            scale = [float(v) for v in (data.get("scale") or [1.0, 1.0, 1.0])]
            for path, track in tracks.get(node, {}).items():
                value = _sample_track(track, time)
                if value is None:
                    continue
                if path == "translation":
                    translation = [float(v) for v in value[:3]]
                elif path == "rotation":
                    rotation = [float(v) for v in value[:4]]
                elif path == "scale":
                    scale = [float(v) for v in value[:3]]
            local = mat4_from_trs(translation, rotation, scale)
        parent = parents[node]
        world[node] = mat4_mul(world[parent], local) if parent in world else local

    source_world = {node: mat4_mul(axis_matrix, world[node]) for node in kept}
    frame: list[dict[str, Any]] = []
    scale_notes = 0
    for bone, node in enumerate(kept):
        parent = parents[node]
        if parent in source_world:
            inverse_parent = mat4_inverse(source_world[parent])
            local = mat4_mul(inverse_parent, source_world[node]) if inverse_parent else mat4_identity()
        else:
            local = source_world[node]
        translation, quaternion, bone_scale, mirrored = mat4_decompose(local)
        if parent in source_world and any(abs(value - 1.0) > 1e-3 for value in bone_scale):
            scale_notes += 1
        if mirrored:
            scale_notes += 1
        roll, pitch, yaw = euler_xyz(quaternion)
        frame.append(
            {
                "bone": bone,
                "position": [round(v, 6) for v in translation],
                "rotation": [round(roll, 6), round(pitch, 6), round(yaw, 6)],
            }
        )
    return frame, scale_notes


def _safe_animation_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._-")
    return cleaned or "anim"


def _box_triangles(
    minimum: Sequence[float], maximum: Sequence[float], material: str
) -> list[dict[str, Any]]:
    """A closed, outward-wound box for `$collisionmodel`."""
    x0, y0, z0 = (float(v) for v in minimum)
    x1, y1, z1 = (float(v) for v in maximum)
    v000 = (x0, y0, z0)
    v100 = (x1, y0, z0)
    v110 = (x1, y1, z0)
    v010 = (x0, y1, z0)
    v001 = (x0, y0, z1)
    v101 = (x1, y0, z1)
    v111 = (x1, y1, z1)
    v011 = (x0, y1, z1)
    faces = [
        ((0.0, 0.0, -1.0), (v000, v010, v110), (v000, v110, v100)),
        ((0.0, 0.0, 1.0), (v001, v101, v111), (v001, v111, v011)),
        ((0.0, -1.0, 0.0), (v000, v100, v101), (v000, v101, v001)),
        ((0.0, 1.0, 0.0), (v010, v011, v111), (v010, v111, v110)),
        ((-1.0, 0.0, 0.0), (v000, v001, v011), (v000, v011, v010)),
        ((1.0, 0.0, 0.0), (v100, v110, v111), (v100, v111, v101)),
    ]
    triangles: list[dict[str, Any]] = []
    for normal, first, second in faces:
        for corners in (first, second):
            triangles.append(
                {
                    "material": material,
                    "vertices": [
                        {
                            "position": [round(v, 6) for v in corner],
                            "normal": list(normal),
                            "uv": [0.0, 0.0],
                            "links": [{"bone": 0, "weight": 1.0}],
                        }
                        for corner in corners
                    ],
                }
            )
    return triangles


# ---------------------------------------------------------------------------
# read_gltf
# ---------------------------------------------------------------------------


def gltf_read(req: dict[str, Any]) -> dict[str, Any]:
    path = Path(str(req.get("path", ""))).resolve()
    if not path.is_file():
        return {"path": str(path), "read": False, "readError": "file does not exist"}
    document, buffers, diagnostics, fmt = _load_document(path, strict=False)
    asset = document.get("asset") or {}

    parents = _parent_table(document)
    roots = _scene_roots(document, parents)
    nodes_out: list[dict[str, Any]] = []
    for index, node in enumerate(document.get("nodes") or []):
        nodes_out.append(
            {
                "index": index,
                "name": str(node.get("name") or ""),
                "parent": parents[index],
                "children": [int(v) for v in (node.get("children") or [])],
                "mesh": None if node.get("mesh") is None else int(node["mesh"]),
                "skin": None if node.get("skin") is None else int(node["skin"]),
            }
        )

    meshes_out: list[dict[str, Any]] = []
    global_mins: list[float] | None = None
    global_maxs: list[float] | None = None
    for mesh_index, mesh in enumerate(document.get("meshes") or []):
        primitives_out: list[dict[str, Any]] = []
        for primitive_index, primitive in enumerate(mesh.get("primitives") or []):
            for extension in (primitive.get("extensions") or {}):
                if extension in _REQUIRED_EXTENSIONS:
                    diagnostics.append(
                        _diag(
                            _SEVERITY_ERROR,
                            "gltf-unsupported-extension",
                            f"mesh {mesh_index} primitive {primitive_index} uses {extension} "
                            f"({_REQUIRED_EXTENSIONS[extension]}); its geometry cannot be read",
                        )
                    )
            attributes = primitive.get("attributes") or {}
            accessor_index = attributes.get("POSITION")
            vertex_count = 0
            minimum: list[float] | None = None
            maximum: list[float] | None = None
            if accessor_index is not None:
                accessors = document.get("accessors") or []
                index = int(accessor_index)
                if 0 <= index < len(accessors):
                    accessor = accessors[index]
                    vertex_count = int(accessor.get("count", 0))
                    if accessor.get("min") is not None:
                        minimum = [float(v) for v in accessor["min"]]
                    if accessor.get("max") is not None:
                        maximum = [float(v) for v in accessor["max"]]
            indices_index = primitive.get("indices")
            index_count = vertex_count
            if indices_index is not None:
                accessors = document.get("accessors") or []
                index = int(indices_index)
                if 0 <= index < len(accessors):
                    index_count = int(accessors[index].get("count", 0))
            mode = int(primitive.get("mode", 4))
            triangles = _triangle_count(mode, index_count)
            materials = document.get("materials") or []
            material_out = None
            if primitive.get("material") is not None:
                material_index = int(primitive["material"])
                name = (
                    str(materials[material_index].get("name") or "")
                    if 0 <= material_index < len(materials)
                    else ""
                )
                material_out = {"index": material_index, "name": name}
            primitive_out = {
                "index": primitive_index,
                "mode": mode,
                "modeName": _MODE_NAMES.get(mode, f"MODE_{mode}"),
                "material": material_out,
                "attributes": {str(k): int(v) for k, v in attributes.items()},
                "indices": None if indices_index is None else int(indices_index),
                "vertexCount": vertex_count,
                "indexCount": index_count,
                "triangleCount": triangles,
                "min": minimum,
                "max": maximum,
                "hasNormals": "NORMAL" in attributes,
                "hasTexCoords": "TEXCOORD_0" in attributes,
                "hasJoints": "JOINTS_0" in attributes,
                "hasWeights": "WEIGHTS_0" in attributes,
                "morphTargets": len(primitive.get("targets") or []),
            }
            primitives_out.append(primitive_out)
            if minimum is not None and len(minimum) >= 3:
                global_mins = minimum[:3] if global_mins is None else [
                    min(global_mins[i], minimum[i]) for i in range(3)
                ]
            if maximum is not None and len(maximum) >= 3:
                global_maxs = maximum[:3] if global_maxs is None else [
                    max(global_maxs[i], maximum[i]) for i in range(3)
                ]
        extras = mesh.get("extras") or {}
        target_names = extras.get("targetNames") if isinstance(extras, dict) else None
        meshes_out.append(
            {
                "index": mesh_index,
                "name": _mesh_name(document, mesh_index),
                "primitives": primitives_out,
                "morphTargetNames": [str(v) for v in target_names] if isinstance(target_names, list) else [],
            }
        )

    materials_out: list[dict[str, Any]] = []
    images = document.get("images") or []
    textures = document.get("textures") or []
    for index, material in enumerate(document.get("materials") or []):
        pbr = material.get("pbrMetallicRoughness") or {}
        base = pbr.get("baseColorTexture") or {}
        texture_index = base.get("index")
        source = None
        uri = None
        mime = None
        if texture_index is not None and 0 <= int(texture_index) < len(textures):
            source = textures[int(texture_index)].get("source")
            if source is not None and 0 <= int(source) < len(images):
                image = images[int(source)]
                uri = image.get("uri")
                mime = image.get("mimeType")
        materials_out.append(
            {
                "index": index,
                "name": str(material.get("name") or ""),
                "alphaMode": str(material.get("alphaMode", "OPAQUE")),
                "doubleSided": bool(material.get("doubleSided", False)),
                "baseColorTexture": (
                    None
                    if texture_index is None
                    else {"texture": int(texture_index), "source": source, "uri": uri, "mimeType": mime}
                ),
            }
        )

    skins_out: list[dict[str, Any]] = []
    for index, skin in enumerate(document.get("skins") or []):
        joints = [int(v) for v in (skin.get("joints") or [])]
        skins_out.append(
            {
                "index": index,
                "name": str(skin.get("name") or ""),
                "jointCount": len(joints),
                "joints": [{"index": joint, "name": _node_name(document, joint)} for joint in joints],
                "skeleton": None if skin.get("skeleton") is None else int(skin["skeleton"]),
                "hasInverseBindMatrices": skin.get("inverseBindMatrices") is not None,
            }
        )

    animations_out: list[dict[str, Any]] = []
    for index, animation in enumerate(document.get("animations") or []):
        channels = animation.get("channels") or []
        samplers = animation.get("samplers") or []
        targets = sorted(
            {
                int(channel["target"]["node"])
                for channel in channels
                if channel.get("target", {}).get("node") is not None
            }
        )
        duration = None
        if samplers:
            input_index = samplers[0].get("input")
            if input_index is not None:
                accessors = document.get("accessors") or []
                if 0 <= int(input_index) < len(accessors):
                    accessor = accessors[int(input_index)]
                    if accessor.get("min") is not None and accessor.get("max") is not None:
                        duration = {
                            "min": float(accessor["min"][0]),
                            "max": float(accessor["max"][0]),
                        }
        animations_out.append(
            {
                "index": index,
                "name": str(animation.get("name") or ""),
                "channelCount": len(channels),
                "samplerCount": len(samplers),
                "duration": duration,
                "targets": targets,
                "paths": sorted(
                    {
                        str((channel.get("target") or {}).get("path", ""))
                        for channel in channels
                        if (channel.get("target") or {}).get("path")
                    }
                ),
                "interpolations": sorted(
                    {str(sampler.get("interpolation", "LINEAR")).upper() for sampler in samplers}
                ),
            }
        )

    buffers_out: list[dict[str, Any]] = []
    for index, buffer in enumerate(document.get("buffers") or []):
        uri = buffer.get("uri")
        buffers_out.append(
            {
                "index": index,
                "byteLength": int(buffer.get("byteLength", 0)),
                "uri": uri,
                "external": uri is not None and not str(uri).startswith("data:"),
                "loaded": index < len(buffers) and buffers[index] is not None,
            }
        )

    morph_targets = sum(
        len(primitive.get("targets") or [])
        for mesh in (document.get("meshes") or [])
        for primitive in (mesh.get("primitives") or [])
    )
    unsupported = sorted(
        {
            int(primitive.get("mode", 4))
            for mesh in (document.get("meshes") or [])
            for primitive in (mesh.get("primitives") or [])
        }
        - {4, 5, 6}
    )
    for mode in unsupported:
        diagnostics.append(
            _diag(
                _SEVERITY_WARNING,
                "gltf-primitive-mode",
                f"{_MODE_NAMES.get(mode, f'MODE_{mode}')} primitives are not triangles and are skipped",
            )
        )

    return {
        "path": str(path),
        "read": True,
        "format": fmt,
        "version": str(asset.get("version", "")),
        "generator": None if asset.get("generator") is None else str(asset["generator"]),
        "copyright": None if asset.get("copyright") is None else str(asset["copyright"]),
        "scene": int(document.get("scene", 0)),
        "sceneRoots": roots,
        "counts": {
            "scenes": len(document.get("scenes") or []),
            "nodes": len(document.get("nodes") or []),
            "meshes": len(document.get("meshes") or []),
            "primitives": sum(len(mesh.get("primitives") or []) for mesh in (document.get("meshes") or [])),
            "materials": len(document.get("materials") or []),
            "textures": len(textures),
            "images": len(images),
            "skins": len(document.get("skins") or []),
            "animations": len(document.get("animations") or []),
            "accessors": len(document.get("accessors") or []),
            "bufferViews": len(document.get("bufferViews") or []),
            "buffers": len(document.get("buffers") or []),
            "morphTargets": morph_targets,
        },
        "nodes": nodes_out,
        "meshes": meshes_out,
        "materials": materials_out,
        "skins": skins_out,
        "animations": animations_out,
        "textures": [
            {
                "index": index,
                "source": None if texture.get("source") is None else int(texture["source"]),
                "sampler": None if texture.get("sampler") is None else int(texture["sampler"]),
            }
            for index, texture in enumerate(textures)
        ],
        "images": [
            {
                "index": index,
                "name": str(image.get("name") or ""),
                "uri": image.get("uri"),
                "mimeType": image.get("mimeType"),
                "bufferView": None if image.get("bufferView") is None else int(image["bufferView"]),
            }
            for index, image in enumerate(images)
        ],
        "buffers": buffers_out,
        "extensionsUsed": [str(v) for v in (document.get("extensionsUsed") or [])],
        "extensionsRequired": [str(v) for v in (document.get("extensionsRequired") or [])],
        "bounds": (
            None
            if global_mins is None or global_maxs is None
            else {
                "mins": [round(v, 4) for v in global_mins],
                "maxs": [round(v, 4) for v in global_maxs],
                "size": [round(global_maxs[i] - global_mins[i], 4) for i in range(3)],
            }
        ),
        "diagnostics": diagnostics,
        "ok": not any(item["severity"] == _SEVERITY_ERROR for item in diagnostics),
    }


# ---------------------------------------------------------------------------
# gltf_to_smd
# ---------------------------------------------------------------------------


def gltf_to_smd(req: dict[str, Any]) -> dict[str, Any]:
    from smd import smd_write

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
    limit_vertices = int(req.get("limitVertices", 2_000_000))
    export_animations = bool(req.get("exportAnimations", True))
    animation_fps = float(req.get("animationFps", 30.0))
    if not math.isfinite(animation_fps) or animation_fps <= 0.0:
        raise GltfError("animationFps must be a positive finite number")
    animation_filter = [str(value).lower() for value in (req.get("animations") or [])]
    collision = str(req.get("collision", "none")).lower()
    if collision not in {"none", "box"}:
        raise GltfError("collision must be 'none' or 'box'")
    mass = float(req.get("mass", 10.0))
    if not math.isfinite(mass) or mass <= 0.0:
        raise GltfError("mass must be a positive finite number")
    collision_thickness = float(req.get("collisionThickness", 1.0))
    if not math.isfinite(collision_thickness) or collision_thickness <= 0.0:
        raise GltfError("collisionThickness must be a positive finite number")

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
    # Animation-only bones must exist in the bind SMD too, or the animation SMD would
    # declare a bone the model does not have. The union is deliberately independent of
    # `exportAnimations`: turning export off must not change the model's skeleton.
    kept = _kept_nodes(document, parents, instances, roots, _animation_targets(document))
    if not kept:
        raise GltfError(f"{source}: the selected meshes produced no nodes")
    names = _unique_names(document, kept)
    bone_of = {node: bone for bone, node in enumerate(kept)}
    axis_matrix = mat4_axis_scale(axis_y, scale)

    # The SMD skeleton is the bind pose. `inverseBindMatrices` is the spec's bind pose;
    # node TRS is only the fallback when the file has no IBM (or no skin at all).
    pose_world: dict[int, Mat4] = {}
    for node in kept:
        world = bind_worlds.get(node, worlds[node])
        pose_world[node] = mat4_mul(axis_matrix, world)

    frames: list[dict[str, Any]] = []
    warnings: list[str] = []
    scale_notes = 0
    for node in kept:
        parent = parents[node]
        parent_bone = bone_of.get(parent) if parent >= 0 else None
        if parent_bone is None:
            local = pose_world[node]
        else:
            inverse_parent = mat4_inverse(pose_world[parent])
            if inverse_parent is None:
                warnings.append(
                    f"{names[node]}: the parent bind pose is singular; the bone is written "
                    "at the origin rather than as a NaN"
                )
                local = mat4_identity()
            else:
                local = mat4_mul(inverse_parent, pose_world[node])
        translation, quaternion, bone_scale, mirrored = mat4_decompose(local)
        if mirrored:
            warnings.append(
                f"{names[node]}: the bind matrix is mirrored; SMD cannot carry a negative "
                "bone scale, so the rotation is written without it"
            )
        # A root bone's local scale is the global `scale` option (which is applied to the
        # positions deliberately); only a non-root bone scale is a loss SMD cannot carry.
        if parent_bone is not None and any(abs(value - 1.0) > 1e-3 for value in bone_scale):
            scale_notes += 1
        roll, pitch, yaw = euler_xyz(quaternion)
        frames.append(
            {
                "bone": bone_of[node],
                "position": [round(v, 6) for v in translation],
                "rotation": [round(roll, 6), round(pitch, 6), round(yaw, 6)],
            }
        )
    if scale_notes:
        warnings.append(
            f"{scale_notes} bone(s) carry a scale other than 1; SMD has no bone scale, so "
            "only the rotation and translation were written"
        )

    ignored_node_transforms = 0
    if not use_transforms:
        for node, _ in instances:
            # A skinned mesh's node transform is ignored by the glTF spec itself (the
            # joint matrices carry the placement), so it is not a loss to report.
            if (document.get("nodes") or [])[node].get("skin") is not None:
                continue
            matrix = worlds[node]
            if any(
                abs(matrix[r][c] - (1.0 if r == c else 0.0)) > 1e-9
                for r in range(4)
                for c in range(4)
            ):
                ignored_node_transforms += 1
    if ignored_node_transforms:
        warnings.append(
            f"{ignored_node_transforms} mesh node transform(s) were ignored (the default, "
            "which matches DCC-exported model space); pass useNodeTransforms:true and, for "
            "a Y-up scene, axis:'y' to place objects"
        )

    triangles: list[dict[str, Any]] = []
    materials: dict[str, int] = {}
    skinned_any = False
    morph_targets_ignored = 0
    bad_weight_vertices = 0
    meshes = document.get("meshes") or []
    nodes = document.get("nodes") or []
    skins = document.get("skins") or []
    vertex_total = 0

    for node_index, mesh_index in instances:
        node = nodes[node_index]
        mesh = meshes[mesh_index]
        skin_index = node.get("skin")
        skin = skins[int(skin_index)] if skin_index is not None else None
        joint_nodes = [int(v) for v in (skin.get("joints") or [])] if skin else []
        joint_to_node = joint_nodes
        fallback_bone = bone_of.get(joint_nodes[0]) if joint_nodes else bone_of.get(node_index)
        if fallback_bone is None:
            fallback_bone = 0
        mesh_world = worlds[node_index]
        normal_matrix = mat3_normal(mesh_world)
        apply_node = use_transforms and skin is None

        for primitive in mesh.get("primitives") or []:
            mode = int(primitive.get("mode", 4))
            if mode not in {4, 5, 6}:
                continue
            for extension in (primitive.get("extensions") or {}):
                if extension in _REQUIRED_EXTENSIONS:
                    raise GltfError(
                        f"{source}: a primitive uses {extension} "
                        f"({_REQUIRED_EXTENSIONS[extension]}); export without compression"
                    )
            attributes = primitive.get("attributes") or {}
            position_index = attributes.get("POSITION")
            if position_index is None:
                warnings.append(
                    f"{_mesh_name(document, mesh_index)}: a primitive has no POSITION and was skipped"
                )
                continue
            positions = _vector3(document, buffers, int(position_index))
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
                        f"{_mesh_name(document, mesh_index)}: the skinned primitive has no "
                        "JOINTS_0/WEIGHTS_0; every vertex falls back to one bone at weight 1"
                    )
                joints = None
                weights = None
            else:
                skinned_any = True

            material = _material_name(document, primitive, fallback_material)
            indices = _indices(document, buffers, None if primitive.get("indices") is None else int(primitive["indices"]), len(positions))
            target = primitive.get("targets") or []
            morph_targets_ignored += len(target)

            for triangle in _triangles(mode, indices):
                corners: list[dict[str, Any]] = []
                for vertex_index in triangle:
                    if vertex_index < 0 or vertex_index >= len(positions):
                        raise GltfError(
                            f"{_mesh_name(document, mesh_index)}: vertex {vertex_index} is "
                            f"outside the {len(positions)}-vertex POSITION accessor"
                        )
                    point = positions[vertex_index]
                    if apply_node:
                        point = mat4_transform_point(mesh_world, point)
                    point = mat4_transform_point(axis_matrix, point)

                    if normals is not None and vertex_index < len(normals):
                        normal = normals[vertex_index]
                    else:
                        normal = (0.0, 0.0, 1.0)
                    if apply_node:
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
                    normal = mat4_transform_direction(axis_matrix, normal)
                    normal = normalize3(normal)

                    if uvs is not None and vertex_index < len(uvs):
                        u, v = uvs[vertex_index]
                    else:
                        u, v = 0.0, 0.0
                    if flip_v:
                        v = 1.0 - v

                    links: list[dict[str, Any]] = []
                    if joints is not None and weights is not None and vertex_index < len(joints) and vertex_index < len(weights):
                        total_weight = 0.0
                        for slot in range(4):
                            weight = float(weights[vertex_index][slot])
                            joint_index = int(joints[vertex_index][slot])
                            if weight <= 1e-6:
                                continue
                            if joint_index < 0 or joint_index >= len(joint_to_node):
                                warnings.append(
                                    f"{_mesh_name(document, mesh_index)}: JOINTS_0 index "
                                    f"{joint_index} is outside skin.joints ({len(joint_to_node)})"
                                )
                                continue
                            bone = bone_of.get(joint_to_node[joint_index])
                            if bone is None:
                                continue
                            links.append({"bone": bone, "weight": round(weight, 6)})
                            total_weight += weight
                        if abs(total_weight - 1.0) > 1e-3:
                            bad_weight_vertices += 1
                    if not links:
                        links = [{"bone": fallback_bone, "weight": 1.0}]

                    corners.append(
                        {
                            "position": [round(float(v), 6) for v in point],
                            "normal": [round(float(v), 6) for v in normal],
                            "uv": [round(float(u), 6), round(float(v), 6)],
                            "links": links,
                        }
                    )
                triangles.append({"material": material, "vertices": corners})
                materials[material] = materials.get(material, 0) + 1
                vertex_total += 3
                if vertex_total > limit_vertices:
                    raise GltfError(
                        f"{source}: more than {limit_vertices} vertices were produced; raise "
                        "limitVertices only if this is really the intended model"
                    )

    if not triangles:
        raise GltfError(f"{source}: no triangles were produced; see warnings")
    if bad_weight_vertices:
        warnings.append(
            f"{bad_weight_vertices} vertex/vertices have weights that do not sum to 1; "
            "studiomdl accepts this but the vertex then behaves unlike either bone"
        )
    morph_names: list[str] = []
    for mesh in meshes:
        extras = mesh.get("extras") or {}
        target_names = extras.get("targetNames") if isinstance(extras, dict) else None
        if isinstance(target_names, list):
            morph_names.extend(str(name) for name in target_names)
    if morph_targets_ignored:
        suffix = f" ({', '.join(morph_names)})" if morph_names else ""
        warnings.append(
            f"{morph_targets_ignored} morph target(s){suffix} were not exported: SMD has no "
            "morph target, so shape keys need a separate SMD/DMX per expression"
        )
    animation_count = len(document.get("animations") or [])
    if animation_count and not export_animations:
        warnings.append(
            f"{animation_count} animation(s) were not exported because exportAnimations is "
            "false; pass exportAnimations:true to write one SMD per animation"
        )

    output = Path(str(req.get("out", "") or req.get("output", ""))).resolve()
    if output.suffix.lower() != ".smd":
        output = output.with_suffix(".smd")
    overwrite = bool(req.get("overwrite", False))

    def ensure_new(path: Path) -> None:
        if path.exists() and not overwrite:
            raise GltfError(f"{path} already exists; pass overwrite:true to replace it")

    ensure_new(output)

    smd_nodes = [
        {"name": names[node], "parent": None if parents[node] not in bone_of else bone_of[parents[node]]}
        for node in kept
    ]
    written = smd_write(
        {
            "path": str(output),
            "nodes": smd_nodes,
            "frames": [{"time": 0.0, "bones": frames}],
            "triangles": triangles,
        }
    )

    points = [vertex["position"] for triangle in triangles for vertex in triangle["vertices"]]
    mins = [min(point[i] for point in points) for i in range(3)]
    maxs = [max(point[i] for point in points) for i in range(3)]
    diagnostics.extend(written.get("diagnostics", []))

    # One SMD per animation, with the same node table as the bind file. SMD frame times
    # are integers; `fps` in the QC turns them into seconds, so a 30 fps sample is one
    # frame per 1/30 s.
    animation_results: list[dict[str, Any]] = []
    ignored_animations = 0
    animations = document.get("animations") or []
    if export_animations:
        used_names: set[str] = set()
        for index, animation in enumerate(animations):
            raw_name = str(animation.get("name") or f"animation{index}")
            if animation_filter and raw_name.lower() not in animation_filter:
                ignored_animations += 1
                continue
            tracks, notes = _animation_tracks(document, buffers, animation)
            if not tracks:
                ignored_animations += 1
                warnings.append(f"{raw_name}: no usable animation channels; skipped")
                warnings.extend(notes)
                continue
            matrix_animated = [
                node for node in tracks if (nodes[node].get("matrix") is not None)
            ]
            if matrix_animated:
                notes.append(
                    f"{raw_name}: {len(matrix_animated)} channel(s) target a node with a "
                    "matrix; glTF forbids animating those, so the static matrix is used"
                )
                for node in matrix_animated:
                    tracks.pop(node, None)
                if not tracks:
                    ignored_animations += 1
                    warnings.extend(notes)
                    continue
            all_times = [
                time
                for node_tracks in tracks.values()
                for track in node_tracks.values()
                for time in track["times"]
            ]
            start = min(all_times)
            end = max(all_times)
            if end < start:
                start, end = end, start
            duration = max(0.0, end - start)
            frame_count = max(1, int(round(duration * animation_fps)) + 1)
            animation_frames: list[dict[str, Any]] = []
            animation_scale_notes = 0
            for frame_index in range(frame_count):
                time = min(start + frame_index / animation_fps, end)
                frame, frame_scale_notes = _animation_frame(
                    document, kept, parents, tracks, time, axis_matrix
                )
                animation_scale_notes += frame_scale_notes
                animation_frames.append({"time": float(frame_index), "bones": frame})
            if animation_scale_notes:
                notes.append(
                    f"{raw_name}: {animation_scale_notes} bone/frame value(s) carry a scale "
                    "other than 1; SMD has no bone scale, so only translation and rotation "
                    "were written"
                )
            name = _safe_animation_name(raw_name)
            unique = name
            suffix = 2
            while unique.lower() in used_names:
                unique = f"{name}_{suffix}"
                suffix += 1
            used_names.add(unique.lower())
            animation_path = output.with_name(f"{output.stem}_{unique}.smd")
            ensure_new(animation_path)
            animation_written = smd_write(
                {
                    "path": str(animation_path),
                    "nodes": smd_nodes,
                    "frames": animation_frames,
                    "triangles": [],
                    "allowEmptyTriangles": True,
                }
            )
            diagnostics.extend(animation_written.get("diagnostics", []))
            animation_results.append(
                {
                    "name": unique,
                    "path": str(animation_path),
                    "frames": frame_count,
                    "fps": round(animation_fps, 4),
                    "duration": round(duration, 4),
                    "start": round(start, 4),
                    "end": round(end, 4),
                    "warnings": notes,
                    "verified": bool(animation_written.get("verified")),
                }
            )
    else:
        ignored_animations = len(animations)

    collision_result: dict[str, Any] | None = None
    if collision == "box":
        box_mins = [float(value) for value in mins]
        box_maxs = [float(value) for value in maxs]
        for axis_index in range(3):
            if box_maxs[axis_index] - box_mins[axis_index] < collision_thickness:
                center = (box_mins[axis_index] + box_maxs[axis_index]) * 0.5
                box_mins[axis_index] = center - collision_thickness * 0.5
                box_maxs[axis_index] = center + collision_thickness * 0.5
        physics_path = output.with_name(f"{output.stem}_phys.smd")
        ensure_new(physics_path)
        physics_written = smd_write(
            {
                "path": str(physics_path),
                "nodes": [{"name": "root", "parent": None}],
                "frames": [
                    {
                        "time": 0.0,
                        "bones": [{"bone": 0, "position": [0, 0, 0], "rotation": [0, 0, 0]}],
                    }
                ],
                # A collision SMD still carries a material name, and `debug/debugempty`
                # makes studiomdl print "Collision model volume" but write a 0-byte .phy.
                # `phys` is the conventional name; no VMT is needed for the hull itself.
                "triangles": _box_triangles(box_mins, box_maxs, "phys"),
            }
        )
        diagnostics.extend(physics_written.get("diagnostics", []))
        collision_result = {
            "path": str(physics_path),
            "triangles": 12,
            "mins": [round(v, 4) for v in box_mins],
            "maxs": [round(v, 4) for v in box_maxs],
            "thickness": collision_thickness,
            "mass": mass,
            "verified": bool(physics_written.get("verified")),
        }

    return {
        "path": str(output),
        "written": True,
        "source": str(source),
        "format": fmt,
        "triangles": len(triangles),
        "vertices": vertex_total,
        "materials": [
            {"name": name, "triangles": count}
            for name, count in sorted(materials.items(), key=lambda item: (-item[1], item[0]))
        ],
        "mins": [round(v, 4) for v in mins],
        "maxs": [round(v, 4) for v in maxs],
        "size": [round(maxs[i] - mins[i], 4) for i in range(3)],
        "boneCount": len(kept),
        "skinned": skinned_any,
        "frameCount": 1,
        "nodes": [{"index": bone, "name": names[node], "parent": smd_nodes[bone]["parent"]} for bone, node in enumerate(kept)],
        "ignoredNodeTransforms": ignored_node_transforms,
        "ignoredMorphTargets": morph_targets_ignored,
        "morphTargetNames": morph_names,
        "ignoredAnimations": ignored_animations,
        "animations": animation_results,
        "animationCount": len(animation_results),
        "animationFps": animation_fps,
        "collision": collision_result,
        "warnings": warnings,
        "diagnostics": diagnostics,
        "verified": bool(written.get("verified")),
        "note": (
            "The bind SMD is one frame; each glTF animation is written beside it as "
            "<name>_<animation>.smd with the same bone table. Geometry is in mesh space by "
            "default (axis:'z'); pass axis:'y' for Y-up data and useNodeTransforms:true for "
            "a multi-object scene. SMD V is inverted because studiomdl inverts it while "
            "parsing, so the compiled model keeps the glTF UV. Morph targets are reported, "
            "not silently dropped. collision:'box' writes a <name>_phys.smd for "
            "$collisionmodel."
        ),
    }
