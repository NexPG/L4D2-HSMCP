# L4D2-HSMCP

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.0.41--alpha-orange.svg)](CHANGELOG.md)
[![CI](https://github.com/NexPG/L4D2-HSMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/NexPG/L4D2-HSMCP/actions/workflows/ci.yml)

**An agent toolkit for building Left 4 Dead 2 content.** Maps, campaigns, VScripts, models
and addons — made through an MCP server and a skill, not by hand-editing files.

> **Early development.** The project has only just entered development. The map and campaign
> pipeline is the first piece being built; VScript, model and wider addon support will follow,
> and the toolkit will keep growing. Interfaces and tool names can change between `0.0.x`
> releases. Windows only, Left 4 Dead 2 only.

## What it is

`L4D2-HSMCP` gives an AI agent the tools a Left 4 Dead 2 mapper uses, in a form it can
call and verify:

- **Read** `.bsp` and `.vmf` files by offset — a gigabyte map without loading it.
- **Build and edit** geometry, entities and I/O, splicing the original text so untouched
  bytes stay untouched.
- **Lint** against the game's own `left4dead2.fgd`, before spending a compile.
- **Compile** with the stock L4D2 chain or standalone Tools++, naming the chain that ran.
- **Write and check campaigns**: mission files, chapters, maps and images.
- **Generate nav** with the engine, and **pack** the result into an addon VPK.
- **Measure** a map against its own brief and against the format's ceilings.

It never talks to a running game. It reads and writes files, runs the game's compilers and
packers, and lets the game generate its own nav mesh.

## How it works

```
  Agent + skill
        │  MCP (stdio)
        ▼
  L4D2-HSMCP ── TypeScript tools
        ├── KeyValues with offsets            .vmf, gameinfo, mission files
        ├── BSP readers (L4D2 field order)     header, entities, geometry
        ├── VMF splice / geometry / render     edits and offline checks
        ├── space, rooms, traces, plans        answers without a compile
        ├── compilers                          vbsp, vvis, vrad (stock / Tools++)
        ├── Python sidecar (srctools)          FGD, VPK, content, dependencies
        └── vpk.exe + the game itself          packing, nav_generate
```

The design rules come from the project this fork grew out of, and they still hold:

- **A `.bsp` is never read whole.** Real maps run to gigabytes; readers go by offset.
- **A `.vmf` is changed by splicing byte ranges.** Comments and formatting survive.
- **A writer is checked by a reader going the other way.** Volume → planes when writing,
  planes → volume when checking, so a sign error cannot hide in both.
- **No number without a source.** Limits and measurements carry a file and a date.
- **No tool without an oracle.** If the answer cannot be checked independently, it does
  not ship.
- **Primitives first; shortcuts never replace them.** Every capability is reachable through a
  general operation (`write_vmf_solid` with arbitrary convex faces, `edit_vmf`, `set_worldspawn`,
  `transform_solids`, `clone_solids`, `write_vscript`). A convenience tool may sit on top of
  that path, but it may not be the only way, and no hardcoded menu may stand in for what the
  engine accepts.

## Requirements

### Required

| Component | Why it is needed |
|---|---|
| **Windows 10/11 x64** | the game's compilers, `vpk.exe` and the toolkit are Windows binaries; Linux is not supported |
| **Left 4 Dead 2** (Steam app `550`) | the client install carries `vbsp.exe`/`vvis.exe`/`vrad.exe`, `vpk.exe`, `left4dead2.fgd` and the game content the tools read. A dedicated server alone is not enough |
| **Left 4 Dead 2 Authoring Tools** (Steam app `563`) | Valve's SDK for L4D2: Hammer, HLMV, Faceposer, the Workshop manager, the VScript plugins and the example content. Install from **Steam → Library → filter Tools**. About 0.9 GB |
| **Node.js 20+** | the MCP server itself (tested on Node 24) |
| **pnpm 10+** | install and build |
| **Python 3.10+** | the `srctools` sidecar, which parses FGD, VPK and VMF (3.12 tested) |
| **An MCP-capable agent** | the thing that drives the tools. OpenCode, Claude Code or any MCP client with tool use; see below |
| **Git** | clone and update |
| ~20 GB free disk | the game (~14 GB), Authoring Tools, compilers and `node_modules` |

### Recommended

| Component | Why |
|---|---|
| [**Hammer++** for L4D2](https://ficool2.github.io/HammerPlusPlus-Website/) | the editor the toolkit is built around: a stable Hammer with faster compiles and extra flags. Install the L4D2 build into the game's `bin/` |
| [**Tools++**](https://ficool2.github.io/HammerPlusPlus-Website/tools.html) | `vbsp++`/`vvis++`/`vrad++`/`bspzip++`. Standalone since October 2026; `run_compile` uses this chain by default and falls back to stock, naming the chain that ran |
| **VTFEdit++ / VTFCmd** | textures, cubemaps and skyboxes for custom content |
| **`bsp_rename`, `tga2skybox`, `cubemap2hdr`** | optional standalone tools from ficool2's tools page; `health` reports which are present |
| **Steam running and logged in** | `nav_generate` and the in-game test need the game client |
| **A dedicated server + SourceMod** | not needed for authoring; planned for automated in-game verification |

### Agent requirements

The toolkit is an MCP server plus the workflow around it, so the agent side has its own
requirements:

- **An MCP client over stdio with tool use.** OpenCode and Claude Code are the two this
  project is developed against; any client that can call MCP tools and show permission
  prompts should work.
- **The skill.** [`skill/l4d2-hsmcp/`](skill/l4d2-hsmcp/SKILL.md) is the workflow an agent
  follows: it routes the task to a reference, a procedure or a troubleshooting page instead of
  loading everything at once. The repository's `opencode.json` points at it, so it is
  available in this project without copying.
- **Permission to run the local tools.** Compilers, `vpk.exe` and the game are `local`
  tools. They need `confirm: true`, or an entry in `toolAllowlist` for an unattended run.
- **Permission to launch the game once per map for nav generation.** That is the only GUI
  step in the pipeline; everything before and after it is file work.

## Quick start

```powershell
git clone https://github.com/NexPG/L4D2-HSMCP
cd L4D2-HSMCP
pnpm install
pnpm build
powershell -ExecutionPolicy Bypass -File sidecar/setup.ps1
node dist/index.js install
```

Then ask the server for its state:

```
health
```

`health` reports the game profile it resolved, the compilers and FGD it found, the sidecar,
the tool count, and whether the build is older than the source. When something is missing it
says what and what that costs - it does not throw.

## Building a campaign

The pipeline the tools are built around:

```
write_vmf / write_vmf_solid     source geometry
read_vmf_leak                   sealed, in seconds, without a compiler
read_vmf_lint                   against the game's FGD
run_compile                     vbsp / vvis / vrad
write_campaign                  the mission file
check_campaign                  maps, images, chapter numbering
nav_generate                    the engine generates the .nav
run_vpk_pack                    an addon VPK
```

A complete worked example lives in the development notes, outside this repository. The
practical rules are in [`docs/campaign/overview.md`](docs/campaign/overview.md).

## Tools

88 tools, grouped by what they answer:

- **Inspect** — `health`, `read_source_games`, `read_bsp_info`, `read_bsp_entities`,
  `read_nav_dump`, `read_map_geometry`, `read_map_report`, `read_vmf`, `read_vmf_lint`.
- **Measure** — extents, sightlines, lightmap budgets, visleaf stats, props, pakfile.
- **Ask offline** — `read_vmf_leak`, `read_vmf_rooms`, `measure_vmf_clearance`,
  `read_vmf_visibility`, `read_vmf_trace`, `render_vmf_view`, `render_vmf_plan`.
- **Build and edit** - solids, fittings, clips, hollows, vertices, faces, lights, hints,
  portals, visgroups, displacements, overlays, instances, weather, fog, cloning, any
  worldspawn key, exact face-alignment copy, displacement subdivision.
- **Compile and ship** — `run_compile`, `read_compile_log`, `read_leak`,
  `read_map_dependencies`, `run_pack`, `run_vpk_pack`, `run_nav_generate`, `run_map_test`.
- **Campaigns** — `read_campaign`, `write_campaign`, `check_campaign`.
- **Scripts** — `write_vscript`: write a `.nut`, check it for Lua habits, attach it with a
  `logic_script`.

Every tool states its realm (`map` for files, `local` for a host binary) and whether it is
guarded. Writing and executing tools need `confirm: true`, or an entry in `toolAllowlist`.

## Repository layout

```
src/tools/        MCP tool definitions
src/campaign/     mission files: parse, write, check
src/vmf/          VMF reading, splicing, geometry, fittings
src/bsp/          BSP readers, limits, nav, VTF headers
src/space/        offline traces, rooms, measurement
src/render/       offline views and plans
src/compile/      compilers, logs, leaks, external tools
sidecar/          Python/srctools helper
skill/            the agent skill: SKILL.md, references, workflows, troubleshooting
test/             the oracle-heavy suite, mirroring src/
docs/             campaign guide, map reference and project reference
```

## Documentation

- [`CHANGELOG.md`](CHANGELOG.md) — what each version changed.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the three rules this project works by.
- [`skill/l4d2-hsmcp/SKILL.md`](skill/l4d2-hsmcp/SKILL.md) — the agent workflow, with
  campaign, nav, VScript and troubleshooting references.
- [`docs/README.md`](docs/README.md) — the documentation index.
- [`docs/campaign/overview.md`](docs/campaign/overview.md) — mission files, VPK layout, nav,
  deployment.
- [`docs/map/architecture.md`](docs/map/architecture.md) — the inherited design notes on
  splicing, offset reads and shared plumbing.
- [`docs/map/measuring.md`](docs/map/measuring.md),
  [`docs/map/spatial.md`](docs/map/spatial.md), [`docs/map/compiling.md`](docs/map/compiling.md)
  — dated measurements from the project's history.
- [`docs/reference/hammer-parity.md`](docs/reference/hammer-parity.md) — the tool-by-tool
  Hammer parity table.

## Status

The project has only just entered development. The map and campaign pipeline is the first
piece being built; VScript, model and wider addon tooling, automated in-game verification
and the agent skill itself are still ahead, so the feature set will keep expanding.
Interfaces and tool names may change between `0.0.x` releases.

Every tool is covered by tests. The suite runs on Windows against a real Left 4 Dead 2
install, and the checks that need game content skip themselves when the game is absent.

## License

**GPL-3.0-only.** Copyright (C) 2026 **NexPG**.

This project is a fork of [`hammer-mcp`](https://github.com/Sycatle/hammer-mcp), made by the
original developers at **Project Society Studio** and released under the MIT licence. The
original MIT notice is kept verbatim in [`LICENSE-MIT`](LICENSE-MIT), and [`NOTICE`](NOTICE)
records the provenance, the modification date and what the GPL asks of anyone redistributing
this work.

Not affiliated with Valve Corporation. Left 4 Dead 2 and its content belong to Valve.
