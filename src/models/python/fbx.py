"""FBX -> SMD, read here rather than delegated to a compiled importer.

Left 4 Dead 2's `studiomdl` has no FBX loader. The usual answers are a DCC re-export, or a
separate compiler with its own bundled SDK; this module reads the file instead, so an FBX
can go straight to the SMD the game's own compiler already accepts. Both shapes of FBX are
handled: binary 7.x (the default from Blender, Maya, 3ds Max) and ASCII.

What is read and what is not, stated plainly:

* **Geometry, skeleton, skin weights, normals, UVs and materials.** Polygons are fan-
  triangulated, `ByPolygonVertex`/`ByVertice`/`ByPolygon` mappings are honoured, and the
  last index of a polygon (stored negative) is decoded rather than treated as a vertex.
* **The bind pose comes from the skin clusters.** `TransformLink` is the world matrix of
  the bone in the bind pose, which is the only place that pose is recorded; node TRS is the
  rest pose and can differ. A file without clusters falls back to the node hierarchy and
  says so.
* **Animations are exported.** Every `AnimationStack` is resampled at `animationFps` into
  its own SMD, using the bind SMD's node table; the QC gets a `$sequence` per animation.
  Cubic tangents are sampled linearly, the documented fallback.
* **Collision is optional.** `collision: "box"` writes the AABB and `"hull"` the convex
  hull as a `_phys.smd` for `$collisionmodel`; a flat model falls back to the box loudly.
* **Blend shapes are counted, not exported.** SMD has no morph target; that is the DMX
  path's job.
* **Units are a flag, not a guess.** FBX is commonly in centimetres and Source is in
  inches, so a 180 cm character is 3x too tall unless `scale: 0.3937` is passed. The reader
  reports the file's `UnitScaleFactor` instead of silently rescaling.

Conventions, and why:

* **Matrices.** FBX stores row-major, row-vector matrices; this module converts at the
  boundary and uses the same column-vector, row-major maths as the glTF path
  (`modelmath`), so the two importers cannot drift apart on a sign.
* **Axes.** `UpAxis` from `GlobalSettings` decides: Y-up (the FBX default) becomes Source
  Z-up with ``(x, y, z) -> (x, -z, y)``; Z-up is kept. `axis: "y"` or `"z"` overrides the
  file when an exporter wrote the wrong global setting.
* **UVs.** SMD's reader inverts V, so ``1 - v`` is written by default, as in the glTF path.

The format facts were cross-checked against the public FBX binary layout (the 7.x node
record, the zlib-compressed property arrays, the polygon-index sign bit) and against the
behaviour the compiler documents for the same files. No code from the compiler, Blender or the FBX SDK is
used; this is an independent reader.
"""

from __future__ import annotations

import bisect
import math
import re
import struct
import zlib
from pathlib import Path
from typing import Any, Iterator, Sequence

from modelmath import (
    Mat4,
    euler_xyz,
    mat3_normal,
    mat4_axis_scale,
    mat4_decompose,
    mat4_identity,
    mat4_inverse,
    mat4_mul,
    mat4_rotation,
    mat4_scale,
    mat4_transform_direction,
    mat4_transform_point,
    mat4_translation,
    normalize3,
    quat_normalize,
)

# The collision-shape builder is shared with the glTF path: the AABB and the outward-wound
# convex hull are format-independent, and a second implementation would only drift.
from gltf import _box_triangles, _hull_triangles

_BINARY_MAGIC = b"Kaydara FBX Binary  \x00\x1a\x00"
_BINARY_HEADER_64BIT = 7500


class FbxError(ValueError):
    """A file this reader refuses, with a message an author can act on."""


def _diag(severity: str, rule: str, message: str) -> dict[str, Any]:
    return {"severity": severity, "rule": rule, "message": message}


# ---------------------------------------------------------------------------
# The node tree, which is what both encodings parse into
# ---------------------------------------------------------------------------


class Node:
    """One FBX record: a name, a flat property list and child records."""

    __slots__ = ("name", "props", "children")

    def __init__(
        self,
        name: str,
        props: list[Any] | None = None,
        children: list["Node"] | None = None,
    ) -> None:
        self.name = name
        self.props = props or []
        self.children = children or []

    def find(self, name: str) -> "Node | None":
        for child in self.children:
            if child.name == name:
                return child
        return None

    def all(self, name: str) -> list["Node"]:
        return [child for child in self.children if child.name == name]

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Node({self.name!r}, {len(self.props)} props, {len(self.children)} children)"


# ---------------------------------------------------------------------------
# Binary 7.x
# ---------------------------------------------------------------------------


def _read_binary_property(raw: bytes, at: int, version: int) -> tuple[Any, int]:
    kind = raw[at : at + 1]
    at += 1
    if kind == b"Y":
        return struct.unpack_from("<h", raw, at)[0], at + 2
    if kind == b"C":
        return bool(raw[at]), at + 1
    if kind == b"I":
        return struct.unpack_from("<i", raw, at)[0], at + 4
    if kind == b"F":
        return struct.unpack_from("<f", raw, at)[0], at + 4
    if kind == b"D":
        return struct.unpack_from("<d", raw, at)[0], at + 8
    if kind == b"L":
        return struct.unpack_from("<q", raw, at)[0], at + 8
    if kind in (b"S", b"R"):
        length = struct.unpack_from("<I", raw, at)[0]
        at += 4
        data = raw[at : at + length]
        if len(data) != length:
            raise FbxError("a string property runs past the end of the file")
        at += length
        if kind == b"S":
            return data.split(b"\x00", 1)[0].decode("utf-8", "replace"), at
        return data, at
    if kind in (b"f", b"d", b"l", b"i", b"b"):
        count, encoding, stored = struct.unpack_from("<III", raw, at)
        at += 12
        width = {"f": 4, "d": 8, "l": 8, "i": 4, "b": 1}[kind.decode("ascii")]
        data = raw[at : at + stored]
        if len(data) != stored:
            raise FbxError("an array property runs past the end of the file")
        at += stored
        if encoding == 1:
            try:
                data = zlib.decompress(data)
            except zlib.error as error:
                raise FbxError(f"an array property did not decompress: {error}") from error
        expected = count * width
        if len(data) < expected:
            raise FbxError(
                f"an array property says {count} item(s) but only {len(data)} byte(s) survived"
            )
        if kind == b"f":
            return list(struct.unpack_from(f"<{count}f", data, 0)), at
        if kind == b"d":
            return list(struct.unpack_from(f"<{count}d", data, 0)), at
        if kind == b"l":
            return list(struct.unpack_from(f"<{count}q", data, 0)), at
        if kind == b"i":
            return list(struct.unpack_from(f"<{count}i", data, 0)), at
        return list(data[:count]), at
    raise FbxError(f"unknown FBX property type {kind!r} at byte {at - 1}")


def _read_binary_node(
    raw: bytes, at: int, version: int
) -> tuple[Node | None, int]:
    wide = version >= _BINARY_HEADER_64BIT
    header = 25 if wide else 13
    if at + header > len(raw):
        return None, at
    if raw[at : at + header] == b"\x00" * header:
        return None, at + header
    if wide:
        end, property_count, _property_length = struct.unpack_from("<QQQ", raw, at)
        at += 24
    else:
        end, property_count, _property_length = struct.unpack_from("<III", raw, at)
        at += 12
    name_length = raw[at]
    at += 1
    if end < at or end > len(raw):
        raise FbxError(
            "a record's end offset is outside the file; the FBX may be truncated or use a "
            "7.5 layout this reader does not trust"
        )
    name = raw[at : at + name_length].decode("utf-8", "replace")
    at += name_length
    props: list[Any] = []
    for _ in range(property_count):
        value, at = _read_binary_property(raw, at, version)
        props.append(value)
    children: list[Node] = []
    while at < end:
        # A record's children end with a null record whose payload is zero bytes.
        child, next_at = _read_binary_node(raw, at, version)
        if child is None:
            at = next_at
            break
        children.append(child)
        at = next_at
    if at < end:
        at = end
    return Node(name, props, children), at


def _parse_binary(raw: bytes) -> tuple[Node, int, list[dict[str, Any]]]:
    diagnostics: list[dict[str, Any]] = []
    if len(raw) < 27:
        raise FbxError("the file is shorter than an FBX header")
    version = struct.unpack_from("<I", raw, 23)[0]
    if version >= _BINARY_HEADER_64BIT:
        diagnostics.append(
            _diag(
                "warning",
                "fbx-version",
                f"FBX {version // 1000}.{version % 1000} uses 64-bit record headers; this "
                "reader tries the documented layout, but if the node tree comes back empty "
                "re-export as FBX 7.4 (2014)",
            )
        )
    at = 27
    roots: list[Node] = []
    while at < len(raw):
        node, at = _read_binary_node(raw, at, version)
        if node is None:
            break
        roots.append(node)
    root = next((node for node in roots if node.name == "FBXHeaderExtension"), None)
    # The file is a tree whose top-level records are the sections; keep them together.
    top = Node("<fbx>", [], roots)
    return top, version, diagnostics


# ---------------------------------------------------------------------------
# ASCII
# ---------------------------------------------------------------------------

_ASCII_TOKEN = re.compile(
    r"""
    (?P<space>[ \t\r]+)
  | (?P<newline>\n)
  | (?P<comment>;[^\n]*)
  | (?P<string>"(?:[^"\\]|\\.)*")
  | (?P<punct>[{}:,*])
  | (?P<number>[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?L?)
  | (?P<ident>[^\s{}:,;*"]+)
    """,
    re.VERBOSE,
)


def _ascii_tokens(text: str) -> list[tuple[str, str, int]]:
    tokens: list[tuple[str, str, int]] = []
    line = 1
    at = 0
    while at < len(text):
        match = _ASCII_TOKEN.match(text, at)
        if not match:
            raise FbxError(f"cannot tokenise the ASCII FBX at line {line}: {text[at:at + 40]!r}")
        at = match.end()
        kind = match.lastgroup or ""
        value = match.group()
        if kind == "newline":
            tokens.append(("newline", "\n", line))
            line += 1
        elif kind in ("space", "comment"):
            continue
        elif kind == "string":
            raw = value[1:-1]
            raw = raw.replace('\\"', '"').replace("\\\\", "\\")
            tokens.append(("value", raw, line))
        elif kind == "number":
            tokens.append(("value", value.rstrip("L"), line))
        elif kind == "punct":
            tokens.append((value, value, line))
        else:
            tokens.append(("ident", value, line))
    return tokens


def _ascii_number(value: str) -> int | float:
    try:
        number = float(value)
    except ValueError:
        return value
    return int(number) if number.is_integer() and "." not in value and "e" not in value.lower() else number


def _parse_ascii(text: str) -> tuple[Node, int]:
    tokens = _ascii_tokens(text)
    at = 0

    def parse_block() -> list[Node]:
        nonlocal at
        nodes: list[Node] = []
        while at < len(tokens):
            kind, value, line = tokens[at]
            if kind == "newline":
                at += 1
                continue
            if kind == "}":
                at += 1
                return nodes
            if kind != "ident":
                raise FbxError(f"line {line}: expected a record name, got {value!r}")
            name = value
            at += 1
            props: list[Any] = []
            children: list[Node] = []
            if at < len(tokens) and tokens[at][0] == ":":
                at += 1
                while at < len(tokens):
                    kind, value, line = tokens[at]
                    if kind == "newline":
                        # Arrays wrap in ASCII FBX. A new line that starts with a value
                        # continues this record; a new line that starts with a name is the
                        # next record. A name is only ever a record start here, so the look
                        # ahead is unambiguous.
                        probe = at + 1
                        while probe < len(tokens) and tokens[probe][0] == "newline":
                            probe += 1
                        if probe < len(tokens) and tokens[probe][0] in ("value", ","):
                            at += 1
                            continue
                        break
                    if kind in ("{", "}"):
                        break
                    if kind == ",":
                        at += 1
                        continue
                    if kind == "*":
                        at += 1
                        if at < len(tokens) and tokens[at][0] == "value":
                            props.append(("arraycount", int(_ascii_number(tokens[at][1]))))
                            at += 1
                        continue
                    if kind in ("value", "ident"):
                        props.append(_ascii_number(value) if kind == "value" else value)
                        at += 1
                        continue
                    raise FbxError(f"line {line}: unexpected token {value!r} in {name}")
            if at < len(tokens) and tokens[at][0] == "{":
                at += 1
                children = parse_block()
            nodes.append(Node(name, props, children))
        return nodes

    roots = parse_block()
    version = 0
    for probe in roots:
        if probe.name == "FBXHeaderExtension":
            found = probe.find("FBXVersion")
            if found and found.props:
                version = int(found.props[0])
    return Node("<fbx>", [], roots), version


# ---------------------------------------------------------------------------
# Scene model: objects, connections, transforms
# ---------------------------------------------------------------------------


def _object_class(node: Node) -> str:
    raw = node.props[1] if len(node.props) > 1 else ""
    if not isinstance(raw, str):
        raw = str(raw)
    return raw.split("\x00", 1)[0]


def _object_name(node: Node) -> str:
    label = _object_class(node)
    if "::" in label:
        label = label.split("::", 1)[1]
    label = label.split("\x00", 1)[0].strip()
    if not label:
        label = node.name
    return label


def _object_type(node: Node) -> str:
    kind = node.props[2] if len(node.props) > 2 else ""
    return str(kind).split("\x00", 1)[0]


class Scene:
    def __init__(self, root: Node) -> None:
        self.root = root
        self.objects: dict[int, Node] = {}
        self.classes: dict[int, str] = {}
        self.names: dict[int, str] = {}
        self.parent: dict[int, int] = {}
        self.parents: dict[int, list[int]] = {}
        self.children: dict[int, list[int]] = {}
        self.geometry_of: dict[int, int] = {}
        self.materials_of: dict[int, list[int]] = {}
        self.skin_of_geometry: dict[int, int] = {}
        self.clusters_of_skin: dict[int, list[int]] = {}
        self.material_name: dict[int, str] = {}
        # (child, parent, property) links; animation curve nodes target models through these.
        self.op_links: list[tuple[int, int, str]] = []

        objects = root.find("Objects")
        if objects is None:
            raise FbxError("the file has no Objects section")
        for node in objects.children:
            identifier = self._id(node)
            if identifier is None:
                continue
            self.objects[identifier] = node
            self.classes[identifier] = _object_class(node)
            self.names[identifier] = _object_name(node)
            if node.name == "Material":
                self.material_name[identifier] = _object_name(node)

        connections = root.find("Connections")
        for connection in connections.all("C") if connections else []:
            if len(connection.props) < 3:
                continue
            kind = str(connection.props[0])
            child = self._as_id(connection.props[1])
            parent = self._as_id(connection.props[2])
            if child is None or parent is None:
                continue
            if kind == "OP":
                if len(connection.props) >= 4:
                    self.op_links.append((child, parent, str(connection.props[3])))
                continue
            if kind != "OO":
                continue
            self.parent[child] = parent
            self.parents.setdefault(child, []).append(parent)
            self.children.setdefault(parent, []).append(child)
            child_node = self.objects.get(child)
            parent_node = self.objects.get(parent)
            if child_node is None or parent_node is None:
                continue
            if child_node.name == "Geometry" and parent_node.name == "Model":
                self.geometry_of[parent] = child
            elif child_node.name == "Material" and parent_node.name == "Model":
                self.materials_of.setdefault(parent, []).append(child)
            elif child_node.name == "Deformer" and parent_node.name == "Geometry":
                if _object_type(child_node) == "Skin":
                    self.skin_of_geometry[parent] = child
            elif child_node.name == "Deformer" and parent_node.name == "Deformer":
                if _object_type(parent_node) == "Skin":
                    self.clusters_of_skin.setdefault(parent, []).append(child)

    @staticmethod
    def _id(node: Node) -> int | None:
        if not node.props:
            return None
        return Scene._as_id(node.props[0])

    @staticmethod
    def _as_id(value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return int(value)
        text = str(value).strip().rstrip("L")
        return int(text) if text.lstrip("+-").isdigit() else None

    def of_class(self, name: str) -> list[int]:
        return [identifier for identifier, node in self.objects.items() if node.name == name]

    def models(self) -> list[int]:
        return self.of_class("Model")

    def model_type(self, identifier: int) -> str:
        node = self.objects.get(identifier)
        return _object_type(node) if node is not None else ""

    def model_children(self, identifier: int) -> list[int]:
        return [
            child
            for child in self.children.get(identifier, [])
            if child in self.objects and self.objects[child].name == "Model"
        ]

    def model_roots(self) -> list[int]:
        return [
            identifier
            for identifier in self.models()
            if self.parent.get(identifier) not in self.objects
            or self.objects[self.parent[identifier]].name != "Model"
        ]


def _properties70(node: Node) -> dict[str, list[Any]]:
    values: dict[str, list[Any]] = {}
    block = node.find("Properties70")
    if block is None:
        return values
    for entry in block.all("P"):
        if len(entry.props) < 5:
            continue
        key = str(entry.props[0])
        values[key] = list(entry.props[4:])
    return values


def _vec3(values: Sequence[Any], default: tuple[float, float, float]) -> tuple[float, float, float]:
    if len(values) < 3:
        return default
    try:
        return (float(values[0]), float(values[1]), float(values[2]))
    except (TypeError, ValueError):
        return default


def _rot_xyz(degrees: Sequence[float], order: int = 0) -> Mat4:
    x, y, z = (math.radians(float(value)) for value in degrees[:3])
    cx, sx = math.cos(x), math.sin(x)
    cy, sy = math.cos(y), math.sin(y)
    cz, sz = math.cos(z), math.sin(z)
    rx: Mat4 = [[1, 0, 0, 0], [0, cx, -sx, 0], [0, sx, cx, 0], [0, 0, 0, 1]]
    ry: Mat4 = [[cy, 0, sy, 0], [0, 1, 0, 0], [-sy, 0, cy, 0], [0, 0, 0, 1]]
    rz: Mat4 = [[cz, -sz, 0, 0], [sz, cz, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    # RotationOrder: 0 XYZ, 1 XZY, 2 YZX, 3 YXZ, 4 ZXY, 5 ZYX. Column vectors, so the
    # named order is applied last-to-first in the product.
    products = {
        0: (rz, ry, rx),
        1: (ry, rz, rx),
        2: (rx, rz, ry),
        3: (rz, rx, ry),
        4: (ry, rx, rz),
        5: (rx, ry, rz),
    }
    first, second, third = products.get(order, products[0])
    return mat4_mul(first, mat4_mul(second, third))


def _local_transform(
    model: Node,
    diagnostics: list[dict[str, Any]],
    translation: Sequence[float] | None = None,
    rotation: Sequence[float] | None = None,
    scale: Sequence[float] | None = None,
) -> Mat4:
    props = _properties70(model)
    translation = _vec3(
        list(translation) if translation is not None else props.get("Lcl Translation", []),
        (0.0, 0.0, 0.0),
    )
    rotation = _vec3(
        list(rotation) if rotation is not None else props.get("Lcl Rotation", []),
        (0.0, 0.0, 0.0),
    )
    scale = _vec3(
        list(scale) if scale is not None else props.get("Lcl Scaling", []),
        (1.0, 1.0, 1.0),
    )
    rotation_offset = _vec3(props.get("RotationOffset", []), (0.0, 0.0, 0.0))
    rotation_pivot = _vec3(props.get("RotationPivot", []), (0.0, 0.0, 0.0))
    pre_rotation = _vec3(props.get("PreRotation", []), (0.0, 0.0, 0.0))
    post_rotation = _vec3(props.get("PostRotation", []), (0.0, 0.0, 0.0))
    scaling_offset = _vec3(props.get("ScalingOffset", []), (0.0, 0.0, 0.0))
    scaling_pivot = _vec3(props.get("ScalingPivot", []), (0.0, 0.0, 0.0))
    order_raw = props.get("RotationOrder", [0])
    try:
        order = int(order_raw[0]) if order_raw else 0
    except (TypeError, ValueError):
        order = 0
    if order not in range(6):
        diagnostics.append(
            _diag(
                "warning",
                "fbx-rotation-order",
                f"{_object_name(model)}: rotation order {order} is not one of XYZ/XZY/YZX/"
                "YXZ/ZXY/ZYX; XYZ was used",
            )
        )
        order = 0

    # FBX SDK's chain, in column-vector order. The halves that the SDK writes as an
    # inverse (Rpost^-1, Rp^-1) are the same matrices with negated angles/translation.
    matrix = mat4_translation(*translation)
    matrix = mat4_mul(matrix, mat4_translation(*rotation_offset))
    matrix = mat4_mul(matrix, mat4_translation(*rotation_pivot))
    matrix = mat4_mul(matrix, _rot_xyz(pre_rotation, order))
    matrix = mat4_mul(matrix, _rot_xyz(rotation, order))
    matrix = mat4_mul(matrix, _rot_xyz([-v for v in post_rotation], order))
    matrix = mat4_mul(matrix, mat4_translation(*(-v for v in rotation_pivot)))
    matrix = mat4_mul(matrix, mat4_translation(*scaling_offset))
    matrix = mat4_mul(matrix, mat4_translation(*scaling_pivot))
    matrix = mat4_mul(matrix, mat4_scale(*scale))
    matrix = mat4_mul(matrix, mat4_translation(*(-v for v in scaling_pivot)))
    return matrix


def _geometric_offset(model: Node) -> Mat4:
    """The part of the model transform that moves geometry but not child bones."""
    props = _properties70(model)
    translation = _vec3(props.get("GeometricTranslation", []), (0.0, 0.0, 0.0))
    rotation = _vec3(props.get("GeometricRotation", []), (0.0, 0.0, 0.0))
    scaling = _vec3(props.get("GeometricScaling", []), (1.0, 1.0, 1.0))
    return mat4_mul(
        mat4_translation(*translation),
        mat4_mul(_rot_xyz(rotation), mat4_scale(*scaling)),
    )


def _matrix_property(node: Node | None, key: str) -> Mat4 | None:
    if node is None:
        return None
    props = _properties70(node)
    values = props.get(key)
    if not values or len(values) != 16:
        return None
    # FBX matrices are row-major row-vector; transpose into the column-vector convention.
    rows = [[float(values[row * 4 + col]) for col in range(4)] for row in range(4)]
    return [[rows[col][row] for col in range(4)] for row in range(4)]


def _up_axis(root: Node) -> int:
    settings = root.find("GlobalSettings")
    node = settings.find("Properties70") if settings else None
    if node is None:
        return 1
    for entry in node.all("P"):
        if entry.props and str(entry.props[0]) == "UpAxis" and len(entry.props) >= 5:
            try:
                return int(entry.props[4])
            except (TypeError, ValueError):
                return 1
    return 1


def _unit_scale(root: Node) -> float | None:
    settings = root.find("GlobalSettings")
    node = settings.find("Properties70") if settings else None
    if node is None:
        return None
    for entry in node.all("P"):
        if entry.props and str(entry.props[0]) == "UnitScaleFactor" and len(entry.props) >= 5:
            try:
                return float(entry.props[4])
            except (TypeError, ValueError):
                return None
    return None


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def _numbers(node: Node | None) -> list[float]:
    """The numeric payload of an array record, in either encoding.

    Binary stores the whole array as one property; ASCII writes ``*N`` and puts the values
    in an ``a`` child. Both are normalised here, and a bare ``*N`` count is never mistaken
    for the data.
    """
    if node is None:
        return []
    if len(node.props) == 1 and isinstance(node.props[0], list):
        return [float(value) for value in node.props[0] if isinstance(value, (int, float))]
    if node.props and all(isinstance(value, (int, float)) for value in node.props):
        return [float(value) for value in node.props]
    inner = node.find("a")
    if inner is not None:
        return [float(value) for value in inner.props if isinstance(value, (int, float))]
    return []


def _mapping(node: Node | None) -> tuple[str, str]:
    if node is None:
        return ("", "")
    mapping = node.find("MappingInformationType")
    reference = node.find("ReferenceInformationType")
    return (
        str(mapping.props[0]) if mapping and mapping.props else "",
        str(reference.props[0]) if reference and reference.props else "",
    )


def _polygons(indices: Sequence[float]) -> Iterator[list[int]]:
    polygon: list[int] = []
    for raw in indices:
        value = int(raw)
        if value < 0:
            polygon.append(-value - 1)
            yield polygon
            polygon = []
        else:
            polygon.append(value)
    if polygon:
        yield polygon


def _vertex_uvs(
    uvs: Sequence[float],
    uv_indices: Sequence[float],
    mapping: str,
    reference: str,
    polygon_vertex: int,
    vertex: int,
) -> tuple[float, float]:
    if not uvs:
        return 0.0, 0.0
    if reference == "IndexToDirect" and uv_indices:
        if mapping == "ByPolygonVertex":
            slot = int(uv_indices[polygon_vertex]) if polygon_vertex < len(uv_indices) else 0
        elif mapping in ("ByVertice", "ByVertex"):
            slot = int(uv_indices[vertex]) if vertex < len(uv_indices) else 0
        else:
            slot = 0
    else:
        if mapping == "ByPolygonVertex":
            slot = polygon_vertex
        elif mapping in ("ByVertice", "ByVertex"):
            slot = vertex
        else:
            slot = 0
    if slot * 2 + 1 >= len(uvs):
        return 0.0, 0.0
    return uvs[slot * 2], uvs[slot * 2 + 1]


def _vertex_normals(
    normals: Sequence[float],
    normal_indices: Sequence[float],
    mapping: str,
    reference: str,
    polygon_vertex: int,
    vertex: int,
    fallback: Sequence[float],
) -> tuple[float, float, float]:
    if not normals:
        return (float(fallback[0]), float(fallback[1]), float(fallback[2]))
    if reference == "IndexToDirect" and normal_indices:
        if mapping == "ByPolygonVertex":
            slot = int(normal_indices[polygon_vertex]) if polygon_vertex < len(normal_indices) else 0
        elif mapping in ("ByVertice", "ByVertex"):
            slot = int(normal_indices[vertex]) if vertex < len(normal_indices) else 0
        else:
            slot = 0
    else:
        if mapping == "ByPolygonVertex":
            slot = polygon_vertex
        elif mapping in ("ByVertice", "ByVertex"):
            slot = vertex
        else:
            slot = 0
    if slot * 3 + 2 >= len(normals):
        return (float(fallback[0]), float(fallback[1]), float(fallback[2]))
    return (normals[slot * 3], normals[slot * 3 + 1], normals[slot * 3 + 2])


# ---------------------------------------------------------------------------
# Reading a document
# ---------------------------------------------------------------------------


def _load(path: Path) -> tuple[Node, int, str, list[dict[str, Any]]]:
    raw = path.read_bytes()
    if raw.startswith(_BINARY_MAGIC):
        root, version, diagnostics = _parse_binary(raw)
        return root, version, "binary", diagnostics
    text = raw.decode("utf-8-sig", "replace")
    if "FBXHeaderExtension" not in text and "Objects:" not in text:
        raise FbxError(
            f"{path} is neither a binary FBX (bad magic) nor an ASCII FBX (no Objects section); "
            "if it is compressed or encrypted, re-export it uncompressed"
        )
    root, version = _parse_ascii(text)
    return root, version, "ascii", []


def _scene_summary(root: Node, version: int, fmt: str) -> dict[str, Any]:
    scene = Scene(root)
    models = scene.models()
    geometries = scene.of_class("Geometry")
    materials = scene.of_class("Material")
    skins = [identifier for identifier in scene.of_class("Deformer") if _object_type(scene.objects[identifier]) == "Skin"]
    clusters = [identifier for identifier in scene.of_class("Deformer") if _object_type(scene.objects[identifier]) == "Cluster"]
    animations = scene.of_class("AnimationStack")
    bones = [identifier for identifier in models if scene.model_type(identifier) in ("LimbNode", "Null")]
    return {
        "format": fmt,
        "version": version,
        "versionLabel": f"{version // 1000}.{version % 1000}" if version else None,
        "upAxis": _up_axis(root),
        "unitScaleFactor": _unit_scale(root),
        "counts": {
            "models": len(models),
            "bones": len(bones),
            "geometries": len(geometries),
            "materials": len(materials),
            "skins": len(skins),
            "clusters": len(clusters),
            "animations": len(animations),
        },
        "models": [
            {
                "name": scene.names[identifier],
                "type": scene.model_type(identifier) or "Mesh",
                "hasGeometry": identifier in scene.geometry_of,
                "materials": [scene.material_name.get(m, "") for m in scene.materials_of.get(identifier, [])],
            }
            for identifier in models
        ],
        "materials": [scene.material_name[identifier] for identifier in materials],
        "animations": [scene.names[identifier] for identifier in animations],
        "scene": scene,
    }


def fbx_read(req: dict[str, Any]) -> dict[str, Any]:
    source = Path(str(req.get("path", ""))).resolve()
    if not source.is_file():
        raise FbxError(f"{source} does not exist")
    root, version, fmt, diagnostics = _load(source)
    summary = _scene_summary(root, version, fmt)
    scene: Scene = summary.pop("scene")
    diagnostics = list(diagnostics)

    geometries = []
    for identifier in scene.of_class("Geometry"):
        node = scene.objects[identifier]
        vertices = _numbers(node.find("Vertices"))
        polygons = _numbers(node.find("PolygonVertexIndex"))
        triangles = sum(max(0, len(polygon) - 2) for polygon in _polygons(polygons))
        geometries.append(
            {
                "name": scene.names[identifier],
                "vertices": len(vertices) // 3,
                "polygons": sum(1 for _ in _polygons(polygons)),
                "triangles": triangles,
                "hasNormals": node.find("LayerElementNormal") is not None,
                "hasUVs": node.find("LayerElementUV") is not None,
                "skinned": identifier in scene.skin_of_geometry,
            }
        )
    summary["geometries"] = geometries
    summary["bones"] = [
        {"name": scene.names[identifier], "type": scene.model_type(identifier)}
        for identifier in scene.models()
        if scene.model_type(identifier) in ("LimbNode", "Null")
    ]
    summary["animations"] = [scene.names[identifier] for identifier in scene.of_class("AnimationStack")]
    if not geometries:
        diagnostics.append(
            _diag("warning", "fbx-no-geometry", "the file has no Geometry object; nothing can be exported")
        )
    if summary["animations"]:
        diagnostics.append(
            _diag(
                "warning",
                "fbx-animations",
                f"{len(summary['animations'])} animation stack(s) are reported but not exported: "
                "SMD sequence export from FBX is not implemented yet",
            )
        )
    summary.setdefault("counts", {})
    summary["counts"]["geometries"] = len(geometries)
    return {
        "path": str(source),
        "read": True,
        **summary,
        "diagnostics": diagnostics,
    }


# ---------------------------------------------------------------------------
# FBX -> SMD
# ---------------------------------------------------------------------------


def _unique_names(names: Sequence[str]) -> list[str]:
    used: dict[str, int] = {}
    out: list[str] = []
    for raw in names:
        name = raw.strip() or "bone"
        if name in used:
            used[name] += 1
            name = f"{name}_{used[name]}"
        else:
            used[name] = 0
        out.append(name)
    return out


def _bone_order(scene: Scene, roots: Sequence[int], wanted: set[int]) -> list[int]:
    """Parent-first order over the models that are bones or ancestors of bones.

    SMD's node table is ordered and a bone may only name a parent that was written before
    it, so a pre-order walk is the whole requirement. A DFS stack, because a rig can be
    deeper than Python's recursion limit only in pathological files, but a deep rig is
    cheap to support this way.
    """
    order: list[int] = []
    stack: list[int] = list(reversed(list(roots)))
    seen: set[int] = set()
    while stack:
        identifier = stack.pop()
        if identifier in seen or identifier not in wanted:
            continue
        seen.add(identifier)
        order.append(identifier)
        for child in reversed(scene.model_children(identifier)):
            stack.append(child)
    return order


# FBX time is stored as KTime ticks. 46186158000 ticks per second is the SDK's constant;
# ASCII exporters may write seconds instead, so the range decides which unit this is.
_FBX_TICKS_PER_SECOND = 46_186_158_000.0


def _curve_keys(curve: Node) -> list[tuple[float, float]]:
    times = _numbers(curve.find("KeyTime"))
    values = _numbers(curve.find("KeyValueFloat"))
    count = min(len(times), len(values))
    if count == 0:
        return []
    scale = (
        _FBX_TICKS_PER_SECOND
        if max(abs(value) for value in times[:count]) > 1_000_000
        else 1.0
    )
    return [(times[index] / scale, values[index]) for index in range(count)]


def _sample_keys(keys: Sequence[tuple[float, float]], time: float, default: float) -> float:
    """Piecewise-linear sample. FBX tangents are cubic; linear is the honest fallback."""
    if not keys:
        return default
    if time <= keys[0][0]:
        return keys[0][1]
    if time >= keys[-1][0]:
        return keys[-1][1]
    starts = [key[0] for key in keys]
    index = bisect.bisect_right(starts, time) - 1
    index = max(0, min(index, len(keys) - 2))
    t0, v0 = keys[index]
    t1, v1 = keys[index + 1]
    if t1 <= t0:
        return v1
    ratio = (time - t0) / (t1 - t0)
    return v0 + (v1 - v0) * ratio


def _scene_animations(scene: Scene) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Animation stacks as `{name, tracks, start, end}`, and the notes about what was lost.

    A stack owns layers, a layer owns curve nodes, and a curve node is connected to the
    Model it drives with an `OP` link whose property is `Lcl Translation`, `Lcl Rotation` or
    `Lcl Scaling`. Its `X`/`Y`/`Z` curves are the other `OP` links, property `d|X`/`d|Y`/
    `d|Z`. A file that only uses `OO` links loses the channel names; the curves are then
    assigned in order X, Y, Z and the assumption is reported.
    """
    notes: list[dict[str, Any]] = []
    stacks = [
        identifier
        for identifier, node in scene.objects.items()
        if node.name == "AnimationStack"
    ]
    results: list[dict[str, Any]] = []
    for stack in stacks:
        layers = [
            child
            for child in scene.children.get(stack, [])
            if scene.objects.get(child) is not None
            and scene.objects[child].name == "AnimationLayer"
        ]
        if len(layers) > 1:
            notes.append(
                _diag(
                    "warning",
                    "fbx-animation-layers",
                    f"{scene.names[stack]}: {len(layers)} layers; they are merged in order, "
                    "later channels win",
                )
            )
        tracks: dict[int, dict[str, dict[str, list[tuple[float, float]]]]] = {}
        times: list[float] = []
        for layer in layers:
            for curve_node in scene.children.get(layer, []):
                node = scene.objects.get(curve_node)
                if node is None or node.name != "AnimationCurveNode":
                    continue
                target = next(
                    (
                        (parent, prop)
                        for child, parent, prop in scene.op_links
                        if child == curve_node
                        and scene.objects.get(parent) is not None
                        and scene.objects[parent].name == "Model"
                    ),
                    None,
                )
                if target is None:
                    continue
                model, prop = target
                channels: dict[str, list[tuple[float, float]]] = {}
                for child in scene.children.get(curve_node, []):
                    curve = scene.objects.get(child)
                    if curve is None or curve.name != "AnimationCurve":
                        continue
                    channel = next(
                        (
                            name[-1].upper()
                            for source, parent, name in scene.op_links
                            if source == child and parent == curve_node and name.startswith("d|")
                        ),
                        None,
                    )
                    if channel is None:
                        channel = ["X", "Y", "Z"][len(channels)] if len(channels) < 3 else None
                        if channel is not None:
                            notes.append(
                                _diag(
                                    "warning",
                                    "fbx-animation-channel",
                                    f"{scene.names[stack]}: a curve has no d|X/d|Y/d|Z link; "
                                    "its channel was assumed from the connection order",
                                )
                            )
                    keys = _curve_keys(curve)
                    if channel is None or not keys:
                        continue
                    channels[channel] = keys
                    times.extend(key[0] for key in keys)
                if channels:
                    tracks.setdefault(model, {})[prop] = channels
        if not times or not tracks:
            notes.append(
                _diag(
                    "warning",
                    "fbx-animation-empty",
                    f"{scene.names[stack]}: no curve values; the stack is skipped",
                )
            )
            continue
        results.append(
            {
                "name": scene.names[stack],
                "tracks": tracks,
                "start": min(times),
                "end": max(times),
                "notes": [
                    note for note in notes if scene.names[stack] in str(note.get("message", ""))
                ],
            }
        )
    return results, notes


def _model_parent(scene: Scene, identifier: int) -> int | None:
    """The Model a cluster/geometry belongs to.

    A cluster has two connections: one to the Skin deformer and one to the bone Model. The
    single `parent` map is the hierarchy and keeps the last one; this asks the question the
    bone table actually needs, and a file that only writes the skin link still imports.
    """
    for parent in scene.parents.get(identifier, []):
        node = scene.objects.get(parent)
        if node is not None and node.name == "Model":
            return parent
    return None


def fbx_to_smd(req: dict[str, Any]) -> dict[str, Any]:
    from smd import smd_write

    source = Path(str(req.get("path", ""))).resolve()
    if not source.is_file():
        raise FbxError(f"{source} does not exist")
    root, version, fmt, diagnostics = _load(source)
    scene = Scene(root)

    axis_option = str(req.get("axis", "auto")).lower()
    if axis_option not in ("auto", "y", "z"):
        raise FbxError("axis must be 'auto', 'y' or 'z'")
    file_up = _up_axis(root)
    if axis_option == "auto":
        axis_y = file_up == 1
    else:
        axis_y = axis_option == "y"
        if axis_y and file_up != 1:
            diagnostics.append(
                _diag(
                    "warning",
                    "fbx-axis-override",
                    f"the file says UpAxis {file_up} but axis:'y' was requested",
                )
            )
        if not axis_y and file_up == 1 and req.get("axis") is not None:
            diagnostics.append(
                _diag(
                    "warning",
                    "fbx-axis-override",
                    "the file is Y-up but axis:'z' was requested; geometry stays as authored",
                )
            )

    scale = float(req.get("scale", 1.0))
    if not math.isfinite(scale) or scale <= 0.0:
        raise FbxError("scale must be a positive finite number")
    flip_v = bool(req.get("flipV", True))
    use_transforms = bool(req.get("useNodeTransforms", True))
    fallback_material = str(req.get("material") or "debug/debugempty")
    limit_vertices = int(req.get("limitVertices", 2_000_000))
    include = [str(name).lower() for name in (req.get("models") or [])]
    export_animations = bool(req.get("exportAnimations", True))
    animation_fps = float(req.get("animationFps", 30.0))
    if not math.isfinite(animation_fps) or animation_fps <= 0.0:
        raise FbxError("animationFps must be a positive finite number")
    animation_filter = [str(name).lower() for name in (req.get("animations") or [])]
    max_animation_frames = int(req.get("maxAnimationFrames", 20_000))
    collision = str(req.get("collision", "none")).lower()
    if collision not in {"none", "box", "hull"}:
        raise FbxError("collision must be 'none', 'box' or 'hull'")
    mass = float(req.get("mass", 10.0))
    if not math.isfinite(mass) or mass <= 0.0:
        raise FbxError("mass must be a positive finite number")
    collision_thickness = float(req.get("collisionThickness", 1.0))
    if not math.isfinite(collision_thickness) or collision_thickness <= 0.0:
        raise FbxError("collisionThickness must be a positive finite number")

    unit = _unit_scale(root)
    if unit and abs(unit - 1.0) > 1e-6 and abs(unit - 2.54) > 1e-6:
        diagnostics.append(
            _diag(
                "warning",
                "fbx-units",
                f"UnitScaleFactor is {unit:g}: FBX is often centimetres while Source units are "
                "inches. Pass scale:0.3937 for a 1:1 centimetre file, or scale:1 if the DCC "
                "already wrote Source-sized units",
            )
        )

    # Every mesh model, optionally filtered by name.
    mesh_models: list[int] = []
    for identifier in scene.models():
        if identifier not in scene.geometry_of:
            continue
        if include and scene.names[identifier].lower() not in include:
            continue
        mesh_models.append(identifier)
    if not mesh_models:
        raise FbxError(
            f"{source}: no mesh model is selected"
            + (f" by models {include!r}" if include else " (no Model has a connected Geometry)")
        )

    # Parent map and world transforms.
    world_cache: dict[int, Mat4] = {}
    local_cache: dict[int, Mat4] = {}

    def local(identifier: int) -> Mat4:
        if identifier not in local_cache:
            local_cache[identifier] = _local_transform(scene.objects[identifier], diagnostics)
        return local_cache[identifier]

    def world(identifier: int, guard: set[int] | None = None) -> Mat4:
        if identifier in world_cache:
            return world_cache[identifier]
        guard = set() if guard is None else guard
        if identifier in guard:
            return mat4_identity()
        guard.add(identifier)
        parent = scene.parent.get(identifier)
        if parent is None or parent not in scene.objects or scene.objects[parent].name != "Model":
            result = local(identifier)
        else:
            result = mat4_mul(world(parent, guard), local(identifier))
        world_cache[identifier] = result
        return result

    # Bones: every LimbNode/Null model, the parents of mesh models, and any model a cluster
    # names. Ancestors are included because an SMD node table cannot skip a level.
    bone_set: set[int] = {
        identifier
        for identifier in scene.models()
        if scene.model_type(identifier) in ("LimbNode", "Null")
    }
    for model in mesh_models:
        parent = scene.parent.get(model)
        while parent is not None and parent in scene.objects and scene.objects[parent].name == "Model":
            bone_set.add(parent)
            parent = scene.parent.get(parent)
    cluster_bone: dict[int, int] = {}
    for skin, clusters in scene.clusters_of_skin.items():
        for cluster in clusters:
            model = _model_parent(scene, cluster)
            if model is None or model not in scene.objects:
                continue
            cluster_bone[cluster] = model
            bone_set.add(model)
            parent = scene.parent.get(model)
            while parent is not None and parent in scene.objects and scene.objects[parent].name == "Model":
                bone_set.add(parent)
                parent = scene.parent.get(parent)

    if bone_set:
        bone_roots = [
            identifier
            for identifier in scene.model_roots()
            if identifier in bone_set
        ]
    else:
        bone_roots = []
    bone_order = _bone_order(scene, bone_roots, bone_set)
    if not bone_order:
        # A static mesh: one bone named after the model.
        bone_order = [mesh_models[0]]
        bone_set = {mesh_models[0]}

    bone_names = _unique_names([scene.names[identifier] for identifier in bone_order])
    bone_of_model = {identifier: index for index, identifier in enumerate(bone_order)}
    bone_parent: list[int | None] = []
    for identifier in bone_order:
        parent = scene.parent.get(identifier)
        while parent is not None and parent not in bone_of_model and parent in scene.objects:
            parent = scene.parent.get(parent)
        bone_parent.append(bone_of_model.get(parent) if parent is not None else None)

    # Scene transform: axis change and the requested scale.
    scene_matrix = mat4_axis_scale(axis_y, scale)

    # Bind world per bone: the cluster's TransformLink wins, because that is the pose the
    # mesh was skinned in. Node TRS is the rest pose and may differ.
    bind_world: dict[int, Mat4] = {}
    for skin, clusters in scene.clusters_of_skin.items():
        for cluster in clusters:
            model = cluster_bone.get(cluster)
            node = scene.objects.get(cluster)
            if model is None or node is None:
                continue
            matrix = _matrix_property(node, "TransformLink") or _matrix_property(node, "Transform")
            if matrix is not None:
                bind_world[model] = matrix
    for identifier in bone_order:
        if identifier not in bind_world:
            bind_world[identifier] = world(identifier)

    # The bind pose must be a consistent hierarchy: a cluster world is absolute, so a bone's
    # local is inverse(parent world) * bone world. Bones without clusters use node TRS.
    bone_world: dict[int, Mat4] = {}
    frames: list[dict[str, Any]] = []
    scale_warnings = 0
    mirrored_warnings = 0
    for identifier in bone_order:
        bone_world[identifier] = mat4_mul(scene_matrix, bind_world[identifier])
    for index, identifier in enumerate(bone_order):
        parent = bone_parent[index]
        current = bone_world[identifier]
        if parent is None:
            transform = current
        else:
            inverse = mat4_inverse(bone_world[bone_order[parent]])
            transform = mat4_identity() if inverse is None else mat4_mul(inverse, current)
        translation, quaternion, bone_scale, mirrored = mat4_decompose(transform)
        if mirrored:
            mirrored_warnings += 1
        if parent is not None and any(abs(value - 1.0) > 1e-3 for value in bone_scale):
            scale_warnings += 1
        roll, pitch, yaw = euler_xyz(quaternion)
        frames.append(
            {
                "bone": index,
                "position": [round(value, 6) for value in translation],
                "rotation": [round(roll, 6), round(pitch, 6), round(yaw, 6)],
            }
        )
    if scale_warnings:
        diagnostics.append(
            _diag(
                "warning",
                "fbx-bone-scale",
                f"{scale_warnings} bone(s) carry a scale other than 1; SMD has no bone scale, "
                "so only rotation and translation were written",
            )
        )

    triangles: list[dict[str, Any]] = []
    materials_seen: dict[str, int] = {}
    vertex_total = 0
    skipped_geometry = 0
    normal_fallbacks = 0
    uv_fallbacks = 0
    unweighted = 0
    for model in mesh_models:
        geometry_id = scene.geometry_of[model]
        geometry = scene.objects[geometry_id]
        positions = _numbers(geometry.find("Vertices"))
        indices = _numbers(geometry.find("PolygonVertexIndex"))
        if not positions or not indices:
            skipped_geometry += 1
            diagnostics.append(
                _diag(
                    "warning",
                    "fbx-empty-geometry",
                    f"{scene.names[model]}: Vertices or PolygonVertexIndex is empty; skipped",
                )
            )
            continue

        mesh_world = mat4_mul(scene_matrix, world(model))
        if not use_transforms:
            mesh_world = scene_matrix
        mesh_world = mat4_mul(mesh_world, _geometric_offset(scene.objects[model]))
        normal_matrix = mat3_normal(mesh_world)

        material_ids = scene.materials_of.get(model, [])
        material_names = [scene.material_name.get(identifier, "material") for identifier in material_ids]
        if not material_names:
            material_names = [fallback_material]

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

        skins = [
            skin
            for geometry_key, skin in scene.skin_of_geometry.items()
            if geometry_key == geometry_id
        ]
        weights: dict[int, list[dict[str, Any]]] = {}
        if skins:
            for cluster_id in scene.clusters_of_skin.get(skins[0], []):
                node = scene.objects.get(cluster_id)
                model_id = cluster_bone.get(cluster_id)
                if node is None or model_id is None or model_id not in bone_of_model:
                    continue
                bone = bone_of_model[model_id]
                cluster_indices = _numbers(node.find("Indexes"))
                cluster_weights = _numbers(node.find("Weights"))
                for slot, vertex_index in enumerate(cluster_indices):
                    if slot >= len(cluster_weights):
                        break
                    vertex = int(vertex_index)
                    weight = float(cluster_weights[slot])
                    if weight <= 1e-6:
                        continue
                    weights.setdefault(vertex, []).append({"bone": bone, "weight": weight})

        fallback_bone = bone_of_model.get(model, 0)
        polygon_start = 0
        for polygon_index, polygon in enumerate(_polygons(indices)):
            if polygon_index < len(material_slots) and material_mapping != "AllSame":
                slot = int(material_slots[polygon_index])
            else:
                slot = 0
            material = material_names[slot] if 0 <= slot < len(material_names) else material_names[0]
            # A fan turns an n-gon into n-2 triangles; each triangle keeps the polygon-vertex
            # slots of the corners it uses (0, corner, corner+1), which is what the normal
            # and UV layers are indexed by under ByPolygonVertex.
            for corner in range(1, len(polygon) - 1):
                corners: list[dict[str, Any]] = []
                for offset, vertex in enumerate((polygon[0], polygon[corner], polygon[corner + 1])):
                    polygon_vertex = polygon_start + (0 if offset == 0 else corner + offset - 1)
                    if vertex < 0 or vertex * 3 + 2 >= len(positions):
                        raise FbxError(
                            f"{scene.names[model]}: vertex {vertex} is outside the "
                            f"{len(positions) // 3}-vertex Vertices array"
                        )
                    point = mat4_transform_point(
                        mesh_world, (positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2])
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
                    if not normals:
                        normal_fallbacks += 1
                    normal = (
                        normal_matrix[0][0] * normal[0] + normal_matrix[0][1] * normal[1] + normal_matrix[0][2] * normal[2],
                        normal_matrix[1][0] * normal[0] + normal_matrix[1][1] * normal[1] + normal_matrix[1][2] * normal[2],
                        normal_matrix[2][0] * normal[0] + normal_matrix[2][1] * normal[1] + normal_matrix[2][2] * normal[2],
                    )
                    normal = normalize3(normal)
                    u, v = _vertex_uvs(
                        uvs,
                        uv_indices,
                        uv_mapping,
                        uv_reference,
                        polygon_vertex,
                        vertex,
                    )
                    if not uvs:
                        uv_fallbacks += 1
                    if flip_v:
                        v = 1.0 - v
                    links = weights.get(vertex)
                    if not links:
                        unweighted += 1
                        links = [{"bone": fallback_bone, "weight": 1.0}]
                    else:
                        total = sum(link["weight"] for link in links)
                        if total > 0.0:
                            links = [
                                {"bone": link["bone"], "weight": round(link["weight"] / total, 6)}
                                for link in links
                            ]
                    corners.append(
                        {
                            "position": [round(value, 6) for value in point],
                            "normal": [round(value, 6) for value in normal],
                            "uv": [round(u, 6), round(v, 6)],
                            "links": links,
                        }
                    )
                triangles.append({"material": material, "vertices": corners})
                materials_seen[material] = materials_seen.get(material, 0) + 1
                vertex_total += 3
                if vertex_total > limit_vertices:
                    raise FbxError(
                        f"{source}: more than {limit_vertices} vertices were produced; raise "
                        "limitVertices only if this is really the intended model"
                    )
            polygon_start += len(polygon)

    if not triangles:
        raise FbxError(f"{source}: no triangles were produced; see diagnostics")
    if skipped_geometry:
        diagnostics.append(
            _diag("warning", "fbx-skipped-geometry", f"{skipped_geometry} geometry object(s) were empty and skipped")
        )
    if normal_fallbacks:
        diagnostics.append(
            _diag(
                "warning",
                "fbx-no-normals",
                f"{normal_fallbacks} polygon-vertex/vertices had no normal and use +Z; the model "
                "will shade flat",
            )
        )
    if uv_fallbacks:
        diagnostics.append(
            _diag(
                "warning",
                "fbx-no-uvs",
                f"{uv_fallbacks} polygon-vertex/vertices had no UV and use (0,0); textures will "
                "stretch",
            )
        )
    if unweighted:
        diagnostics.append(
            _diag(
                "warning",
                "fbx-unweighted",
                f"{unweighted} polygon-vertex/vertices had no skin weight and were bound to one "
                "bone at weight 1",
            )
        )
    if len(mesh_models) > 1:
        diagnostics.append(
            _diag(
                "info",
                "fbx-multi-mesh",
                f"{len(mesh_models)} mesh models were merged into one SMD; $bodygroup-per-object "
                "is a QC decision, not something an FBX can express",
            )
        )
    animation_stacks = scene.of_class("AnimationStack")
    if animation_stacks and not export_animations:
        diagnostics.append(
            _diag(
                "warning",
                "fbx-animations",
                f"{len(animation_stacks)} animation stack(s) were not exported because "
                "exportAnimations is false; the bind pose is written",
            )
        )
    blend_shapes = [
        identifier
        for identifier in scene.of_class("Deformer")
        if _object_type(scene.objects[identifier]) == "BlendShape"
    ]
    if blend_shapes:
        diagnostics.append(
            _diag(
                "warning",
                "fbx-blend-shapes",
                f"{len(blend_shapes)} blend-shape deformer(s) were not exported: SMD has no morph "
                "target; use the DMX path for flexes",
            )
        )

    output = Path(str(req.get("out", "") or req.get("output", ""))).resolve()
    if output.suffix.lower() != ".smd":
        output = output.with_suffix(".smd")
    if output.exists() and not bool(req.get("overwrite", False)):
        raise FbxError(f"{output} already exists; pass overwrite:true to replace it")

    nodes = [
        {"name": bone_names[index], "parent": bone_parent[index]}
        for index in range(len(bone_order))
    ]
    written = smd_write(
        {
            "path": str(output),
            "nodes": nodes,
            "frames": [{"time": 0.0, "bones": frames}],
            "triangles": triangles,
        }
    )
    diagnostics.extend(written.get("diagnostics", []))

    # ---------------------------------------------------------------------
    # Animation: one SMD per stack, with the same node table as the bind pose.
    # ---------------------------------------------------------------------
    animation_results: list[dict[str, Any]] = []
    if export_animations and animation_stacks:
        animations, animation_notes = _scene_animations(scene)
        diagnostics.extend(animation_notes)
        # A bind pose taken from a cluster is not always the node rest pose. The frames are
        # written relative to the bind parent, not the rest parent, or the model jumps at
        # frame zero; the same conversion the bind frames use is applied here.
        bind_scene = {
            identifier: mat4_mul(scene_matrix, bind_world[identifier])
            for identifier in bone_order
        }
        used_names: set[str] = set()
        for index, animation in enumerate(animations):
            raw_name = str(animation.get("name") or f"animation{index}")
            if animation_filter and raw_name.lower() not in animation_filter:
                continue
            tracks = animation["tracks"]
            unknown = [model for model in tracks if model not in bone_of_model]
            if unknown:
                diagnostics.append(
                    _diag(
                        "warning",
                        "fbx-animation-target",
                        f"{raw_name}: {len(unknown)} animated model(s) are not in the SMD "
                        "skeleton and their tracks were skipped",
                    )
                )
                tracks = {
                    model: channels
                    for model, channels in tracks.items()
                    if model in bone_of_model
                }
            if not tracks:
                continue
            start = float(animation["start"])
            end = float(animation["end"])
            if end <= start:
                diagnostics.append(
                    _diag(
                        "warning",
                        "fbx-animation-range",
                        f"{raw_name}: the curve range is {start:g}..{end:g}; skipped",
                    )
                )
                continue
            frame_count = max(1, int(round((end - start) * animation_fps)) + 1)
            if frame_count > max_animation_frames:
                diagnostics.append(
                    _diag(
                        "warning",
                        "fbx-animation-long",
                        f"{raw_name}: {frame_count} frames at {animation_fps:g} fps exceeds "
                        f"maxAnimationFrames ({max_animation_frames}); skipped",
                    )
                )
                continue
            rest = {identifier: _properties70(scene.objects[identifier]) for identifier in bone_order}
            animation_frames: list[dict[str, Any]] = []
            for frame_index in range(frame_count):
                time = min(start + frame_index / animation_fps, end)
                overrides: dict[int, dict[str, tuple[float, float, float]]] = {}
                for model, props in tracks.items():
                    base = rest.get(model, {})
                    values: dict[str, tuple[float, float, float]] = {}
                    for prop, axis in props.items():
                        default = (
                            (0.0, 0.0, 0.0)
                            if prop != "Lcl Scaling"
                            else (1.0, 1.0, 1.0)
                        )
                        rest_value = _vec3(base.get(prop, []), default)
                        values[prop] = (
                            _sample_keys(axis.get("X", []), time, rest_value[0]),
                            _sample_keys(axis.get("Y", []), time, rest_value[1]),
                            _sample_keys(axis.get("Z", []), time, rest_value[2]),
                        )
                    overrides[model] = values
                worlds: dict[int, Mat4] = {}
                for bone_index, identifier in enumerate(bone_order):
                    values = overrides.get(identifier, {})
                    local = _local_transform(
                        scene.objects[identifier],
                        diagnostics,
                        values.get("Lcl Translation"),
                        values.get("Lcl Rotation"),
                        values.get("Lcl Scaling"),
                    )
                    parent_index = bone_parent[bone_index]
                    worlds[identifier] = (
                        local
                        if parent_index is None
                        else mat4_mul(worlds[bone_order[parent_index]], local)
                    )
                bones: list[dict[str, Any]] = []
                for bone_index, identifier in enumerate(bone_order):
                    current = mat4_mul(scene_matrix, worlds[identifier])
                    parent_index = bone_parent[bone_index]
                    if parent_index is None:
                        transform = current
                    else:
                        inverse = mat4_inverse(bind_scene[bone_order[parent_index]])
                        transform = (
                            mat4_identity()
                            if inverse is None
                            else mat4_mul(inverse, current)
                        )
                    translation, quaternion, _bone_scale, _mirrored = mat4_decompose(transform)
                    roll, pitch, yaw = euler_xyz(quaternion)
                    bones.append(
                        {
                            "bone": bone_index,
                            "position": [round(value, 6) for value in translation],
                            "rotation": [round(roll, 6), round(pitch, 6), round(yaw, 6)],
                        }
                    )
                animation_frames.append({"time": float(frame_index), "bones": bones})

            safe = re.sub(r"[^A-Za-z0-9_]+", "_", raw_name).strip("_") or f"animation{index}"
            if safe.lower() in used_names:
                safe = f"{safe}_{index}"
            used_names.add(safe.lower())
            animation_path = output.with_name(f"{output.stem}_{safe}.smd")
            if animation_path.exists() and not bool(req.get("overwrite", False)):
                raise FbxError(
                    f"{animation_path} already exists; pass overwrite:true to replace it"
                )
            animation_written = smd_write(
                {
                    "path": str(animation_path),
                    "nodes": nodes,
                    "frames": animation_frames,
                    "triangles": [],
                    "allowEmptyTriangles": True,
                }
            )
            diagnostics.extend(animation_written.get("diagnostics", []))
            animation_results.append(
                {
                    "name": safe,
                    "path": str(animation_path),
                    "frames": frame_count,
                    "fps": round(animation_fps, 4),
                    "duration": round(end - start, 4),
                    "start": round(start, 4),
                    "end": round(end, 4),
                }
            )

    points = [vertex["position"] for triangle in triangles for vertex in triangle["vertices"]]
    mins = [min(point[i] for point in points) for i in range(3)]
    maxs = [max(point[i] for point in points) for i in range(3)]

    collision_result: dict[str, Any] | None = None
    if collision in {"box", "hull"}:
        box_mins = [float(value) for value in mins]
        box_maxs = [float(value) for value in maxs]
        for axis_index in range(3):
            if box_maxs[axis_index] - box_mins[axis_index] < collision_thickness:
                center = (box_mins[axis_index] + box_maxs[axis_index]) * 0.5
                box_mins[axis_index] = center - collision_thickness * 0.5
                box_maxs[axis_index] = center + collision_thickness * 0.5
        mode = "box"
        if collision == "hull":
            try:
                physics_triangles = _hull_triangles(points, "phys")
                mode = "hull"
            except Exception as exc:  # noqa: BLE001 -- a flat model has no hull
                diagnostics.append(
                    _diag(
                        "warning",
                        "fbx-hull-fallback",
                        f"convex hull failed ({type(exc).__name__}: {exc}); the collision "
                        "model falls back to the bounding box",
                    )
                )
                physics_triangles = _box_triangles(box_mins, box_maxs, "phys")
        else:
            physics_triangles = _box_triangles(box_mins, box_maxs, "phys")
        physics_path = output.with_name(f"{output.stem}_phys.smd")
        if physics_path.exists() and not bool(req.get("overwrite", False)):
            raise FbxError(
                f"{physics_path} already exists; pass overwrite:true to replace it"
            )
        physics_written = smd_write(
            {
                "path": str(physics_path),
                "nodes": [{"name": "root", "parent": None}],
                "frames": [
                    {
                        "time": 0.0,
                        "bones": [
                            {"bone": 0, "position": [0, 0, 0], "rotation": [0, 0, 0]}
                        ],
                    }
                ],
                # A collision SMD carries a material name; `phys` is the conventional one.
                "triangles": physics_triangles,
            }
        )
        diagnostics.extend(physics_written.get("diagnostics", []))
        collision_result = {
            "path": str(physics_path),
            "mode": mode,
            "triangles": len(physics_triangles),
            "mins": [round(v, 4) for v in (box_mins if mode == "box" else mins)],
            "maxs": [round(v, 4) for v in (box_maxs if mode == "box" else maxs)],
            "thickness": collision_thickness,
            "mass": mass,
            "verified": bool(physics_written.get("verified")),
        }

    return {
        "path": str(source),
        "out": str(output),
        "written": True,
        "format": fmt,
        "version": version,
        "axis": "y" if axis_y else "z",
        "scale": scale,
        "nodes": nodes,
        "counts": {
            "meshes": len(mesh_models),
            "bones": len(bone_order),
            "triangles": len(triangles),
            "vertices": len(triangles) * 3,
            "materials": len(materials_seen),
        },
        "materials": sorted(materials_seen),
        "bounds": {"mins": [round(value, 6) for value in mins], "maxs": [round(value, 6) for value in maxs]},
        "unitScaleFactor": unit,
        "collision": collision_result,
        "animations": animation_results,
        "animationCount": len(animation_results),
        "animationFps": animation_fps,
        "diagnostics": diagnostics,
        "warnings": [entry["message"] for entry in diagnostics if entry["severity"] == "warning"],
    }
