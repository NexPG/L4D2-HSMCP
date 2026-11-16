# L4D2-HSMCP

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.0.10--alpha-orange.svg)](CHANGELOG.md)
[![CI](https://github.com/NexPG/L4D2-HSMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/NexPG/L4D2-HSMCP/actions/workflows/ci.yml)

**An agent toolkit for building Left 4 Dead 2 content.** Maps, campaigns, VScripts, models
and addons — made through an MCP server and a skill, not by hand-editing files.

> **Early development — 0.0.10-alpha.** The map and campaign pipeline works end to end on a
> real install: a two-chapter campaign is built, compiled, given nav meshes, packed and
> loaded by the game. VScript, model and wider addon support are the next stages.
> Windows only, Left 4 Dead 2 only.

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

## What works today

| Area | State |
|---|---|
| BSP 21 reading, L4D2 lump layout | working; counts match `vbspinfo` exactly |
| VMF read, lint against `left4dead2.fgd` | working |
| VMF edit, brush building, clipping, hollowing, vertices | working |
| Compile: stock L4D2 and Tools++ | working, with per-stage findings |
| Campaign files: read, write, check | working; the game's own campaigns can be checked in place |
| VPK addon packing and deployment | working |
| Nav mesh generation | working via the campaign script (engine-side) |
| Two-chapter test campaign | built, compiled, packed, deployed |
| In-game play test of that campaign | next |
| VScript editing | planned |
| Model and wider addon tooling | planned |

The suite currently runs **1023 tests** on Windows with the game installed (33 skipped,
none failed).

## Quick start

Requirements:

- Windows
- Node.js 20+
- Python 3.10+ (for the srctools sidecar)
- Left 4 Dead 2 (the compilers and FGD ship with the client, not with `srcds`)
- optional: [Tools++](https://ficool2.github.io/HammerPlusPlus-Website/tools.html) for the
  faster compiler chain

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
says what and what that costs — it does not throw.

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
practical rules are in [`docs/campaigns.md`](docs/campaigns.md).

## Tools

75 tools, grouped by what they answer:

- **Inspect** — `health`, `read_source_games`, `read_bsp_info`, `read_bsp_entities`,
  `read_map_geometry`, `read_map_report`, `read_vmf`, `read_vmf_lint`.
- **Measure** — extents, sightlines, lightmap budgets, visleaf stats, props, pakfile.
- **Ask offline** — `read_vmf_leak`, `read_vmf_rooms`, `measure_vmf_clearance`,
  `read_vmf_visibility`, `read_vmf_trace`, `render_vmf_view`, `render_vmf_plan`.
- **Build and edit** — solids, fittings, clips, hollows, vertices, faces, lights, hints,
  portals, visgroups, displacements.
- **Compile and ship** — `run_compile`, `read_compile_log`, `read_leak`,
  `read_map_dependencies`, `run_pack`, `run_vpk_pack`.
- **Campaigns** — `read_campaign`, `write_campaign`, `check_campaign`.

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
test/             the oracle-heavy suite
docs/             campaign guide and inherited measurements
```

## Documentation

- [`CHANGELOG.md`](CHANGELOG.md) — what each version changed.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the three rules this project works by.
- [`docs/campaigns.md`](docs/campaigns.md) — mission files, VPK layout, nav, deployment.
- [`docs/architecture.md`](docs/architecture.md) — the inherited design notes on splicing,
  offset reads and shared plumbing.
- [`docs/measuring.md`](docs/measuring.md), [`docs/spatial.md`](docs/spatial.md),
  [`docs/compiling.md`](docs/compiling.md) — dated measurements from the project's history.

## Status

This is an early, actively changing project. The map and campaign path is proven on a real
Left 4 Dead 2 install; everything beyond it — VScript, models, broader addon formats,
automated in-game verification, the agent skill itself — is being built. Interfaces may
change between `0.0.x` releases.

## License

**GPL-3.0-only.** Copyright (C) 2026 **NexPG**.

This project is a fork of [`hammer-mcp`](https://github.com/Sycatle/hammer-mcp) by
**Sycatle**, which is MIT licensed. The original MIT notice is kept verbatim in
[`LICENSE-MIT`](LICENSE-MIT), and [`NOTICE`](NOTICE) records the provenance, the modification
date and what the GPL asks of anyone redistributing this work.

Not affiliated with Valve Corporation. Left 4 Dead 2 and its content belong to Valve.
