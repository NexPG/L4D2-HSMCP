# Engine limits and the stock asset browser

Full table: `docs/reference/engine-limits-l4d2.md`. This page is the short version an agent
needs while choosing geometry, and the same numbers serve both passes: pass 1 must not plan
more entities, models or brushes than pass 2 can compile.

## Format facts before limits

- **`dmodel_t` is 48 bytes** (`Vector mins, maxs, origin; int headnode; int firstface,
  numfaces`, `bspfile.h`). A reader that assumes 64 decodes garbage after the world model; that
  is how brush entities lost their bounds and water/nav-blocker volumes disappeared.
- **Nav areas are not `MAX_MAP_AREAS`.** That 256 counts BSP vis areas. A nav file carries its
  own area count; stock chapters hold 1,000–1,700 and load fine.

## The numbers that stop a map

- Coordinates: **-16384 .. +16384**. `read_map_geometry` reports `mins`/`maxs`.
- Brushes **8192**, brush sides **65536**, faces **65536**, vertices **65536**,
  planes **65536**, texinfo **12288**, unique materials/texdata **2048**,
  displacement surfaces **2048**, brush models **1024**.
- Map entities **8192**; runtime edicts **2048**. A `prop_static` is cheap; a
  `prop_dynamic`, door, physics prop or NPC is an edict.
- Lighting **16 MB per mode**; visibility **16 MB**. `hdr: true` needs both lightmap sets.
- Keep the BSP **under ~300 MB** and the VPK **under 2 GB**; the process is 32-bit.
- Dynamic lights: keep **under 32** at once; projected textures **1-4**.

`read_vmf_lint` checks the source, `read_map_geometry` the compiled BSP, and
`run_compile` refuses a sky without faces for the lighting mode being built.

## Assets: browse, do not guess

`read_asset_catalog` returns the stock categories in one call: `escalator`, `stairs`,
`door`, `vehicle`, `foliage`, `street`, `interior`, `light`, `sign`, with real counts,
a bounded sample, and the hull bounds for structural categories. `read_game_content`
with an empty pattern browses a whole kind, paged with `offset`.

Confirmed stock paths (L4D2, 2026 install):

| Need | Models |
|---|---|
| Escalator | `models/props_unique/escalator01_left.mdl`, `..._right.mdl` (38.99 x 467.55 x 261.34); `models/props_mall/mall_escalator.mdl` (110.5 x 606 x 324.25); `models/props_unique/escalator02.mdl`, `escalatorairport.mdl` |
| Stairs / steps | `models/props_interiors/stair_treads_straight.mdl`; `models/props_exteriors/wood_stairs_120.mdl`; brush `shape: "stairs"` |
| Doors | `models/props_doors/checkpoint_door_02.mdl` (58.3 x 105.8); `checkpoint_door_01.mdl` (68.4 x 105); `checkpoint_door_-02.mdl` (58.3) |
| Vehicles | `models/props_vehicles/apc001.mdl` (closest stock BTR stand-in); `train003.mdl` |

## Doors: the origin is the hinge

A rotating door model's origin sits on its **hinge**, not in the middle of the leaf. For
`checkpoint_door_02` the hull is `-2.6..+55.7` on the model's local Y: the leaf extends
58.3 units one way from the origin. Put that origin in the middle of a 64-unit opening and
half the doorway stays open while the other half goes through the wall.

- Use the jamb, about **2 units inside the opening**, as the entity origin.
- With `angles "0 90 0"` the leaf's local +Y turns to world **-X**, so the hinge belongs on
  the **+X** jamb (x = opening.max - 2). Yaw 270 puts it on the -X jamb.
- `placeDoor` in `src/maps/typescript/vmf/door.ts` does this from `read_model_info` bounds and an opening;
  the build uses it for both checkpoint doors.
- `read_vmf_lint` reports `l4d2-door-hinge-at-center` when the origin is more than 8 units
  from both jambs, and `l4d2-door-opening-too-wide` / `-too-narrow` for the fit.
- The engine resolves the checkpoint door by **class near the safe room's landmark**, not
  by name. `checkpoint_exit`/`checkpoint_entrance` are canonical advice; 20 of 57 stock
  chapters leave the door unnamed and still transition.
- Keep the leaf's width + 16 units clear of props; `l4d2-door-swing-blocked` reports a bench
  or crate inside the swing arc.

## Props on a slope: roll, not pitch

Source `angles` are **pitch yaw roll**. A model whose long axis is local **Y** (an escalator,
a handrail, a ramp prop) is tilted along that axis by **roll** (the third number), not pitch.
For a ramp climbing +Y, positive roll raises the +Y end: `angles "0 0 23"`. Negative roll
sinks it into the floor. A model long on **X** uses pitch instead. Verify the sign in game:
the old escalator used `-23`, which tilted it against the 23-degree ramp.

## Map names: 30 characters, not 64

The nav header stores the map name in 32 bytes, but the engine fails signon at 31 characters.
A longer name leaves the client at the main menu with `String Table dictionary ... should be
rebuilt` and `Netchannel: failed reading message net_SignonState`. Measured: a 37-character
preview name failed; a 31-character one (`hsmcp_preview_checkpoi_mwteil6r`) failed; the same
rooms at 30 characters (`hsmcp_preview_bench001_mwtehbv5`) and 11 (`prevcartest`) loaded.
Keep a custom map name at 30 characters or fewer, and let `preview_model` generate its own
(it caps the total).

## Props that look solid and are not
`prop_static` has a `solid` key with the FGD default **6** (Use VPhysics), but vbsp does not
apply that default: an omitted key compiles to `solidity 0`. Measured on Santa Monica: 382
`prop_static` instances with `.phy` models and no `solid` key all came out solidity 0, and
every bench, car and cart was a ghost. **Write `solid 6` explicitly** for a solid prop;
`solid 0` for decoration, `solid 2` for a bounding box. `read_static_props` reports the
compiled `solidity` histogram and `nonSolidInstances`; the campaign gate fails a non-decorative
solidity-0 instance. A model without a `.phy` needs a clip brush or `solid 2` even with 6.

A model also needs the MDL `$staticprop` header flag to be a `prop_static`. Without it vbsp
prints `Error! prop_static using model ..., which must be used on a dynamic entity ... Deleted.`
and exits 0. `read_model_info.staticProp` and `read_vmf_lint`'s
`prop-static-not-static-prop` (an error) name it before the compile; `write_prop` warns too.

## Geometry that nav can cross

- Ramp/wedge: **<= 45 degrees**. `write_vmf_solid` refuses a steeper `wedge` unless
  `steep: true` (scenery). Use `shape: "stairs"` for a descent.
- Stairs: **<= 18 units per step**. `write_vmf_solid` refuses a taller step unless
  `steep: true`.
- A ramp needs flat landings at both ends and must connect to nav on both banks.
- Water is not nav. A route across water needs a solid boardwalk at least one survivor hull
  (32 x 32) wide, joined to nav at both ends.
- `nav_slope_limit` (`run_nav_generate({ navSlopeLimit })`) can allow a steep surface, but
  it does not make a 51-degree wall walkable for a player. Fix the geometry.
