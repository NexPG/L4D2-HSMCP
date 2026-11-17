# Contributing

This is a standalone fork of `hammer-mcp`, developed on its own terms and aimed at Left 4 Dead 2.
The process is deliberately light; the three rules below are not.

## 1. A passing test proves nothing until it has been shown it can fail

This one outranks the others. A green test may be green because the code works, or because the test
tests nothing — and nothing in the output distinguishes the two.

So for every test you add: **sabotage the code it covers, watch it go red, put it back.** Then say
so in the commit message, naming what you broke.

That is not a formality here. `edit_vmf` once shipped with four tests asserting byte equality after a
splice; replacing the splice with a full reserialisation made **none of them fail**, because the
fixtures were canonical enough to round-trip. The tests were proving nothing, and only the sabotage
said so.

This suite also drives real compilers, a real Python sidecar and real maps, none of which ships with
the repository. A test that cannot find what it needs **skips**, and an over-broad skip guard is
indistinguishable from a success. Hence:

- availability predicates live in `test/support/env.ts`, **all of them**, never reinvented inside a
  test file;
- a run announces in plain text what it could not test;
- CI refuses a green run in which too few tests actually executed.

## 2. No number nobody read

This repository asserts a great many numbers: lump ceilings, sizes, thresholds, durations. Each one
comes from a file that was read or a measurement that was taken, and **the docs say which, with its
date**.

A lump ceiling copied off a wiki page, a limit that is "probably the same on that game", a duration
"in the region of": no. If a value cannot be verified, it is absent, or marked unverified — never
presented as fact. This matters more here than in most projects, because the target game's limits
have not been measured yet: a number inherited from another Source branch is a guess wearing a
format.

## 3. The commit carries its documentation

One atomic commit, one subject, in English, **Conventional Commits** format:

```
type(scope): imperative summary

Why this change exists, what it makes true, and what it makes false.
```

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`.
- **Scope** is optional but wanted when it narrows the change: `feat(map):`, `ci:`,
  `docs(skill):`.
- **Summary** is imperative, lower case, no trailing period, and under ~72 characters.
- **Body** starts after a blank line and says **why**, not what — the diff already says what.
- **Breaking change** takes `!` before the colon (`feat(tools)!:`) and a `BREAKING CHANGE:`
  footer.
- A commit that does not parse as Conventional Commits is a defect, even when the change is
  right: the history is read by tools and by people scanning for `fix:`.

Documentation the change makes false is fixed **in the same commit**. A README describing a tool
that does not exist is a bug, not a delay: somebody reads it and relies on it.

There is a corollary for tools: **no tool without an oracle.** If you cannot build an independent
way to check what the tool returns, it does not ship. Several gaps in this repository are documented
rather than filled for exactly that reason.

## Before committing

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Typecheck is separate from tests, and not out of habit: a stale `dist/` of
`@projectsociety/mcp-core` makes tests green and typecheck red on the same tree. Run both, always.

## Workflow

There is one branch, `main`, and commits go straight to it. A pull request is welcome when a change
is large or wants a second pair of eyes, but nothing here depends on the review mechanism — the
rules above do the work a reviewer would otherwise do.

## What is not wanted

- **A free-form argument passthrough to the compilers.** A flag nobody can verify does not belong
  in a tool; it belongs in the documentation, presented as a judgement call.
- **A reader that loads a whole file.** Real maps run to the gigabyte, and a `readFileSync` on one
  kills the MCP transport — which the caller sees as a hang, not an error. Everything reads by
  offsets.
- **Redistributing Valve content, the Hammer++/Tools++ binaries or the game's own FGDs.** They are
  installed, not vendored. No `.fgd`, `.bsp` or `.exe` that is not ours enters this repository.

## Versioning

`package.json` holds the version; `src/version.ts` reads it rather than repeating it, and
`health` reports what the running build actually loaded. `CHANGELOG.md` keeps the human
history, and a version bump lands in the same commit as the change it describes.

The scheme is SemVer: `MAJOR` for a break in the tool contracts, `MINOR` for a new
capability, `PATCH` for a fix that changes no contract. While the target game's limits are
still being measured and the campaign pipeline does not exist yet, releases stay on
`0.0.x-alpha`; the first `0.1.0` is for a campaign that can be built and played end to end.

## Licence

The repository ships under **GPL-3.0-only** ([`LICENSE`](LICENSE)), with the upstream MIT notice it
was forked from kept in [`LICENSE-MIT`](LICENSE-MIT) and the history in [`NOTICE`](NOTICE). By
contributing you agree that your contribution is licensed under the same terms, and that it carries
no notice, dependency or vendored file that would add a restriction on top of the GPL.

A file copied from somewhere else is the one thing to say out loud in the commit or PR: a
GPL-compatible licence with its notice intact is fine, anything else is not.
