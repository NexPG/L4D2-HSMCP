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

## Reusing an existing DCC export

- `read_dmx` shows what Blender/Crowbar wrote, without expanding the cyclic graph.
- `read_smd` shows the skeleton, frames, materials, triangles and weights.
- A `.glb`/`.gltf` is converted first: `read_gltf` describes it, `gltf_to_smd` writes the
  SMD and can write the QC in the same call. The default is Blender's export: mesh-space
  geometry, node transforms ignored, bind pose from `inverseBindMatrices`. Pass
  `axis: "y"` only for hand-written Y-up data, and `useNodeTransforms: true` for a
  multi-object scene. Each animation becomes its own SMD and sequence;
  `collision: "box"` adds a `$collisionmodel` so the compiled prop is solid. Morph targets
  are reported by name, not exported. See
  [glTF and GLB → SMD](../references/mapping/gltf-import.md).
- FBX is still not read: `studiomdl` does not read it either. Export SMD/DMX, or install
