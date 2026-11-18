"""Checking a VMF against the game's FGD and against what the compilers will accept.

Every rule here answers a failure that is otherwise found late and expensively: after a
compile that took forty minutes, or in game, as an entity that quietly does nothing.
"""

from __future__ import annotations

from typing import Any

# Texture scale outside this range makes vbsp fail with "Bad surface extents", which
# names a face by an index nobody can find in Hammer.
MIN_TEXTURE_SCALE = 0.1
MAX_TEXTURE_SCALE = 10.0

# Keys every entity carries that no FGD class declares.
UNIVERSAL_KEYS = {"classname", "id", "hammerid", "origin", "angles", "spawnflags"}


def model_bounds(vmf: Any, game_dir: str | None) -> list[dict[str, Any]]:
    """Every point entity carrying a model, with that model's own hull.

    Split from the rules deliberately: whether a prop sinks into the floor is a question
    about the floor, and the tracer that answers it lives in TypeScript. This returns the
    half nothing there can get -- a `.mdl`'s bounds -- and lets the caller do the geometry.

    A model's origin is wherever the artist put it. `props_c17/door01_left.mdl` has it at the
    centre, `mins z -54.25`, so a door placed on a floor at z 0 is half underground; the
    barrel `read_model_info` documents is the same story at 26. Bounds are cached per path
    because a map places one model many times and opening a `.mdl` is not free.
    """
    if not game_dir:
        return []
    try:
        from srctools.game import Game
        from srctools.mdl import Model

        fsys = Game(game_dir).get_filesystem()
    except Exception:  # noqa: BLE001
        return []

    cache: dict[str, list[float] | None] = {}

    def bounds_of(rel: str) -> list[float] | None:
        if rel in cache:
            return cache[rel]
        got: list[float] | None = None
        try:
            mdl = Model(fsys, fsys[rel])
            lo, hi = mdl.hull_min, mdl.hull_max
            got = [
                round(float(lo.x), 3), round(float(lo.y), 3), round(float(lo.z), 3),
                round(float(hi.x), 3), round(float(hi.y), 3), round(float(hi.z), 3),
            ]
        except Exception:  # noqa: BLE001
            got = None
        cache[rel] = got
        return got

    out: list[dict[str, Any]] = []
    for ent in vmf.entities:
        # Brush entities carry their geometry, not a model: their `origin` is a pivot and
        # sinking is meaningless for them.
        if list(ent.solids):
            continue
        rel = str(ent["model", ""]).replace("\\", "/").strip()
        # `*12` is a brush model index vbsp assigns, not a file.
        if not rel or rel.startswith("*") or not rel.lower().endswith(".mdl"):
            continue
        got = bounds_of(rel)
        if got is None:
            continue
        try:
            o = ent.get_origin()
            origin = [round(float(o.x), 3), round(float(o.y), 3), round(float(o.z), 3)]
        except Exception:  # noqa: BLE001
            continue
        out.append(
            {
                "id": int(ent.id),
                "classname": ent["classname", ""],
                "model": rel,
                "origin": origin,
                "mins": got[:3],
                "maxs": got[3:],
            }
        )
    return out


def _flag_bits(value: str) -> int:
    """`spawnflags` as an int; a malformed value is 0, not an exception in a lint."""
    try:
        return int(str(value).strip() or "0")
    except (TypeError, ValueError):
        return 0


def _finding(
    severity: str, rule: str, message: str, **extra: Any
) -> dict[str, Any]:
    return {"severity": severity, "rule": rule, "message": message, **extra}


def _point_in_solid(vmf: Any, point: Any) -> int | None:
    """The id of the first *solid* brush containing this point, world or entity-owned.

    Trigger volumes, nav attribute regions and `info_changelevel` brushes are brush
    entities too, but they have no collision. Counting them made a landmark in the middle
    of a safe room "embedded in solid", which is exactly the false positive that sends a
    builder moving a correct entity.
    """
    non_solid = (
        "trigger_",
        "func_nav_",
        "func_areaportal",
        "func_occluder",
        "func_viscluster",
        "func_instance",
        "info_changelevel",
        "func_water_analog",
    )
    for solid in vmf.brushes:
        try:
            if solid.point_inside(point):
                return int(solid.id)
        except Exception:  # noqa: BLE001
            continue
    for ent in vmf.entities:
        if str(ent["classname", ""]).startswith(non_solid):
            continue
        for solid in ent.solids:
            try:
                if solid.point_inside(point):
                    return int(solid.id)
            except Exception:  # noqa: BLE001
                continue
    return None


def _lint_landmarks_and_doors(
    vmf: Any, entities: list[Any], game_dir: str | None
) -> list[dict[str, Any]]:
    """Point entities that must sit in open space, and doors whose opening does not fit.

    Two failures that compile cleanly and are only found by walking the map:

    * `info_landmark` is where the next chapter places the team. Inside a solid, the engine
      reports `landmark embedded in solid` and the transition can drop survivors into geometry.
    * A door model is a fixed size. A 128-unit opening around a 58-unit checkpoint door is a
      hole with a door in the middle: it looks wrong and it leaks sight and nav through the
      gap. Both numbers exist -- the model's hull and the brush gap -- so the lint compares
      them instead of leaving it to a screenshot.
    """
    findings: list[dict[str, Any]] = []
    import math

    for ent in entities:
        if ent["classname", ""] != "info_landmark":
            continue
        try:
            p = ent.get_origin()
        except Exception:  # noqa: BLE001
            continue
        brush = _point_in_solid(vmf, p)
        if brush is not None:
            findings.append(
                _finding(
                    "error",
                    "l4d2-landmark-in-solid",
                    f"info_landmark is inside brush {brush}; the engine logs 'landmark "
                    f"embedded in solid' and the arrival point can be unreachable. Move it "
                    f"into open space at survivor height",
                    entity_id=int(ent.id),
                    classname="info_landmark",
                    brush_id=brush,
                )
            )

    try:
        bounds = {b["id"]: b for b in model_bounds(vmf, game_dir)}
    except Exception:  # noqa: BLE001
        bounds = {}

    for ent in entities:
        classname = ent["classname", ""]
        if not classname.startswith("prop_door"):
            continue
        model = str(ent["model", ""]).replace("\\", "/").strip()
        if not model.lower().endswith(".mdl"):
            continue
        try:
            p = ent.get_origin()
        except Exception:  # noqa: BLE001
            continue
        if _point_in_solid(vmf, p) is not None:
            findings.append(
                _finding(
                    "error",
                    "l4d2-door-origin-in-solid",
                    "door origin is inside a brush; the door cannot swing and the opening is "
                    "not where the entity thinks it is",
                    entity_id=int(ent.id),
                    classname=classname,
                )
            )
            continue
        b = bounds.get(int(ent.id))
        if not b:
            continue
        model_width = max(
            float(b["maxs"][0]) - float(b["mins"][0]),
            float(b["maxs"][1]) - float(b["mins"][1]),
        )
        try:
            angles = [float(x) for x in str(ent["angles", "0 0 0"]).split()]
            yaw = math.radians(angles[1] if len(angles) > 1 else 0.0)
        except Exception:  # noqa: BLE001
            yaw = 0.0
        # A door model's width is its local Y; yaw 0 keeps it on world Y, yaw 90 turns it
        # onto world X. Only axis-aligned doors: a diagonal doorway needs a ray, and
        # guessing is worse than saying nothing.
        if abs(math.sin(yaw)) >= 0.9:
            axis = 0
        elif abs(math.cos(yaw)) >= 0.9:
            axis = 1
        else:
            continue
        gap = 0.0
        for sign in (1.0, -1.0):
            travelled = 0.0
            while travelled < 512.0:
                travelled += 2.0
                probe = [p[0], p[1], p[2]]
                probe[axis] += sign * travelled
                if _point_in_solid(vmf, probe) is not None:
                    break
            else:
                travelled = 512.0
            gap += travelled
        if gap >= 1024.0:
            continue
        if gap - model_width > 16.0:
            findings.append(
                _finding(
                    "warning",
                    "l4d2-door-opening-too-wide",
                    f"door opening is about {gap:.0f} units, but {model} is "
                    f"{model_width:.0f} units wide; the extra "
                    f"{gap - model_width:.0f} units is a hole beside the door",
                    entity_id=int(ent.id),
                    classname=classname,
                    opening=round(gap, 1),
                    modelWidth=round(model_width, 1),
                )
            )
        elif model_width - gap > 8.0:
            findings.append(
                _finding(
                    "error",
                    "l4d2-door-opening-too-narrow",
                    f"door opening is about {gap:.0f} units, but {model} is "
                    f"{model_width:.0f} units wide; the door cannot fit",
                    entity_id=int(ent.id),
                    classname=classname,
                    opening=round(gap, 1),
                    modelWidth=round(model_width, 1),
                )
            )
    return findings


def lint_vmf(vmf: Any, fgd: Any, game_dir: str | None = None) -> list[dict[str, Any]]:
    """Left 4 Dead 2's FGD is the whole truth about entity classes.

    Unlike Garry's Mod, there is no Lua layer registering entities at runtime, so an
    unknown classname is a real finding rather than a false positive to be tolerated.
    """
    findings: list[dict[str, Any]] = []

    entities = list(vmf.entities)
    names: dict[str, list[int]] = {}
    for ent in entities:
        name = ent["targetname", ""]
        if name:
            names.setdefault(name, []).append(int(ent.id))

    for name, ids in names.items():
        if len(ids) > 1:
            findings.append(
                _finding(
                    "info",
                    "duplicate-targetname",
                    f'{len(ids)} entities share the targetname "{name}"; an output '
                    f"aimed at it fires on all of them",
                    entity_ids=ids[:20],
                )
            )

    for ent in entities:
        classname = ent["classname", ""]
        ent_id = int(ent.id)
        cls = fgd.entities.get(classname)

        if cls is None:
            findings.append(
                _finding(
                    "warning",
                    "unknown-classname",
                    f'"{classname}" is in no FGD class. Either a typo, or an entity this '
                    f"server's FGD set does not know; check which FGDs were loaded",
                    entity_id=ent_id,
                    classname=classname,
                )
            )
            continue

        known = {k.lower() for k in cls.kv} | UNIVERSAL_KEYS
        for key in ent.keys:
            if key.lower() not in known:
                findings.append(
                    _finding(
                        "warning",
                        "unknown-keyvalue",
                        f'"{classname}" has no keyvalue "{key}"; it will be ignored',
                        entity_id=ent_id,
                        classname=classname,
                        key=key,
                    )
                )

        for out in ent.outputs:
            if out.output.lower() not in {o.lower() for o in cls.out}:
                findings.append(
                    _finding(
                        "warning",
                        "unknown-output",
                        f'"{classname}" never fires "{out.output}"',
                        entity_id=ent_id,
                        classname=classname,
                        output=out.output,
                    )
                )

            target = out.target
            # !self, !activator and the other bangs are resolved at runtime.
            if not target or target.startswith("!"):
                continue
            if target not in names and not fgd.entities.get(target):
                findings.append(
                    _finding(
                        "warning",
                        "output-target-missing",
                        f'"{out.output}" of entity {ent_id} targets "{target}", which '
                        f"no entity in this map is named. An entity created at runtime "
                        f"can carry that name at runtime, so this is a lead, not a verdict",
                        entity_id=ent_id,
                        output=out.output,
                        target=target,
                    )
                )
                continue

            for target_id in names.get(target, []):
                target_ent = next(e for e in entities if int(e.id) == target_id)
                target_cls = fgd.entities.get(target_ent["classname", ""])
                if target_cls is None:
                    continue
                if out.input.lower() not in {i.lower() for i in target_cls.inp}:
                    findings.append(
                        _finding(
                            "error",
                            "unknown-input",
                            f'"{out.output}" sends "{out.input}" to "{target}", but '
                            f'{target_ent["classname", ""]} has no such input',
                            entity_id=ent_id,
                            target=target,
                            input=out.input,
                        )
                    )
                    break

    # L4D2 campaign structure. These are the failures that compile cleanly and then make a
    # chapter unplayable: a transition that is not the L4D2 transition, a missing landmark
    # pair, a safe room without its door, a finale type Valve never ships.
    by_class: dict[str, list[Any]] = {}
    for ent in entities:
        by_class.setdefault(ent["classname", ""], []).append(ent)

    landmarks = {ent["targetname", ""] for ent in by_class.get("info_landmark", [])}
    has_checkpoint_door = bool(by_class.get("prop_door_rotating_checkpoint"))
    checkpoint_regions = [
        ent
        for ent in by_class.get("func_nav_attribute_region", [])
        if _flag_bits(ent["spawnflags", "0"]) & 2048
    ]

    for ent in by_class.get("trigger_changelevel", []):
        findings.append(
            _finding(
                "warning",
                "l4d2-trigger-changelevel",
                "trigger_changelevel is not how Left 4 Dead 2 changes chapters; no stock "
                "chapter uses it. Use an info_changelevel brush with a landmark pair",
                entity_id=int(ent.id),
                classname="trigger_changelevel",
            )
        )

    for ent in by_class.get("info_changelevel", []):
        ent_id = int(ent.id)
        landmark = ent["landmark", ""].strip()
        destination = ent["map", ""].strip()
        if not destination:
            findings.append(
                _finding(
                    "error",
                    "l4d2-changelevel-no-map",
                    "info_changelevel has no map name; the chapter cannot advance",
                    entity_id=ent_id,
                    classname="info_changelevel",
                )
            )
        if not landmark:
            findings.append(
                _finding(
                    "error",
                    "l4d2-changelevel-no-landmark",
                    "info_changelevel has no landmark; the engine cannot place survivors "
                    "in the next map and the transition does not fire",
                    entity_id=ent_id,
                    classname="info_changelevel",
                )
            )
        elif landmark not in landmarks:
            findings.append(
                _finding(
                    "error",
                    "l4d2-changelevel-landmark-missing",
                    f'info_changelevel points at landmark "{landmark}", but no '
                    f'info_landmark in this map carries that targetname',
                    entity_id=ent_id,
                    classname="info_changelevel",
                    landmark=landmark,
                )
            )
        if not ent.solids:
            findings.append(
                _finding(
                    "error",
                    "l4d2-changelevel-no-brush",
                    "info_changelevel has no brush; it is a brush entity and without a "
                    "volume there is nothing to walk into",
                    entity_id=ent_id,
                    classname="info_changelevel",
                )
            )
        if not has_checkpoint_door:
            findings.append(
                _finding(
                    "warning",
                    "l4d2-changelevel-no-checkpoint-door",
                    "info_changelevel without a prop_door_rotating_checkpoint in the map; "
                    "the changelevel does not spawn and the safe room never activates",
                    entity_id=ent_id,
                    classname="info_changelevel",
                )
            )
        if not checkpoint_regions:
            findings.append(
                _finding(
                    "warning",
                    "l4d2-changelevel-no-checkpoint-nav",
                    "no func_nav_attribute_region carries the CHECKPOINT bit (2048); the "
                    "safe room is not a goal area and bots have nowhere to go",
                    entity_id=ent_id,
                    classname="info_changelevel",
                )
            )

    is_campaign_map = bool(
        by_class.get("info_changelevel") or by_class.get("trigger_finale")
    )
    if is_campaign_map and not by_class.get("info_director"):
        findings.append(
            _finding(
                "warning",
                "l4d2-no-director",
                "a campaign map needs info_director; without it there is no Director "
                "behaviour and no flow-driven spawning",
            )
        )

    if by_class.get("trigger_finale") and not by_class.get("info_changelevel"):
        findings.append(
            _finding(
                "warning",
                "l4d2-finale-no-arrival-changelevel",
                "a finale map needs the disabled info_changelevel that marks where the team "
                "arrived; without it the Director reports 'No exit checkpoint could be "
                "found' and the finale does not start",
            )
        )

    # Brush-side rules. Displacements are the reason to look at entity solids at all:
    # vbsp refuses a displacement that is not part of the world, and the id it prints
    # for the offending brush is always 0, so it cannot be found from the message.
    for ent in entities:
        for solid in ent.solids:
            for side in solid.sides:
                if getattr(side, "disp_power", None):
                    findings.append(
                        _finding(
                            "error",
                            "displacement-on-entity",
                            f'displacement on brush {solid.id} which belongs to '
                            f'"{ent["classname", ""]}" (entity {ent.id}); vbsp only '
                            f"accepts displacements on world brushes",
                            entity_id=int(ent.id),
                            brush_id=int(solid.id),
                        )
                    )
                    break

    for solid in vmf.brushes:
        for side in solid.sides:
            for axis_name in ("uaxis", "vaxis"):
                axis = getattr(side, axis_name, None)
                scale = getattr(axis, "scale", None)
                if scale is None:
                    continue
                if scale < MIN_TEXTURE_SCALE or scale > MAX_TEXTURE_SCALE:
                    findings.append(
                        _finding(
                            "error",
                            "bad-texture-scale",
                            f"brush {solid.id} side {side.id} has {axis_name} scale "
                            f"{scale}, outside [{MIN_TEXTURE_SCALE}, "
                            f"{MAX_TEXTURE_SCALE}]; vbsp reports this as "
                            f'"Bad surface extents"',
                            brush_id=int(solid.id),
                            side_id=int(side.id),
                            scale=scale,
                        )
                    )

            lightmap = getattr(side, "lightmap_scale", None)
            if (
                getattr(side, "disp_power", None)
                and lightmap is not None
                and lightmap < 8
            ):
                # A displacement is not auto-subdivided the way a brush face is: it goes
                # straight to 124x124 luxels, and a fine scale here is the usual reason a
                # vrad run stops being measured in minutes.
                findings.append(
                    _finding(
                        "warning",
                        "fine-lightmap-on-displacement",
                        f"displacement on brush {solid.id} has lightmap scale "
                        f"{lightmap}; displacements are not subdivided, so this "
                        f"multiplies vrad time",
                        brush_id=int(solid.id),
                        side_id=int(side.id),
                    )
                )

    findings.extend(_lint_landmarks_and_doors(vmf, entities, game_dir))

    return findings


def count_vmf(vmf: Any) -> dict[str, int]:
    """Counts what the compiler will have to fit under its ceilings."""
    entities = list(vmf.entities)
    brushes = list(vmf.brushes)
    sides = sum(len(s.sides) for s in brushes)
    displacements = sum(
        1 for s in brushes for side in s.sides if getattr(side, "disp_power", None)
    )
    solids_in_entities = sum(len(list(e.solids)) for e in entities)
    return {
        "entities": len(entities) + 1,  # worldspawn is not in vmf.entities
        "brushes": len(brushes) + solids_in_entities,
        "worldBrushes": len(brushes),
        "entityBrushes": solids_in_entities,
        "brushSides": sides,
        "displacements": displacements,
    }
