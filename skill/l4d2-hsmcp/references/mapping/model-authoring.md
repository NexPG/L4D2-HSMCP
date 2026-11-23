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
  `$hboxset`/`$hbox` sets, `$poseparameter` sliders, `$bbox`/`$cbox`/`$illumposition`/
  `$eyeposition`; a decompiled single-hull model carries its `.phy` `$collisiontext`.
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
3. `run_studiomdl` - compiles with StudioMDL++/studiomdl, then proves the `.mdl`, `.vvd` and `.dx90.vtx` exist. `compiler: "studiomdl"` forces the stock binary if the ++ build crashes.
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
and each vertex's bone weights, and derives the collision from the `.phy`: a jointed file
becomes `$collisionjoints` with every solid, its parent, mass, massbias, damping and
`$jointconstrain` limits (so a ragdoll stays a ragdoll), and a single hull becomes
`$collisionmodel`/`$concave`. A single hull's compiler frame follows the first sequence's
root; the pitched-root case is reproduced exactly, and other root poses are reported instead
of being written rotated. The QC also carries what only the compiled model knows:
`$includemodel` entries, `$contents`, `$bbox`/`$cbox`, `$keyvalues` (so `prop_data` and fire
interactions survive), `$ikchain`/`$ikautoplaylock` for the limb chains, and, on request, a
`$definebone` line per bone in the verified `(y, z, x)` order. Sequences whose data lives in
the `.mdl` are decoded frame by frame (raw vectors and quaternions, or the RLE streams) and
written as SMD `time <frame>` blocks with a `$sequence` line at the source fps; the SMD
`time` is a frame number, not seconds. Fade times and `event` lines are written with the
sequence, and a one-SMD clip with an event becomes a `$sequence` block because the one-line
form cannot carry one.

Every body part's alternatives are written as separate SMDs and a `$bodygroup` block, with
`blank` for an empty value, so a model with several bodygroup values keeps them. Every VTX LOD
becomes its own SMD and a `$lod`/`replacemodel` line at the source switch distance; shadow
LODs use a `$shadowlod` block. Attachments and custom hitbox sets are written as `$attachment` and
`$hboxset`/`$hbox` lines; a hitbox set that studiomdl auto-generated is left out so the next
compile can rebuild it from the mesh. Models with more than one skin family get a
`$texturegroup "skinfamilies"` block built from the MDL's skin table. External `.ani` clips
are decoded, including the frame-by-bone layout; multi-blend sequences become `$sequence`
blocks with one SMD per animation, `blendwidth` and `blend` pose ranges. External clips live in a sibling `.ani`; `read_model_ani` shows its `IDAG` header, block ranges, the clips and sequences each block holds, and range/gap/orphan checks, while `decompile_model` decodes the frames. LOD options are reconstructed from the compiled data: `replacebone` from the per-LOD bone
flags, `replacematerial` from the VTX replacement lists, `facial`/`nofacial` from the strip
group flags, and `removemodel` when a bodygroup model has no geometry at that distance.
`read_model_lods` shows the same options before a decompile. Procedural bones (quat-interp helpers and aim rules) are written to a `_procedural.vrd`
next to the QC and referenced with `$proceduralbones`; `read_model_procedural` shows them.
Jigglebones survive as `$jigglebone` blocks, including the flexible/boing variants and
all constraints (`read_model_jiggle` inspects them). Eyes and mouths are readable (`read_model_eyes`) but not writable: L4D2's studiomdl has no
`$eyeball`/`$eyelid`/`$mouth` command, so a decompile warns that a recompile loses them.
Flex deltas are
written as a `.vta` next to the reference SMD, referenced from a `$model { flexfile ... }`
block: the basis frame lists every fixed LOD-0 vertex, each frame holds the deformed
position/normal, and the QC carries the original `flexcontroller` lines and the rules
rebuilt from the MDL's postfix ops. The delta fields are float16 in the `.mdl`, not
`short / 4096`. `read_vta`/`write_vta` inspect or hand-author the same file and verify a
write by reading it back. A one-frame `$sequence "idle"` is written only when no real sequence can be
decoded. Bodygroup presets are the remaining gap; the tool lists it in `warnings` rather
than pretending the QC is complete. The default target is `<name>_decompiled.mdl`, so a
direct recompile cannot overwrite the source.

**IK rules and autolayers are read but not written.** They are not a rare corner: measured
on stock L4D2, `anim_gambler.mdl` has 532 of 814 sequences carrying IK rules, the common
infected 380 of 407, the hunter 51 of 89, and gambler has 310 sequences with autolayers.
Neither this decompiler nor the reference one (Crowbar's v49 writer lists `ikrule` and
`walkframe` as not done) reconstructs the QC line from the compiled records, so
`decompile_model` writes a warning with the counts instead of inventing lines. `read_model_animation`
shows `ikrules`, `autolayers` and `weightlist` per sequence, so the loss is visible before a
compile, not after it. For an aim-matrix-heavy character, treat the decompiled QC as a
starting point, not a faithful source.

**Sequence options are written from the flags, with one deliberate exception.** `snap`,
`hidden`, `autoplay`, `realtime` and `posecycle` come from the compiled sequence flags and go
into the `$sequence` block. Verified by a real compile of `gascan001a`: `pullpin`/`throw`/
`melee` came back with `STUDIO_SNAP` (0x2) and `a_gasCan_vaims` with `STUDIO_HIDDEN` (0x400).
`delta` is **not** written: the decompiled SMDs are baked frames, while `delta` tells studiomdl
to read them as differences from the reference pose. That model's `gasCan_idle` loses the
`delta` bit on a recompile, and the tool does not pretend otherwise. `addlayer`/`blendlayer`
are read as counts but not written yet.

## L4D2 specifics

- **Viewmodels** need `$attachment "primary"` / `"melee"`, the right `$weaponmodel`/hands
  setup, and the `CharacterViewmodelAddon` block in the weapon script.

### A viewmodel skeleton without copying numbers

A viewmodel is compiled against the player skeleton, so its QC needs `$definebone` lines for
every bone it references. Do not paste numbers from a tutorial:

1. `read_model_skeleton` on a stock viewmodel (`models/v_models/v_rifle.mdl`) returns the
   `$definebone` set generated from the bind pose (the QC order is `(y, z, x)` degrees).
2. Put `$UnlockDefineBones` before that set in the QC; the compiler then accepts its own
   skeleton position instead of refusing a mismatch.
3. Keep `$attachment "primary"`/`"melee"` and the `$weaponmodel` naming the weapon script
   expects; the add-on's `CharacterViewmodelAddon` block points at the model.

`read_qc` checks the result: a `$definebone` parent declared later, a cycle, or a sequence
`activity` weight of zero is reported before a compile rather than by studiomdl.
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
| Compile a QC | `run_studiomdl` (StudioMDL++ first, stock studiomdl otherwise; `compiler` can force either; reads `$modelname`, proves the `.mdl` and companions exist, reports `compiler`) |
| Read hull, skins, sequences, materials, `.phy` | `read_model_info` |
| Read `.phy` solids, convex pieces, `$concave` need and `prop_data` | `read_model_collision` |
| Read a model's flex descriptors, rules and vertex deltas | `read_model_flexes` |
| Decompile a compiled model | `decompile_model` - QC + reference SMDs + animation SMDs + collision SMD; attachments, custom hitboxes, skin families, bodygroup alternatives, LOD replacements, flex VTA; bodygroup presets are reported |
| Open in HLMV | `run_hlmv`; prefers HLMV++, probes it, falls back to stock HLMV on a crash, creates the model's loose folder tree first (HLMV cannot open a VPK model without it), captures and closes by default, `close:false` leaves it for a person |
| Clear leftover editor/model/game windows | `close_windows` (dry-run first; Hammer needs `force` to discard unsaved work) |
| Make a texture from a PNG | `write_vtf` (native, 7.4, full mip chain, DXT1/DXT5); `frames` for an animated sheet; `run_vtf_convert` for TGA/DDS through VTFCmd |
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
