# Library boundary: srctools, the sidecar and TypeScript

This page is the standing answer to “are we writing something srctools already does?”. It is
checked against **srctools 2.7.0** and the **41 verbs** registered in
`src/core/python/main.py`.

The rule itself is in [`AGENTS.md`](../AGENTS.md): call the library first; a second copy of
an existing implementation is a defect unless the library cannot express the operation.

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
| `func_instance` expansion | `srctools.instancing` via sidecar `vmf_collapse` | wrapper only: paths, guarded write, temp file | **delegated** (a duplicate TS expander was deleted) |
| VMF read, lint, dependencies, displacements, static props | sidecar `vmf_read`, `vmf_lint`, `map_dependencies`, `vmf_displacements`, `static_props*` | read-side tools call the sidecar | **delegated** |
| VMF write/edit | `srctools.vmf` exists | byte-offset TypeScript parser/writer, splices, prefab/instance extraction | **intentional TS** (offsets, byte-identical edits) |
| KeyValues | `srctools.keyvalues` | TypeScript lexer/parser with offsets | **intentional TS** (offsets) |
| BSP read/audit/patch | `srctools.bsp`; sidecar `pakfile`, `static_props*` | TypeScript lump reader for hot compile/audit paths; sidecar for ZIP/pakfile, static props, LZMA | **hybrid, intentional** |
| VPK | `srctools.vpk`/`filesys`; sidecar `vpk_list`, `vpk_read` | TypeScript VPK index/read for hot model/texture lookups | **intentional TS**; candidate for read-only tools if the subprocess cost is acceptable |
| VTF | `srctools.vtf`; sidecar `vtf_extract`, `vtf_convert`, `material_preview` | TypeScript decoder for in-process preview/software render | **intentional TS**; candidate |
| VMT | `srctools.vmt`; sidecar `material_preview` | TypeScript VMT read/write for tools and previews | **intentional TS**; candidate |
| Surface properties | `srctools.surfaceprop` (no verb yet) | TypeScript table parser with the prose-comment workaround | **candidate** — add a `surfaceprops` verb and delete the TS table parser |
| MDL basic info | `srctools.mdl`; sidecar `model_info` | `read_model_info` calls the sidecar; raw readers for decompile, eyes, jiggle, LOD, procedural, VTA, PHY | **hybrid, intentional** |
| DMX, SMD, glTF, FBX | `srctools.smd`, `srctools.dmx`, sidecar format verbs | TypeScript tools call the sidecar; no local parser copies | **delegated** |
| Particles | `srctools.particles` via sidecar | TypeScript tools call the sidecar | **delegated** |
| Soundscripts/soundscapes/WAV | `srctools.sndscript`, `sndscape`; sidecar verbs | TypeScript tools call the sidecar | **delegated** |
| FGD | `srctools.fgd` via sidecar `fgd_class` | TypeScript tools call the sidecar | **delegated** |
| Choreo, cmdseq | `srctools.choreo`, `srctools.cmdseq` | no local implementation; unused so far | no overlap |
| NAV, VTA, QC catalogue | no srctools module | TypeScript readers/writers | **necessary** |
| Math/transform helpers | `srctools.math`; no JS dependency installed | small 3×4 affine/rotation helpers | **intentional TS** (no subprocess for arithmetic) |

## Duplication that was found and removed

`collapse_instances` first shipped as a ~500-line TypeScript expander. The sidecar already
had `vmf_collapse`, which calls `srctools.instancing.collapse_all`; the TypeScript copy was
deleted in commit `1699b05`. The tool is now a wrapper that keeps this project's `out`,
backup and dry-run semantics, and passes `maxDepth` as the sidecar's `recurLimit`.

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
