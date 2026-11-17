---
name: L4D2-HSMCP
description: Build and ship Left 4 Dead 2 campaigns, maps, nav meshes, chapter transitions, finales, VScripts and addon VPKs with the L4D2-HSMCP MCP server. Use for a L4D2 map or campaign, mission file, safe room, chapter change, nav mesh, finale, VScript, addon packaging — and when a campaign is missing from the menu, a chapter will not change, bots wander, a nav is stale or a script does not load.
---

# L4D2-HSMCP

Left 4 Dead 2 content, built through the MCP server. The server does the file work; this
skill says what "correct" looks like in L4D2 and in what order to do it.

The toolkit is early: maps and campaigns are proven, VScript is proven to load, models and
wider addon formats are not built yet. Read [What is not supported](#what-is-not-supported)
before promising anything.

## Route the task first

| Task | Read |
|---|---|
| Build a campaign from nothing | `workflows/new-campaign.md` |
| Rebuild, pack and deploy | `workflows/build-and-deploy.md` |
| Check a build in game | `workflows/playtest.md` |
| Campaign missing from the menu | `troubleshooting/campaign-not-in-menu.md` |
| Chapter does not change | `troubleshooting/chapter-does-not-change.md` |
| Bots wander instead of advancing | `troubleshooting/bots-wander.md` |
| Nav may be stale | `troubleshooting/nav-stale.md` |
| Script may not load | `troubleshooting/vscript-not-loaded.md` |
| Find the right tool | `references/tools/index.md` |

## Reference map

| File | Read when |
|---|---|
| `references/campaign/mission-file.md` | writing or debugging a mission file |
| `references/campaign/safe-room-and-transition.md` | building a chapter exit |
| `references/campaign/finale.md` | building or debugging the last chapter |
| `references/campaign/custom-finale.md` | type 2 stages, `[map]_finale.nut`, the escape phase |
| `references/campaign/addon-and-deployment.md` | staging, packing, deploying |
| `references/nav/generation.md` | generating a nav mesh |
| `references/nav/attributes-and-flow.md` | marking CHECKPOINT/FINALE, or bots ignore the map |
| `references/scripting/vscript.md` | shipping a `.nut` in the add-on |
| `references/testing/console.md` | console commands, `-condebug`, nav and entity debugging |
| `references/testing/live-debugging.md` | run a map, move survivors, fire inputs, prove it from the log |
| `references/mapping/entities.md` | checking what an entity actually does in L4D2 |
| `references/mapping/editor-and-fgd.md` | Hammer++, Tools++ flags, FGD edits and what not to ship |
| `references/mapping/hammer-tabs.md` | finding textures, models, skyboxes, particles and model sizes |
| `references/mechanics/coverage.md` | what of L4D2 is covered, and what is not yet |
| `references/mechanics/weapons-and-items.md` | the spawn classes, how to place one, and the saferoom rules |
| `references/mechanics/crescendo-and-panic.md` | triggered hordes, nav Battlefield/Battlestation, testing |
| `references/compiling/toolchain.md` | compiling, or choosing stock vs Tools++ |
| `references/tools/index.md` | choosing a tool for a job |

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
   inferred.

## Invariants

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

- VScripted finale waves, and the VScript API beyond loading a script.
- Model import, materials beyond stock content, non-campaign add-on formats.
- Automated in-game play tests. The play test is manual; the console log is the evidence.
- A nav tool. Nav generation is still a project script, not an MCP tool.

If a request depends on one of these, say so plainly and do not fake the step.

## Definition of done

A campaign build is done when every line of `checklists/campaign-ready.md` is true. The short
version: sealed and lint-clean, compiles with exit 0, mission checks pass, nav fresh for every
map, VPK entry list verified, deployed under the fixed name, and a play test recorded.
