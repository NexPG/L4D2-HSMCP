# Engine limits and the stock asset browser

Full table: `docs/reference/engine-limits-l4d2.md`. This page is the short version an agent
needs while choosing geometry.

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
