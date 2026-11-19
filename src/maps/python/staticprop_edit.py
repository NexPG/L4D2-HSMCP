"""Editing the static-prop game lump of a compiled BSP.

`read_static_props` could list props; nothing could change one. A shipped map sometimes
needs a prop skin, solidity, fade or tint fixed without the source VMF, and recompiling a
large map to change one integer is the wrong tool. `srctools.bsp` already parses and
rebuilds the `sprp` lump, so this module applies field changes and writes the BSP back.

Changing a **model** or **origin** leaves the compiled `visleafs` set stale. Those leaves
were computed by vbsp for the old geometry; culling can be wrong until the map is
recompiled or the prop is re-placed in Hammer. The result says so. Adding a prop creates an
empty visleaf set for the same reason.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any


def _vec(value: Any) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError("expected 3 numbers")
    return [float(v) for v in value]


def _prop_json(prop: Any, index: int) -> dict[str, Any]:
    from srctools.bsp import StaticPropFlags

    flags = [
        flag.name
        for flag in StaticPropFlags
        if flag is not StaticPropFlags.NONE and prop.flags & flag
    ]
    try:
        scaling: Any = [round(float(v), 3) for v in prop.scaling]
    except TypeError:
        scaling = round(float(prop.scaling), 3)
    return {
        "index": index,
        "model": prop.model,
        "origin": [round(prop.origin.x, 3), round(prop.origin.y, 3), round(prop.origin.z, 3)],
        "angles": [round(prop.angles.pitch, 3), round(prop.angles.yaw, 3), round(prop.angles.roll, 3)],
        "skin": int(prop.skin),
        "solidity": int(prop.solidity),
        "scaling": scaling,
        "flags": flags,
        "tint": [int(prop.tint.x), int(prop.tint.y), int(prop.tint.z)],
        "renderfx": int(prop.renderfx),
        "minFade": round(prop.min_fade, 3),
        "maxFade": round(prop.max_fade, 3),
        "fadeScale": round(prop.fade_scale, 3),
        "visleafs": len(prop.visleafs),
    }


def _apply(prop: Any, spec: dict[str, Any]) -> list[str]:
    from srctools.bsp import StaticPropFlags
    from srctools.math import Angle, Vec

    warnings: list[str] = []
    if "model" in spec:
        prop.model = str(spec["model"]).replace("\\", "/")
        warnings.append("model changed: compiled visleafs are stale until a recompile")
    if "origin" in spec:
        prop.origin = Vec(*_vec(spec["origin"]))
        warnings.append("origin changed: compiled visleafs are stale until a recompile")
    if "angles" in spec:
        prop.angles = Angle(*[float(v) for v in _vec(spec["angles"])])
    if "skin" in spec:
        prop.skin = int(spec["skin"])
    if "solidity" in spec:
        solidity = int(spec["solidity"])
        if not 0 <= solidity <= 6:
            raise ValueError("solidity must be 0-6")
        prop.solidity = solidity
    if "scale" in spec:
        scaling = spec["scale"]
        prop.scaling = Vec(*_vec(scaling)) if isinstance(scaling, (list, tuple)) else float(scaling)
    if "tint" in spec:
        prop.tint = Vec(*_vec(spec["tint"]))
    if "renderfx" in spec:
        prop.renderfx = int(spec["renderfx"])
    if "minFade" in spec:
        prop.min_fade = float(spec["minFade"])
    if "maxFade" in spec:
        prop.max_fade = float(spec["maxFade"])
    if "fadeScale" in spec:
        prop.fade_scale = float(spec["fadeScale"])

    add = spec.get("flagsAdd") or []
    remove = spec.get("flagsRemove") or []
    current = prop.flags
    for name in add:
        try:
            current |= StaticPropFlags[str(name)]
        except KeyError as exc:
            raise ValueError(f"unknown static prop flag {name!r}") from exc
    for name in remove:
        try:
            current &= ~StaticPropFlags[str(name)]
        except KeyError as exc:
            raise ValueError(f"unknown static prop flag {name!r}") from exc
    prop.flags = current
    return warnings


def static_props_edit(req: dict[str, Any]) -> dict[str, Any]:
    from srctools.bsp import BSP, StaticProp
    from srctools.math import Vec

    path = Path(str(req.get("path", ""))).resolve()
    if not path.is_file():
        raise ValueError(f"{path} does not exist")
    ops = req.get("ops")
    if not isinstance(ops, list) or not ops:
        raise ValueError("ops must be a non-empty list")

    bsp = BSP(str(path))
    warnings: list[str] = []
    changed: list[int] = []

    for op in ops:
        kind = str(op.get("op", ""))
        if kind == "add":
            if not op.get("model") or "origin" not in op:
                raise ValueError("add needs model and origin")
            prop = StaticProp(model=str(op["model"]), origin=Vec(*_vec(op["origin"])))
            warnings.extend(
                _apply(prop, {k: v for k, v in op.items() if k not in {"op", "model", "origin"}})
            )
            warnings.append("added prop has no compiled visleafs until a full recompile")
            bsp.props.append(prop)
            changed.append(len(bsp.props) - 1)
            continue

        index = int(op.get("index", -1))
        if not 0 <= index < len(bsp.props):
            raise ValueError(f"static prop index {index} is outside 0-{len(bsp.props) - 1}")
        if kind == "remove":
            bsp.props.pop(index)
            warnings.append(f"removed prop {index}; later indices shifted")
            continue
        if kind != "set":
            raise ValueError(f"unknown static prop op {kind!r}")
        warnings.extend(_apply(bsp.props[index], op))
        changed.append(index)

    out = Path(str(req.get("out", "") or path)).resolve()
    backup = None
    if out == path and req.get("backup", True):
        backup = Path(f"{path}.bak")
        shutil.copy2(path, backup)
    elif out != path:
        shutil.copy2(path, out)
    bsp.save(str(out))

    check = BSP(str(out))
    props = [_prop_json(prop, index) for index, prop in enumerate(check.props)]
    return {
        "path": str(path),
        "out": str(out),
        "backup": str(backup) if backup else None,
        "bytesBefore": path.stat().st_size,
        "bytesAfter": out.stat().st_size,
        "count": len(props),
        "changed": changed,
        "props": props[: int(req.get("limit", 200))],
        "warnings": sorted(set(warnings)),
        "note": (
            "Model/origin changes and added props need a vbsp recompile before their "
            "visleaf sets are trustworthy. Skin, solidity, tint, fade and flags are safe."
        ),
    }
