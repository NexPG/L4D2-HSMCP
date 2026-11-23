# Brush → model (Propper++ without the plugin)

Hammer can build a shape faster than a DCC can, but a brush is map geometry, not a model.
`brush_to_model` takes one or more VMF solids and writes the SMD/QC `studiomdl` compiles.
This is the Propper++ workflow with the toolkit's own plane oracle and UV maths.

## The path

1. `read_vmf_solids` — find the Hammer solid id and check that it is valid.
2. `brush_to_model` — convert the solid(s):
   ```
   {
     vmf: "maps/my_map.vmf",
     solids: [42],
     output: "models/props_myaddon/crate.smd",
     origin: "center",
     textureSize: 512,
     collision: "brush",
     qc: {
       path: "models/props_myaddon/crate.qc",
       modelname: "props_myaddon/crate.mdl",
       surfaceprop: "wood"
     }
   }
   ```
3. `run_studiomdl` on the QC.
4. `read_model_info` — bounds, skins, `hasPhysics` and `staticProp`.
5. `write_vmt` / `write_vtf` if the brush's material is not already a stock one.

`origin: "center"` puts the model origin at the brush's bounding-box centre; `"base"` puts
it at the centre of the floor, which is convenient for a prop that stands on the ground;
`"world"` keeps the coordinates the brush had in the map.

## Geometry

The brush is already a closed convex volume. The tool does not clip anything itself:
`checkVmfSolids` rebuilds the hull from the planes and reports the corners on each face,
then `orderedLoop` winds each face and the face is fan-triangulated. A brush the oracle calls
valid therefore cannot change shape on the way to the model. A displacement is refused,
not flattened: its rendered surface is not the face plane.

Several solids may be converted at once; each is convex, and the collision model is marked
`$concave`. The rendering mesh is a normal SMD mesh and does not need that flag.

## UVs

The VMF stores `uaxis`/`vaxis` as a world-space axis, a texel offset and a scale; SMD stores
normalised UVs. The conversion is:

```
u = (dot(p, uaxis.xyz) / uaxis.scale + uaxis.offset) / textureWidth
v = (dot(p, vaxis.xyz) / vaxis.scale + vaxis.offset) / textureHeight
```

followed by `v = 1 - v` for SMD, which studiomdl inverts again while parsing. A VMF does
not store the texture size, so `textureSize` is an explicit input (512 by default) and
`textureSizes` overrides it per material. A 512 texture at scale `0.25` repeats every
128 units, which is the number to check if a wall looks stretched.

## Materials

A VMF material `BRICK/BRICKWALL003A` becomes:

- SMD material `brickwall003a`
- `$cdmaterials "brick/"`

The directories are derived from the face materials; `qc.cdmaterials` overrides them. If
two materials share a basename in different directories, the tool warns: the engine will
resolve the first directory in `$cdmaterials`.

The physics SMD uses the conventional material name `phys`, not `debug/debugempty`: the
debug fallback makes studiomdl print a collision volume and write a **0-byte** `.phy`.

## Collision

- `collision: "brush"` (default) uses the brush faces. One solid is convex; several are
  marked `$concave`.
- `collision: "box"` writes an AABB, with `$mass` from the QC block.
- `collision: "none"` omits `$collisionmodel`; the compiled prop has no `.phy` and a
  `prop_static` from it is not solid.

`$staticprop` is on by default, because a brush prop normally is one. Studiomdl then applies
its own `Rz(90°)` to the compiled geometry; the engine expects that, so do not pre-rotate
the brush. A compiled static prop's hull/VVD can look rotated in a model viewer and still
be correct in Hammer.

## Pitfalls

- **Origin.** The brush's world position is discarded unless `origin: "world"`. The prop is
  placed in Hammer, so the model's origin is what matters, not where the brush was.
- **Texture size.** If the UVs are wrong by a constant factor, `textureSize` is the likely
  cause; a VMF simply does not carry it.
- **Displacements.** Convert the brush before adding a displacement, or build the displaced
  surface as a mesh in a DCC.
- **Missing VMT.** The model compiles with a material name; a missing `.vmt`/`.vtf` is a
  purple checkerboard, not a compile error. `preview_asset` is the check.
- **No `.phy`.** Without a collision model a `prop_static` is not solid; `read_model_info`
  reports `hasPhysics`. `write_prop` `collision: "auto"` adds a clip hull from the bounds.
- **No `$staticprop`.** A model compiled without it is deleted by vbsp as a `prop_static`
  (`Error! ... Deleted.`, exit 0); `read_model_info.staticProp` reports the flag.

## Provenance

The plane convention and the oracle are this repository's own (`src/maps/typescript/vmf/
solid.ts`). The UV formula is Source's `texinfo` convention; the fixture compiles a box and
reads the SMD back, and the end-to-end test proves the `.phy` exists.
