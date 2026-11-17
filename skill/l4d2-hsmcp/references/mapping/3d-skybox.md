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
write_sky_camera(path: "my_map.vmf", origin: [0, 0, 10000], scale: 16)
```

The tool refuses a second camera and warns when `skyname` is missing.

## Making the copy

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

Then seal the skybox area with `write_vmf_solid` and compile. `clone_solids` refuses hidden
and displaced brushes, and refuses `count` with a transform because every copy would land on
the same spot.

## What is still manual

Choosing which geometry is worth copying, laying out the skybox area, sealing it, and
matching the camera to what the player sees. Those are design decisions, not file edits.
The remaining layout gap is named in `hammer-coverage.md`.

## Checking

- `read_vmf` shows exactly one `sky_camera` with the expected `scale`.
- The skybox area must be sealed; `read_vmf_leak` reports the whole map, so check a copy with
  the playable part cordoned off if it leaks.
- In game, look at the horizon: a broken 3D skybox shows as a seam or a hole, not as missing
  geometry in the play area.
