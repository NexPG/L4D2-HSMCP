# Library and project boundary: never a second implementation

This page is the standing answer to **two** questions:

1. “Are we writing something `srctools` already does?”
2. “Are we writing something this repository already does?”

It is checked against **srctools 2.7.0** and the **54 verbs** registered in
`src/core/python/main.py`.

The rule itself is in [`AGENTS.md`](../../AGENTS.md) and
[`CONTRIBUTING.md`](../../CONTRIBUTING.md): use or extend an existing implementation, whether
it is a library or a helper in `src/`. A second copy is a defect unless the library cannot
express the operation, and the reason is recorded below.

## Project duplicates are the same defect

The audit is not only about srctools. This repository has helpers whose whole purpose is to
prevent drift, and a tool that copies one of them is a duplicate even though no library is
involved:

| Concern | One owner | Examples of the old copies |
|---|---|---|
| Solid/face selectors | `src/maps/typescript/vmf/select.ts` | field sets in `modify`, `organise`, `hollow`, `clip`, `optimise`, `face`, `displacement`, `skyboxbuild`, `skyboxcopy` |
| Temp file → sidecar verb → guarded write | `src/maps/typescript/tools/sidecarvmf.ts` | `collapse_instances`, `carve_solids`, `hull_solids` |
| “An attribute edit must not move a volume” | `assertGeometryUntouched` in `src/maps/typescript/vmf/solid.ts` | `face`, `displacement`, `organise` |
| Instance expansion | sidecar `vmf_collapse` / `srctools.instancing` | a deleted TypeScript expander |
| Model/MDL readers | `src/models/typescript/formats/` | a second parser in a tool would be the defect; tools import the format module |

Before adding a tool, search `src/` for the concern, not just `node_modules` and the sidecar.
If a helper exists, import it; if it is close but parameterised differently, change the
helper and its tests rather than forking it into the new tool.

## How the boundary is chosen

`src/core/python/main.py` states the policy in its header: **what is hot and already proven
stays in TypeScript; what is cold and expensive to rewrite lives in Python.** The same choice
shows up here as four concrete reasons:

1. **Offsets.** The VMF write path must change only the bytes it was asked to change. The
   KeyValues and VMF objects in srctools do not preserve source offsets, so the TypeScript
   parser keeps them. This is a write-path requirement, not a preference.
2. **Data the library does not expose.** srctools' `mdl` model has the common structures,
   but not the raw procedural/jiggle records this project inspects and writes; there is no
   srctools NAV or VTA reader. Those stay in TypeScript.
3. **Hot paths that must not spawn Python.** BSP/VPK/VTF reads drive compile checks, audits
   and previews; a subprocess per read would be slower and would make the toolkit require
   Python for work it can do offline.
4. **No existing call.** For a few formats there is no installed JS library and no srctools
   module (NAV, VTA, the QC command catalogue), so there is nothing to delegate to.

## Current table

| Domain | Library / sidecar | What this repository does | Verdict |
|---|---|---|---|
| Live-edit approval queue | no library module: editor/session state is this server's | project journal (`hammer/live/journal.ts`) and the existing shell transport | **necessary** (there is no upstream queue) |
| Engine console command | `srctools.run.send_engine_command` via sidecar `send_console_command` | wrapper only: argument checks and the error text | **delegated** |
| `func_instance` expansion | `srctools.instancing` via sidecar `vmf_collapse` | wrapper only: paths, guarded write, temp file | **delegated** (a duplicate TS expander was deleted) |
| Brush carve and convex hull | `srctools.geometry.Geometry.carve`, `srctools.math.quickhull` via sidecar `carve_solids`, `hull_solids` | wrapper only: selector resolution, ids, guarded write | **delegated** (see the `from_points` note below) |
| VMF asset check | `srctools.game.Game` mount chain, `srctools.vmt.Material`, `srctools.mdl.Model`; the sidecar's `check_assets` reuses `Resolver`, `_walk_material` and `_walk_model` from `map_dependencies` | source-side collection only; resolution is shared | **delegated** |
| VMF read, lint, dependencies, displacements, static props | sidecar `vmf_read`, `vmf_lint`, `map_dependencies`, `vmf_displacements`, `static_props*` | read-side tools call the sidecar | **delegated** |
| VMF write/edit | `srctools.vmf` exists | byte-offset TypeScript parser/writer, splices, prefab/instance extraction | **intentional TS** (offsets, byte-identical edits) |
| KeyValues | `srctools.keyvalues` | TypeScript lexer/parser with offsets | **intentional TS** (offsets) |
| BSP read/audit/patch | `srctools.bsp`; sidecar `pakfile`, `static_props*` | TypeScript lump reader for hot compile/audit paths; sidecar for ZIP/pakfile, static props, LZMA | **hybrid, intentional** |
| VPK | `srctools.vpk`/`filesys`; sidecar `vpk_list`, `vpk_read` | TypeScript VPK index/read for hot model/texture lookups; `verify_vpk` checks v2 MD5/signature, which srctools does not expose | **intentional TS**; candidate for read-only tools if the subprocess cost is acceptable |
| VTF | `srctools.vtf`; sidecar `vtf_extract`, `vtf_convert`, `material_preview`, `vtf_resources` | TypeScript header reader and decoder for in-process preview/software render; reading the resource table, particle sheets and hotspots is delegated; writing them is a TypeScript offset splice because `VTF.save()` re-encodes every mip | **hybrid, intentional** (the save path cannot preserve image bytes) |
| VMT | `srctools.vmt`; sidecar `material_preview` | TypeScript VMT read/write for tools and previews | **intentional TS**; candidate |
| VGUI `.res` | `srctools.keyvalues` parses it but evaluates `[$WIN32]`/`[!$OSX]` and drops the tags | condition-aware KeyValues parser and byte-offset value splice | **intentional TS** (the tags and offsets are the operation) |
| Surface properties | `srctools.surfaceprop` (no verb yet) | TypeScript table parser with the prose-comment workaround | **candidate** — add a `surfaceprops` verb and delete the TS table parser |
| MDL basic info | `srctools.mdl`; sidecar `model_info` | `read_model_info` calls the sidecar; raw readers for decompile, eyes, jiggle, LOD, procedural, VTA, PHY | **hybrid, intentional** |
| DMX, SMD, glTF, FBX | `srctools.smd`, `srctools.dmx`, sidecar format verbs | TypeScript tools call the sidecar; no local parser copies | **delegated** |
| Particles | `srctools.particles` via sidecar | TypeScript tools call the sidecar | **delegated** |
| Soundscripts/soundscapes/WAV | `srctools.sndscript`, `sndscape`; sidecar verbs | TypeScript tools call the sidecar | **delegated** |
| FGD | `srctools.fgd` via sidecar `fgd_class` | TypeScript tools call the sidecar | **delegated** |
| Game modes and mutations | `srctools.keyvalues` via sidecar `mode_read`; the existing `checkNut` reads Squirrel | TypeScript validates the contract and scaffolds the files; the guarded write is shared | **delegated** for parsing, project-owned for the contract |
| Choreo, cmdseq | `srctools.choreo`, `srctools.cmdseq`; sidecar `read_choreo`, `choreo_edit_events`, `cmdseq_read` | Reading and text re-serialisation are srctools; TypeScript only discovers paths and applies the guarded write | **delegated** (semantic round-trip measured on 10 195 of 10 203 stock scenes) |
| NAV, VTA, QC catalogue | no srctools module | TypeScript readers/writers | **necessary** |
| Run Map execution | `srctools.cmdseq` supplies the commands; no library runs them | one thin runner: compilers through `runCompiler`, file steps through `node:fs`, argv through `compile/commandline.ts` | **necessary** |
| Math/transform helpers | `srctools.math`; no JS dependency installed | small 3×4 affine/rotation helpers | **intentional TS** (no subprocess for arithmetic) |

## Duplication that was found and removed

`collapse_instances` first shipped as a ~500-line TypeScript expander. The sidecar already
had `vmf_collapse`, which calls `srctools.instancing.collapse_all`; the TypeScript copy was
deleted in commit `1699b05`. The tool is now a wrapper that keeps this project's `out`,
backup and dry-run semantics, and passes `maxDepth` as the sidecar's `recurLimit`.

The carve/hull wave found the same problem inside the project. `SolidSelector` and
`FaceSelector` zod fields and their flat-argument mappers had been copied into
`modify`, `organise`, `hollow`, `clip`, `optimise`, `face`, `displacement`, `skyboxbuild`
and `skyboxcopy`; they now live once in `vmf/select.ts`. The temp-directory/sidecar/
guarded-write scaffold was about to get its third copy, so it became
`tools/sidecarvmf.ts` and `collapse_instances`, `carve_solids` and `hull_solids` use it.
The same search found `assertGeometryUntouched` copied into `face`, `displacement` and
`organise`; it now lives in `vmf/solid.ts`. The rule is not only about srctools: **if the
project already has the helper, import it.**

## Upstream defect: `Geometry.from_points` returns nothing

In srctools 2.7.0, `Geometry.from_points(cube_corners)` returns an empty `Geometry`.
`from_points` builds a `Plane` from each quickhull triangle with
`Vec.cross(a - b, b - c)`, but those normals face *into* the hull, while
`Geometry.from_dup_planes` expects outward-facing planes (the same orientation
`from_brush` produces). Every polygon is therefore discarded.

The sidecar's `hull_solids` verb calls `quickhull` directly and flips each plane against
the point cloud's centroid before `from_dup_planes`. That keeps the library's hull
algorithm and plane-deduplication; it does not introduce a second hull implementation.
If upstream fixes `from_points`, the loop can be replaced by a single call, and the cube
oracle in `test/vmf/hull.test.ts` will say so.

## Known candidates, not hidden

These are real overlaps with an existing library. They are kept for the reasons above, but
they are the first places to look if the sidecar dependency becomes acceptable on that path:

- `src/assets/typescript/formats/surfaceprops.ts` — srctools has a complete parser;
- `src/formats/typescript/formats/vpk.ts` — read-only callers could use `vpk_read`;
- `src/textures/typescript/formats/vtfdecode.ts` — preview callers could use
  `material_preview`/`vtf_convert`;
- `src/formats/typescript/formats/vmt.ts` — read-only callers could use the sidecar's VMT
  parser once a `vmt_read` verb exists.

## Before adding a format tool

1. Search `src/*/python/` and `main.py` verbs.
2. Search the installed `srctools` modules and `package.json` dependencies.
3. If the library covers it and the path is not offset-bound, hot or offline, call the
   library. Add a sidecar verb if the operation is missing but the library supports it.
4. If a TypeScript implementation is still required, write the reason in the module comment
   and add it to the table above.
5. Do not add a second copy of an existing helper; extend the existing one.
