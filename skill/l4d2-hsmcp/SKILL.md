---
name: l4d2-hsmcp
description: Builds and ships Left 4 Dead 2 campaigns, maps, nav meshes, chapter transitions, finales, VScripts, models, textures and addon VPKs with the L4D2-HSMCP MCP server. Use for a L4D2 map or campaign, mission file, safe room, chapter change, nav mesh, finale, VScript, model, material, addon packaging or a compile — and when a campaign is missing from the menu, a chapter will not change, bots wander, a nav is stale or a script does not load.
license: GPL-3.0-only
compatibility: Windows 10/11; Left 4 Dead 2 with its bin/ compilers, FGD and vpk.exe; Node 22+ and pnpm; Python sidecar with srctools; MCP server l4d2-hsmcp.
---

# L4D2-HSMCP

Left 4 Dead 2 content, built through the MCP server. The server does the file work; this
skill says what "correct" looks like in L4D2 and in what order to do it.

**This skill is the product.** Every number, limit and pitfall here was measured on a real
L4D2 install, not copied from a forum. The research exists so that an agent which has never
seen the game can still do the right thing the first time: recognise an error by its symptom,
know why it happens, avoid it, and say "not proven" instead of guessing. A page that does not
let you do that is not finished; a finding that stayed in a log is lost.

**A tool factory, not a parts catalogue.** We build instruments for making parts, not a fixed
box of parts. The agent must be able to make something we never anticipated: a class with no
named builder, a shape no preset covers, a script no template describes. Named builders are
shortcuts over primitives: `write_brush_entity` and `write_point_entity` take any classname,
`write_vmf_solid` takes arbitrary convex faces, `edit_vmf` reaches every key and output, and
`write_vscript` is the Squirrel source. If a helper cannot express what you need, the primitive
can; if a capability exists only as a preset, the primitive is missing. `CONTRIBUTING.md`
section 4 and `references/tools/primitives.md` carry the rule.

The toolkit is early, but maps, campaigns, finales, nav, model source authoring and
compilation, native VTF writing and add-on VPKs are proven. Two-team rounds and a few visual
checks still need a person or a second client. Read
[What is not supported](#what-is-not-supported) before promising the rest.

**A new addon or campaign is one workspace and two passes.** `write_addon_workspace(name)`
creates it; the layout is in [`workflows/addon-workspace.md`](workflows/addon-workspace.md).
Pass 1 writes `plan/plan.json` and renders the five drawings (site, terrain,
circulation, building/height schedule, floor plans/sections) plus plan/DESIGN.md: the route,
rooms, floors, beats, events, finale, palette, variability and budget, using read-only tools.
It writes no `.vmf` and stops for approval. Pass 2 builds that plan; it chooses exact assets
within the palette but may not silently change the route, a room's purpose or a beat. See
`workflows/addon-workspace.md`, `workflows/design-a-map.md`,
`references/planning/five-drawings.md`, `workflows/new-campaign.md`,
`workflows/model-skin.md` and
`workflows/from-a-wish.md`.

**Tool names are this server's.** A bare `write_vmf` means the `l4d2-hsmcp` tool:
`l4d2-hsmcp:write_vmf` in a client that prefixes server and tool, or
`tools["l4d2-hsmcp"].write_vmf` through OpenCode's Code Mode. A tool from another server keeps
its own prefix; never assume a bare name belongs to this catalogue.

**Runtime truth is a primitive too.** `write_entity_probe` + `run_map_test` with
`markerOrder: "any"` proves a written entity exists in the running map; a compiled BSP alone
does not. `write_class_probe` counts what the Director spawned, and `write_nav_probe` checks
attributes the region applied to the live mesh. Use them for spawners, borders and anything
invisible in a screenshot.

**Author identity.** `addonauthor` in `addoninfo.txt` and `Author` in a mission file are
the person making the content, not the toolkit author. There is no default and no prepared
name: before the first addon or campaign, call `read_addon_author`. If it returns `null`, ask
the user once — “What name should appear as the add-on author?” — and store the answer with
`set_addon_author`. Use that name in every `addonauthor`/`Author` field. Do not take a name
from documentation, examples, the repository or a previous project; the only valid value is
the one the user gave. If the user asks to change it later, call `set_addon_author` again;
future writes use the new name, and files already written keep the old one.

**Addon provenance.** Every addon or campaign packed with `run_vpk_pack` gets an
`addonAICredit` entry in `addoninfo.txt` by default:

```
"addonAICredit" "Created by AI via L4D2-HSMCP <version>"
```

The version is read from the toolkit's `package.json`; do not hard-code an older one. Read
it with `health` or from the package itself, and use the same value in files you write by
hand. There is deliberately no fixed number in this skill: a number here would drift.

**Foundations are required, not copied.** Some Workshop add-ons are libraries, frameworks or
shared asset packs that other add-ons build on. A dependent add-on lists the foundation as a
required item on the Workshop page and keeps its scripts and assets out of its own VPK; a
second copy is a conflict. If a script needs the library, check its global at load and tell the
player what to install when it is missing. Details:
[`references/campaign/addon-and-deployment.md`](references/campaign/addon-and-deployment.md)
and [`references/scripting/addons.md`](references/scripting/addons.md).

## The mistakes that waste a run

Every research result on this project is converted into **prevention**, not into a story.
A page opens with what to do so the failure cannot happen, then the symptom, then the check,
then the fix. If a mistake is not listed here or on the page it links to, it will be made
again.

| What you will see | Do this and it cannot happen | Read |
|---|---|---|
| Loading bar never finishes; `Host_NewGame` for the same map repeats | Never probe on a map with a live `info_changelevel` + checkpoint warp. Strip the exit (`edit_vmf` remove `to_m2`, `selftest_start`, `selftest_warp`) or ship the whole campaign in one VPK | `troubleshooting/endless-loading.md` |
| A renamed or edited stock `.bsp` hangs at load | Probe only on a VMF you compiled under its own name | `troubleshooting/endless-loading.md` |
| `Cannot execute "z_spawn ...", no player` | A direct `-insecure` launch attaches no local player. Use `run_map_test` `via: "steam"` for anything that needs a player | `references/testing/harness.md` |
| An add-on says its required Workshop library is missing although the item is installed | A direct `-insecure` run mounts only `left4dead2/addons`, not `addons/workshop`; copy the library VPK there for the test and remove it after | `references/testing/harness.md` |
| `workshop_build_item` or `SetItemContent` says `Invalid Parameter` for an L4D2 VPK | Upload with `publish_workshop_item` / `update_workshop_item`; L4D2's UGC content path is disabled, and SteamCMD uses the same call | `troubleshooting/workshop-upload.md` |
| A fork was given a unique script path and no longer conflicts with the original | Keep the original's script path (for Dynamic Light, `scripts/vscripts/dynamic_light.nut`); a fork is a replacement, not a sibling. Rename only when the user explicitly asks for coexistence | `references/scripting/addons.md` |
| A fork renamed the class, globals, commands, settings or entity names | Change only the behaviour the user asked for; keep the original's identifiers, settings path and script path. A rename breaks existing settings and chat commands and is not part of the fix | `references/scripting/addons.md` |
| Two add-ons do the same thing but the Add-ons menu stays silent | Run `check_addon_conflicts`; it reports duplicate paths, plugin classes, globals and `ems/` settings, not only the game's file-path highlight | `references/tools/index.md` |
| `commands` / `ent_fire` in a run do nothing | `cfg/listenserver.cfg` runs before the map's entities exist. Use `scriptsDir` with `EntFire(..., delay)` or `schedule` | `references/testing/harness.md` |
| `NAV ERRORS - Map is unplayable!` | Nav is made from the final `.bsp`; regenerate after the last compile and pass it to `run_map_test` | `references/nav/generation.md` |
| VScript `expression expected` at line 1 | Write `.nut` files without a BOM | `references/scripting/vscript.md` |
| Campaign vanished from the menu after a killed run | A run hid an addon as `*.vpk.off`. `check_game_state` restores it | `references/testing/game-environment-cleanup.md` |
| HUD says `NAV ERRORS — Map is unplayable!` while the map plays | The chapter has a CHECKPOINT nav attribute but no checkpoint door/changelevel, or a finale map with no `trigger_finale`. Give it a real end and regenerate nav | `troubleshooting/nav-unplayable.md` |
| A player is dropped to the main menu when a test starts | Never launch while `left4dead2.exe` runs. The tools refuse unless you pass `replaceRunningGame: true`; they stop only the pid they started | `references/testing/harness.md` |
| Nothing spawns, `no player`, bots idle | A fixture room has no flow. Use a playable chapter with player start, nav and Director | `troubleshooting/endless-loading.md` |
| Every bench, car and cart is a ghost; `read_model_info` says `.phy` exists | Write `solid 6` explicitly on `prop_static`; an omitted key compiles to solidity 0. `write_prop` does it, the gate checks `read_static_props.solidity` | `troubleshooting/props-no-collision.md` |
| A breakable wall does not break, or a wall prop is not breakable | Use `write_breakable` for a `func_breakable` brush; `prop_wall_breakable`/`prop_car_glass` go through `write_point_entity`, not `prop_static` | `references/mapping/entity-families.md` |
| A prop faces the wall or is 90/180° off | Use `write_prop` `facing` + `modelForward` from the measured table; look at the model with `preview_model` (`view` for the other sides) | `references/mapping/model-facing.md` |
| Official servers work, a friend's local/listen server does not | Check the game's `Network: IP` line; use a Steam lobby, not `connect` to a NAT'd host, and remove `-insecure` | `troubleshooting/local-server-connection.md` |
| A prop is in Hammer but missing in game; the compile log says `Error! ... Deleted.` | A `prop_static` needs a model compiled with `$staticprop`; `write_prop` `collision: "dynamic"`/`"physics"` or a `$staticprop` model avoids the deletion | `troubleshooting/prop-deleted.md` |
| Nav generation finishes in 0.1 s and the dump has 0 areas | Use `run_nav_generate(via: "steam")` when the origin is not open floor; a direct launch marks the world origin before the player spawns. Keep the spawn on a flat brush ring; a 2048 1:12 patch gets 1,158 areas through Steam. `func_nav_blocker` only keeps bots off scenery at load, it does not change the generated mesh | `troubleshooting/terrain-nav-empty.md` |
| A bot will not climb the ladder the player can use | Compile with Tools++ so vbsp emits `func_simpleladder`; span the brush to the upper floor and keep its centre line off the world origin; check `read_nav_ladders` | `references/mapping/entity-families.md` |
| Two copies of one prefab fight over the same `screen01`/`door_button` names | Paste with `insert_prefab` `namePrefix`; check `duplicates`/`unresolvedOutputs` in the result, not by eye | `references/mapping/prefabs-and-instances.md` |
| An ammo cabinet/helicopter button is inert | Place it with `place_entity_group`; the prefab needs its `vscripts` (`usetargets/...`) copied, not only the geometry | `references/mapping/prefabs-and-instances.md` |
| vvis takes minutes and the PVS is huge; every trim, pillar and window frame is structural | Move visual-only brushes into `func_detail`, then compile and `read_leak` because detail does not seal; use `func_areaportal`/`func_occluder` only after the hull is closed | `references/mapping/detail-and-vis.md` |

## Route the task first

The same routes are MCP prompts: `l4d2_task` for a general request,
`l4d2_hud_override`, `l4d2_material_edit`, `l4d2_compiled_light` and
`l4d2_editor_sequence`. They point at the resource page and carry the caller's map, screen or
material; the instructions live in one place.

| Task | Read |
|---|---|
| Create the addon workspace | `workflows/addon-workspace.md` |
| Turn a user's campaign wish into a design (pass 1) | `workflows/design-a-map.md` |
| Build from an approved design (pass 2) | `workflows/new-campaign.md` |
| The two passes in one view | `workflows/from-a-wish.md` |
| Rebuild, pack and deploy | `workflows/build-and-deploy.md` |
| Publish, update or delete a Workshop item | `workflows/publish-to-workshop.md` |
| Workshop upload says `Invalid Parameter` | `troubleshooting/workshop-upload.md` |
| Drive the main menu or the Add-ons screen | `references/testing/harness.md` |
| Check a build in game | `workflows/playtest.md` |
| Make a prop/model without a DCC | `workflows/make-a-prop.md` |
| Re-skin or move a HUD screen | `workflows/hud-override.md` |
| Change a material or resolve a patch | `workflows/material-edit.md` |
| Fix baked lighting without vrad | `workflows/compiled-light-fix.md` |
| Build exactly what the editor's Run Map would | `workflows/editor-sequence.md` |
| Campaign missing from the menu | `troubleshooting/campaign-not-in-menu.md` |
| Chapter does not change | `troubleshooting/chapter-does-not-change.md` |
| Loading bar never finishes | `troubleshooting/endless-loading.md` |
| Bots wander instead of advancing | `troubleshooting/bots-wander.md` |
| Nav may be stale | `troubleshooting/nav-stale.md` |
| Script may not load | `troubleshooting/vscript-not-loaded.md` |
| Prefab, texture or clip result is wrong | `troubleshooting/mapping-edits.md` |
| Check a door's size, hinge or swing | `references/mapping/doors.md` |
| Mark CHECKPOINT/FINALE, or bots ignore the map | `references/nav/attributes-and-flow.md` |
| Find a stock entity class | `references/mechanics/entity-coverage.md` |
| Browse installed models, materials or textures | `references/assets/models.md` |
| Check an engine limit (budget, area, rope, decal) | `references/mapping/engine-limits.md` |
| Decompile or inspect a compiled model | `references/mapping/model-decompile.md` |
| Find the right tool | `references/tools/index.md` |

If the table has no row for the request, use one of the four indexes before guessing:

- **Tools by job:** [`references/tools/index.md`](references/tools/index.md), 326 tools
  grouped by job; every tool's own description is the argument reference.
- **Symptom or error:** the mistakes table above, then `troubleshooting/` and the
  `troubleshooting/` row in the reference map.
- **A measured limit or what is covered:** `references/mapping/engine-limits.md` and
  `references/mechanics/coverage.md`.
- **An entity class or stock content:** `references/mechanics/entity-coverage.md` and
  `references/assets/models.md`.

Every page is linked from the reference map below. If a term is still not found, search the
skill directory and the tool catalogue, then record the gap in the workspace error log. Do not
invent a workflow from memory.

## Reference map

| File | Read when |
|---|---|
| `workflows/addon-workspace.md` | one workspace per addon: plan, templates, logs, src, addon, dist, evidence |
| `workflows/design-a-map.md` | pass 1: the design file, route, rooms, floors, beats, palette, variability |
| `references/planning/five-drawings.md` | the five drawings, the plan JSON, the checks and why SVG |
| `references/planning/plan-survey.md` | surveying a stock `.bsp`/`.nav` into an imported plan, and what it cannot recover |
| `references/planning/route-skeleton.md` | first layer: districts, route nodes, pacing, landmarks, gates, the research and the checks |
| `references/planning/pipeline-research.md` | mission graph, space graph and floor-plan graph; what the research says |
| `workflows/new-campaign.md` | pass 2: the build pipeline from the approved design |
| `workflows/model-skin.md` | texture-only model skin: photo -> landmarks -> projection -> bake -> VTF |
| `references/models/photo-texture.md` | the tools and the professional photo-to-texture pipeline |
| `references/models/photo-texture-toolchain.md` | which external tools and optional Python packages the user needs, and which they do not |
| `workflows/from-a-wish.md` | the two passes in one view |
| `workflows/publish-to-workshop.md` | publish, verify, update or delete a Workshop item; the legacy content path and app id 550 |
| `workflows/make-a-prop.md` | a model or prop from glTF/FBX or a brush, through StudioMDL |
| `workflows/hud-override.md` | reading a stock `.res`, shifting controls and writing an add-on copy |
| `workflows/material-edit.md` | changing one VMT value, checking a patch include and packing a reskin |
| `workflows/compiled-light-fix.md` | patching one face's baked LDR lightmap without recompiling |
| `workflows/editor-sequence.md` | running the editor's own Run Map steps, and when not to |
| `references/campaign/mission-file.md` | writing or debugging a mission file |
| `references/campaign/safe-room-and-transition.md` | building a chapter exit |
| `checklists/map-ready.md` | the per-map checklist: skeleton, goals, safe room, finale, world, gate |
| `references/campaign/finale.md` | building or debugging the last chapter |
| `references/campaign/custom-finale.md` | type 2 stages, `[map]_finale.nut`, the escape phase |
| `references/campaign/addon-and-deployment.md` | staging, packing, deploying, and foundation add-ons as Workshop required items |
| `references/nav/generation.md` | generating a nav mesh |
| `references/nav/attributes-and-flow.md` | marking CHECKPOINT/FINALE, or bots ignore the map |
| `references/nav/editing.md` | the console command set for repairing a generated mesh |
| `references/scripting/vscript.md` | shipping a `.nut`, the event contract, `read_vscript_api` and `check_vscript_contract` |
| `references/scripting/addons.md` | pure VScript addons: the three `*_addon.nut` scripts, library/plugin hosts, `ems` settings, event hooks, item control and probes |
| `references/scripting/game-events.md` | `info_game_event_proxy`'s FGD list vs the 338 VScript events, and how to read each |
| `references/testing/console.md` | console commands, `-condebug`, nav and entity debugging |
| `references/testing/harness.md` | ordered log markers, probe scripts, the Steam-logon limit, main-menu/Add-ons navigation, Workshop subscription and the console overlay |
| `references/testing/entity-probes.md` | entity, class and nav probes: marker shape, `markerOrder`, and measured limits |
| `references/testing/live-debugging.md` | run a map, move survivors, fire inputs, prove it from the log |
| `references/mapping/entities.md` | the FGD check, and where each L4D2-specific entity family is documented |
| `references/mapping/world-dressing.md` | light, postprocess, atmosphere volumes, wind, spotlights, decals, ropes, sprites/beams/lasers, checked against the FGD and vbsp |
| `references/mapping/entity-families.md` | triggers as brush volumes, movers with their origin, and point logic with connections |
| `references/mapping/level-design.md` | turning a theme and a wish into rooms, cover and sightlines |
| `references/mapping/detail-and-vis.md` | world vs `func_detail` vs `func_brush`/`func_lod`, and areaportal/occluder rules |
| `references/mapping/prefabs-and-instances.md` | the official prefab catalogue, `insert_prefab` names/validation, and instance vs prefab |
| `references/mapping/atmosphere.md` | the six atmosphere layers, multiple fog controllers, tonemaps/colour correction and wind |
| `references/mapping/variability.md` | `logic_case`/`PickRandom`, `point_template`/`env_entity_maker`, `Color`/`SetSkin` |
| `references/mapping/terrain-water-boundaries.md` | terrain patches, slope/profile, the measured nav band, water and map edges |
| `references/mapping/worldspawn-and-damage.md` | sky, music, detail material, `timeofday` and damage types |
| `references/mapping/editor-and-fgd.md` | Hammer++, Tools++ flags, FGD edits and what not to ship |
| `references/mapping/model-authoring.md` | QC/SMD/DMX, `studiomdl`, physics, viewmodels and player models |
| `references/mapping/model-decompile.md` | turning a `.mdl` back into QC/SMDs, and what autolayers, IK rules, weight lists and a recompile cannot restore |
| `references/mapping/model-facing.md` | which way a model faces, how it tilts on a slope, `write_prop` `facing`/`modelForward`, and the measured table |
| `references/mapping/doors.md` | door models and sizes, hinge origin, opening fit and swing clearance |
| `references/mapping/engine-limits.md` | the ceilings a map must fit, and where the full table and each specific rule live |
| `references/mapping/gltf-import.md` | glTF/GLB → SMD: the axis, bind-pose and UV conventions, and what is not exported |
| `references/mapping/fbx-import.md` | FBX (binary 7.x or ASCII) -> SMD: axes, units, bind pose from clusters, and what is not exported |
| `references/mapping/brush-to-model.md` | a VMF brush → SMD/QC, with VMF UVs and a brush collision model |
| `references/mapping/particles.md` | reading and writing `.pcf` systems, children, operators and materials |
| `references/assets/sound.md` | WAV format L4D2 decodes, soundscript paths, the sound tools, and `ambient_music` |
| [`references/assets/models.md`](references/assets/models.md) | browse the installed models/materials, confirmed stock paths, and what a name does not prove |
| `references/mapping/hammerpp.md` | the Hammer++ build, settings, Tools++ flags and the editor-only boundary |
| `docs/reference/hammerpp-complete-reference.md` | the full Hammer++ feature inventory and feature → tool matrix |
| `docs/reference/l4d2-complete-reference.md` | L4D2 mechanics, Director defaults, finale stages, infected/weapon stats, entities, console, limits |
| `docs/reference/l4d2-campaign-authoring.md` | the ten-guide synthesis: map sequence, safe-room contract, boundaries, finale shape |
| `references/mapping/hammer-tabs.md` | finding textures, models, skyboxes, particles and model sizes |
| `references/mapping/hammer-coverage.md` | every Hammer++ feature, its tool, and what is still a gap |
| `references/mapping/3d-skybox.md` | `build_skybox`, scale 16, and the copy/room/camera workflow |
| `references/mechanics/coverage.md` | what of L4D2 is covered, and what is not yet |
| `references/mechanics/campaign-wiring.md` | safe room, landmark pair, changelevel, finale, spawn areas, item density, and the cross-map check |
| `references/mechanics/weapons-and-items.md` | the spawn classes, how to place one, and the safe-room rules |
| `references/mechanics/crescendo-and-panic.md` | triggered hordes, nav Battlefield/Battlestation, testing |
| `references/mechanics/tanks-and-witches.md` | `z_spawn`, cheats, the log lines that prove a tank or witch exists |
| `references/mechanics/survival.md` | mission mode, `run_map_test mode: "survival"`, HUD evidence |
| `references/mechanics/scavenge.md` | gas-can spawns, `run_map_test mode: "scavenge"`, HUD evidence |
| `references/mechanics/versus.md` | mission mode, `run_map_test mode: "versus"`, `anv_versus.nut` evidence |
| `references/mechanics/mutations.md` | `modes/*.txt` + `MutationOptions`, validation, VPK, runtime proof |
| `references/mechanics/weather.md` | `func_precipitation`, `env_fog_controller`, and what a static check can prove |
| `references/mechanics/ai-and-nav-content.md` | rescue closets, `info_remarkable`, nav blockers and hiding spots |
| `references/mechanics/entity-coverage.md` | the 219-class official inventory by family: covered, partial, documented, none |
| `references/compiling/toolchain.md` | compiling, or choosing stock vs Tools++ |
| `references/tools/index.md` | choosing a tool for a job |
| `references/tools/primitives.md` | which tool is the general operation, and which is only a shortcut |
| `checklists/design-ready.md` | the pass-1 gate: route, rooms, beats, palette, acceptance |
| `checklists/campaign-ready.md` | the final gate list before calling a campaign done |
| `troubleshooting/cubemaps-do-not-build.md` | `buildcubemaps` writes nothing, or says a path is not writable |
| `troubleshooting/mapping-edits.md` | a prefab, texture skew, clip, overlay or moved brush is not where it should be |
| `troubleshooting/hlmv-screenshot.md` | HLMV shows an error, a black viewport, or the screenshot is blank |
| `troubleshooting/endless-loading.md` | the loading bar never fills, or the same map restarts instead of loading |
| `troubleshooting/nav-unplayable.md` | the HUD says `NAV ERRORS — Map is unplayable!` although the map loads |
| `troubleshooting/prop-deleted.md` | a prop is in the VMF but missing in game, or vbsp logs `Error! ... Deleted.` |
| `troubleshooting/props-no-collision.md` | every prop is a ghost; the compiled `solidity` is 0 |
| `troubleshooting/local-server-connection.md` | official servers work but a friend's local/listen server does not |
| `troubleshooting/terrain-nav-empty.md` | nav generation says complete but the dump has 0 areas, or a terrain patch has no nav |
| `troubleshooting/workshop-upload.md` | upload says `Invalid Parameter`, Steam is not reachable, or an update does not change the item |
| `references/testing/game-environment-cleanup.md` | after any run that wrote into the game install |
| `references/testing/multi-client.md` | two clients on one PC, the Steam-login limit, and what a single client can prove |

## The pipeline

1. **State of the install.** `health`. It reports the game profile, compilers, FGD, sidecar
   and tool count. Missing pieces are named with their cost; do not guess around them.
2. **Workspace.** `write_addon_workspace(name)` creates the layout described in
   [`workflows/addon-workspace.md`](workflows/addon-workspace.md).
3. **Design.** `workflows/design-a-map.md`: the brief (experience, pillars, beats), the route
   skeleton (districts, nodes, intensity, landmarks, gates), then rooms, floors, events, finale,
   palette, variability and budget in the design file and the plan JSON. Read-only; no `.vmf`;
   stop for approval. The first layer is `references/planning/route-skeleton.md`. The render
   writes the build sheet; pass 2 reads it with the JSON, not the SVGs.
4. **Source map.** `workflows/new-campaign.md`: create or open a `.vmf`, build the sealed
   shell, then lint and check for leaks *before* a compile that can take minutes.
5. **Compile.** `run_compile` with the stock chain or Tools++, and read the per-stage
   findings. A non-zero exit is a stop, not a warning.
6. **Nav.** The engine generates it, not the toolkit: `references/nav/generation.md`.
   A `.nav` without CHECKPOINT/FINALE and a flow path is not a playable mesh.
7. **Mission file.** `references/campaign/mission-file.md`: naming rules that decide whether
   the campaign appears at all.
8. **Pack and deploy.** `references/campaign/addon-and-deployment.md`: one archive in the
   game, fixed name, previous ones removed. To put it on the Workshop, publish private with
   `publish_workshop_item`, verify with `read_workshop_item`, then release:
   `workflows/publish-to-workshop.md`.
9. **Play test.** `workflows/playtest.md`. What counts as passed is written there, not
   inferred. The one-call form is `run_campaign_gate`: mission → lint → compile → nav →
   props → audit → finale → `nav_trouble_report` → map test with the exact BSP/nav pair.

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
- **Two passes.** No `.vmf` before an approved DESIGN.md, and no silent design change during
  the build. A deviation is an amendment with a reason, not a cleanup.
- **A chapter exit is a safe room, not a trigger.** `info_changelevel` + checkpoint door +
  CHECKPOINT nav (+ PLAYER_START on the first map) + landmark pair. All four.
- **Bots follow flow, not the player.** They path to the goal area. No goal area, no
  following.
- **Workspaces are local.** `campaigns/` and `workspaces/` are ignored on purpose; never
  commit an addon's source or history.
- **A fork keeps the original's script path.** A fork replaces the original; the shared path makes
  the Add-ons menu mark them as conflicting and lets the engine load only one. Rename the script
  only when the user explicitly asks for coexistence.
- **A fork is a minimal diff.** Keep the original's class, globals, chat commands, settings path,
  entity names and script path; change only the behaviour the user asked for. Rename only on an
  explicit request.
- **Error logs are for skill and MCP defects.** The workspace error log records errors,
  omissions and holes in this skill, the MCP server, its tools or our pipeline. It does not
  record limitations of the user's content, source photos, reference material or creative
  brief; those are design facts and belong in the design/assumptions.
- **One campaign in the game.** Deploy the latest under a fixed name and remove older
  archives.
- **A site plan is the whole street, not the route boxes.** Every visible building or structure
  in the playable area is in `buildings[]` with a role (`route`, `safe-room`, `context`,
  `facade`, `landmark`); fewer than three context/facade/landmark buildings fails approval.
- **No number without a source.** A limit, size or flag comes from a tool result, a dump or
  the game's files, not from memory.
- **Runtime claims need runtime evidence.** `-condebug` console log, nav dump, compile log.
  If nothing was verified, say so.

## Gotchas

- `info_changelevel` does not spawn without `prop_door_rotating_checkpoint` in the safe room.
  A brush alone is inert. [`references/campaign/safe-room-and-transition.md`](references/campaign/safe-room-and-transition.md)
- `nav_generate` needs **`sv_cheats 1` and `nav_edit 1`**, and a **loose** map: a `.nav`
  cannot be written beside a map inside a VPK. Without `nav_edit` it does nothing, silently.
  [`references/nav/generation.md`](references/nav/generation.md)
- `read_nav` compares `savedBspSize` with the `.bsp`: after any geometry change the mesh is
  stale until regenerated. [`troubleshooting/nav-stale.md`](troubleshooting/nav-stale.md)
- Mission file base name must equal the VPK name, and `Name` is alphanumeric only. This is
  the difference between "add-on enabled" and "campaign in the list".
  [`references/campaign/mission-file.md`](references/campaign/mission-file.md)
- `trigger_finale` type 0 (Standard) is used by no Valve campaign. A shipping finale is type 2
  plus `scripts/vscripts/<map>_finale.nut`; `FinaleEscapeStarted` enables the escape and
  `FinaleEscapeFinished` plus an outtro ends it. Type 0 is a scriptless test path only.
  [`references/campaign/finale.md`](references/campaign/finale.md)
- `addOutput` values have five comma-separated fields: `target,input,param,delay,timesToFire`.
  Four fields are rejected by the sidecar.
  [`references/mapping/entity-families.md`](references/mapping/entity-families.md)
- VScript in an add-on lives at `scripts/vscripts/<name>.nut` and is attached with
  `logic_script` keyvalue `vscripts = <name>`, no extension.
  [`references/scripting/vscript.md`](references/scripting/vscript.md)
- `-condebug` plus `printl` turns "does the engine load this?" into a one-command check.
  [`references/testing/live-debugging.md`](references/testing/live-debugging.md)

## What is not supported

- **Fully automated two-team rounds.** One Steam account cannot authenticate two clients
  (`No Steam logon`), and no dedicated server is installed here. `run_map_test` proves map
  load, mode script and HUD; a real Versus/Scavenge round still needs a server or a second
  account. See `references/testing/multi-client.md`.
- **HDR baked-light editing.** `write_bsp_lightmap` patches LDR RGB only. HDR is RGBE; the
  tool refuses it rather than changing the exponent's meaning. Compile `-both` and use the
  LDR lump, or recompile with vrad.
- **Evaluating HUD conditions.** `read_hud` shows `[$WIN32]`/`[!$OSX]`; it does not decide
  which ones apply, and `write_hud` edits existing controls rather than creating new ones.
- **A material patch chain longer than 16 links.** `check_vmt` follows the chain, applies
  each `insert`/`replace`, and reports the effective `$basetexture` and textures; a cycle or
  a missing link is a finding, and a deeper chain is refused rather than followed forever.
- **Arbitrary executables and the game launch in `run_compile_sequence`.** It runs the
  three compiler aliases and the file steps; `$game_exe` is skipped and any other executable
  is refused. Use `run_compile` for `func_instance` maps, which the sequence runner refuses.
- **A full Survival wave.** Setup and HUD are verified; the round still starts from the
  map's own `trigger_finale` or `ForcePanicEvent`, which the map author must place.
- **HLMV's 3D canvas in a headless session.** The editor launches and its UI captures; the
  viewport needs an interactive desktop. HLMV++ is tried first, but the current L4D2 build
  crashes after ~3 s on this machine with `0xc0000005`, so `run_hlmv` probes it and falls
  back to stock HLMV, reporting `viewer` and `fallbackReason`. `preview_model` is the rendered
  fallback: it builds a sealed dev-textured room, compiles it, generates a nav and captures
  the real game view, and it uses the same blank-viewport measurement to decide whether HLMV
  is worth trying first.
- **A player-driven finale start in `+map`.** `ForceFinaleStart` without a spawned player
  is not the player-facing path; the last proof is the campaign menu or a reachable +use
  button in a live round.
- **A general VScript API wrapper.** Scripts are authored and attached, but what they call
  at runtime is the map's own logic.
- **Model import from DCC formats.** glTF/GLB and FBX (binary 7.x and ASCII) are read
  natively, and QC/SMD compilation with StudioMDL++/studiomdl is covered. FBX animations are exported
  as one SMD per stack with `$sequence` lines, and `collision: "box"`/`"hull"` writes the
  `_phys.smd`; shape keys go through `fbx_to_dmx` as DMX flexes, while `fbx_to_smd` counts
  them because SMD has no morph target.
- **Model collision shape.** `read_model_collision` reads a `.phy`'s solids, convex pieces,
  triangles and `prop_data`, and checks its checksum against the `.mdl`. More than one piece
  per solid means the QC needs `$concave`; `read_static_props` only reports whether a `.phy`
  exists.
- **Model decompilation.** `decompile_model` turns a compiled `.mdl` back into a QC/SMD set
  and round-trips through studiomdl; the recovery rules, the autolayer/IK/weight-list limits
  and the remaining gap (bodygroup presets) are in
  [`references/mapping/model-decompile.md`](references/mapping/model-decompile.md).
- **Model flex inspection.** `read_model_flexes` reports a compiled model's flex
  descriptors, controllers and rules, plus sampled position/normal deltas with the vertex
  position. Use it to compare a source and a recompiled model; the decompiler writes the
  same data as a VTA.
- **3D-skybox composition.** `build_skybox` copies a selection, seals the room and places
  `sky_camera` in one call; choosing what is worth copying is design work. `write_sky_camera`
  and `write_skybox_copy` remain as the halves.

If a request depends on one of these, say so plainly and do not fake the step.

## Definition of done

A campaign build is done when every line of `checklists/campaign-ready.md` is true. The short
version: sealed and lint-clean, compiles with exit 0, mission checks pass, nav fresh for every
map, VPK entry list verified, deployed under the fixed name, and a play test recorded.
