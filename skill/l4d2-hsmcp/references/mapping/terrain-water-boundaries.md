# Terrain, water and map boundaries

The tools for all three exist. This is the order they go in; the failure mode is almost
never the tool, it is a flat box used where terrain was wanted and a map whose ground ends
at the skybox shell.

## Terrain

1. **Build the floor as a grid, not one giant box.** A displacement replaces one face; a
   power-4 grid is 17x17 vertices. One 2048-unit box gives one broad wave and no detail. Use
   `write_vmf_solid` with several boxes (a cell every 128-256 units) for the area that will
   be sculpted, and keep a separate flat floor under paths, doorways and props.
2. **Displace the top faces.**
   ```
   write_displacement(path, power: 4, facing: "up", material: "<ground material>", confirm: true)
   ```
   Do not displace the map's sealing shell: a displacement does not seal, and vbsp will leak
   through the shape the terrain no longer has.
3. **Shape it.**
   ```
   sculpt_displacement(path, solidIds: [...], shape: { kind: "noise", amplitude: 48, seed: 7 })
   sculpt_displacement(path, solidIds: [...], shape: { kind: "slope", from: 0, to: 96, along: "y" })
   ```
   `noise` takes a seed so the same map can be regenerated. `raise`, `flatten` and `slope`
   are the other three shapes.
4. **Sew the seams.** `sew_displacements` closes the crack between two grids that were
   sculpted separately.
5. **Paint the blend.** `paint_displacement` with `byHeight` or `bySlope` on a blend material
   (`NATURE/BLEND...`). A non-blend VMT ignores alpha, and nothing in vbsp says so.
6. **Keep the route gradeable.** A 45-degree slope is the walk limit; a 51-degree wedge is a
   wall. Stairs must be 18 units or less per step. `write_vmf_solid` refuses both unless
   `steep: true` is passed for scenery.

## Water

- A water body is a **`func_water_analog` brush**, not a material on the floor. Create the
  entity with `edit_vmf`, add its brush with `write_vmf_solid({ entityId })`, and use a
  `LIQUIDS/...` material. `water_lod_control` is a point entity for the LOD; add one.
- **Water is not nav.** The nav mesh stops at the surface. A route across it needs a solid
  boardwalk or bridge at least a survivor hull wide (32x32), joined to nav on both banks.
- A shoreline is `paint_displacement` `byHeight` between the water line and the bank, not a
  hard line of one material.
- `LIQUIDS/WATER_SWAMP_M1`, `LIQUIDS/WATER_COAST01`, `LIQUIDS/WATER_CANAL` are stock; preview
  them with `preview_asset` before choosing.

## Boundaries

A map that ends at the skybox shell is a map that shows its edge. Cover it in this order:

1. **A physical edge** the player cannot cross: a cliff, a dense tree line, a building wall,
   a fence. In the forest, a line of tall trees at the shell; in the city, the facades and a
   blocked street.
2. **A visual edge** behind it: a 3D skybox or a sky material, plus `env_fog_controller`.
   Fog at 1500-2500 units hides the last row of trees and the ground seam.
3. **A nav edge**: no nav areas beyond the physical edge. A tree line that nav can path
   around is not a boundary.
4. **A sound/atmosphere edge** if the map is large: `env_soundscape` and a fog volume.

Use `read_vmf_view`/`run_map_test` to look at the boundary from the playable side. The
offline plan and the game frame are different oracles; only the frame proves the seam is
hidden.

## See the asset before choosing it

```
read_asset_catalog(perCategory: 10)
preview_asset(asset: "BRICK/BRICK_EXT_01", kind: "material")
preview_asset(asset: "models/props_unique/escalator01_left.mdl", kind: "model")
read_model_info(model: "...")
```

`read_asset_catalog` groups models into building, roof, window, vehicle, foliage, street,
interior, prop, fence, light, sign, terrain, escalator and stairs, and materials into brick,
concrete, plaster, wood, metal, roof, tile, ground, grass, asphalt, water, glass, fabric,
sign and building. Use `preview_asset` on a candidate; a name is not a look.
