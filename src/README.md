# `src/` — modules by meaning

A directory here is a **piece of the toolkit**, not a language and not an upstream project.
`hammer/` is everything that drives the editor; `maps/` is everything that reads or writes a
map; `models/` is everything about a model. Finding the code for a job means asking what the
job is, not what it was written in.

## The language rule

A module that needs more than one language splits by language underneath:

```
src/hammer/
  typescript/     the tools, settings, autosave matching
  python/         the WM_COPYDATA / WM_COMMAND bridge
```

Those directories hold **source files only**. No assets, no licence texts, no build output,
no third-party trees, no module of their own inside them. Everything that is not source has
a home of its own:

| Not source | Where it goes |
|---|---|
| Licences and notices | `third_party/` |
| Test fixtures | `test/fixtures/` |
| Rendered output, screenshots | the caller's directory, or the state directory |
| Upstream repositories | nowhere: the part we use is ported here and credited |

A single-language module keeps its files at the module root — `src/textures/typescript/` is
the only exception in today's tree because that module also has to be able to grow a second
language without moving every file again.

## The modules

| Module | What it owns |
|---|---|
| `hammer/` | the live editor channel, Hammer++ settings, autosaves, Run Map sequences |
| `maps/` | VMF and BSP reading and writing, geometry, entities, displacements, spatial queries, renders, compile, and the map-facing tools |
| `models/` | QC parsing and building, studiomdl, HLMV |
| `textures/` | VTF and VMT |
| `nav/` | the navigation mesh: reading, generation, trouble reports |
| `scripts/` | VScript |
| `campaigns/` | mission files, finales, campaign gates |
| `assets/` | content search, material preview |
| `packages/` | addon packaging (VPK) |
| `formats/` | file-format primitives shared by the rest: KeyValues, VPK, VMT, QC |
| `core/` | config, version, logging, MCP plumbing, the sidecar client |

## Rules

1. **A module owns its tools.** `src/<module>/typescript/tools/` holds the tool definitions
   that belong to it; the aggregate list is `src/registry.ts` and nowhere else.
2. **`core/` holds no domain knowledge.** If it knows what a BSP is, it belongs in `maps/`.
3. **No cycles between modules.** `maps/` may use `formats/` and `core/`; `core/` uses
   neither.
4. **Every file says why it exists.** The header comment is the design note: what the file
   is for, what it refuses, and what it was measured against.
