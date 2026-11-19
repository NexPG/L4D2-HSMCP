# Make a prop without a DCC

For a box, a sign, a simple machine or any shape that is a handful of quads. For sculpted
geometry, skinning or animation, use Blender and come back at `read_smd`/`run_studiomdl`.

## 1. Decide the numbers before writing anything

Source units: a standing survivor is 72 tall, a doorway is 64×96, a crate is often 32–64.
`read_model_info` on a stock prop gives a real hull to copy. Write the model in its own
space with the origin where you want the pivot — usually the base centre for a floor prop.

## 2. Write the mesh

`write_smd` takes nodes (bones), frames and triangles. One root bone is enough for a static
prop; each triangle is exactly three vertices:

```
nodes:      [{ name: "root", parent: null }]
frames:     omitted (one identity frame is written)
triangles:  [{ material: "crate", vertices: [
  { position: [0,0,0],   normal: [0,0,1], uv: [0,0] },
  { position: [64,0,0],  normal: [0,0,1], uv: [1,0] },
  { position: [64,64,0], normal: [0,0,1], uv: [1,1] },
]}]
```

The tool reads the file back and returns `diagnostics`. A weight that does not sum to 1 or
a bone no node declares is reported; fix it before compiling.

## 3. Write the QC

```
$modelname "props_myaddon/crate.mdl"
$body "Body" "crate.smd"
$cdmaterials "models/props_myaddon/"
$surfaceprop "wood"
$staticprop
```

`write_qc` builds this; `read_qc` checks the includes and the structural rules. The
`$modelname` path is where `studiomdl` writes the model, without `models/`.

## 4. Compile

`run_studiomdl` on the QC. It reads `$modelname`, runs the game's compiler and proves the
`.mdl`, `.vvd` and `.dx90.vtx` exist. A material without a `.vmt` compiles and renders as a
purple checkerboard; that is a material problem, not a compile problem.

## 5. Material and texture

1. `write_vmt` with `VertexLitGeneric` (or `UnlitGeneric` for a sign) and `$basetexture`.
2. `write_vtf` from a PNG. It writes 7.4, builds the mip chain and verifies the pixels.
   Non-power-of-two images are scaled (`resize`) or refused (`resize: "none"`).
3. `preview_asset` on the material to see the texture before placing it.

## 6. Physics: the one thing that does not come for free

`studiomdl` writes a `.phy` only from `$collisionmodel`, and this workflow does not build
one. A `prop_static` without a `.phy` is **not solid**. Either:

- add a `$collisionmodel` SMD (a simple box hull is enough), or
- place a clip brush under the prop and accept that bullets pass through the model.

`read_model_info` reports `hasPhysics`; check it before promising a solid prop.

## 7. Prove it in the map

1. `edit_vmf` with `prop_static`, `model` set to the compiled path, and `skin` 0.
2. `run_compile`, then `run_map_test` with a screenshot.
3. `read_static_props` after the compile — it lists the prop and whether its model has
   physics, which is the machine-checkable version of "it looks solid".

## Building a prop from a Hammer brush

If the shape is already in the map, do not remodel it:

1. `read_vmf_solids` — note the solid id.
2. `brush_to_model` — `solids: [id]`, `output`, and a `qc` block; the brush's own planes
   are the mesh and its `uaxis`/`vaxis` are the UVs.
3. `run_studiomdl` — the brush collision model gives the `.phy`.
4. `read_model_info` — bounds and `hasPhysics`.

`textureSize` is the texture width/height (512 by default); a VMF does not store it. The
full conventions are in [Brush → model](../references/mapping/brush-to-model.md).

## Reusing an existing DCC export

- `read_dmx` shows what Blender/Crowbar wrote, without expanding the cyclic graph.
- `read_smd` shows the skeleton, frames, materials, triangles and weights.
- A `.glb`/`.gltf` is converted first: `read_gltf` describes it, `gltf_to_smd` writes the
  SMD and can write the QC in the same call. The default is Blender's export: mesh-space
  geometry, node transforms ignored, bind pose from `inverseBindMatrices`. Pass
  `axis: "y"` only for hand-written Y-up data, and `useNodeTransforms: true` for a
  multi-object scene. Each animation becomes its own SMD and sequence;
  `collision: "box"` adds a `$collisionmodel` so the compiled prop is solid. A file with
  shape keys goes through `gltf_to_dmx` instead: L4D2's `studiomdl` turns the DMX shape keys
  into flexes without `$flex` in the QC. See
  [glTF and GLB → SMD](../references/mapping/gltf-import.md).
- An `.fbx` is converted directly: `read_fbx` reports the units, axis and meshes, and
  `fbx_to_smd` writes the SMD with the bind pose from the skin clusters. Pass `scale:
  0.3937` for a centimetre export unless the DCC already wrote Source-sized numbers.
  Animations and blend shapes are counted, not exported; use the glTF path for those.
  See [FBX -> SMD](../references/mapping/fbx-import.md).
