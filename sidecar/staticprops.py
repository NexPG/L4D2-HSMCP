"""Static prop collision audit.

A `prop_static` is not an entity with a runtime `SOLID_*`; vbsp bakes it into the BSP's
static-prop lump with a `solidity` value and, for `solidity 6`, the model's `.phy`. A model
without a `.phy` silently becomes non-solid even though Hammer shows a solid prop, and a
map built from models is then a map the player walks through. This reads the lump and says
what each prop actually got.
"""
from __future__ import annotations

from typing import Any


def _mount(game_dir: str | None) -> tuple[Any, str | None]:
    if not game_dir:
        return None, "no gameDir given"
    try:
        from srctools.game import Game

        return Game(game_dir).get_filesystem(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def _present(fsys: Any, path: str) -> bool:
    try:
        fsys[path]
        return True
    except Exception:  # noqa: BLE001
        return False


def static_props(req: dict[str, Any]) -> dict[str, Any]:
    game_dir = req.get("gameDir")
    path = req.get("path")
    limit = min(max(int(req.get("limit", 200)), 1), 2000)
    if not path:
        return {"error": "no path given"}

    try:
        from srctools.bsp import BSP

        bsp = BSP(path)
        # `static_props()` also walks visleafs/faces and srctools can fail on a map whose
        # culling removed a surfedge. The model dictionary is enough for the collision
        # question: a solidity-6 prop without a .phy is the one the player walks through.
        instance_models = [str(m).replace("\\", "/") for m in bsp.static_prop_models()]
    except Exception as exc:  # noqa: BLE001
        return {"path": path, "read": False, "error": f"{type(exc).__name__}: {exc}"}

    fsys, mount_error = _mount(game_dir)
    unique = sorted(set(instance_models))
    rows: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    for model in unique:
        if not model.startswith("models/"):
            model = f"models/{model}"
        phy = f"{model[:-4]}.phy" if model.lower().endswith(".mdl") else f"{model}.phy"
        has_phy = _present(fsys, phy) if fsys is not None else None
        row = {"model": model, "hasPhysics": has_phy, "instances": instance_models.count(model)}
        rows.append(row)
        if has_phy is False:
            missing.append(row)

    return {
        "path": path,
        "read": True,
        "mounted": fsys is not None,
        "mountError": mount_error,
        "totalInstances": len(instance_models),
        "uniqueModels": len(unique),
        "missingPhysicsCount": len(missing),
        "missingPhysics": missing[:limit],
        "models": rows[:limit],
        "truncated": len(rows) > limit,
        "note": (
            "A prop_static is solidity 6 by default and needs the model's .phy. A model "
            "without one is non-solid in play even though Hammer draws it solid. Use a "
            "clip brush for a model whose physics is missing, or set `solid 2` for a "
            "bounding box. Per-instance solidity is in the VMF (`solid` key); this reader "
            "starts from the compiled model dictionary because srctools' full prop reader "
            "fails on culled maps."
        ),
    }

