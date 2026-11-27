# Terrain, water and map boundaries

The tools for all three exist. This is the order they go in; the failure mode is almost
never the tool, it is a flat box used where terrain was wanted and a map whose ground ends
at the skybox shell.

## Terrain

1. **Build the floor as a grid, not one giant box.** A displacement replaces one face; a
   power-4 grid is 17x17 vertices. One 2048-unit box gives one broad wave and no detail. Use
   `write_vmf_solid` with several boxes (a cell every 128-256 units) for the area that will
   be sculpted, and keep a separate flat floor under paths, doorways and props.
2. **Displace the top faces.** The one-call path is `write_vmf_terrain`, which builds the
   grid, displaces every top face, applies an optional slope or profile, adds seeded noise
   and sews the seams:
   ```
   write_vmf_terrain(path, mins, maxs, floorZ: 0, cellSize: 256, power: 3,
                     material: "LIGHTHOUSE/BLEND/BLEND_SAND03_CLIFF",
                     profile: { along: "x", points: [{ at: -1180, height: 0 },
                               { at: -1020, height: 48 }, { at: -860, height: 0 }] },
                     noise: 8, seed: 11, seal: true, confirm: true)
   ```
   The lower-level path is `write_displacement(path, power: 4, facing: "up", material:
   "<ground material>", confirm: true)`. Do not displace the map's sealing shell: vbsp takes
   a displaced brush out of the hull, so its volume is void and the map leaks through it. Pass
   `seal: true` to duplicate each displaced brush with a tool material, or run
   `seal_displacements` afterwards. A lower brush whose top is below the terrain also seals;
   the seal's flat face clips any terrain that dips below it, so keep the terrain's edge on
   that plane.
   The face must also fit **one lightmap**: at scale 16 a side longer than ~2000 units
   (125 luxels) makes vbsp exit with `Bad surface extents - surface is too big to have a
   lightmap` and write no BSP, because a displacement is not split the way a brush face is.
   `write_displacement` refuses that face and names the split length and the scale to use.
   Measured: a 2048x4608 floor at scale 16 failed (`128 > 126`); a 1024x2048 floor at scale 32
   compiled, generated 157 nav areas and loaded in game with no `NAV ERRORS`.
3. **Shape it.** `slope` is one ramp per patch; `profile` is a control-point heightfield for
   a dune that has to rise and fall again. Both measure the **undisplaced world position**, so
   neighbouring cells meet at the same height and the patch is one surface, not a row of
   sawteeth.
   ```
   sculpt_displacement(path, solidIds: [...], shape: { kind: "noise", amplitude: 48, seed: 7 })
   sculpt_displacement(path, solidIds: [...], shape: { kind: "plane", from: 0, to: 96,
                       along: "y", fromPos: -2816, toPos: 3840 })
   sculpt_displacement(path, solidIds: [...], shape: { kind: "profile", along: "x",
                       points: [{ at: 0, height: 0 }, { at: 256, height: 48 },
                                { at: 512, height: 0 }] })
   ```
   `noise` takes a seed so the same map can be regenerated. Its amplitude is **per vertex**:
   16 units at a 16-unit grid spacing is a 45-degree zigzag, not a dune. Keep the amplitude
   under about a quarter of the vertex spacing.
4. **Sew the seams.** `sew_displacements` closes the crack between two grids that were
   sculpted separately. A patch made in one `write_vmf_terrain` call still needs it: noise is
   generated per local grid, so the shared edge is averaged.
5. **Paint the blend.** `paint_displacement` with `byHeight` or `bySlope` on a blend material
   (`NATURE/BLEND...`, `LIGHTHOUSE/BLEND/...`). A non-blend VMT ignores alpha, and nothing in
   vbsp says so. On a beach, `byHeight` low near the water and high at the dune crest gives
   wet-to-dry sand; keep the high value near the crest or the whole beach becomes the second
   texture.
6. **Keep the route gradeable.** A 45-degree slope is the walk limit; a 51-degree wedge is a
   wall. Stairs must be 18 units or less per step. `write_vmf_solid` refuses both unless
   `steep: true` is passed for scenery.
7. **Nav needs a mark on a real walking position.** The engine samples one mark, not the whole
   BSP; an empty mesh on terrain is usually the mark at the world origin, not a rise limit.
   Cause, check and fix: [`../../troubleshooting/terrain-nav-empty.md`](../../troubleshooting/terrain-nav-empty.md).
   Keep the spawn on a flat brush ring even when the patch is displaced.

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

Browse the installed library, do not invent a name: [`../assets/models.md`](../assets/models.md).
For a surface, `read_asset_catalog` groups terrain materials; `preview_asset` renders the
candidate. A name is not a look.
