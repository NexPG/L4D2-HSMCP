# 3D skybox

A 3D skybox is real geometry drawn at 1/16 scale around a `sky_camera`. It lets a map show
distant buildings, hills or a city skyline that the player can never reach.

## What it needs

1. A **2D sky**: `skyname` on worldspawn (`set_map_properties`). Without it the 3D skybox has
   nothing to draw against. The name must carry the mode suffix the engine looks up:
   stock L4D2 maps store `sky_l4d_c1_1_hdr`, not `sky_l4d_c1_1`. A bare base name makes the
   engine request `skybox/<name>rt.vmt`, which does not exist, and the sky draws as a flat
   void. `read_asset_catalog` returns every sky with `ldrComplete`, `hdrComplete` and the
   exact `suggested` name; `write_vmf` appends `_hdr` when that set is complete.
2. **One `sky_camera`**, placed at the point the skybox is centred on. `scale` is 16 by
   default: the camera stays at world scale, the geometry around it is 1/16 size.
3. A **sealed skybox area** built far from the playable map, containing the scaled geometry.
4. The skybox geometry uses sky materials; the playable map is untouched.

```
write_sky_camera(path: "my_map.vmf", origin: [0, 0, 10000], scale: 16)
```

The tool refuses a second camera and warns when `skyname` is missing.

## Making the copy

`build_skybox` does the whole thing in one call: it copies the selected brushes at 1/16
scale around the map origin, moves them to a free area outside the playable map, encloses
them in a sealed room textured `TOOLS/TOOLSSKYBOX`, and places the single `sky_camera` at
the scaled origin.

```
build_skybox(
  path: "my_map.vmf",
  within: { mins: [-2048, -2048, 0], maxs: [2048, 2048, 1024] },
  material: "NATURE/",          // optional: only the scenery
  scale: 16
)
```

It refuses a selection whose scaled origin lands inside a copied brush (vbsp rejects a
`sky_camera` in solid volume), a room that would overlap the playable map, a room outside
the ±16384 world bounds, and a map that already has a camera. It warns when `skyname` is
missing.

The older path is still available when the copy needs to go somewhere specific:
`clone_solids` is Hammer's copy/paste, and `transform_solids` scales the copy:

```
clone_solids(
  path: "my_map.vmf",
  within: { mins: [-512, -512, 0], maxs: [512, 512, 256] },
  count: 1,
  scale: { factor: [0.0625, 0.0625, 0.0625], pivot: [0, 0, 0] }
)

transform_solids(
  path: "my_map.vmf",
  solidIds: <the ids clone_solids returned>,
  move: [0, 0, 10000]
)
```

The scale is 1/16 around the map origin, then the whole copy moves to the skybox area. Do
not leave the copy in the playable map: it will z-fight with the original. The copy keeps its
materials and texture alignment, which is why it is a byte copy rather than a rebuild.

Then compile. `clone_solids` refuses hidden and displaced brushes, and refuses `count` with
a transform because every copy would land on the same spot.

## What is still manual

Choosing which geometry is worth copying, and how the skybox should look. The builder
places the room and the camera; the selection is the design decision, and a copy that
surrounds the map origin cannot be used because the camera would sit inside it.

## Checking

- `read_vmf` shows exactly one `sky_camera` with the expected `scale`.
- The skybox area is a second sealed volume; vbsp compiles it without a leak
  (`test/tools/skyboxbuild.test.ts` runs that compile where a toolchain exists).
- Measured: a 128-unit tower at 1/16 in a 1,024 room produced a `sky_camera` at
  `1616 -6 184`, a 76x76x80 sealed room and a vbsp compile with no leak. The screenshot is
  deferred while the game launch is paused.
- In game, look at the horizon: a broken 3D skybox shows as a seam or a hole, not as missing
  geometry in the play area.
