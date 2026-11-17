# 3D skybox

A 3D skybox is real geometry drawn at 1/16 scale around a `sky_camera`. It lets a map show
distant buildings, hills or a city skyline that the player can never reach.

## What it needs

1. A **2D sky**: `skyname` on worldspawn (`set_map_properties`). Without it the 3D skybox has
   nothing to draw against.
2. **One `sky_camera`**, placed at the point the skybox is centred on. `scale` is 16 by
   default: the camera stays at world scale, the geometry around it is 1/16 size.
3. A **sealed skybox area** built far from the playable map, containing the scaled geometry.
4. The skybox geometry uses sky materials; the playable map is untouched.

```
write_sky_camera(path: "my_map.vmf", origin: [0, 0, 0], scale: 16)
```

The tool refuses a second camera and warns when `skyname` is missing.

## What is still manual

Copying the playable geometry into the skybox and scaling it 1/16 is not a tool yet. The
existing `transform_solids` can scale brushes, but it does not clone them, so the workflow is:

- build the skybox copy with `write_vmf_solid` (or copy the source in Hammer),
- scale it around the camera origin,
- seal it,
- compile and look up.

The scaled-copy step is the remaining 3D-skybox gap in `hammer-coverage.md`.

## Checking

- `read_vmf` shows exactly one `sky_camera` with the expected `scale`.
- The skybox area must be sealed; `read_vmf_leak` reports the whole map, so check a copy with
  the playable part cordoned off if it leaks.
- In game, look at the horizon: a broken 3D skybox shows as a seam or a hole, not as missing
  geometry in the play area.
