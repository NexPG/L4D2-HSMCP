# Changelog

Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`, with a
prerelease suffix (`-alpha`, `-beta`) while the toolchain is still being proven on the
target game. A version is bumped in the same commit as the change it describes, together
with a line here.

## 0.0.24-alpha — 2026-11-17

- The nav-attribute trap is documented and fixed in the test map: FINALE must be applied
  liberally, while BATTLEFIELD stops infected spawning for as long as survivors stand in it.
  The finale corridor was both, so the Director had an empty spawn set. Battlefield is gone;
  FINALE now covers the whole eastern half.
- `info_zombie_spawn` points moved from between nav areas to two area centres.
- The remaining spawn blocker is the Director's safety range: on a ~700-unit map every area is
  closer than `z_spawn_safety_range` / `z_finale_spawn_safety_range` /
  `z_finale_spawn_mob_safety_range`. Setting them to 100 dropped `MOB SPAWN ERROR` from ~1800
  to ~60 in the first seconds and removed special-spawn failures, but a map this small still
  starves the Director later. The convars and the mission `convar` block are in the docs.
- `read_nav_dump` decodes the full spawn-attribute set (empty, battlestation, battlefield,
  rescue vehicle, rescue closet, no-mobs) instead of only checkpoint/finale.
- Victory is still not automated: the finale starts and the escape trigger fires, but the
  campaign does not reach the credits map. The user's observation stands — a stats crawl or
  credits means the survivors escaped; the correct marker is `Host_NewGame on map credits`,
  not `Mission credits`.

## 0.0.23-alpha — 2026-11-17

- **Correction: the finale victory is not verified.** 0.0.20 claimed it from
  `Mission credits ver 1 loading...`, but the engine loads every mission file at startup,
  credits included. The real marker is the map starting: `Host_NewGame on map credits`. A
  rerun with that marker did not win: `Finale started` and `HSMCP_ESCAPE_TOUCHED` appear,
  the credits map does not.
- The standard finale cannot spawn: 1662 `MOB SPAWN ERROR` and 47
  `Director failed to spawn a special` lines. `AdvanceFinaleState` on a timer did not move it
  to the escape phase. The map needs a real combat area with spawnable nav, then waves.
- `run_map_test` truncates `console.log` instead of deleting it. A delete that silently leaves
  yesterday's lines made a wait-for match return in five seconds on a stale marker.
- The finale map gets a Battlefield nav region; the spawn errors remain, so the region alone is
  not the fix.
- `verify-finale.mjs` now waits for `Host_NewGame on map credits`, not `Mission credits`.
  The mechanics coverage table marks the finale as start/escape verified, victory not yet.

## 0.0.22-alpha — 2026-11-17

- `read_game_content` now browses assets the way Hammer's tabs do, with the numbers that
  matter: `details: true` on a model returns its hull bounds (`mins`, `maxs`, `size`) — the
  size the model viewer shows and the number needed before placing a building — and
  `kind: "particle"` lists `.pcf` files for the Particle Browser. Verified against the
  install: 246 `props_urban` models with sizes, 52 particle systems.
- The skill gains `references/mapping/hammer-tabs.md` (every Hammer++ tab mapped to the tool
  that replaces it, and recipes for roads, skyboxes, buildings and street props) and
  `references/mechanics/coverage.md`, an honest table of which L4D2 mechanics are verified and
  which are still `not yet`.
- Mechanics coverage is now the project's definition of done: a row moves to verified only
  with in-game evidence. The open rows are the next blocks — spawn areas and waves, weapons
  and items, crescendos, tanks and witches, Scavenge/Survival/Versus, weather, VScript waves,
  displacements and instances.

## 0.0.21-alpha — 2026-11-17

- **`write_vscript`** (80th tool) writes a L4D2 `.nut`, refuses unbalanced braces, warns
  about Lua habits (`local`, `end`, `--[[`) and about a missing `printl`/`Msg` banner, and
  can attach the script to a map by adding a `logic_script` entity with `vscripts` set to the
  file's base name. A compiled map is refused by name, like every other `.vmf` tool.
- The scripting reference now points at the tool, so an agent can ship a script and attach it
  without hand-editing the VMF.

## 0.0.20-alpha — 2026-11-17

- **The finale is verified end to end.** `verify-finale.mjs` deploys a self-test build, starts
  the finale (`Finale started`), warps the team into the corridor, and the escape trigger
  fires `FinaleEscapeFinished`; the engine then loads `Mission credits`. That credits load is
  the victory marker.
- `env_outtro_stats` is presentation, not the win: `OnOuttroStatsDone` did not report during
  the run, and the campaign completed anyway. The docs and the skill now say so.
- The test escape zone moved into the finale corridor, so the warp lands inside it; the
  self-test uses `WarpAllSurvivorsToFinale` and `+sv_pausable 0`.
- Gate G is complete: spawn, bots, chapter transition, finale start, escape, victory/credits.
  What remains is combat quality: this tiny map cannot spawn a mob
  (`Director failed to spawn a special`), so waves and specials are the next block, not a
  completion blocker.

## 0.0.19-alpha — 2026-11-17

- **`run_nav_generate`** (78th tool) wraps the whole nav loop: loose copies, the VPK moved
  aside, `sv_cheats 1` + `nav_edit 1`, launch, wait for the mesh, collect `.nav` and the
  engine dump, clean the rotating backups, restore the config and the archives. It returns
  the mesh size, the dump, the decoded verdict and the flow warnings. Verified on both maps
  of campaign 001: `playable`, 12 areas, no flow warnings, everything restored.
- **`run_map_test`** (79th tool) launches an installed map with `-condebug`, waits for a
  console pattern, closes the game and returns the match and log tail. It is the automated
  half of a play test.
- The finale starts without a human: `trigger_finale` **type 0** plus `ForceFinaleStart`
  produces `Finale started`; type 2 without a finale script starts nothing. A finale map also
  needs the disabled arrival `info_changelevel` — without it the Director reports
  `No exit checkpoint could be found`. The lint gains
  `l4d2-finale-no-arrival-changelevel`, and the incorrect `l4d2-finale-type-standard` warning
  is gone.
- The escape trigger is touched after the warp (`HSMCP_ESCAPE_TOUCHED`), but victory and the
  outtro are not reached yet: the standard finale cannot spawn a mob (`MOB SPAWN ERROR`) on
  this test map, so its state machine does not advance to the escape phase. That is the next
  block: a combat area with spawn nav, then waves/rescue.
- `Director.WarpAllSurvivorsToCheckpoint()` fails on a finale map (no exit checkpoint); the
  self-test uses `WarpAllSurvivorsToFinale()`. `run_map_test` accepts `extraArgs`, used with
  `+sv_pausable 0 +sv_cheats 1` so an unfocused game does not pause.

## 0.0.18-alpha — 2026-11-17

- **The chapter transition is verified end to end without a human.** The engine needs two
  things, not one: every survivor inside the `info_changelevel` volume **and** the checkpoint
  door closed (`CheckpointDoorClosed`). `verify.ps1` builds with `HSMCP_SELFTEST=1`, the map's
  timer warps the team into the safe room and closes the door, and the game loads
  `hsmcp_test_m2` — recorded as `transition: PASS`.
- `read_nav_dump` (77th tool) parses the engine's `<map>_nav.txt`, decodes CHECKPOINT,
  PLAYER_START, FINALE and the escape route, and returns a `playable` / `no-goal` / `no-flow`
  / `empty` verdict.
- `read_vmf_lint` gains the L4D2 campaign rules: `trigger_changelevel`,
  `l4d2-changelevel-no-landmark`, `-landmark-missing`, `-no-brush`, `-no-checkpoint-door`,
  `-no-checkpoint-nav`, `l4d2-finale-type-standard`, `l4d2-no-director`. Three new tests.
- `run_vtf_convert` is registered again: it was defined and documented but never added to the
  tool list, and its argument still carried the Wine-era `Z:` prefix, which is wrong on
  Windows. It now passes the native path.
- Cleanup from the dead-code audit: unused imports in fourteen tool modules, dead constants
  (`LUMP_PAKFILE`, `MASK_NAMES`, the unused `.lmp` test path), the `garrys-mod` keyword, and
  stale GMod/Lua/Linux wording in descriptions and docs. The GMod-era measurement pages now
  carry a historical banner.
- The skill gains `references/mapping/editor-and-fgd.md` (Hammer++, Tools++ flags,
  L4D2-FGD-Edits and the rule that only the stock FGD is a shipping authority) and
  `references/testing/console.md` (nav/entity commands, `-condebug`, and why `setpos` in a
  config silently does nothing).

## 0.0.17-alpha — 2026-11-17

- The agent skill is added at `skill/l4d2-hsmcp/`, structured for progressive disclosure:
  a short `SKILL.md` router, then `references/` (campaign, nav, scripting, mapping,
  compiling, tools), `workflows/`, `troubleshooting/` and `checklists/`. `opencode.json`
  points at it so it is available in this repository.
- The skill documents only what the project has verified — mission rules, the safe-room
  transition, nav attributes and flow, the finale inputs, add-on VScript, the tool catalogue —
  and names what is not built yet instead of inventing it.
- Campaign 001: the checkpoint door stood on a solid wall. The corridor now ends in a real
  doorway and a safe room behind it, with the changelevel volume over the room floor. Nav was
  regenerated: 12 areas per map, CHECKPOINT on both safe rooms, FINALE in the radio corridor,
  and the flow path reaching the safe room.

## 0.0.16-alpha — 2026-11-17

- A chapter transition needs more than `info_changelevel`: a `prop_door_rotating_checkpoint`
  must exist (without one the changelevel never spawns), and the nav areas must carry
  CHECKPOINT, with PLAYER_START on the first map. `func_nav_attribute_region` applies those
  attributes during generation, and the `<map>_nav.txt` dump proves it: `0x800` is CHECKPOINT,
  `0x40` FINALE, and `0x20000000` marks the computed flow path.
- Campaign 001 now has all of it: a checkpoint door at the exit and at the second map's start,
  Mission Start + Checkpoint on the spawn area, Checkpoint in the exit corridor and Finale in
  the radio corridor. Nav regenerated with those attributes and the flow path present.
- `docs/campaigns.md` records the three non-optional requirements and explains why bots run
  ahead: they path to the goal area, not to the player.
- `nav.ps1` captures each generation's console log and reports flow and checkpoint errors, so
  a mesh that exists but has no goal is caught without a play test.

## 0.0.15-alpha — 2026-11-17

- An add-on VPK can carry VScript: `scripts/vscripts/hsmcp_finale.nut` is packed into the
  campaign, attached through a `logic_script` entity and verified in the running game — the
  `[HSMCP] hsmcp_finale loaded` banner appears in `console.log` with `-condebug`.
- The finale is now completable with entities: `trigger_finale` type 2 starts on **+use**,
  `FinaleStart` enables an escape `trigger_multiple` after ten seconds, and its `OnStartTouch`
  fires `FinaleEscapeFinished` and the outtro stats — the same inputs the Authoring Tools'
  rescue template uses. Stock campaigns never use type 0, so the earlier standard-finale
  attempt was replaced rather than tuned.
- `docs/campaigns.md` gains "The finale" and "VScript in an add-on", with the exact inputs and
  the console-log check.
- Campaign 001: exit corridor and changelevel (0.0.14) plus this finale; both maps rebuilt,
  nav regenerated (1346 bytes, fresh) and the 7-entry archive redeployed.

## 0.0.14-alpha — 2026-11-17

- Chapter transitions use L4D2's own mechanism: an `info_changelevel` brush with `map` and
  `landmark`, plus a matching `info_landmark` in both maps. Every stock chapter works this
  way; `trigger_changelevel` exists in `base.fgd` but is not part of the campaign flow, which
  is why the test campaign loaded and never advanced.
- Campaign 001 gets a visible exit: an east-wall doorway, a lit corridor and the changelevel
  brush at its end, replacing the invisible trigger brush. Both maps were rebuilt, nav was
  regenerated (1346 bytes, fresh against the new `.bsp`) and the archive redeployed.
- `docs/campaigns.md` gains "Chapter transitions" and "The finale": all stock finales use
  `trigger_finale` type 2 (Custom) with a VScript, so a script-free finale is still open.

## 0.0.13-alpha — 2026-11-17

- The upstream credit names the original developers' studio, **Project Society Studio**, and
  stops there: the README does not restate a copyright line, because `LICENSE-MIT` already
  carries the MIT notice verbatim.

## 0.0.12-alpha — 2026-11-17

- README drops the "What works today" feature table. The project has only just entered
  development, and the page now says so plainly: the map and campaign pipeline is the first
  piece being built, and the feature set will keep expanding.
- Upstream credit names **Project Society Studio**, which is how the original authors identify
  themselves; the MIT notice in `LICENSE-MIT` is unchanged.

## 0.0.11-alpha — 2026-11-17

- README gains a full Requirements section: L4D2 (app 550) and its Authoring Tools (app 563),
  Node, pnpm, Python/srctools, Windows, disk; recommended Hammer++ and standalone Tools++,
  the VTF tools, Steam for nav and testing; and the agent side (MCP client, skill,
  permission to run local tools and launch the game once per map for nav).

## 0.0.10-alpha — 2026-11-17

- README rewritten around what this project is: an agent toolkit for Left 4 Dead 2 maps,
  campaigns, VScripts, models and addons. It states the early-development status, how the
  pieces fit together, what works today and what is planned.
- `docs/campaigns.md` added: mission format and naming rules, addon layout, nav generation,
  deployment, and the checks `check_campaign` performs.
- Provenance points at `Sycatle/hammer-mcp`, the upstream this fork grew from; the MIT
  notice and copyright remain in `LICENSE-MIT`.

## 0.0.9-alpha — 2026-11-17

- Gate F answered: `nav_generate` runs in the client's listen server, not a dedicated
  binary, and it requires `sv_cheats 1` **and** `nav_edit 1`; without `nav_edit` it does
  nothing. The map must be loose, because a `.nav` cannot be written beside a map inside a
  VPK.
- `campaigns/001-hsmcp-test/nav.ps1` automates the loop: loose maps, generate, collect
  `nav/`, restore the game config, re-pack and deploy.
- Both maps now carry analysed nav meshes (version 16/14, `savedBspSize` matches), and the
  addon has 6 entries (two maps, two navs, mission, manifest).
- A transition needs a landmark: both maps carry `info_landmark landmark_transition` and
  `trigger_changelevel.landmark` points at it.

## 0.0.8-alpha — 2026-11-16

- The project moved to its own repository, `NexPG/L4D2-HSMCP`, with the full history. The
  old fork's remote is gone; metadata, clone URL and CI badge point at the new home.
- The upstream MIT notice and the provenance in `NOTICE` stay exactly where the licences
  require them.

## 0.0.7-alpha — 2026-11-16

- Campaign metadata is now shaped the way L4D2 matches it: the mission file's base name
  equals the VPK's (`hsmcp_campaign.txt` in `hsmcp_campaign.vpk`), `"Name"` is alphanumeric,
  and `"Image"` is set. The addon manifest carries `addonSteamAppID 550` and
  `addonContent_Campaign 1`.
- The staging tree is cleaned before a rebuild, so a renamed mission cannot survive and
  register a second campaign.

## 0.0.6-alpha — 2026-11-16

- `campaigns/` is ignored as a directory (root-anchored `/campaigns/`), not merely for the
  files inside it.
- Deployment keeps exactly one campaign in the game: the build removes earlier
  `hsmcp*.vpk` archives from `left4dead2/addons/` and copies the new one as
  `hsmcp_campaign.vpk`. History stays in the numbered campaign directories, where any run
  can be rebuilt and deployed again.

## 0.0.5-alpha — 2026-11-16

- Test campaigns are local only (`campaigns/` is ignored) and live in numbered directories:
  a README stating the date, project version, what was attempted and what came out, plus
  the source maps, staging tree, build script and packed VPK.
- The build script deploys the archive to the game's `left4dead2/addons/`, so a campaign
  can be opened in the game directly.
- `001-hsmcp-test` re-laid out under that convention.

## 0.0.4-alpha — 2026-11-16

- First campaign built through the tools: two sealed chapters with a transition and a
  finale, a mission file, an addon manifest and a packed VPK. `check_campaign` passes on
  the unpacked tree and on the archive itself.
- `campaigns/hsmcp-test/` keeps the source `.vmf` files, the mission and a `build.mjs` that
  reproduces the build; compiled maps and the VPK are build output.

## 0.0.3-alpha — 2026-11-16

- `run_vpk_pack`: packs a staging directory into an addon VPK with the game's own
  `vpk.exe`, writes the addon manifest when given one, and reads the archive back through
  the sidecar to prove every staging file made it in. Overwrites only on request.
- The pack output is an ordinary L4D2 addon tree: `addoninfo.txt`, `missions/`, `maps/`,
  `materials/vgui/maps/`.

## 0.0.2-alpha — 2026-11-16

- Campaign files: `read_campaign`, `write_campaign` and `check_campaign`. The schema was
  read from the game's own `missions/campaign1.txt` inside `pak01_dir.vpk`; a campaign can
  be written, checked against its maps and images, and the game's own campaigns can be
  checked in place.
- The sidecar can list and read VPK entries (`vpk_list`, `vpk_read`), so campaigns and
  their maps are checked without extracting a 1 GB archive.
- Sky checks accept Left 4 Dead 2's `_hdr`-prefixed sky faces, and dependency resolution
  does the same; `write_vmf` now defaults to `sky_l4d_c1_1`, a sky this game really has.
- The probe fixture is compiled by this game's own compilers (BSP 21, L4D2 field order),
  not inherited from Garry's Mod.
- Test environment: the repo root default was one level too high, which had silently
  skipped every game-content test on a normal checkout. With it fixed, 1020 tests pass on
  Windows against the real install.

## 0.0.1-alpha — 2026-11-16

First version of the Left 4 Dead 2 fork.

- Targets **Left 4 Dead 2 only** (BSP 21, `left4dead2.fgd`, game appid 550). Other Source
  games and the Garry's Mod subsystems were removed.
- **Windows only**: the game's own compilers run natively; the Wine/Proton layer and the
  Linux paths are gone.
- Reads L4D2's lump directory, whose field order differs from every other Source game.
  Counts on `c1m1_hotel.bsp` match Valve's `vbspinfo` exactly.
- Compiles with the stock chain and with standalone **Tools++** (`vbsp++.exe` family),
  naming the chain that actually ran.
- Python sidecar (srctools 2.7.0) installed and used for FGD, VMF and VPK work.
- 71 tools. Tests pass on Windows with the game installed (947 passed, 94 skipped at the
  time of writing).
