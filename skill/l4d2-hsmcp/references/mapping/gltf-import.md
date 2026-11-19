# glTF and GLB → SMD

`studiomdl.exe` has no glTF loader. Its extension probe chain is
`fbx xml obj vta phys sma smd mpp dmx vrm`: a `.glb` from Blender is not a model source the
game can compile. `gltf_to_smd` is the bridge, and `read_gltf` is the map of the file before
you convert it.

## The two commands

| Job | Tool |
|---|---|
| Inspect a `.gltf`/`.glb` | `read_gltf` |
| Convert geometry and a skeleton | `gltf_to_smd` |
| Write the QC in the same call | `gltf_to_smd` with the `qc` block |
| Compile | `run_studiomdl` on the QC |

A minimal prop path from a Blender `.glb`:

1. `read_gltf` — check the mesh count, materials, skins and that every buffer loaded.
2. `gltf_to_smd` with `output: "crate.smd"` and, for a static prop, a `qc` block:
   `{ path: "crate.qc", modelname: "props_myaddon/crate.mdl", staticprop: true,
   cdmaterials: ["models/props_myaddon"] }`. `$modelname` is relative to the game's
   `models/` directory; a leading `models/` is stripped by the writer because studiomdl
   already adds it.
3. `run_studiomdl` on `crate.qc`.
4. `write_vmt` and `write_vtf` for each material, then `preview_asset`.
5. `read_model_info` — bounds and `hasPhysics`. Without a `$collisionmodel`, a
   `prop_static` is non-solid.

## The conventions that make it a Source model

These are the decisions that are easy to get wrong and produce a model that compiles but is
rotated, mirrored or textured inside-out.

### Geometry stays in mesh space by default

Blender's default `+Y up` export puts the axis change on the scene root and leaves the mesh
`POSITION` accessor in Z-up model space. That is already what Source wants, so the default is
`axis: "z"` and node transforms are **not** applied. A hand-authored Y-up scene needs
`axis: "y"`, which rotates `(x, y, z) -> (x, -z, y)`.

A scene with several objects at different node transforms needs
`useNodeTransforms: true`; pair it with `axis: "y"` when the file really is Y-up. The result
reports `ignoredNodeTransforms` when it skipped a non-identity transform, so the choice is
visible rather than silent.

### The bind pose comes from `inverseBindMatrices`

A Blender file exported with **Use Rest Position Armature** turned off has node TRS in the
current pose while the IBMs stay in rest. Taking TRS would put the mesh and the skeleton in
different spaces. The importer inverts each IBM to get the bind world, then writes the SMD
skeleton as local bone transforms. A file with no IBM falls back to node TRS, which is what
the spec says an absent IBM means.

### SMD V is inverted

glTF stores the final engine-space V. `studiomdl` inverts V while parsing SMD
(`v1support.cpp`: `// invert v`), so the converter writes `1 - v`. The compiled model then
keeps the glTF UV. `flipV: false` exists only for a source that already compensated.

### Weights

`JOINTS_0` indexes `skin.joints`, not the node array; the converter maps through the joint
list to SMD bone numbers. A weight set that does not sum to 1 is written as-is and reported,
because studiomdl accepts it and the vertex then behaves unlike either bone.

## What is not exported

- **Morph targets.** SMD has no per-vertex morph target. `read_gltf` counts them and
  `gltf_to_smd` reports how many were ignored; each expression needs its own SMD/DMX, or a
- **Animations.** This path writes one bind-pose frame. Each animation needs its own SMD
  source. `read_gltf` lists the animations and their duration so the work is planned, not
  discovered later.
- **Compressed geometry.** `KHR_draco_mesh_compression` and `EXT_meshopt_compression` are
  required extensions the importer does not decode. It refuses with a message that says to
  export without compression; `read_gltf` still describes the rest of the file.

## What is supported

- `.gltf` with external `.bin` buffers, `data:` URIs, and `.glb` with a BIN chunk.
- Accessors with interleaved `byteStride`, normalized integer components and sparse
  overrides; a missing `bufferView` is all zeros, as the spec says (Blender writes this for
  a normal offset that does not move).
- Triangle lists, strips (odd triangles flipped to keep winding) and fans.
- Node TRS or a 4x4 matrix, a hierarchy whose parent is not guaranteed to come first, skins
  with `inverseBindMatrices`, and multiple mesh instances.

The fixtures in `test/models/gltf.test.ts` build all of these byte by byte, including the
GLB container and a sparse accessor. The axis and bind-pose conventions were cross-checked

## Pitfalls

- **A material is not a texture.** The QC gets the material *name*; the `.vmt` and `.vtf`
  are separate files. `read_gltf` shows the base-colour texture chain so you know what to
  export.
- **No `.phy`, no solid prop.** The converter does not build a collision model. Add a
  `$collisionmodel` SMD or place a clip brush.
- **Node transforms ignored by default.** If two objects in the file sit at the same place
  after conversion, that is the warning, not a bug: pass `useNodeTransforms: true`.
- **Scale is uniform.** `scale` multiplies positions and bone translations. A per-node
  non-uniform bone scale cannot be represented in SMD; the converter reports it.
- **A `$staticprop` model is rotated in the compiled file.** `studiomdl` applies its
  default `Rz(90°)` to the geometry in `MakeStaticProp`, so a compiled static prop's VVD
  and hull read as `(x, y, z) -> (-y, x, z)` relative to the SMD. That is official
  behavior, not the converter: a static prop placed in Hammer is correct. A non-static
  model keeps its VVD vertices as written, while its hull is still rotated because the
  pose bbox uses the same default rotation. Do not "fix" the SMD by pre-rotating it.
