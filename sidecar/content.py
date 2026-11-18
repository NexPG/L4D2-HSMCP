"""Searching the game's own content: which materials and models exist, and what they are.

A mapper picks a texture from Hammer's browser and a prop from its model viewer. An agent
had neither, so it named materials from memory -- and vbsp resolves a name literally, which
makes a wrong one a purple checkerboard nobody sees until a player loads the map. `set_face_
material` can now change a wall's material; this is how you find out what to change it to.

The mounting is the same one `dependencies.py` uses, deliberately: `Game(dir).get_filesystem()`
chains the VPKs and the loose tree in the order the engine reads them. Reusing it means the
answer here and the answer there cannot disagree about what is installed.

Two things this does not do, and says so rather than implying otherwise:

**It does not judge whether a texture looks right.** It reports the shader, the flags and the
size; "is this the brick for a 1970s Bronx tenement" is not a measurement.

**It does not read every VMT to answer a search.** A Garry's Mod install holds tens of
thousands, and parsing them all to answer "brick" would cost seconds per call. The search is
over names; `details` reads the VMTs of what the search returned, which is a handful.
"""

from __future__ import annotations

import fnmatch
import re
from typing import Any

# A search that returns everything is not a search, and serialising 40 000 names through
# the transport would cost more than the caller could use.
DEFAULT_LIMIT = 100
# Animation labels returned per model. A prop has one; a character can have hundreds, and
# a caller asking about a prop should not pay for those.
SEQUENCE_LIMIT = 64
MAX_LIMIT = 1000


def _mount(game_dir: str | None) -> tuple[Any, str | None]:
    if not game_dir:
        return None, "no gameDir given, so nothing was searched"
    try:
        from srctools.game import Game

        return Game(game_dir).get_filesystem(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def _walk(fsys: Any) -> list[str]:
    """Every file the mounted chain can see, as engine-relative paths."""
    out: list[str] = []
    for f in fsys:
        try:
            out.append(f.path.replace("\\", "/"))
        except Exception:  # noqa: BLE001,S112
            continue
    return out


def _searchable(rel: str, prefix: str) -> str:
    """The name a mapper thinks in: `brick/brickwall001a`, no prefix and no extension.

    Matching against the full engine path instead is what a first version did, and it made
    every anchored glob fail silently: `brick/brickwall*` cannot match
    `materials/brick/brickwall001a.vmt`, because fnmatch anchors at both ends and the path
    starts with the prefix. It returned nothing, which is indistinguishable from a game
    that does not have the texture.
    """
    stem = rel[len(prefix) :] if rel.lower().startswith(prefix) else rel
    return stem.rsplit(".", 1)[0].lower()


def _matcher(pattern: str) -> Any:
    """A glob when it looks like one, a substring otherwise.

    `brick*` and `metal/*floor*` are what a mapper types; `brick` on its own means "anything
    with brick in it", not "a file called exactly brick". Guessing wrong in either direction
    returns nothing and looks like the content is missing.

    A glob is tried anchored and then floating, so `brick/brickwall*` matches from the start
    of the name while `*wall00?a` still matches in the middle of it.
    """
    p = pattern.lower().strip("/")
    if any(c in p for c in "*?["):
        return lambda name: fnmatch.fnmatch(name, p) or fnmatch.fnmatch(name, f"*{p}")
    return lambda name: p in name


def _vmf_name(rel: str) -> str:
    """`materials/brick/wall.vmt` as a .vmf stores it: `BRICK/WALL`.

    The form `set_face_material` wants. Returning the path instead would make the caller
    strip the prefix and the suffix itself, which is exactly the step that gets skipped.
    """
    stem = rel[len("materials/") :] if rel.lower().startswith("materials/") else rel
    return re.sub(r"\.vmt$", "", stem, flags=re.IGNORECASE).upper()


def _present(fsys: Any, path: str) -> bool:
    """Whether the mounted chain has this file. `in` is not part of the filesystem API."""
    try:
        fsys[path]
    except (KeyError, FileNotFoundError):
        return False
    except Exception:  # noqa: BLE001
        return False
    return True


def _material_details(fsys: Any, rel: str) -> dict[str, Any]:
    """Shader, base texture, surface properties -- and whether the thing will actually draw.

    That last part is #77, and it is why this function is not just a VMT reader. A `.vmt`
    present in the game says nothing about the `.vtf` it points at. `NATURE/BLENDGRASSDIRT01`
    ships with Garry's Mod; its `forest_grass_01`, `forest_dirt_02` and `blendtexture01` do
    not, and a garden built on it is the purple checkerboard this whole tool exists to
    prevent -- reported as present.

    The resolution is `dependencies.py`'s, imported rather than restated: the two must not be
    able to disagree about what is installed, which is the same reason both mount through
    `Game(dir).get_filesystem()`.
    """
    out: dict[str, Any] = {"shader": None, "basetexture": None, "surfaceprop": None,
                           "translucent": False, "toolTexture": False,
                           "resolves": True, "missingTextures": [], "error": None}
    try:
        from srctools.vmt import Material

        from dependencies import ENVMAP_KEYWORDS, TEXTURE_PARAMS, _under_materials

        with fsys[rel].open_str() as fh:
            mat = Material.parse(fh, rel)
        mat = mat.apply_patches(fsys)
        out["shader"] = mat.shader
        for key in ("$basetexture", "$bumpmap", "$surfaceprop", "$translucent", "$alphatest"):
            val = mat.get(key)
            if val is None:
                continue
            if key == "$basetexture":
                out["basetexture"] = str(val)
            elif key == "$surfaceprop":
                out["surfaceprop"] = str(val)
            elif key in ("$translucent", "$alphatest") and str(val).strip() not in ("0", ""):
                out["translucent"] = True

        # Every texture the material names, not just the base one: a blend draws its second
        # texture wherever alpha is 255, so a missing `$basetexture2` is half a terrain.
        missing: list[str] = []
        seen: set[str] = set()
        for key, value in mat.items():
            low = key.lower()
            if not isinstance(value, str) or not value.strip():
                continue
            if low in TEXTURE_PARAMS or (
                low == "$envmap" and value.lower() not in ENVMAP_KEYWORDS
            ):
                tex = _under_materials(value.strip(), ".vtf")
                if tex in seen:
                    continue
                seen.add(tex)
                if not _present(fsys, tex):
                    missing.append(tex)
        out["missingTextures"] = sorted(missing)
        out["resolves"] = not missing
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {exc}"
        # A VMT this parser cannot read is not evidence that its textures are absent. Saying
        # `resolves: false` there would turn "I could not tell" into "it is broken".
        out["resolves"] = None
    out["toolTexture"] = rel.lower().startswith("materials/tools/")
    return out


def _model_bounds(fsys: Any, rel: str) -> dict[str, Any]:
    """Hull bounds of one model, the numbers Hammer's model viewer shows.

    `details` is what asks for this: opening every model to answer a name search would cost
    seconds, and a building's size is only needed when the caller is about to place it.
    """
    try:
        from srctools.mdl import Model

        mdl = Model(fsys, fsys[rel])
        mins = getattr(mdl, "hull_min", None)
        maxs = getattr(mdl, "hull_max", None)

        def vec(value: Any) -> list[float] | None:
            try:
                return [round(float(value.x), 3), round(float(value.y), 3), round(float(value.z), 3)]
            except Exception:  # noqa: BLE001
                return None

        lo, hi = vec(mins), vec(maxs)
        size = (
            [round(hi[i] - lo[i], 3) for i in range(3)]
            if lo is not None and hi is not None
            else None
        )
        return {"mins": lo, "maxs": hi, "size": size}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"}


def search_content(req: dict[str, Any]) -> dict[str, Any]:
    """Finds materials and models in the game, by name.

    An empty pattern is a browse, not a refusal: it returns the whole `kind`, paged with
    `offset`. Refusing it was the reason an agent could only find an asset whose name it
    already guessed -- the escalator existed in the game and the agent never saw it.
    """
    game_dir = req.get("gameDir")
    pattern = str(req.get("pattern", "")).strip()
    kind = req.get("kind", "material")
    limit = min(int(req.get("limit", DEFAULT_LIMIT)), MAX_LIMIT)
    offset = max(0, int(req.get("offset", 0)))
    want_details = bool(req.get("details", False))

    fsys, mount_error = _mount(game_dir)
    if fsys is None:
        return {
            "gameDir": game_dir,
            "mounted": False,
            "mountError": mount_error,
            "pattern": pattern,
            "kind": kind,
            "total": 0,
            "results": [],
            "note": "nothing was searched, so an empty result here says nothing about the game",
        }

    prefix, suffix = {
        "material": ("materials/", ".vmt"),
        "model": ("models/", ".mdl"),
        "particle": ("particles/", ".pcf"),
        "sound": ("sound/", ".wav"),
    }.get(kind, ("materials/", ".vmt"))
    match = _matcher(pattern) if pattern else (lambda name: True)
    hits: list[str] = []
    for path in _walk(fsys):
        low = path.lower()
        if not low.startswith(prefix) or not low.endswith(suffix):
            continue
        if match(_searchable(low, prefix)):
            hits.append(path)

    hits.sort()
    total = len(hits)
    shown = hits[offset : offset + limit]

    results: list[dict[str, Any]] = []
    for rel in shown:
        row: dict[str, Any] = {"path": rel}
        if kind == "material":
            row["name"] = _vmf_name(rel)
            if want_details:
                row.update(_material_details(fsys, rel))
        elif want_details:
            # A model's size is the number a mapper needs before placing it: a house whose
            # origin is at its centre is not a house placed on the floor's z.
            row.update(_model_bounds(fsys, rel))
        results.append(row)

    return {
        "gameDir": game_dir,
        "mounted": True,
        "mountError": None,
        "pattern": pattern,
        "kind": kind,
        "offset": offset,
        "total": total,
        "shown": len(results),
        "truncated": offset + len(results) < total,
        "nextOffset": offset + len(results) if offset + len(results) < total else None,
        "results": results,
        "note": (
            "names only unless details was asked for. Materials: details reads the VMT and "
            "every texture it names. Models: details reads the hull bounds Hammer's model "
            "viewer shows. An empty pattern browses; page it with offset."
        ),
    }


MODEL_CATEGORIES: dict[str, tuple[str, ...]] = {
    "escalator": ("escalator",),
    "stairs": ("stair", "stairs", "step", "steps", "tread", "ladder"),
    "door": ("door", "doorway", "gate"),
    "vehicle": ("vehicle", "car", "truck", "bus", "van", "apc", "btr", "train"),
    "foliage": ("tree", "foliage", "plant", "bush", "fern", "grass"),
    "street": ("street", "bench", "fountain", "statue", "lamp", "hydrant", "trash"),
    "interior": ("interior", "chair", "table", "shelf", "cabinet", "desk", "bed"),
    "light": ("light", "lamp", "fluorescent", "neon", "fixture"),
    "sign": ("sign", "poster", "billboard", "graffiti"),
}


def _category_hit(stem: str, needles: tuple[str, ...]) -> bool:
    """Whether a model filename carries one of these words as a word.

    A plain substring test made `log_cabin_corners` a street prop (`bin`) and
    `checkpoint_door_lighthouse01` a light (`light`). A filename is tokenised on
    non-alphanumerics; a token matches exactly, or a needle plus a numeric suffix
    (`escalator01`).
    """
    for token in re.split(r"[^a-z0-9]+", stem):
        for needle in needles:
            if token == needle:
                return True
            if token.startswith(needle) and token[len(needle):].isdigit():
                return True
    return False


def asset_catalog(req: dict[str, Any]) -> dict[str, Any]:
    """Every category of stock model Hammer++ shows, in one walk.

    `search_content` needs a name. That is the wrong shape for "what stair and escalator
    models does this game have": the caller does not know the name, which is why it is
    asking. This groups the mounted model tree by what the path says it is, and returns the
    bounds for the structural categories (stairs, escalators, doors) because those numbers
    decide whether a doorway or a shaft fits.
    """
    game_dir = req.get("gameDir")
    kind = str(req.get("kind", "model"))
    per_category = min(max(int(req.get("perCategory", 40)), 1), 200)
    fsys, mount_error = _mount(game_dir)
    if fsys is None:
        return {
            "gameDir": game_dir,
            "mounted": False,
            "mountError": mount_error,
            "categories": [],
            "skyboxes": [],
        }

    paths = _walk(fsys)
    models = sorted(p for p in paths if p.lower().startswith("models/") and p.lower().endswith(".mdl"))
    materials = sorted(
        p for p in paths if p.lower().startswith("materials/skybox/") and p.lower().endswith(".vmt")
    )

    details_for = {"escalator", "stairs", "door", "vehicle"}
    categories: list[dict[str, Any]] = []
    for name, needles in MODEL_CATEGORIES.items():
        hits = [
            p
            for p in models
            if _category_hit(p.rsplit("/", 1)[-1].lower().removesuffix(".mdl"), needles)
        ]
        # A model can match two categories; that is fine and better than a silent miss.
        rows: list[dict[str, Any]] = []
        for rel in hits[:per_category]:
            row: dict[str, Any] = {"path": rel}
            if name in details_for:
                row.update(_model_bounds(fsys, rel))
            rows.append(row)
        categories.append(
            {
                "name": name,
                "total": len(hits),
                "shown": len(rows),
                "results": rows,
            }
        )

    # Sky completeness, grouped the way the engine resolves it: `_hdr`/`_ldr` infix (or no
    # infix, which Source treats as the LDR set) before rt/lf/bk/ft/up/dn.
    sides = ("rt", "lf", "bk", "ft", "up", "dn")
    sky: dict[str, dict[str, set[str]]] = {}
    side_re = re.compile(r"^materials/skybox/(.+?)(?:_(hdr|ldr))?(rt|lf|bk|ft|up|dn)(?:_(hdr|ldr))?\.vmt$", re.I)
    for rel in materials:
        m = side_re.match(rel)
        if not m:
            continue
        base = m.group(1).lower()
        mode = (m.group(2) or m.group(4) or "ldr").lower()
        sky.setdefault(base, {"ldr": set(), "hdr": set()})[mode].add(m.group(3).lower())
    skies: list[dict[str, Any]] = []
    for base, faces in sorted(sky.items()):
        ldr_complete = all(s in faces["ldr"] for s in sides)
        hdr_complete = all(s in faces["hdr"] for s in sides)
        skies.append(
            {
                "name": base,
                "ldrName": f"{base}_ldr",
                "hdrName": f"{base}_hdr",
                "suggested": f"{base}_hdr" if hdr_complete else f"{base}_ldr" if ldr_complete else base,
                "ldrComplete": ldr_complete,
                "hdrComplete": hdr_complete,
                "strictComplete": ldr_complete and hdr_complete,
            }
        )

    return {
        "gameDir": game_dir,
        "mounted": True,
        "mountError": None,
        "kind": kind,
        "modelCount": len(models),
        "materialCount": len(paths) - len(models),
        "categories": categories,
        "skyboxes": skies,
        "note": (
            "One walk of the mounted VPK-and-loose chain. Categories are by path name; "
            "`total` is the real count and `shown` is capped by perCategory. Bounds are the "
            "hull Hammer's model viewer reports, so `mins.z` is how far below the origin the "
            "model reaches. `strictComplete` is the only sky value safe to compile in both "
            "LDR and HDR."
        ),
    }


def model_info(req: dict[str, Any]) -> dict[str, Any]:
    """Bounds, skins, sequences and materials of one .mdl.

    What Hammer's model browser shows, and what an agent needs before placing a prop: a
    prop_static positioned from its origin without knowing its size lands half inside the
    floor, and nothing downstream reports that.
    """
    game_dir = req.get("gameDir")
    rel = str(req.get("model", "")).replace("\\", "/").strip()
    if not rel:
        return {"model": "", "mounted": False, "found": False, "refused": "no model given"}
    if not rel.lower().startswith("models/"):
        rel = f"models/{rel}"
    if not rel.lower().endswith(".mdl"):
        rel = f"{rel}.mdl"

    fsys, mount_error = _mount(game_dir)
    if fsys is None:
        return {"model": rel, "mounted": False, "mountError": mount_error, "found": False}

    try:
        from srctools.mdl import Model

        mdl = Model(fsys, fsys[rel])
    except (KeyError, FileNotFoundError):
        return {
            "model": rel,
            "mounted": True,
            "mountError": None,
            "found": False,
            "note": "not in this game's content. Check the name, or the addon that ships it",
        }
    except Exception as exc:  # noqa: BLE001
        # `readError` rather than `error`, for the same reason as above: a malformed model
        # would otherwise reach the caller as "sidecar model_info: unknown error" with the
        # diagnostic thrown away.
        return {
            "model": rel,
            "mounted": True,
            "mountError": None,
            "found": False,
            "readError": f"{type(exc).__name__}: {exc}",
        }

    def _vec(v: Any) -> list[float] | None:
        try:
            return [round(float(v.x), 3), round(float(v.y), 3), round(float(v.z), 3)]
        except Exception:  # noqa: BLE001
            return None

    textures = []
    try:
        textures = sorted({t.replace("\\", "/") for t in mdl.iter_textures()})
    except Exception:  # noqa: BLE001
        textures = []

    skins: list[int] = []
    try:
        skins = list(range(len(mdl.skins)))
    except Exception:  # noqa: BLE001
        skins = []

    # Labels only. srctools' Sequence reprs its bounding box and its event list, which
    # runs to a few hundred characters each and answers a question nobody asked.
    # Counted before slicing. Reporting the length of the truncated list told a caller a
    # model with 300 animations has exactly 64, with nothing to say the rest exist.
    sequences: list[str] = []
    sequence_total = 0
    try:
        labels = [str(getattr(s, "label", s)) for s in getattr(mdl, "sequences", [])]
        sequence_total = len(labels)
        sequences = labels[:SEQUENCE_LIMIT]
    except Exception:  # noqa: BLE001
        sequences = []

    mins = _vec(getattr(mdl, "hull_min", None))
    maxs = _vec(getattr(mdl, "hull_max", None))
    size = (
        [round(maxs[i] - mins[i], 3) for i in range(3)]
        if mins is not None and maxs is not None
        else None
    )

    return {
        "model": rel,
        "mounted": True,
        "mountError": None,
        "found": True,
        "mins": mins,
        "maxs": maxs,
        "size": size,
        "skinCount": len(skins),
        "sequenceCount": sequence_total,
        "sequences": sequences,
        "sequencesTruncated": sequence_total > len(sequences),
        "materials": textures,
        "note": (
            "bounds are the model's own hull, around its origin. A prop placed at a floor's "
            "height sinks by however far its origin sits above its lowest point"
        ),
    }
