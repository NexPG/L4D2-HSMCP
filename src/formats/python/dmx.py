"""Reading and writing DMX, the datamodel a Blender/Crowbar model pipeline speaks.

A `.qc` is the compiler's input; a `.dmx` is what BlenderSourceTools, Crowbar, SFM and
Blender actually export. Before this module the toolkit could compile a QC but could not
read the file an artist hands over, so "make a model from these sources" stopped at the
first step.

The format itself is srctools' `dmx` module (a pinned Python dependency, not vendored
code). This file is the boundary: it turns an Element tree into JSON an agent can read,
and turns a JSON tree back into a file, refusing shapes it cannot represent instead of
writing a DMX that only looks right.

Two encodings matter in practice and both are handled: binary (the L4D2 model default,
format 15) and KeyValues2 text (what a human can diff).
"""

from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any

# ValueType names are the ones srctools stores in the DMX header, so a JSON tree written
# by `read_dmx` can be fed straight back to `write_dmx` without a translation table.
_SCALARS = {
    "int": "val_int",
    "float": "val_float",
    "bool": "val_bool",
    "string": "val_string",
    "time": "val_time",
    "color": "val_color",
    "vector2": "val_vec2",
    "vector3": "val_vec3",
    "vector4": "val_vec4",
    "qangle": "val_angle",
    "quaternion": "val_quaternion",
    "vmatrix": "val_matrix",
}

_STRING_LIMIT = 4096
_HEADER = re.compile(
    rb"<!--\s*dmx\s+encoding\s+(unicode_)?(\S+)\s+([0-9]+)\s+format\s+(\S+)\s+([0-9]+)\s*-->"
)


def _header(path: Path) -> dict[str, Any]:
    """The comment at the top of a DMX: encoding, format name and versions.

    srctools validates this header and then throws it away, but a caller needs to know
    whether it is looking at binary 4 or KeyValues2: the same tree means different things
    to different importers.
    """
    try:
        with path.open("rb") as fh:
            head = fh.read(512)
    except OSError:
        return {}
    match = _HEADER.search(head)
    if match is None:
        return {}
    unicode_flag, encoding, encoding_version, fmt, fmt_version = match.groups()
    return {
        "encoding": encoding.decode("ascii", "replace"),
        "encodingVersion": int(encoding_version),
        "format": fmt.decode("ascii", "replace"),
        "formatVersion": int(fmt_version),
        "unicode": unicode_flag is not None,
    }


def _ref(element: Any) -> dict[str, Any]:
    """A reference to an element that is not expanded (array item, or past the depth limit)."""
    return {
        "name": element.name,
        "type": element.type,
        "uuid": str(element.uuid),
        "stub": bool(getattr(element, "is_stub", False)),
        "null": bool(getattr(element, "is_null", False)),
    }


def _scalar(attr: Any) -> Any:
    from srctools.dmx import ValueType

    kind = attr.type
    if kind is ValueType.ELEMENT:
        element = attr.val_elem
        if bool(getattr(element, "is_null", False)):
            return None
        return _ref(element)
    if kind is ValueType.BINARY:
        return {"bytes": len(attr.val_bin)}
    name = kind.value
    field = _SCALARS.get(name)
    if field is None:
        return str(attr)
    value = getattr(attr, field)
    if name == "string" and len(value) > _STRING_LIMIT:
        return value[:_STRING_LIMIT]
    if name == "vmatrix":
        try:
            return [[round(float(v), 6) for v in row] for row in value]
        except Exception:  # noqa: BLE001 -- a malformed matrix is data, not a crash
            return str(value)
    if name in {"vector2", "vector3", "vector4", "qangle", "quaternion"}:
        try:
            return [round(float(v), 6) for v in value]
        except Exception:  # noqa: BLE001
            return str(value)
    if name == "color":
        try:
            return [int(v) for v in value]
        except Exception:  # noqa: BLE001
            return str(value)
    if name == "time":
        return round(float(value), 6)
    if name == "float":
        return round(float(value), 6)
    return value


def _attribute(
    attr: Any,
    depth: int,
    max_depth: int,
    max_items: int,
    budget: dict[str, int],
) -> dict[str, Any]:
    from srctools.dmx import ValueType

    kind = attr.type.value
    if not attr.is_array:
        if attr.type is ValueType.ELEMENT and depth < max_depth and budget["left"] > 0:
            element = attr.val_elem
            if not bool(getattr(element, "is_null", False)) and not bool(
                getattr(element, "is_stub", False)
            ):
                budget["left"] -= 1
                return {
                    "type": kind,
                    "element": _node(element, depth + 1, max_depth, max_items, budget),
                }
        return {"type": kind, "value": _scalar(attr)}

    total = len(attr)
    take = min(total, max_items)
    if attr.type is ValueType.ELEMENT:
        values: list[Any] = [_ref(attr[i].val_elem) for i in range(take)]
    elif attr.type is ValueType.BINARY:
        values = [{"bytes": len(attr[i].val_bin)} for i in range(take)]
    else:
        field = _SCALARS.get(kind)
        if field is None:
            values = [str(attr[i]) for i in range(take)]
        else:
            values = []
            for i in range(take):
                item = getattr(attr[i], field)
                if kind in {"vector2", "vector3", "vector4", "qangle", "quaternion"}:
                    item = [round(float(v), 6) for v in item]
                elif kind == "color":
                    item = [int(v) for v in item]
                elif kind in {"float", "time"}:
                    item = round(float(item), 6)
                values.append(item)
    return {
        "type": kind,
        "array": True,
        "count": total,
        "truncated": total > take,
        "values": values,
    }


def _node(
    element: Any,
    depth: int,
    max_depth: int,
    max_items: int,
    budget: dict[str, int],
) -> dict[str, Any]:
    attributes: dict[str, Any] = {}
    for name in element.keys():
        attributes[name] = _attribute(element[name], depth, max_depth, max_items, budget)
    return {
        "name": element.name,
        "type": element.type,
        "uuid": str(element.uuid),
        "attributes": attributes,
    }


def dmx_read(req: dict[str, Any]) -> dict[str, Any]:
    """A DMX as a JSON tree: header, element types and the attributes an agent asks about."""
    from srctools.dmx import Element

    path = Path(str(req.get("path", ""))).resolve()
    if not path.is_file():
        return {"path": str(path), "read": False, "readError": "file does not exist"}
    max_depth = max(0, min(int(req.get("maxDepth", 4)), 16))
    max_items = max(1, min(int(req.get("maxItems", 512)), 100_000))
    max_elements = max(1, min(int(req.get("maxElements", 20_000)), 200_000))

    try:
        with path.open("rb") as fh:
            root, fmt, fmt_version = Element.parse(fh)
    except Exception as exc:  # noqa: BLE001 -- the boundary reports, never tracebacks
        return {
            "path": str(path),
            "read": False,
            "readError": f"{type(exc).__name__}: {exc}",
        }

    header = _header(path)
    budget = {"left": max_elements}
    tree = _node(root, 0, max_depth, max_items, budget)

    # Counts, not a second walk of the same tree: an element can appear under several
    # attributes, and "how many meshes" is the question a model import starts with.
    types: dict[str, int] = {}
    stack = [root]
    seen: set[str] = set()
    element_count = 0
    while stack and element_count < max_elements:
        current = stack.pop()
        key = str(current.uuid)
        if key in seen:
            continue
        seen.add(key)
        element_count += 1
        types[current.type] = types.get(current.type, 0) + 1
        for attr in current.values():
            if attr.type.value != "element":
                continue
            for child in attr.iter_elem():
                if not bool(getattr(child, "is_stub", False)) and not bool(
                    getattr(child, "is_null", False)
                ):
                    stack.append(child)

    return {
        "path": str(path),
        "read": True,
        "bytes": path.stat().st_size,
        **header,
        "format": header.get("format", fmt),
        "formatVersion": header.get("formatVersion", fmt_version),
        "rootType": root.type,
        "elementCount": element_count,
        "elementTypes": dict(sorted(types.items(), key=lambda kv: (-kv[1], kv[0]))),
        "tree": tree,
        "maxDepth": max_depth,
        "note": (
            "Element references in arrays, and anything past maxDepth, are reported as "
            "{name,type,uuid} rather than expanded: a DMX model graph is cyclic and "
            "expanding it fully would not terminate. Increase maxDepth for a deeper view."
        ),
    }


def _build_attribute(name: str, spec: Any) -> Any:
    """Turns one JSON attribute into an srctools Attribute, or refuses it."""
    from srctools.dmx import Attribute, ValueType

    if not isinstance(spec, dict) or "type" not in spec:
        raise ValueError(f"attribute {name!r} needs an object with a type")
    kind = str(spec["type"])
    try:
        value_type = ValueType(kind)
    except ValueError as exc:
        raise ValueError(
            f"attribute {name!r} has type {kind!r}; known types are "
            + ", ".join(sorted(v.value for v in ValueType))
        ) from exc

    is_array = bool(spec.get("array", False))
    values = spec.get("values") if is_array else spec.get("value")

    if value_type is ValueType.ELEMENT:
        def element_of(item: Any) -> Any:
            if item is None:
                return None
            if not isinstance(item, dict) or "type" not in item:
                raise ValueError(
                    f"attribute {name!r} is an element; give a node with name/type/attributes"
                )
            return _build_element(item)

        if is_array:
            return Attribute.array(name, value_type, [element_of(v) for v in values or []])
        return Attribute(name, value_type, element_of(values))

    if is_array:
        return Attribute.array(name, value_type, list(values or []))
    return Attribute(name, value_type, values)


def _build_element(spec: dict[str, Any]) -> Any:
    from srctools.dmx import Element

    if not isinstance(spec, dict):
        raise ValueError("an element must be an object")
    element = Element(str(spec.get("name", "")), str(spec.get("type", "DmElement")))
    attributes = spec.get("attributes", {})
    if not isinstance(attributes, dict):
        raise ValueError(f"element {element.name!r}: attributes must be an object")
    for name, attr in attributes.items():
        element[str(name)] = _build_attribute(str(name), attr)
    return element


def dmx_write(req: dict[str, Any]) -> dict[str, Any]:
    """Builds a DMX from the tree `read_dmx` returns (or an equivalent hand-written one)."""
    from srctools.dmx import Element

    path = Path(str(req.get("path", ""))).resolve()
    tree = req.get("tree")
    if not isinstance(tree, dict):
        raise ValueError("tree must be an object with name, type and attributes")

    root = _build_element(tree)
    encoding = str(req.get("encoding", "binary")).lower()
    if encoding not in {"binary", "kv2", "keyvalues2"}:
        raise ValueError(f"encoding {encoding!r} is not binary or kv2")
    binary = encoding == "binary"
    version = int(req.get("version", 4))
    if binary and not 0 <= version <= 5:
        raise ValueError(f"binary DMX version {version} is outside 0-5")
    fmt_name = str(req.get("format", "model"))
    fmt_version = int(req.get("formatVersion", 15))

    buffer = io.BytesIO()
    try:
        if binary:
            root.export_binary(buffer, version=version, fmt_name=fmt_name, fmt_ver=fmt_version)
        else:
            root.export_kv2(buffer, fmt_name=fmt_name, fmt_ver=fmt_version)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"{type(exc).__name__}: {exc}") from exc

    data = buffer.getvalue()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)

    # Read the file back with the same parser a consumer would use. A writer that cannot
    # read its own output has produced a file that only its writer understands.
    with path.open("rb") as fh:
        back, back_fmt, back_version = Element.parse(fh)

    return {
        "path": str(path),
        "written": True,
        "bytes": len(data),
        "encoding": "binary" if binary else "keyvalues2",
        "encodingVersion": version if binary else 1,
        "format": back_fmt,
        "formatVersion": back_version,
        "root": {"name": back.name, "type": back.type, "uuid": str(back.uuid)},
        "verified": root.name == back.name and root.type == back.type,
    }
