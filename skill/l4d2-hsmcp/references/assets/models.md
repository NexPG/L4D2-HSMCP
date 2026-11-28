# Models and materials in the stock game

The toolkit does not ship assets: it reads the installed game. Choose from what is installed,
and look at the asset before writing its path into a map.

## Browse, then look

```
read_asset_catalog(perCategory: 10)
read_model_catalog(pattern: "props_doors", minDimension: 100, maxDimension: 130,
                   hasPhysics: true)
preview_asset(asset: "BRICK/BRICK_EXT_01", kind: "material")
preview_asset(asset: "models/props_unique/escalator01_left.mdl", kind: "model")
read_model_info(model: "...")
```

`read_asset_catalog` groups models into building, roof, window, vehicle, foliage, street,
interior, prop, fence, light, sign, terrain, escalator and stairs, and materials into brick,
concrete, plaster, wood, metal, roof, tile, ground, grass, asphalt, water, glass, fabric,
sign and building. It returns real counts, a bounded sample per category, and hull bounds for
structural categories. It hides the roots the editor hides
(`debug/engine/hud/vgui/voice/console/sblitz/particle/dons_decals`); `includeHidden: true`
browses them. `read_game_content` with an empty pattern pages a whole kind. On a material,
`details: true` resolves every texture it names; a missing one draws as a checkerboard.

`read_model_catalog` answers the placement question without opening a viewer: filter the
stock models by measured hull (`minDimension`/`maxDimension`), `$staticprop`, a `.phy` sibling
and a material name, then page the result. It reads the MDL header and material table, not the
vertex data, so a full scan is seconds. The hull is a bound, not a silhouette, and the `.mdl`
stores no forward axis: `preview_model`/`read_model_facing` is still the facing check.

A name is not a look. `preview_asset` renders the candidate; `read_model_info` returns the
hull, `.phy`, `$staticprop` flag and sequences of one model when the catalog row is not
enough.

## Confirmed stock paths

Measured on the installed L4D2, 2026.

| Need | Models | Size (units) |
|---|---|---|
| Escalator | `models/props_unique/escalator01_left.mdl`, `..._right.mdl`; `models/props_mall/mall_escalator.mdl`; `models/props_unique/escalator02.mdl`, `escalatorairport.mdl` | 38.99 x 467.55 x 261.34 (`escalator01`); 110.5 x 606 x 324.25 (`mall_escalator`); measure the others with `read_model_info` |
| Stairs / steps | `models/props_interiors/stair_treads_straight.mdl`; `models/props_exteriors/wood_stairs_120.mdl`; brush `shape: "stairs"` | measure with `read_model_info` |
| Doors | `models/props_doors/checkpoint_door_02.mdl`, `checkpoint_door_01.mdl`, `checkpoint_door_-02.mdl` | see [`../mapping/doors.md`](../mapping/doors.md) |
| Vehicles | `models/props_vehicles/apc001.mdl` (closest stock BTR stand-in); `train003.mdl` | measure with `read_model_info` |

The escalator's long axis is local **Y**; it tilts by **roll**, not pitch. That rule, with the
campaign corrections, is in [`../mapping/model-facing.md`](../mapping/model-facing.md).

## Related

- Which way a model faces: [`model-facing.md`](../mapping/model-facing.md).
- Writing a new model: [`model-authoring.md`](../mapping/model-authoring.md).
- Choosing terrain and water materials: [`terrain-water-boundaries.md`](../mapping/terrain-water-boundaries.md).
- Sky completeness (`ldrComplete`/`hdrComplete`): [`3d-skybox.md`](../mapping/3d-skybox.md).
