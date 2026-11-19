# glTF and GLB → SMD

`studiomdl.exe` has no glTF loader. Its extension probe chain is
`fbx xml obj vta phys sma smd mpp dmx vrm`: a `.glb` from Blender is not a model source the
game can compile. `gltf_to_smd` is the bridge, and `read_gltf` is the map of the file before
you convert it.

## The two commands

| Job | Tool |
|---|---|
| Inspect a `.gltf`/`.glb` | `read_gltf` |
| Convert geometry, skeleton and animations | `gltf_to_smd` |
| Make a solid prop | `gltf_to_smd` with `collision: "box"` |
| Write the QC in the same call | `gltf_to_smd` with the `qc` block |
| Compile | `run_studiomdl` on the QC |

A minimal prop path from a Blender `.glb`:

1. `read_gltf` — check the mesh count, materials, skins and that every buffer loaded.
2. `gltf_to_smd` with `output: "crate.smd"`, `collision: "box"` for a solid prop, and a
   `qc` block: `{ path: "crate.qc", modelname: "props_myaddon/crate.mdl",
   staticprop: true, cdmaterials: ["models/props_myaddon"] }`. `$modelname` is relative to
   the game's `models/` directory; a leading `models/` is stripped by the writer because
   studiomdl already adds it. The QC gets the `$collisionmodel` and its `$mass` for you.
3. `run_studiomdl` on `crate.qc`.
4. `write_vmt` and `write_vtf` for each material, then `preview_asset`.
5. `read_model_info` — bounds and `hasPhysics`. With `collision: "box"` the `.phy` exists
   and `hasPhysics` is true; without it, a `prop_static` is non-solid.

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

## Animations

`gltf_to_smd` samples every animation at `animationFps` (default 30) and writes
`<name>_<animation>.smd` beside the bind SMD. The animation file has the **same node table**
as the bind file, which is why animation-driven nodes are added to the bind skeleton even
when `exportAnimations: false`. SMD frame times are integers; `fps` in the QC turns them into
seconds.

- `STEP` and `LINEAR` are exact; rotations use slerp.
- `CUBICSPLINE` is resampled from the middle value of each key, linearly, and the animation's
  `warnings` say so.
- A channel that targets a node with a `matrix` is ignored (glTF forbids animating those).
- `animations: ["idle"]` filters by name; an empty list means every animation.
- The QC block adds a `$sequence` per animation when `animationSequences` is true (the
  default). `animationArgs: ["loop"]` appends arguments to each one.

The animation SMD has an empty `triangles` section and many `time` blocks; that is legal and
is what `studiomdl` reads for `$sequence`.

## Collision

`collision: "box"` writes `<name>_phys.smd`, a closed box around the model, and the QC block
adds:

```
$collisionmodel "crate_phys.smd"
{
    $mass 10
}
```

- `mass` defaults to 10; `collisionThickness` (default 1) is the minimum size on a flat
  axis, so a sign still gets a solid slab instead of a zero-volume hull.
- The physics SMD uses the material name `phys`, not `debug/debugempty`: with the debug
  fallback `studiomdl` reports a collision volume and then writes a **0-byte** `.phy`.
- The box is in SMD model space. `$staticprop` still applies studiomdl's own `Rz(90°)` to
  the compiled geometry; the engine expects that, so do not pre-rotate the SMD.
- The compiled hull is the mesh AABB unioned with the physics AABB plus its margin, so
  `read_model_info` bounds are slightly larger than the mesh alone.

## What is not exported

- **Morph targets.** SMD has no per-vertex morph target. `read_gltf` returns
  `mesh.extras.targetNames` and `gltf_to_smd` lists the ignored names; each expression needs
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
- Animations with translation, rotation and scale channels; collision as a box.

The fixtures in `test/models/gltf.test.ts` build all of these byte by byte, including the
GLB container, a sparse accessor, an animation and a collision box. Static and animated
models are compiled with the real `studiomdl.exe`; the static one is checked for a `.phy`
and `hasPhysics`, the animated one for both sequences. The axis and bind-pose conventions

## Pitfalls

- **A material is not a texture.** The QC gets the material *name*; the `.vmt` and `.vtf`
  are separate files. `read_gltf` shows the base-colour texture chain so you know what to
  export.
- **No `.phy`, no solid prop.** Pass `collision: "box"` to generate the `$collisionmodel`
  SMD, or supply your own. A `prop_static` from a model without `.phy` is not solid.
- **Animations need the same bone table.** Use one `gltf_to_smd` call for the bind pose and
  all animations; do not convert the bind and the animation separately, or the bone numbers
  can differ.
- **A static prop collapses animation.** `$staticprop` makes studiomdl throw away all but
  one frame; do not mark an animated character or prop `$staticprop`.
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
