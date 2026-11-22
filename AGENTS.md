# Agent rules

## Never write a second implementation — library or project

Before writing a parser, converter, packer, editor or helper, ask **two** questions:

1. **Does a library already do this?** Check `src/*/python/` and the verbs in
   `src/core/python/main.py` (srctools-backed), the installed `srctools` modules (`vmf`,
   `keyvalues`, `bsp`, `mdl`, `vpk`, `vtf`, `vmt`, `surfaceprop`, `instancing`, `dmx`, `smd`,
   `particles`, `sndscape`, `sndscript`, `fgd`, `choreo`, `cmdseq`, …), and the installed npm
   packages already in `package.json`.
2. **Does this repository already do this?** Search `src/` for the helper. Selection
   (`vmf/select.ts`), the guarded write (`fs/write.ts`), the temporary-file/sidecar/
   guarded-write scaffold (`tools/sidecarvmf.ts`), the KV/VMF readers, the geometry guard
   (`vmf/solid.ts`) — a second copy inside a new tool is the same defect as a copy of
   srctools.

If either answer is yes, **use or extend that implementation**. Writing a second copy is a
defect even when the copy is shorter, “fits this tool better”, or was easier to type. There
is no third category called “but it is only a small helper”.

### Library rules

1. **If a library can do it, call the library.** For srctools that means the Python sidecar,
   not a TypeScript copy. A wrapper that passes paths, reads the reply and keeps this
   project's guards is fine; reimplementing the library is not.
2. **Reimplement only when the library cannot express the operation**, for example:
   - byte-identical surgical edits need source offsets that the library's object model does
     not preserve (`keyvalues`/`vmf` write path);
   - the data is not exposed (raw MDL procedural/jiggle records, NAV records, VTA);
   - a hot path must work without Python or without a subprocess per call (BSP/VPK/VTF
     reads used by compile/audit/preview).
3. **When you do reimplement, say why in the module comment and add it to
   [`docs/reference/library-boundary.md`](docs/reference/library-boundary.md).** “It was
   easier” is not a reason.
4. **Do not transplant srctools or other upstream code.** Use it as a dependency (sidecar)
   or write an independent implementation from the format, and cite the reference.

### Project rules

- **Search before writing.** `src/` is not a library, but it is the first place to look. A
  helper that already exists is extended, not copied into a tool.
- **One owner per concern.** A selector shape has one home, a write path has one home, a
  sidecar-call scaffold has one home. A new tool imports them.
- **A near-copy is a bug even if it compiles.** If two files differ only in wording or in
  one default, unify them and keep the difference as a parameter.
- **Do not fork a tool to avoid touching a shared helper.** Change the helper and its tests;
  a fork hides the divergence until the two copies disagree.

The lasting audit table and current exceptions live in
[`docs/reference/library-boundary.md`](docs/reference/library-boundary.md).

## Repository facts

- Windows only, GPL-3.0-only, Node 22+, pnpm. `packageManager` in `package.json` pins the
  pnpm version and CI reads the same field, so use `pnpm`, not `npm`; the lockfile is
  `pnpm-lock.yaml`.
- The gates before calling work done are `pnpm build`, `pnpm typecheck`, `pnpm lint` and
  `pnpm test`, in that order. TypeScript is strict, including `noUnusedLocals` and
  `noUnusedParameters`; ESLint rejects unawaited promises.
- Never commit `dist/`, `node_modules/`, `config.json`, `.mcp.json`, `.hammer-mcp/`,
  `.develop-diary/`, `addons/`, `campaigns/` or `.3d-projects/`.

## The rest

`CONTRIBUTING.md` is the full rulebook: licence compliance, tests that can fail, numbers
that were read, documentation in the same commit, and Conventional Commits.
