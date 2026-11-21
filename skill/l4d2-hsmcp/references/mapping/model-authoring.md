# Model authoring for L4D2

The toolkit compiles a model with **StudioMDL++** when Tools++ is installed (stock
`studiomdl.exe` otherwise; the result says which compiler ran) and inspects it with
`read_model_info`, `run_hlmv`, `preview_asset` and `preview_model` (the engine fallback when
HLMV's 3D canvas is blank). `run_hlmv` prefers HLMV++ and falls back to stock HLMV when the
latest viewer crashes on the machine; `viewer` and `fallbackReason` say what happened. It
also reads and writes the source
formats itself: an SMD or DMX can be inspected, and a simple mesh can be built from JSON
without a DCC. Complex sculpting, UV painting and animation still belong in Blender.

## The source set

A Source 1 model is a `.qc` plus `.smd`/`.dmx` meshes and animations. The QC names the
output and pulls the parts together:

```
$modelname "props_misc/myprop.mdl"
$body "Body" "myprop.smd"
$cdmaterials "models/props_misc/"
$surfaceprop "metal"
$sequence "idle" "myprop_idle.smd" fps 30 loop
$collisionmodel "myprop_phys.smd" { $mass 10 $concave }
```

- `$modelname` is the in-game path, without `models/`.
- `$cdmaterials` is the VMT directory, with a trailing slash.
- `$surfaceprop` decides the impact sound and physics surface.
- `$sequence` names an animation; `fps`, `loop`, `activity` and `events` are common.
- `$collisionmodel` is the physics hull. A `prop_static` needs the `.phy` that comes from
  it; without one the prop is non-solid in game.
- `$staticprop` is for a static prop; `$mostlyopaque` for cutout transparency.
- `write_qc` also writes `$bodygroup` alternatives, `$lod`/`$shadowlod` replacement blocks,
  `$hboxset`/`$hbox` sets, and `$bbox`/`$cbox`/`$illumposition`/`$eyeposition`.
  `check_model` reads a QC or a compiled MDL and reports the geometry, bodygroups, LODs,
  hitbox sets, sequences and missing materials before the compiler is trusted.

## A simple prop without a DCC

This is the whole path for a box-shaped prop. The numbers are the model's own space, in
Source units (a player is 72 tall).

1. `write_smd` — nodes (one root bone is enough for a static prop), one frame, and the
   triangles. Each triangle is exactly three vertices with position, normal, UV and a bone
   link; the tool refuses anything else and reads the file back.
2. `write_qc` — `$modelname`, `$body` pointing at that SMD, `$cdmaterials`, `$surfaceprop`,
   and `$staticprop: true`.
3. `run_studiomdl` - compiles with StudioMDL++/studiomdl, then proves the `.mdl`, `.vvd` and `.dx90.vtx` exist.
4. `write_vmt` + `write_vtf` — the material and its texture; both are native.
5. `read_model_info` — bounds to place it, `hasPhysics` to know whether it is solid.

**Physics is the trap.** `studiomdl` only writes a `.phy` from `$collisionmodel`, and this
path does not build one. A `prop_static` without a `.phy` is non-solid: either add a
`$collisionmodel` SMD in a DCC, or place a clip brush under the prop. The toolkit reports
the absence instead of hiding it.

A `.phy` can also exist and still be the wrong shape. `read_model_collision` reads its solids,
convex pieces, triangles and `prop_data` block, and checks the `.phy` checksum against the
`.mdl`. If any solid has more than one convex piece, the QC needs `$concave`; without it
studiomdl keeps one piece and the rest is walk-through. A shelf is one piece; a car or a bed
is many, and their `editparams` block says `"concave" "1"`.

## Reading what a DCC exported

- `read_smd` — bones, frame times, materials, triangle count, bounds, per-vertex weights;
  diagnostics name the faults a failed compile would otherwise only hint at.
- `read_dmx` — the datamodel as a JSON tree. Element references stay references: a model
  graph is cyclic, and expanding it fully never terminates. Raise `maxDepth` for one level.
- `write_dmx` — the reverse, for a generated datamodel. `encoding: "kv2"` is diffable text;
  binary v4 / format 15 is what L4D2-era tools expect.
- `dmx_to_smd` — a mesh export into SMD: DAG transform, UVs, materials, polygons, **and the
  skeleton**: node hierarchy, local bone rotations and per-vertex weights. Verified against
  BlenderSourceTools' own cube export. A datamodel without a joint list falls back to one
  root bone and says so.
- `read_gltf` / `gltf_to_smd` — the same bridge for a `.gltf`/`.glb`, which `studiomdl`
  cannot read at all. Geometry stays in mesh space by default (what Blender's `+Y up` export
  writes), the bind pose comes from `inverseBindMatrices`, and the SMD V is inverted so
  studiomdl's parse-time inversion leaves the glTF UV intact. `axis`, `useNodeTransforms`,
  `parts` and an optional `qc` block cover the rest. Each animation is sampled into its own
  SMD and sequence; `collision: "box"` writes a `$collisionmodel` so the compiled prop has a
  `.phy`. See [glTF and GLB → SMD](gltf-import.md) for the conventions and the limits.
- `read_fbx` / `fbx_to_smd` — an FBX (binary 7.x or ASCII) read natively, with the bind pose
  taken from the skin clusters' `TransformLink`, the axis from `UpAxis`, and V flipped for
  SMD. Units are a flag, not a guess: centimetres need `scale: 0.3937` unless the DCC wrote
  Source-sized numbers. Every animation stack is resampled into its own SMD with a
  `$sequence` in the QC, and `collision: "box"`/`"hull"` writes a `_phys.smd`; shape keys go
  through `fbx_to_dmx` as DMX flexes. See
  [FBX -> SMD](fbx-import.md).
- `gltf_to_dmx` — shape keys become a DMX model source with Source flexes. The compiler
  reads the `DmeVertexDeltaData` and `DmeCombinationOperator` without a `$flex` command, and
  `read_model_info` reports `flexdescCount`/`flexcontrollerCount`/`flexruleCount`. Use it
  when the glTF has morph targets; `gltf_to_smd` is the path for geometry and animations.
- `brush_to_model` — a VMF brush becomes an SMD/QC without a DCC. The brush's own planes are
  the geometry, `uaxis`/`vaxis` become UVs (divided by `textureSize`), the origin can move to
  the centre/base, and the collision model defaults to the brush itself. This is the
  Propper++ path: see [Brush → model](brush-to-model.md).

## Decompiling a compiled model

`decompile_model` is the reverse direction: a compiled `.mdl` becomes a QC, a reference SMD,
one animation SMD per decodable sequence, and, when a `.phy` is installed, a collision SMD.
It applies the VVD fixup order and the static-prop axis swap, writes the bind-pose skeleton
and each vertex's bone weights, and derives `$collisionmodel`/`$concave` from the collision
file. Sequences whose data lives in the `.mdl` are decoded frame by frame (raw vectors and
quaternions, or the RLE streams) and written as SMD `time <frame>` blocks with a `$sequence`
line at the source fps; the SMD `time` is a frame number, not seconds.

This version extracts LOD 0 and model 0 of each body part only. Attachments and custom
hitbox sets are written as `$attachment` and `$hboxset`/`$hbox` lines; a hitbox set that
studiomdl auto-generated is left out so the next compile can rebuild it from the mesh. Models
with more than one skin family get a `$texturegroup "skinfamilies"` block built from the
MDL's skin table. Sequences whose data is in an external `.ani`, use the sectioned
fast-lookup layout, or blend several animations are skipped and listed with the reason;
flexes and bodygroup alternatives are **not** extracted. A one-frame `$sequence "idle"` is
written only when no real sequence can be decoded. The tool lists those gaps in `warnings`
rather than pretending the QC is complete. The default target is `<name>_decompiled.mdl`, so
a direct recompile cannot overwrite the source.

## L4D2 specifics

- **Viewmodels** need `$attachment "primary"` / `"melee"`, the right `$weaponmodel`/hands
  setup, and the `CharacterViewmodelAddon` block in the weapon script.
- **Player models** use `declaresequence` files and `includemodels`; a proportion/anim-swap
  setup is a set of QCI includes, not one QC.
- **Attachments** are positioned with `.smd`/`.dmx` helper meshes and `$attachment`; the
  weapon attachment helper is a separate mesh.
- **Physics** is `$collisionmodel`; a model with no `.phy` cannot be a solid `prop_static`.

## The commands

| Job | Tool |
|---|---|
| Read an SMD (bones, frames, materials, faults) | `read_smd` |
| Build an SMD from JSON | `write_smd` |
| Read a DMX datamodel | `read_dmx` |
| Build a DMX from JSON | `write_dmx` |
| Inspect a glTF/GLB | `read_gltf` |
| Convert glTF/GLB geometry, skeleton and animations | `gltf_to_smd` |
| Convert glTF/GLB shape keys to Source flexes | `gltf_to_dmx` |
| Generate a `$collisionmodel` box for a solid prop | `gltf_to_smd` with `collision: "box"` |
| Inspect an FBX (binary 7.x or ASCII) | `read_fbx` |
| Convert FBX geometry, skeleton, weights and animations | `fbx_to_smd` (optionally with a `qc` block) |
| Turn a VMF brush into a model | `brush_to_model` (Propper++ path) |
| Write a QC | `write_qc`; `read_qc` parses includes and faults |
| Compile a QC | `run_studiomdl` (StudioMDL++ first, stock studiomdl otherwise; reads `$modelname`, proves the `.mdl` and companions exist, reports `compiler`) |
| Read hull, skins, sequences, materials, `.phy` | `read_model_info` |
| Read `.phy` solids, convex pieces, `$concave` need and `prop_data` | `read_model_collision` |
| Decompile a compiled model | `decompile_model` - QC + reference SMD + animation SMDs + collision SMD; attachments, custom hitboxes, skin families, LOD 0/model 0 only, with the gaps in `warnings` |
| Open in HLMV | `run_hlmv`; prefers HLMV++, probes it, falls back to stock HLMV on a crash, creates the model's loose folder tree first (HLMV cannot open a VPK model without it), captures and closes by default, `close:false` leaves it for a person |
| Clear leftover editor/model/game windows | `close_windows` (dry-run first; Hammer needs `force` to discard unsaved work) |
| Make a texture from a PNG | `write_vtf` (native, 7.4, full mip chain, DXT1/DXT5); `run_vtf_convert` for TGA/DDS through VTFCmd |
| Reformat or resize a shipped VTF | `convert_vtf` — decode, resize, re-encode, verify |
| Look at a texture directly | `extract_vtf` — any VTF to a PNG, no VMT needed; `face` selects a cubemap side |
| Build a cubemap | `write_cubemap_vtf` — six named PNG faces, verified one by one |
| Look at a material | `preview_asset` (VTF → PNG) |
| Look at a model | `run_hlmv` (HLMV++ first, stock fallback), or `preview_model` when the canvas is blank |
| Find a stock model or material | `read_game_content`, `read_asset_catalog` |
| Place the model | `edit_vmf` (`prop_static` / `prop_dynamic`) |

`run_studiomdl` is a compiler driver, not a modeller: it does not sculpt, paint UVs or
animate. Those come from the DCC. What the toolkit can do is create or inspect the source
files and prove the compiled result.

## Checking a model before it ships

1. `read_smd` / `read_dmx` — the source is structurally valid before a compiler sees it.
2. `read_qc` — `$modelname`, `$body`, materials and attachments resolve.
3. `run_studiomdl` — the `.mdl` and its `.vvd`/`.dx90.vtx`/`.phy` companions exist.
4. `read_model_info` — `found`, bounds, skins, sequences, materials, `hasPhysics`.
5. `preview_asset` on each material — a missing VTF is a purple checkerboard in game.
6. Look at it with `preview_model` — it measures the HLMV capture and, when the canvas is a
   flat rectangle, compiles a sealed dev room and captures the engine's own view. HLMV's 3D
   canvas is not reliable on every desktop; `run_hlmv` and `close_windows` make sure no GUI
   is left behind.
7. `read_model_collision` after the compile - solids, convex pieces, `$concave` and the
   `.phy`/`.mdl` checksum; `read_static_props` then checks which baked props actually got it.
8. `read_static_props` after the compile - a model without `.phy` is non-solid unless a clip
   brush replaces it.
9. `decompile_model` when the source is lost - rebuild a QC, reference SMD and animation SMDs,
   then recompile; the result is a starting point, not a full recovery (see the warnings).

## Licensing

The community QC prefabs and player-model helper packs have **no licence file** in the
repositories reviewed here, so none of their files are copied into this project. A model or
texture taken from another project needs the same licence check as code; a mesh is a
copyrighted work too.
