# Agent rules

> **Scope.** This file governs changes to **this repository** by a coding agent: library use,
> tests, docs, commits and build gates. The L4D2 runtime agent's instructions live in
> `skill/l4d2-hsmcp/`; product behaviour belongs there, not here. Do not duplicate those rules.

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

## Findings become prevention

A runtime finding is not finished when it is understood. It lands in the skill in the form the
production agent needs: the tool default or guard that prevents the mistake, a row in
`skill/l4d2-hsmcp/references/mechanics/coverage.md`, and a `troubleshooting/` page that opens
with the prevention and then gives symptom → cause → check → fix. The "mistakes that waste a
run" table in `SKILL.md` is the index of those pages. Research exists to transfer knowledge
into the skill: an insight that lives only in a log or a chat message will be lost, and the
next agent will pay for the same mistake again.

## Skill documentation is a product surface

`skill/l4d2-hsmcp/` follows the Agent Skills specification and is read by an agent that has
never seen this repository. Treat it as a product, not a scratchpad.

1. **Search before writing.** Before adding a page, a section or a fact, read `SKILL.md` and
   search the skill for the term, tool or rule. If it already exists, edit its owner and link;
   never add a second copy. The page that owns a fact holds the full version; every other page
   points to it.
2. **One topic per file and directory.** A file may cover one coherent job; a sentence that
   belongs to another page is moved there and linked, not left as a side note. If a new file is
   needed, put it in the directory that owns the topic, not in the nearest convenient one.
3. **A new page is routed.** Every page is listed in `SKILL.md` and every relative link must
   resolve. `test/support/structure.test.ts` fails on an orphan page or a broken link.
4. **Respect the format.** `name` is lowercase/hyphenated and equals the directory; the
   description says what the skill does and when to use it; `SKILL.md` stays under 500 lines;
   reference, workflow and troubleshooting pages over 100 lines start with `## Contents`;
   paths use forward slashes; dates are provenance, not decoration.
   `test/support/skill-spec.test.ts` enforces the frontmatter and the body limit.
5. **Do not add what already exists.** Check the skill, `references/tools/index.md` and
   `docs/` before writing a new tool, helper, page or table. A second copy is a defect even
   when it is shorter or “fits this page better”; the second-implementation rule above applies
   to documentation as well as code.
6. **The skill is for the runtime agent.** Development notes, research narratives, changelogs,
   open-task lists and “we should later” comments belong in `.develop-diary/`, not in the
   skill. The skill says how to make L4D2 content; it does not describe how this repository is
   maintained.
7. **Validate before commit.** Run `pnpm vitest run test/support/skill-spec.test.ts
   test/support/structure.test.ts test/tools/skill.test.ts`, then the full gates. If a tool
   changed, regenerate `docs/tools/`.
8. **Follow the published guidance.** The Agent Skills specification is
   <https://agentskills.io/specification>; Anthropic's authoring guide is
   <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>. When a
   local habit and the specification disagree, the specification wins.

## Repository facts

- **Every project gets its own directory under `workspaces/`.** A map, campaign, model or
  addon is a project: `workspaces/<project>/` holds its `plan/`, `logs/`, `src/` and outputs.
  `workspaces/` is ignored by git; nothing a project produces belongs in `src/`, `test/` or
  the repository root.
- Windows only, GPL-3.0-only, Node 22+, pnpm. `packageManager` in `package.json` pins the
  pnpm version and CI reads the same field, so use `pnpm`, not `npm`; the lockfile is
  `pnpm-lock.yaml`.
- The gates before calling work done are `pnpm build`, `pnpm typecheck`, `pnpm lint` and
  `pnpm test`, in that order. TypeScript is strict, including `noUnusedLocals` and
  `noUnusedParameters`; ESLint rejects unawaited promises.
- Never commit `dist/`, `node_modules/`, `config.json`, `.mcp.json`, `.hammer-mcp/`,
  `.develop-diary/`, `addons/`, `campaigns/` or `.3d-projects/`.
- `docs/tools/` is generated by `pnpm docs:tools`. One area is one logical job; a new kind
  of tool gets a new area, row and page, never an "Other" bucket. VScript authoring and the
  runtime harness are separate areas.

## The rest

`CONTRIBUTING.md` is the full rulebook: licence compliance, tests that can fail, numbers
that were read, documentation in the same commit, and Conventional Commits.
