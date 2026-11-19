# `third_party/` — the paperwork

Everything this project is legally obliged to carry, and nothing else. No source code lives
here: borrowed code is **ported into `src/` and becomes part of this project**, credited in
`NOTICES.md` with the exact upstream file it came from.

| Path | What it is |
|---|---|
| [`NOTICES.md`](NOTICES.md) | The record: every project whose code or reference work is used, what was taken, and every project deliberately **not** copied. The file a contributor must update before importing anything. |
| [`NOTICE`](NOTICE) | Provenance, the modification notice GPL-3.0 §5(a) asks for, and what the GPL requires of anyone redistributing this work. |
| [`licenses/`](licenses/) | The verbatim licence of each work we borrow, with its own copyright line. |

## Why there are no source trees here

A parked copy of someone else's repository is not integration. It drifts, it is never
compiled, and it makes the project look like ours plus a pile of attachments. When a port
needs to be re-checked, `NOTICES.md` names the upstream file — `vpkpp/format/VPK.cpp`,
`vtfpp/ImageFormats.h`, `mdlpp/structs/MDL.h` — and the repository URL is one click away.

The rule that follows from it: **what we use, we port; what we port, we test; what we test,
we own.** If a component cannot be ported yet, it is not added at all.

## Rules

1. **Licence first.** Identify the licence and the copyright holder from the repository's
   `LICENSE`. No licence means all rights reserved: read it, do not copy it.
2. **Compatible with GPL-3.0-only.** MIT, BSD and Apache-2.0 are; GPL-2.0-only and
   unlicensed code are not. The project's own code is GPL-3.0-only, so GPL-3.0 code is
   compatible too.
3. **A new licence is a new file.** `licenses/<work>-<SPDX>.txt`, verbatim text plus the
   copyright line, linked from `NOTICES.md`.
4. **Say what was taken.** `NOTICES.md` gets the project, the licence, the upstream files and
   what they became here. The commit message says the same.
5. **Mark the port.** A file ported from upstream starts with a header naming the project,
   the licence and the fact that it was modified.
6. **Missing record = defect.** A component that is used and not listed in `NOTICES.md` is a
   compliance defect even when the code is correct.

`CONTRIBUTING.md` makes this rule 0 of the project.
