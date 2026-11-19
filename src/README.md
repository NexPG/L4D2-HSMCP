# `src/` — modules by meaning

A directory here is a **piece of the toolkit**, not a language and not an upstream project.
`hammer/` is everything that drives the editor; `maps/` is everything that reads or writes a
map; `models/` is everything about a model. Finding the code for a job means asking what the
job is, not what it was written in.

## The language rule

The project is **TypeScript, Python and PowerShell**, and nothing else. A module that needs
more than one language splits by language underneath:

```
src/hammer/
  typescript/     the tools, settings, autosave matching
  python/         the WM_COPYDATA / WM_COMMAND bridge
  data/           the build registry the tools read
```

Those directories hold **source files only**. No assets, no licence texts, no build output,
no module of their own inside them. TypeScript is compiled to `dist/` by the repository's
own toolchain; Python is interpreted by the sidecar interpreter. There is no build manifest
inside a language directory because there is no native build to describe.

Everything that is not source has a home of its own:

| Not source | Where it goes |
|---|---|
| Licences and notices | `third_party/` |
| Test fixtures | `test/fixtures/` |
| Runtime data (a registry, a table) | `<module>/data/` |
| Rendered output, screenshots | the caller's directory, or the state directory |
| Upstream repositories | nowhere: the part we use is ported here and credited |

All modules now keep their files under a language directory, including the single-language
ones: `src/textures/typescript/`, `src/nav/typescript/`, `src/scripts/typescript/`. The
symmetry is what makes "where is the Python for maps" answerable without a second rule.

## Data, not source

`src/hammer/data/` holds data a module reads at runtime: `hammers.json`, the registry of known
editor builds. It is not code, so it is not in `typescript/` or `python/`; it is not paperwork
either, so it is not in `third_party/`. A module that needs a data file gets a `data/`
directory beside its language directories.

## The modules

| Module | What it owns |
|---|---|
| `hammer/` | the live editor channel, Hammer++ settings, autosaves, Run Map sequences, and `data/` (the build registry) |
| `maps/` | VMF and BSP reading and writing, every lump including LZMA-compressed ones, geometry, entities, displacements, spatial queries, renders, compile, and the map-facing tools |
| `models/` | QC, SMD, DMX and glTF/GLB model sources (including shape keys → flexes), VMF brush → model, studiomdl, HLMV, and deep model reporting (sequences, events, hitboxes, skins, flex counts) |
| `textures/` | VTF and VMT, PNG decoding, native VTF writing/conversion and image extraction |
| `nav/` | the navigation mesh: reading, generation, editing, trouble reports |
| `scripts/` | VScript |
| `campaigns/` | mission files, finales, campaign gates |
| `assets/` | content search, material preview |
| `audio/` | WAV reading/conversion and soundscripts (names, waves, #base, wave existence) |
| `packages/` | addon packaging (VPK), pakfile writing |
| `formats/` | file-format primitives shared by the rest: KeyValues, VPK, VMT, QC, DMX |
| `core/` | config, version, logging, MCP plumbing, the sidecar client |

## Rules

1. **A module owns its tools.** `src/<module>/typescript/tools/` holds the tool definitions
   that belong to it; the aggregate list is `src/registry.ts` and nowhere else.
2. **`core/` holds no domain knowledge.** If it knows what a BSP is, it belongs in `maps/`.
3. **No cycles between modules.** `maps/` may use `formats/` and `core/`; `core/` uses
   neither.
4. **Every file says why it exists.** The header comment is the design note: what the file
   is for, what it refuses, and what it was measured against.
