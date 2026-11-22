# Agent rules

## Library first, and never a second implementation

Before writing a parser, converter, packer or editor for a format:

1. **Look for an existing implementation first.**
   - `src/*/python/` and the verbs in `src/core/python/main.py` (srctools-backed);
   - the installed `srctools` modules (`vmf`, `keyvalues`, `bsp`, `mdl`, `vpk`, `vtf`,
     `vmt`, `surfaceprop`, `instancing`, `dmx`, `smd`, `particles`, `sndscape`,
     `sndscript`, `fgd`, `choreo`, `cmdseq`, …);
   - the installed npm packages already in `package.json`.
2. **If a library can do it, call the library.** For srctools that means the Python
   sidecar, not a TypeScript copy. A wrapper that passes paths, reads the reply and keeps
   this project's guards is fine; reimplementing the library is not.
3. **Reimplement only when the library cannot express the operation**, for example:
   - byte-identical surgical edits need source offsets that the library's object model
     does not preserve (`keyvalues`/`vmf` write path);
   - the data is not exposed (raw MDL procedural/jiggle records, NAV records, VTA);
   - a hot path must work without Python or without a subprocess per call (BSP/VPK/VTF
     reads used by compile/audit/preview).
4. **When you do reimplement, say why in the module comment and add it to
   [`docs/reference/library-boundary.md`](docs/reference/library-boundary.md).** “It was
   easier” is not a reason.
5. **Never add a second implementation of something this repository already has.**
   Selection (`vmf/select.ts`), the guarded write (`fs/write.ts`), the
   temporary-file/sidecar/guarded-write scaffold (`tools/sidecarvmf.ts`), the KV/VMF
   readers — search `src/` first and extend the helper. A copy inside a new tool is the
   same defect as a copy of srctools. Do not fork it into a tool.
6. **Do not transplant srctools or other upstream code.** Use it as a dependency (sidecar)
   or write an independent implementation from the format, and cite the reference.

The lasting audit table and current exceptions live in
[`docs/reference/library-boundary.md`](docs/reference/library-boundary.md).

## The rest

`CONTRIBUTING.md` is the full rulebook: licence compliance, tests that can fail, numbers
that were read, documentation in the same commit, and Conventional Commits.
