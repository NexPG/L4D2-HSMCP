# Models and materials in the stock game

The toolkit does not ship assets: it reads the installed game. Choose from what is installed,
and look at the asset before writing its path into a map.

## Browse, then look

```
read_asset_catalog(perCategory: 10)
preview_asset(asset: "BRICK/BRICK_EXT_01", kind: "material")
preview_asset(asset: "models/props_unique/escalator01_left.mdl", kind: "model")
read_model_info(model: "...")
```

`read_asset_catalog` groups models into building, roof, window, vehicle, foliage, street,
interior, prop, fence, light, sign, terrain, escalator and stairs, and materials into brick,
concrete, plaster, wood, metal, roof, tile, ground, grass, asphalt, water, glass, fabric,
sign and building. It hides the roots the editor hides
(`debug/engine/hud/vgui/voice/console/sblitz/particle/dons_decals`); `includeHidden: true`
browses them. `read_game_content` with an empty pattern pages a whole kind. On a material,
`details: true` resolves every texture it names; a missing one draws as a checkerboard.

A name is not a look, and a family is not a size. `preview_asset` renders the candidate;
`read_model_info` returns the hull, `.phy`, `$staticprop` flag and sequences that a placement
needs.

## Confirmed stock paths

Measured on the installed L4D2, 2026.

| Need | Models | Hull (units) |
|---|---|---|
| Escalator | `models/props_unique/escalator01_left.mdl`, `..._right.mdl`; `models/props_mall/mall_escalator.mdl`; `models/props_unique/escalator02.mdl`, `escalatorairport.mdl` | 38.99 x 467.55 x 261.34; 110.5 x 606 x 324.25 |
| Stairs / steps | `models/props_interiors/stair_treads_straight.mdl`; `models/props_exteriors/wood_stairs_120.mdl`; brush `shape: "stairs"` | read with `read_model_info` |
| Doors | `models/props_doors/checkpoint_door_02.mdl`, `checkpoint_door_01.mdl`, `checkpoint_door_-02.mdl` | [`../mapping/doors.md`](../mapping/doors.md) |
| Vehicles | `models/props_vehicles/apc001.mdl` (closest stock BTR stand-in); `train003.mdl` | read with `read_model_info` |

The escalator's long axis is local **Y**; it tilts by **roll**, not pitch. That rule, with the
campaign corrections, is in [`../mapping/model-facing.md`](../mapping/model-facing.md).

## Related

- Which way a model faces: [`model-facing.md`](../mapping/model-facing.md).
- Writing a new model: [`model-authoring.md`](../mapping/model-authoring.md).
- Choosing terrain and water materials: [`terrain-water-boundaries.md`](../mapping/terrain-water-boundaries.md).
- Sky completeness (`ldrComplete`/`hdrComplete`): [`3d-skybox.md`](../mapping/3d-skybox.md).
