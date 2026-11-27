# Every prop is a ghost

**Prevention.** Write the `solid` key explicitly on every `prop_static`: `"solid" "6"` for a
model with a `.phy`, `"2"` for a bounding box, `"0"` only for decoration (with
`spawnflags 2`). `write_prop` now does this; the campaign gate fails a non-decorative
`solidity 0` instance. Do not rely on the FGD default.

## Symptom

The map compiles cleanly and every bench, car and cart can be walked through. Hammer draws
them solid. `read_model_info` says `hasPhysics: true`, and the `.phy` files are present.

## Cause

`prop_static`'s `solid` key has FGD default **6**, but vbsp does not apply that default. If
the key is absent in the VMF, the compiled `sprp` record gets **`solidity 0`**.

Measured on Santa Monica 003: 382 `prop_static` instances, all models with `.phy`, no `solid`
key → **382 instances with solidity 0**. `read_static_props` only checked the model dictionary
at first, so it reported the `.phy` as present and missed the compiled value. The game had no
collision for anything.

## Check

1. `read_static_props` → `solidity` histogram and `nonSolidInstances`. A solid map is mostly
   `"6"`; `"0"` is allowed only for `spawnflags 2` decoration.
2. `read_bsp_static_props`/the raw `sprp` reader → per-instance `solidity`.
3. `read_vmf_lint` → `prop-static-not-solid` for `solid 0` unless `spawnflags 2`.
4. `read_model_info` → `hasPhysics`; a model without `.phy` cannot be solid at `6`.

## Fix

- Add `"solid" "6"` to the `prop_static` (or `"2"` for a bounding box / no `.phy`).
- Decoration: `"solid" "0"` **and** `"spawnflags" "2"`; a clip brush is a separate world
  brush, not a prop.
- **Regenerate nav after the change.** Solid props partition nav; measured on Santa Monica,
  m1 went from 617 to 1,058 areas and m2 from 321 to 694 once the props had collision. The
  old nav describes a map the player can walk through.
- Re-run the gate (`props`, `nav`, `trouble`, `test`).

## Related

- A `.phy` file can exist and still be unused: collision is the `solid` key, not the file.
- `write_prop` `collision: "auto"` sets `solid 6` when the model has a `.phy`, `solid 0` plus
  a `TOOLS/TOOLSCLIP` hull when it has none.
- **A solid `prop_static` car is a nav island.** A static prop is in the nav build; a parked
  car, bench or cart with `solid 6` can leave orphan and non-walkable areas around it (measured
  on Santa Monica: 149 areas after the blanket fix). The official maps make movable clutter
  **`prop_physics`**; it collides at runtime and `nav_generate` ignores it. The family rule is
  in [`../references/mapping/entity-families.md`](../references/mapping/entity-families.md). Use `write_prop`
  `collision: "physics"` for cars/benches/carts; keep `prop_static` solid 6
  for fixed open architecture (lamp posts, steps, structures).
- Wall-flush props (windows, doors, railings, guardrails) are `solid 0`: the wall or fence
  brush is the collision, and a solid row of 250 windows makes nav slivers.
