# L4D2-HSMCP

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.0.67--alpha-orange.svg)](CHANGELOG.md)
[![CI](https://github.com/NexPG/L4D2-HSMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/NexPG/L4D2-HSMCP/actions/workflows/ci.yml)

**Build Left 4 Dead 2 content with an AI agent.** Maps, campaigns, nav meshes, VScripts and
addons — through a purpose-built MCP server and a skill that teaches the agent how L4D2
actually works.

> **Alpha.** The project is under active development. Features, tool names and behaviour may
> change between `0.0.x` releases. Windows only. Left 4 Dead 2 only.

## What it is

`L4D2-HSMCP` is an MCP server that gives an AI assistant the same control over Left 4 Dead 2
content that a mapper has in Hammer — plus the checks Hammer never had. The agent reads and
writes `.vmf` and `.bsp` files, edits geometry and entities, validates against the game's own
FGD, compiles, generates nav, writes mission files and packs addons.

A companion **skill** supplies the L4D2 knowledge: safe-room rules, chapter transitions,
finale stages, nav attributes, asset conventions and troubleshooting. The server provides
the operations; the skill provides the judgement.

It is designed for agents but useful to people: every operation is a checked tool with a
clear description, and anything that writes asks for confirmation.

## What you can do

- **Read and inspect** maps without loading a gigabyte into memory: BSP headers, entities,
  geometry, nav, lighting, pakfile and dependencies.
- **Build and edit** brushes, entities, I/O, displacements, overlays, instances, weather,
  fog, 3D-skybox cameras, visgroups, hints and portals.
- **Validate before compiling**: sealed-map checks, solid validation, FGD lint, clearance,
  sightlines, room detection and dimensioned plans.
- **Compile** with the stock L4D2 toolchain or Hammer++/Tools++, and read the log as
  findings rather than noise.
- **Build campaigns**: mission files, numbered chapters, safe rooms, chapter transitions,
  custom finales, nav generation and addon VPKs.
- **Script** VScripts and attach them with `logic_script`.
- **Work with game content**: textures, models and their real dimensions, particles, sounds,
  VTF conversion and cubemap utilities.
- **Test** a map by launching it and watching the console for a real marker.
- **Build cubemaps** with the engine's own `-buildcubemaps` launch mode, and pack them into
  a copy of the map.
- **Compile models** from QC/SMD sources with the game's `studiomdl`, open a model in HLMV,
  and capture the window as an image the agent can see.
- **Capture any GUI window** — HLMV or the running game — as a real image block, and ask
  `run_map_test` for a screenshot of the running map.
- **Build a 3D skybox copy** at 1/16 scale with `write_skybox_copy`.
- **Paste a saved prefab** with `insert_prefab`.
- **Export** a `.vmf` to Valve's `.map` format.

## Requirements

### Required

| Component | Why |
|---|---|
| **Windows 10/11 x64** | the game's compilers, `vpk.exe` and the toolkit are Windows binaries |
| **Left 4 Dead 2** (Steam app `550`) | carries the compilers, `vpk.exe`, the FGD and the game content the tools read |
| **Left 4 Dead 2 Authoring Tools** (Steam app `563`) | Hammer, HLMV, Faceposer, Workshop manager and example content |
| **Node.js 20+** | the MCP server (tested on Node 24) |
| **pnpm 10+** | install and build |
| **Python 3.10+** | the `srctools` sidecar, used for FGD, VPK and some VMF parsing |
| **An MCP-capable agent** | OpenCode, Claude Code or any MCP client with tool use |
| **Git** and ~20 GB free disk | clone, build and the game install |

### Recommended

- [**Hammer++ for L4D2**](https://ficool2.github.io/HammerPlusPlus-Website/) — the editor
  this toolkit is modelled on.
- [**Tools++**](https://ficool2.github.io/HammerPlusPlus-Website/tools.html) — faster
  `vbsp++`/`vvis++`/`vrad++`/`bspzip++`; the compiler prefers this chain and falls back to
  stock, naming the chain that ran.
- **VTFEdit++ / VTFCmd** — textures, cubemaps and skyboxes.
- **Steam running and logged in** — needed for nav generation and in-game tests.

## Quick start

```powershell
git clone https://github.com/NexPG/L4D2-HSMCP
cd L4D2-HSMCP
pnpm install
pnpm build
powershell -ExecutionPolicy Bypass -File sidecar/setup.ps1
node dist/index.js install
```

`install` registers the server with your MCP client and writes `.mcp.json` with local paths.
Start or reload your agent, then ask it:

```
health
```

`health` reports the game profile it found, the compilers and FGD, the sidecar, the tool
count and whether the build is stale. Missing pieces are named with their cost; it does not
throw at you.

If the game is not found automatically, copy
[`config.example.json`](config.example.json) to `.hammer-mcp/config.json` and set the paths.

## A typical campaign

```
source .vmf
   → lint and leak check          no compiler needed
   → compile                      vbsp / vvis / vrad
   → nav_generate                 the engine builds the .nav
   → mission file                 chapters, modes, images
   → addon VPK                    pack and deploy
   → run_map_test                 prove the chapter or finale loads
```

The worked rules live in [`docs/campaign/overview.md`](docs/campaign/overview.md), and the
agent skill turns them into a step-by-step workflow.

## For agent users

The repository's [`opencode.json`](opencode.json) points OpenCode at
[`skill/l4d2-hsmcp/`](skill/l4d2-hsmcp/SKILL.md). Other MCP clients can copy that directory
into their skills location. The skill is a short router: it loads only the campaign, nav,
scripting, asset or troubleshooting page the current task needs.

Tools that write to files or run local binaries are guarded: they require `confirm: true`,
or an entry in `toolAllowlist` for an unattended run. The agent sees the same permission
prompt a person would.

## Documentation

- [`docs/README.md`](docs/README.md) — the documentation index.
- [`docs/campaign/overview.md`](docs/campaign/overview.md) — missions, safe rooms,
  transitions, finales, nav and deployment.
- [`skill/l4d2-hsmcp/SKILL.md`](skill/l4d2-hsmcp/SKILL.md) — the agent workflow and its
  reference library.
- [`CHANGELOG.md`](CHANGELOG.md) — what changed in each version.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how the project is built and reviewed.

## Status

The project is in **alpha** (`0.0.x`). It is under active development, not production-ready,
and anything may change between releases. Use it, test it and expect rough edges.

## License

**GPL-3.0-only.** Copyright (C) 2026 **NexPG**.

This project is a fork of [`hammer-mcp`](https://github.com/Sycatle/hammer-mcp), made by the
original developers at **Project Society Studio** and released under the MIT licence. The
original MIT notice is kept verbatim in [`LICENSE-MIT`](LICENSE-MIT), and [`NOTICE`](NOTICE)
records the provenance, the modification date and what the GPL asks of anyone redistributing
this work.

Not affiliated with Valve Corporation. Left 4 Dead 2 and its content belong to Valve.
