# FBX -> SMD

An FBX from Blender, Maya or 3ds Max is not a model source `studiomdl` can read. `read_fbx`
describes the file and `fbx_to_smd` writes the SMD the game's own compiler already accepts.
Both binary 7.x and ASCII are read; no SDK, Blender or third-party importer is involved.

## Fast path

| Want | Tool |
|---|---|
| Inspect a `.fbx` | `read_fbx` |
| Convert geometry, skeleton and weights | `fbx_to_smd` |
| Convert shape keys to Source flexes | `fbx_to_dmx` |
| Export every animation stack as an SMD + `$sequence` | `fbx_to_smd` (default) with the `qc` block |
| Make a solid prop | `fbx_to_smd` with `collision: "box"` or `"hull"` |
| Write the QC in the same call | `fbx_to_smd` with the `qc` block |
| Compile | `run_studiomdl` |
| Look at the result | `preview_model` (engine fallback) or `preview_asset` (HLMV) |

```
read_fbx        path: "crate.fbx"
fbx_to_smd      path: "crate.fbx"
                output: "crate.smd"
                qc: { path: "crate.qc", modelname: "props/crate.mdl",
                      cdmaterials: ["models/props"], surfaceprop: "wood",
                      staticprop: true }
run_studiomdl   qc: "crate.qc"
read_model_info model: "models/props/crate.mdl"
```

Read first when the file came from someone else: `read_fbx` reports the axis, the unit
factor, every model with or without geometry, and whether normals, UVs and skinning exist.
A mesh with no `PolygonVertexIndex`, or an FBX whose `UnitScaleFactor` is 100, is cheaper to
see there than after a compile.

## Conventions this path chooses

- **Axis.** `axis: "auto"` follows `GlobalSettings.UpAxis`. FBX's default is Y-up and Source
  is Z-up, so the reader applies `(x, y, z) -> (x, -z, y)`. Override only when the exporter
  wrote the wrong global setting; the override is reported.
- **Units are not guessed.** FBX is commonly centimetres; Source units are inches. A 180 cm
  character is 3x too tall unless `scale: 0.3937` is passed. `UnitScaleFactor` is returned
  in the result and a factor other than 1 or 2.54 produces a warning. This is a flag, not a
  silent conversion: an export that already wrote Source-sized numbers must stay at
  `scale: 1`.
- **Bind pose from the clusters.** Each `Cluster`'s `TransformLink` is the bone's world
  matrix in the pose the mesh was skinned in. Node TRS is the rest pose and can differ, so
  the skeleton is built from `TransformLink`; a bone without a cluster falls back to the
  node hierarchy. A file with no skin at all becomes one bone named after the mesh.
- **UVs are flipped.** SMD's reader inverts V, so `1 - v` is written. `flipV: false` is for
  a source that already compensated.
- **Node transforms are applied.** `useNodeTransforms` defaults to `true` for FBX because
  objects are placed by their hierarchy; `false` reads raw mesh-space vertices.
- **Weights are normalised.** Cluster weights that do not sum to 1 are divided by their
  sum, and a vertex with no cluster is bound to one bone at weight 1 with a warning.
- **Polygons are fan-triangulated.** The last index of an FBX polygon is stored negative
  (`~index`); that sign bit is the polygon boundary, not a vertex.

## Animations

Every `AnimationStack` becomes its own SMD (`<name>_<animation>.smd`), with the bind SMD's
node table, sampled at `animationFps` (default 30). `$sequence` lines are added to the QC
when the `qc` block is used and `animationSequences` is not false; `animationArgs` appends
flags such as `loop`. `animations: ["Take 001"]` limits the export to named stacks;
`exportAnimations: false` writes the bind pose only.

What the path does with the curves:

- **The stack → layer → curve node → curve chain is followed.** A curve node targets a
  Model through an `OP` link (`Lcl Translation`, `Lcl Rotation`, `Lcl Scaling`); its `X`/`Y`/
  `Z` curves are the other `OP` links (`d|X`, `d|Y`, `d|Z`).
- **Frame data is relative to the bind parent, not the rest parent.** A cluster bind pose
  and the node rest pose can differ; writing rest-space locals would make the model jump at
  frame zero. The same conversion the bind frames use is applied at every key.
- **Cubic tangents are sampled linearly.** FBX stores tangents in `KeyAttrFlags`; this
  reader does not evaluate the cubic. The sampled pose follows the key values; the shape
  between them is a straight line. That is the documented fallback, not a silent fault.
- **Time is KTime ticks** (46,186,158,000 per second) or seconds in an ASCII export; the
  range decides, so a file with times above a million is treated as ticks.
- **A stack with no curves is skipped** with `fbx-animation-empty`; a target outside the
  SMD skeleton is skipped with `fbx-animation-target`. Multiple layers are merged in order
  and reported.

## What is reported, not exported

| Present in the file | Result |
|---|---|
| `BlendShape` | Exported by `fbx_to_dmx`; `fbx_to_smd` counts it because SMD has no morph target |
| Several mesh models | Merged into one SMD, with a note: `$bodygroup` is a QC decision |
| No material connection | `material` (default `debug/debugempty`), which compiles as the pink checkerboard, not an error |

## Shape keys and flexes

An SMD has no morph target, so a face with shape keys goes through `fbx_to_dmx` instead of
`fbx_to_smd`. It writes a DMX model source: the same skeleton and bind pose, the geometry as
one `DmeMesh`, and one flex per `BlendShapeChannel`.

- A `BlendShapeChannel` owns one or more `Shape` geometries. The delta is that shape's
  `Vertices` minus the base mesh at the control points its `Indexes` names; both are in the
  same mesh space, so the same node transform that places the geometry places the delta.
- A channel with several shapes is an in-between chain. The shape with the largest
  `FullWeights` entry becomes the flex; the others are named in `warnings`.
- The graph is shared with the glTF path (`dmxmodel.py`), including the detail that makes
  flexes work: `DmeMesh.deltaStateWeights` and `deltaStateWeightsLagged` carry one `(0, 0)`
  per control. Without them the compiler writes the payload and `flexrule = 0`.
- The QC names the DMX as `$body` and needs no `$flex` command. `studiomdl` writes
  `flexdesc`, `flexcontroller` and `flexrule` from the graph.
- A delta beyond ±8 is clamped by `studiomdl` and reported. Animations are not written to
  the DMX; use `fbx_to_smd` when the model needs sequences.

## Collision

A solid prop needs a `_phys.smd`. `fbx_to_smd` takes the same choice as the glTF path:

- `collision: "box"` writes the model's AABB, with `collisionThickness` as a minimum on an
  axis so a flat sign still gets a solid slab;
- `collision: "hull"` writes the convex hull of the mesh vertices, outward-wound; a
  coplanar cloud cannot bound a volume, so it falls back to the box and reports
  `fbx-hull-fallback`;
- the result's `collision.mode` says which shape was written, and `mass` is passed to the
  QC's `$collisionmodel`.

The collision SMD uses the material `phys`; `debug/debugempty` makes `studiomdl` report a
collision volume but write a 0-byte `.phy`. A brush-built collision is still
`brush_to_model`'s job; a model with several disjoint parts needs `$concave`, which this
path does not generate.

## Formats and failure modes

- **Binary 7.2-7.4** is the supported range and what Blender writes by default. Arrays may
  be zlib-compressed; both encodings are read.
- **Binary 7.5 (FBX 2020)** uses 64-bit record headers. The reader tries the documented
  layout and warns; if the node tree does not parse, re-export as FBX 7.4 (2014).
- **ASCII** is read by a tokeniser that follows the record grammar, including `*N` array
  blocks and lines that wrap inside an array.
- **Encrypted or compressed FBX** is refused with the reason. Re-export uncompressed.

Common messages and what to do:

| Message | Cause |
|---|---|
| `no mesh model is selected` | No `Model` has a connected `Geometry`, or `models` filtered them all out |
| `a record's end offset is outside the file` | Truncated file, or 7.5 layout this reader will not guess at |
| `fbx-units` | `UnitScaleFactor` is neither 1 nor 2.54; pass `scale` deliberately |
| `fbx-unweighted` | Clusters do not cover every control point; the model compiles but those vertices follow one bone |
| `fbx-no-normals` | No `LayerElementNormal`; every face normal is +Z, so the model shades flat |

## Checking it

`fbx_to_smd` returns the node table, triangle/bone/material counts, bounds and diagnostics.
The proof that matters is the compiler: `run_studiomdl` must exit 0 and `read_model_info`
must report the expected size and `boneCount`. For a static prop, `preview_model` renders it
in a sealed room with its lowest point on a pedestal, which is also the check on origin
placement; `preview_asset` still tries HLMV first.
