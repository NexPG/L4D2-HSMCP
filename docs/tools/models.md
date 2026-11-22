# Models

28 tools: compiled MDL/VVD/VTX/PHY, decompiling and compiling, QC/SMD, collision, animation, LODs and effects.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Inspection and source

| Tool | What it does |
|---|---|
| `check_model` | Checks a `.qc` before studiomdl or a compiled `.mdl` through the model reader. |

## Decompile and compile

| Tool | What it does |
|---|---|
| `decompile_model` | Decompiles a compiled model into a QC, reference meshes and a collision SMD when a `.phy` is installed. |
| `run_studiomdl` | Compiles a QC into a Source model, preferring StudioMDL++ when it is installed and falling back to the game's own studiomdl.exe otherwise, then proves the result: `$modelname` is read from the QC, and the .mdl (plus the .vvd/.vtx/.phy files studiomdl wrote beside it) must exist. |

## QC and interchange

| Tool | What it does |
|---|---|
| `dmx_to_smd` | Converts a static .dmx model export to .smd: walks DmeMesh/DmeVertexData/DmeFaceSet, applies the DAG transform, honours flipVCoordinates, fan-triangulates polygons and writes the same SMD the writer uses. |
| `fbx_to_dmx` | Converts an FBX with shape keys into a DMX model source, the form L4D2's `studiomdl` turns into flexes. |
| `fbx_to_smd` | Converts FBX geometry, a skeleton and skin weights to the SMD studiomdl reads. |
| `gltf_to_dmx` | Converts glTF/GLB shape keys to a DMX model source with Source flexes. |
| `gltf_to_smd` | Converts glTF 2.0 (.gltf) or GLB geometry and skeleton to the SMD studiomdl reads, without Blender or a separate compiler. |
| `read_fbx` | Reads a binary 7.x or ASCII FBX without converting it: the format and version, `UpAxis` and `UnitScaleFactor` from GlobalSettings, every Model with its type and whether it carries geometry, geometries with vertex/polygon/triangle counts and whether normals, UVs and skinning are present, materials, bones, skins, clus... |
| `read_gltf` | Reads a glTF 2.0 (.gltf) or binary (.glb) file without converting it: scenes and the active root nodes, every node's parent/mesh/skin, mesh primitives with their mode, material, attribute accessors, vertex/index/triangle counts and bounds, materials with their base-colour texture chain, skins with the joint list and... |
| `read_qc` | Parses a .qc and every file it $includes: model name, sequences (with fps and activity), $cdmaterials, attachments, body parts, the include tree, variables and macros, and structural faults - a missing $modelname or $body, a repeated sequence, a model path outside models/. |
| `read_smd` | Parses an SMD model source: version, nodes (the skeleton), frame times and bone transforms, triangle and vertex counts, material groups, bounds, and per-vertex bone links. |
| `write_qc` | Writes a .qc from parameters: $modelname, $body entries, $cdmaterials, $surfaceprop, $staticprop, $sequence (with fps, activity and an optional block of events), and $attachment. |
| `write_smd` | Writes an SMD from JSON: nodes (skeleton), frames and triangles, then reads it back and reports what the parser saw. |

## Collision and physics

| Tool | What it does |
|---|---|
| `brush_to_model` | Converts one or more VMF brush solids into an SMD model source and, optionally, the QC. |
| `read_model_collision` | Reads a model's `.phy` collision and reports its solids, convex pieces, triangles, vertices, `prop_data` block, the ragdoll text section (per-solid name/parent/mass/massbias, joint constraints, editparams and collision rules) and whether the file still matches the model's checksum. |

## Skeleton and animation

| Tool | What it does |
|---|---|
| `read_model_ani` | Reads the external `.ani` a model's clips live in: the `IDAG` header and version, every anim block with its byte range and size, the clips and sequences that use each block, frame-by-bone/sectioned/delta counts and the duration, plus range, gap, overlap and orphan checks. |
| `read_model_animation` | Reads a compiled model's animation structure: every sequence with its activity, flags, fps, frame count, blend width and pose range, the `mstudioevent_t` events (name or numeric id, frame and options), the pose parameters, the IK chains, and the `$includemodel` entries that let a survivor reuse another model's seque... |
| `read_model_skeleton` | Reads a model's skeleton and writes the bind pose as ready-to-paste `$definebone` lines. |

## Flexes and VTA

| Tool | What it does |
|---|---|
| `read_model_flexes` | Reads a compiled model's flexes: descriptor names, controllers with their ranges, rules (as QC-style expressions when the postfix ops are understood), and every body-part model's per-vertex position and normal deltas. |
| `read_vta` | Reads a VTA (vertex animation) file: skeleton nodes, the basis frame's vertex count, and one entry per flex with its frame number, name and moved-vertex count. |
| `write_vta` | Writes a VTA from JSON: optional skeleton nodes, the basis shape (every fixed LOD-0 vertex) and one frame per flex. |

## Eyes, jigglebones and procedural bones

| Tool | What it does |
|---|---|
| `read_model_eyes` | Reads a compiled model's eyeball and mouth records: bone, model-space and bone-local origin, radius, z-offset, iris scale, the upper/lower lid flexes and their target angles, and the eye material (with the stored index and the `_l`/`_r` guess). |
| `read_model_jiggle` | Reads a compiled model's jigglebones: each bone with `proctype 5`, its flags, length, tip mass, stiffness/damping, angle and pitch/yaw constraints, base spring and boing parameters, plus the exact `$jigglebone` block. |
| `read_model_procedural` | Reads a compiled model's procedural bones: quat-interp helpers (proctype 2) with their control bone and triggers, and aim rules (proctype 3/4) with parent, aim bone or attachment, aim/up vectors and base position. |

## LODs and bodygroups

| Tool | What it does |
|---|---|
| `read_model_bodygroups` | Reads a compiled model's body parts and `$bodygrouppreset` table. |
| `read_model_lods` | Reads a compiled model's LOD chain: one entry per VTX LOD with its switch distance (negative is a shadow LOD), mesh/vertex/triangle counts, and each mesh's material at that LOD (a VTX override wins over the base material). |

## Preview

| Tool | What it does |
|---|---|
| `preview_model` | Returns a real image of a compiled model. |
