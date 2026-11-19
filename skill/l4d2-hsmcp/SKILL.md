---
name: L4D2-HSMCP
description: Build and ship Left 4 Dead 2 campaigns, maps, nav meshes, chapter transitions, finales, VScripts, models, textures and addon VPKs with the L4D2-HSMCP MCP server. Use for a L4D2 map or campaign, mission file, safe room, chapter change, nav mesh, finale, VScript, addon packaging — and when a campaign is missing from the menu, a chapter will not change, bots wander, a nav is stale or a script does not load.
---

# L4D2-HSMCP

Left 4 Dead 2 content, built through the MCP server. The server does the file work; this
skill says what "correct" looks like in L4D2 and in what order to do it.

The toolkit is early, but maps, campaigns, finales, nav, model source authoring and
compilation, native VTF writing and add-on VPKs are proven. Two-team rounds and a few visual
checks still need a person or a second client. Read
[What is not supported](#what-is-not-supported) before promising the rest.

**Primitives first.** Use the general operations (`write_vmf_solid` with convex faces,
`edit_vmf`, `set_worldspawn`, `transform_solids`, `clone_solids`, `write_vscript`); the
named helpers are shortcuts, not the limit of what is possible. If a helper cannot express
what you need, the primitive can. See `references/tools/primitives.md`.

## Route the task first

| Task | Read |
|---|---|
| Turn a user's campaign wish into a spec and build | `workflows/from-a-wish.md` |
| Build a campaign from nothing | `workflows/new-campaign.md` |
| Rebuild, pack and deploy | `workflows/build-and-deploy.md` |
| Check a build in game | `workflows/playtest.md` |
| Make a prop/model without a DCC | `workflows/make-a-prop.md` |
| Campaign missing from the menu | `troubleshooting/campaign-not-in-menu.md` |
| Chapter does not change | `troubleshooting/chapter-does-not-change.md` |
| Bots wander instead of advancing | `troubleshooting/bots-wander.md` |
| Nav may be stale | `troubleshooting/nav-stale.md` |
| Script may not load | `troubleshooting/vscript-not-loaded.md` |
| Prefab, texture or clip result is wrong | `troubleshooting/mapping-edits.md` |
| Find the right tool | `references/tools/index.md` |

## Reference map

| File | Read when |
|---|---|
| `workflows/from-a-wish.md` | the user describes a campaign instead of naming files |
| `workflows/new-campaign.md` | the spec exists and the first .vmf is about to be written |
| `references/campaign/mission-file.md` | writing or debugging a mission file |
| `references/campaign/safe-room-and-transition.md` | building a chapter exit |
| `references/campaign/finale.md` | building or debugging the last chapter |
| `references/campaign/custom-finale.md` | type 2 stages, `[map]_finale.nut`, the escape phase |
| `references/campaign/addon-and-deployment.md` | staging, packing, deploying |
| `references/nav/generation.md` | generating a nav mesh |
| `references/nav/attributes-and-flow.md` | marking CHECKPOINT/FINALE, or bots ignore the map |
| `references/nav/editing.md` | the console command set for repairing a generated mesh |
| `references/scripting/vscript.md` | shipping a `.nut` in the add-on |
| `references/testing/console.md` | console commands, `-condebug`, nav and entity debugging |
| `references/testing/harness.md` | ordered log markers, probe scripts and the Steam-logon limit |
| `references/testing/live-debugging.md` | run a map, move survivors, fire inputs, prove it from the log |
| `references/mapping/entities.md` | checking what an entity actually does in L4D2 |
| `references/mapping/level-design.md` | turning a theme and a wish into rooms, cover and sightlines |
| `references/mapping/editor-and-fgd.md` | Hammer++, Tools++ flags, FGD edits and what not to ship |
| `references/mapping/model-authoring.md` | QC/SMD/DMX, `studiomdl`, physics, viewmodels and player models |
| `references/mapping/gltf-import.md` | glTF/GLB → SMD: the axis, bind-pose and UV conventions, and what is not exported |
| `references/mapping/fbx-import.md` | FBX (binary 7.x or ASCII) -> SMD: axes, units, bind pose from clusters, and what is not exported |
| `references/mapping/brush-to-model.md` | a VMF brush → SMD/QC, with VMF UVs and a brush collision model |
| `references/mapping/particles.md` | reading and writing `.pcf` systems, children, operators and materials |
| `references/assets/sound.md` | WAV format L4D2 decodes, soundscript paths, and the sound tools |
| `references/mapping/hammerpp.md` | the Hammer++ build, settings, Tools++ flags and the editor-only boundary |
| `docs/reference/hammerpp-complete-reference.md` | the full Hammer++ feature inventory and feature → tool matrix |
| `docs/reference/l4d2-complete-reference.md` | L4D2 mechanics, Director defaults, finale stages, infected/weapon stats, entities, console, limits |
| `references/mapping/hammer-tabs.md` | finding textures, models, skyboxes, particles and model sizes |
| `references/mapping/hammer-coverage.md` | every Hammer++ feature, its tool, and what is still a gap |
| `references/mapping/3d-skybox.md` | sky_camera, scale 16, and the scaled-copy workflow |
| `references/mechanics/coverage.md` | what of L4D2 is covered, and what is not yet |
| `references/mechanics/weapons-and-items.md` | the spawn classes, how to place one, and the saferoom rules |
| `references/mechanics/crescendo-and-panic.md` | triggered hordes, nav Battlefield/Battlestation, testing |
| `references/mechanics/tanks-and-witches.md` | `z_spawn`, cheats, the log lines that prove a tank or witch exists |
| `references/mechanics/survival.md` | mission mode, `+mp_gamemode survival`, HUD evidence |
| `references/mechanics/scavenge.md` | gas-can spawns, `+mp_gamemode scavenge`, HUD evidence |
| `references/mechanics/versus.md` | mission mode, `+mp_gamemode versus`, `anv_versus.nut` evidence |
| `references/mechanics/weather.md` | `func_precipitation`, `env_fog_controller`, and what a static check can prove |
| `references/compiling/toolchain.md` | compiling, or choosing stock vs Tools++ |
| `references/tools/index.md` | choosing a tool for a job |
| `references/tools/primitives.md` | which tool is the general operation, and which is only a shortcut |
| `troubleshooting/cubemaps-do-not-build.md` | `buildcubemaps` writes nothing, or says a path is not writable |
| `troubleshooting/mapping-edits.md` | a prefab, texture skew, clip, overlay or moved brush is not where it should be |
| `troubleshooting/hlmv-screenshot.md` | HLMV shows an error, a black viewport, or the screenshot is blank |
| `references/testing/game-environment-cleanup.md` | after any run that wrote into the game install |
| `references/testing/multi-client.md` | two clients on one PC, the Steam-login limit, and what a single client can prove |

## The pipeline

1. **State of the install.** `health`. It reports the game profile, compilers, FGD, sidecar
   and tool count. Missing pieces are named with their cost; do not guess around them.
2. **Source map.** Create or open a `.vmf`, build the sealed shell, then lint and check for
   leaks *before* a compile that can take minutes.
3. **Compile.** `run_compile` with the stock chain or Tools++, and read the per-stage
   findings. A non-zero exit is a stop, not a warning.
4. **Nav.** The engine generates it, not the toolkit: `references/nav/generation.md`.
   A `.nav` without CHECKPOINT/FINALE and a flow path is not a playable mesh.
5. **Mission file.** `references/campaign/mission-file.md`: naming rules that decide whether
   the campaign appears at all.
6. **Pack and deploy.** `references/campaign/addon-and-deployment.md`: one archive in the
   game, fixed name, previous ones removed.
7. **Play test.** `workflows/playtest.md`. What counts as passed is written there, not
   inferred. The one-call form is `run_campaign_gate`: mission → lint → compile → nav →
   props → finale → `nav_trouble_report` → map test with the exact BSP/nav pair.

## Invariants

- **Licence first.** Any borrowed code, FGD, model or data file must have a licence
  compatible with GPL-3.0-only, keep its copyright/permission notice, and be recorded in
  `third_party/NOTICES.md`. No licence means no copied code; use it as a reference and
  implement our own.
- **L4D2 only.** Do not apply GMod, CS:S or HL2 conventions. Every game-specific fact here
  was read from L4D2's own files, its FGD or its engine.
- **A `.bsp` is never read whole.** Use the readers; real maps are gigabytes.
- **Lint before compile.** `read_vmf_lint` and `read_vmf_leak` cost seconds; a compile costs
  minutes.
- **A chapter exit is a safe room, not a trigger.** `info_changelevel` + checkpoint door +
  CHECKPOINT nav (+ PLAYER_START on the first map) + landmark pair. All four.
- **Bots follow flow, not the player.** They path to the goal area. No goal area, no
  following.
- **Campaigns are local.** Never commit `campaigns/`; it is ignored on purpose.
- **One campaign in the game.** Deploy the latest under a fixed name and remove older
  archives.
- **No number without a source.** A limit, size or flag comes from a tool result, a dump or
  the game's files, not from memory.
- **Runtime claims need runtime evidence.** `-condebug` console log, nav dump, compile log.
  If nothing was verified, say so.

## Gotchas

- `info_changelevel` does not spawn without `prop_door_rotating_checkpoint` in the safe room.
  A brush alone is inert.
- `nav_generate` needs **`sv_cheats 1` and `nav_edit 1`**, and a **loose** map: a `.nav`
  cannot be written beside a map inside a VPK. Without `nav_edit` it does nothing, silently.
- `read_nav` compares `savedBspSize` with the `.bsp`: after any geometry change the mesh is
  stale until regenerated.
- Mission file base name must equal the VPK name, and `Name` is alphanumeric only. This is
  the difference between "add-on enabled" and "campaign in the list".
- `trigger_finale` type 0 (Standard) is used by no Valve campaign. A completable finale is
  type 2 plus `FinaleEscapeFinished` and an outtro.
- `addOutput` values have five comma-separated fields: `target,input,param,delay,timesToFire`.
  Four fields are rejected by the sidecar.
- VScript in an add-on lives at `scripts/vscripts/<name>.nut` and is attached with
  `logic_script` keyvalue `vscripts = <name>`, no extension.
- `-condebug` plus `printl` turns "does the engine load this?" into a one-command check.

## What is not supported

- **Fully automated two-team rounds.** One Steam account cannot authenticate two clients
  (`No Steam logon`), and no dedicated server is installed here. `run_map_test` proves map
  load, mode script and HUD; a real Versus/Scavenge round still needs a server or a second
  account. See `references/testing/multi-client.md`.
- **A full Survival wave.** Setup and HUD are verified; the round still starts from the
  map's own `trigger_finale` or `ForcePanicEvent`, which the map author must place.
- **HLMV's 3D canvas in a headless session.** The editor launches and its UI captures; the
  viewport needs an interactive desktop. `preview_model` is the fallback: it builds a sealed
  dev-textured room, compiles it, generates a nav and captures the real game view, and it
  uses the same blank-viewport measurement to decide whether HLMV is worth trying first.
- **A player-driven finale start in `+map`.** `ForceFinaleStart` without a spawned player
  is not the player-facing path; the last proof is the campaign menu or a reachable +use
  button in a live round.
- **A general VScript API wrapper.** Scripts are authored and attached, but what they call
  at runtime is the map's own logic.
- **Model import from DCC formats.** glTF/GLB and FBX (binary 7.x and ASCII) are read
  natively, and QC/SMD compilation with `studiomdl` is covered. FBX animations are exported
  as one SMD per stack with `$sequence` lines; blend shapes are counted, not exported — SMD
  has no morph target, so flexes need the glTF/DMX route.
- **3D-skybox composition.** `write_sky_camera` places the camera and `write_skybox_copy`
  makes the scaled copy; choosing and sealing what to copy is design work.

If a request depends on one of these, say so plainly and do not fake the step.

## Definition of done

A campaign build is done when every line of `checklists/campaign-ready.md` is true. The short
version: sealed and lint-clean, compiles with exit 0, mission checks pass, nav fresh for every
map, VPK entry list verified, deployed under the fixed name, and a play test recorded.
