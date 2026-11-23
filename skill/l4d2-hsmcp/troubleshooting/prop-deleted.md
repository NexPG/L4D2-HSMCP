# A prop is in Hammer but missing in game

**Prevention.** A `prop_static` must be a model compiled with `$staticprop`. Use `write_prop`:
it reads `staticProp` from the MDL and warns before the entity is written; `read_vmf_lint`
reports `prop-static-not-static-prop` as an **error**. For clutter the player moves, the
official maps use `prop_physics` (11,667 instances) — `write_prop` `collision: "physics"`
writes that class and keeps the model's own physics hull.

## Symptom

Hammer draws the prop, the VMF contains it, `run_compile` returns `ok: true` — and in game
there is nothing there. The compile log has:

```text
Error! prop_static using model "models/props_fairgrounds/arcadegame01.mdl",
which must be used on a dynamic entity (i.e. prop_physics). Deleted.
```

vbsp **deletes** the prop and exits **0**. `run_compile` returns the exit code, so a build that
only checks it calls the deletion a pass; the `vbsp-deleted-prop` rule makes it an error.

Measured on Tools++ vbsp with `models/props_fairgrounds/arcadegame01.mdl`: `read_model_info`
reports `staticProp: false`, the log has the line above, the compile exits 0, and the map has
no prop. The same model as `prop_dynamic` compiles and appears.

## Cause

`$staticprop` is an MDL header flag, not a file and not a keyvalue. A model without it can
only be used on a dynamic entity; a `prop_static` from it is refused. A model can have a
valid `.phy` and still fail this check — collision and static-prop eligibility are separate.

## Check

1. `read_model_info` on the model → `staticProp`. `false` means it cannot be a `prop_static`.
2. `read_vmf_lint` on the source → `prop-static-not-static-prop` (error) names the entity and
   model before a compile.
3. `read_compile_log` on an existing log → `vbsp-deleted-prop`; the finding carries the model.
4. `read_map_geometry`/`read_static_props` on the BSP: the model is absent, which is the
   post-compile proof.

## Fix

| Want | Do |
|---|---|
| A static, baked prop | Use a model with `$staticprop: true`, or recompile your model's QC with `$staticprop` |
| A prop that stands still but is not baked | `write_prop` `collision: "dynamic"` → `prop_dynamic` |
| Movable clutter (car, bin, bench, cart) | `write_prop` `collision: "physics"` → `prop_physics` |
| A prefab's own class | `kind: "dynamic_override"` / `"physics_override"` where the official prefab uses it |

Do not "fix" it by deleting the log line. The prop is gone from the BSP; a green build with a
missing prop is the failure this page exists to prevent.

## Related

- A prop that is present but **walk-through**: the model has no `.phy`, not a missing prop.
  `read_static_props`/`read_model_info.hasPhysics` and `read_vmf_lint`
  `prop-static-no-physics` name it; `write_prop` `collision: "auto"` adds a clip hull.
- `spawnflags 2` marks decoration (grass, a tree canopy, an overlay). It does not make a
  dynamic-only model static.
