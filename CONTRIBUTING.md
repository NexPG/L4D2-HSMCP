# Contributing

This is an independent project that began from code published as `hammer-mcp`, developed on
its own terms and aimed at Left 4 Dead 2. The process is deliberately light; the rules below
are not.

## 0. Licence compliance is non-negotiable

**This rule outranks every other rule.** If a borrowed work cannot be used lawfully, it does
not go in, no matter how useful it is.

Before taking code, data or an asset from another repository:

1. **Identify the licence and the copyright holder.** Check the repository's `LICENSE`,
   `COPYING` or `NOTICE`. A repository with no licence is **all rights reserved** by default;
   do not copy its code or content.
2. **Check compatibility with GPL-3.0-only.** MIT, BSD, Apache-2.0 and GPL-3.0 are compatible;
   GPL-2.0-only, proprietary and unlicensed code are not. If you are unsure, stop and ask.
3. **Keep the notice.** Put the upstream copyright and permission notice in
   [`third_party/NOTICES.md`](third_party/NOTICES.md) and the verbatim licence in [`third_party/licenses/`](third_party/licenses), and keep the upstream `LICENSE` text
   or a verbatim copy of it.
4. **Mark the source.** Every ported file starts with a comment naming the upstream project,
   its licence, and the fact that it was modified here.
5. **Record the provenance.** The commit message says what was taken, from which repository
   and commit (use `cherry picked from commit ...` when that is true), and that the licence
   was checked.
6. **Never silently relicense.** The imported part stays under its own licence; the GPL
   applies to the combined work.
7. **No licence, no code.** Learn from the behaviour, write our own implementation, and cite
   the project as a reference. Do not copy the expression.

A component missing from `third_party/NOTICES.md` is a compliance defect even if the code is
correct. A missing feature is recoverable; a licence violation is not.

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

Findings are not finished in the diary. Every experiment that produced a fact, a limit or an error
goes into `skill/l4d2-hsmcp/troubleshooting/` or `references/` as **symptom → cause → check → fix**,
including what the error means and what it affects. The diary records the process; the skill is what
the agent reads while working. If an agent has to ask "why is this happening?", the documentation is
incomplete.

**Research reports and upstream-intake audits belong in `.develop-diary/04-log/`, not in
`docs/`.** `docs/reference/` is for stable contracts the agent reads while working;
`docs/reports/` is for build/test incident reports. A research narrative in `docs/reports/`
is in the wrong place.

**Leave the game install as you found it.** A test that copies a map, injects entities or creates
`materials/maps/<map>/` removes those files and restores any modified original in a `finally`, even
when the run fails. The game directory belongs to the user, not to the test suite. The checklist is
[`skill/l4d2-hsmcp/references/testing/game-environment-cleanup.md`](skill/l4d2-hsmcp/references/testing/game-environment-cleanup.md).

There is a corollary for tools: **no tool without an oracle.** If you cannot build an independent
way to check what the tool returns, it does not ship. Several gaps in this repository are documented
rather than filled for exactly that reason.

## 4. Hands untied, not a menu

**We build a tool factory, not a parts catalogue.** The agent must be able to make a part we
never anticipated. A named preset is a shortcut over a primitive, never the only way to reach
a capability. If a user asks for something no builder covers, the answer is a primitive call,
not "not supported".

The agent is the user of this toolkit. The goal is every Hammer++ capability **and more**, available
as operations the agent can combine freely - not a catalogue of prepared answers it has to choose
from. A canned option that is the only way to do something is a defect, however convenient it looks.

- **Every shortcut sits on a primitive, and the primitive stays reachable.** If deleting a helper
  would remove a capability, the primitive is missing. `write_vmf_fitting` is allowed because
  `write_vmf_solid` with an arbitrary convex face list still builds any shape; `set_map_properties`
  is allowed because `set_worldspawn` still reaches every worldspawn key.
- **Enums must be complete for the engine, not for us.** `preciptype` is a closed FGD list, so it
  can be an enum. A keyvalue the engine accepts as an arbitrary string or number gets an arbitrary
  string or number, not the subset somebody thought of.
- **No hardcoded dimensions, names or flows as the only option.** Measured defaults are fine when
  they are labelled as defaults and can be overridden. A single baked-in variant is not.
- **A gap is named, not papered over.** If the engine step or the format is not implemented, it
  belongs in the coverage table and the backlog. Do not ship a menu and call it completeness.
- **Review question for every new tool:** "How would the agent do this without this tool?" If the
  answer is "it could not", write the primitive first. Then the helper is a shortcut, not a cage.

## Repository layout

The root holds only files with a build, licence or documentation job. Everything else lives
in a directory.

| File | Job |
|---|---|
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | package, locked dependencies, pnpm build approvals |
| `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts` | build config, test typecheck, shared test setup |
| `config.example.json` | template for the local `.hammer-mcp/config.json` |
| `opencode.json` | registers the repository skill with OpenCode |
| `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | front page, rules, version history |
| `LICENSE` | GPL-3.0-only, the licence of the combined work |
| `.gitattributes`, `.gitignore` | line endings and local/generated files |

`.mcp.json`, `config.json`, `dist/`, `node_modules/`, `campaigns/`, `.develop-diary/` and
`.hammer-mcp/` are local and gitignored. A new tracked file at the root fails
`test/support/structure.test.ts` until it is added to that allowlist and this table.

## Before committing

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Typecheck is separate from tests, and not out of habit: a stale `dist/` of
`@projectsociety/mcp-core` makes tests green and typecheck red on the same tree. Run both, always.

**Close what you open.** Compilers, Hammer, HLMV, a game launch and any helper binary that
draws a window are processes, and a failed one can leave a modal error dialog on someone's
desktop. Close them when the answer has been read. This is not only tidiness: three
`VConfig Error` dialogs from an abandoned `bspzip` experiment are three interruptions for the
person at the machine, and the experiment had already been replaced by the in-process ZIP
writer.

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

The repository ships under **GPL-3.0-only** ([`LICENSE`](LICENSE)). The work it grew out of,
and everything else it borrows, is recorded in [`third_party/`](third_party/README.md): the
provenance in [`third_party/NOTICE`](third_party/NOTICE), the record in
[`third_party/NOTICES.md`](third_party/NOTICES.md), and the verbatim licence of each work in
[`third_party/licenses/`](third_party/licenses). By contributing you agree that your
contribution is licensed under the same terms, and that it carries no notice, dependency or
vendored file that would add a restriction on top of the GPL.

A file copied from somewhere else is the one thing to say out loud in the commit or PR: a
GPL-compatible licence with its notice intact is fine, anything else is not.
