# Skill

The L4D2-HSMCP agent skill lives here. `l4d2-hsmcp/` is the skill itself: a directory with
`SKILL.md` at its root, which is what OpenCode and Claude discover. `skill/` is the container
so the repository has one obvious place for it.

```
skill/
└── l4d2-hsmcp/
    ├── SKILL.md                     entry point; the only file loaded by default
    ├── references/                  knowledge, read on demand
    │   ├── campaign/                mission, safe room/transition, finale, deployment
    │   ├── nav/                     generation, attributes and flow
    │   ├── scripting/               VScript in an add-on
    │   ├── mapping/                 L4D2 entity facts
    │   ├── compiling/               stock vs Tools++, lint before compile
    │   └── tools/                   the MCP tool catalogue by job
    ├── workflows/                   ordered procedures with checkpoints
    ├── troubleshooting/             symptom → cause → fix
    └── checklists/                  the definition of done
```

## How it is loaded

`SKILL.md` is the only file an agent reads automatically. Everything else is linked from it
with a "read this when…" condition. That is deliberate: the skill must stay small enough to
fit in context while the reference material can grow without cost.

The repository's `opencode.json` points at `./skill/l4d2-hsmcp`, so the skill is available in
this project without copying. That relative path is resolved against the session's working
directory, not the config file, so it only covers sessions started at the repository root.
`pnpm skill:link` (also run by `pnpm install` through `prepare`) adds the gitignored
`.opencode/skills/l4d2-hsmcp` directory link; OpenCode finds that while walking up from `src/`
and `workspaces/<project>/` as well. The link is a pointer, not a second copy.

To use it in another project or globally:

```powershell
# project-local
Copy-Item -Recurse skill/l4d2-hsmcp <project>/.opencode/skills/l4d2-hsmcp

# or global
Copy-Item -Recurse skill/l4d2-hsmcp "$env:USERPROFILE/.config/opencode/skills/l4d2-hsmcp"
```

The directory name becomes the skill ID, so keep it `l4d2-hsmcp`.

## Rules for writing here

1. **Only verified facts.** A statement about the engine, a keyvalue or a flag needs a source:
   a tool result, a nav/compile/console log, the FGD or the game's own files. When something
   is untested, say "not verified" or leave it out.
2. **One concept per file.** Mission format, safe rooms, nav attributes are separate files.
   A file that needs a table of contents is a file that should be split.
3. **Link with a condition.** "Read `references/nav/attributes-and-flow.md` when bots do not
   follow" is useful; "see references/" is not.
4. **Keep `SKILL.md` under 500 lines.** It is a router and a short procedure, not a manual.
5. **Procedures live in `workflows/`, knowledge in `references/`, symptoms in
   `troubleshooting/`.** Do not mix the three.
6. **Update the skill in the same change that changes behaviour.** A tool rename or a new
   requirement must not leave the skill lying.

The development rules and the research behind this structure are recorded in
`.develop-diary/` (`04-log/2026-11-17-skill-docs-research.md`).
