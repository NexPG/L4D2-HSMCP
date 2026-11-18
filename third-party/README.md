# `third-party/` — the paperwork, and nothing else

Every licence, notice and obligation that came with code we did not write, in one place.
No source code lives here: the borrowed implementations belong to the module they serve
(see [`../src/README.md`](../src/README.md)), under the same licence recorded here.

> **Licence compliance is mandatory.** `CONTRIBUTING.md` makes it rule 0 and
> [`NOTICES.md`](NOTICES.md) is the authoritative record. A project with no licence cannot be
> copied; its behaviour can be studied, and the implementation written here.

## What is here

| Path | What it is |
|---|---|
| [`NOTICES.md`](NOTICES.md) | Every project we use, every project we deliberately did not, and why. Update it before importing anything. |
| [`NOTICE`](NOTICE) | Provenance of this repository, the modification notice GPL-3.0 §5(a) asks for, and what the GPL requires of anyone redistributing it. |
| [`licenses/`](licenses/) | The verbatim licence of each borrowed work, with its own copyright line. Linked from the Credits table in the root README. |

## Where the code that these licences cover lives

The borrowed code is not parked in a "vendor" folder; it is part of the project, filed in the
module whose job it does:

| Module | What it does | Borrowed parts |
|---|---|---|
| [`src/formats`](../src/formats/) | Reading and writing Source file formats | `native/sourcepp` — MIT, © 2023 Laura Lewis |

Each of those directories keeps its upstream `LICENSE` file next to the source, as MIT and the
GPL require. Editing them is allowed — the licences permit modification — but a change must
start with a header naming the upstream project and the change, and be recorded in
[`NOTICES.md`](NOTICES.md) in the same commit.

## Rules

1. **Every new licence is a new file** in `licenses/`: the verbatim text with its copyright
   line. Link it from the root README and from `NOTICES.md`, and say what was taken. All in
   the same commit.
2. **No licence, no code.** Study the behaviour, write the implementation, cite the project.
   `NOTICES.md` records it as reference-only.
3. **Never strip a notice.** If a borrowed file is rewritten, the new file still carries the
   upstream notice in its header.
4. **The combined work stays GPL-3.0-only.** Nothing here adds a restriction on top of it.
