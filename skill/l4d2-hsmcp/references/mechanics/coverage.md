# L4D2 mechanics coverage

The project is not done while this table has a `not yet`. A mechanic is **verified** only
when it has all four:

1. a tool or a documented entity/VMX pattern;
2. a static check when it can be wrong before a compile;
3. an in-game test with evidence in `console.log` (`run_map_test`);
4. a page here and in the skill, plus a checklist entry.

| Mechanic | What it needs | Status |
|---|---|---|
| Campaign, chapter transition, saferoom | info_changelevel, checkpoint door, CHECKPOINT, landmark pair | **verified** (`verify.ps1`, PASS) |
| Campaign wiring builders | `write_safe_room`, `write_changelevel`, `write_spawn_points` | **verified offline and by vbsp**: the safe-room door is on its hinge and named `checkpoint_exit`/`checkpoint_entrance`; a departure/arrival pair writes the brush volume, map and landmark; the compile case emits `info_player_start`, `info_zombie_spawn`, `info_changelevel`, `info_landmark` and `trigger_finale`. `check_campaign_wiring` follows a real two-chapter chain with no errors |
| Finale builder | `write_finale_setup` | **verified offline and by vbsp**: types 0/1/2/4, custom starts disabled and refuses no script, four escape positions; the trigger compiles. Nav FINALE marking and the round are the existing runtime evidence, not re-run |
| Finale: start, escape, victory | trigger_finale, FINALE nav, arrival changelevel, FinaleEscapeFinished | **runtime timeline on `hsmcp_test_m2`**: with Steam logged on, a scratch 4-stage type-2 script matched `panic` (116.5 s) -> `delay` (143 s) -> `HSMCP_ESCAPE_STARTED` (157.2 s) -> `HSMCP_ESCAPE_TOUCHED` (157.2 s) -> `Map: credits` (168 s); the real 6-stage script also logged stages 1-6, escape and credits in a separate run. The TANK stage fires, but waiting for the tank to die is what stalled one marker run. A campaign-menu start is still open: the `+map` harness has no player +use |
| Finale: waves, tanks, specials | spawn areas, Director state machine | custom finale stages verified on `hsmcp_test_m2`: PANIC → DELAY → TANK → DELAY → DELAY, escape and credits (137 s). TANK stage transitioned; bots killing a tank is not proven |
| Director flow, goal area | nav CHECKPOINT/FINALE, info_director | **verified** (dump + bots) |
| Nav generation and attributes | run_nav_generate, func_nav_attribute_region, read_nav_dump | **verified** |
| Assets: textures, models, sizes, skyboxes, particles | `read_game_content`, `read_model_info`, `read_particle`, `write_particle`, `extract_vtf`, `read_soundscape` | **verified** against the stock game: model hulls/sequences/events, VTF decode, particle systems and soundscape waves |
| Sound: WAV, soundscripts, soundscapes | `read_wav`/`convert_wav`, `read_soundscript`/`write_soundscript`, `read_soundscape`/`write_soundscape` | tools + stock-game verification (13k soundscript names, 577 soundscapes); in-game audio mix not judged |
| Particles: `.pcf` read and write | `read_particle`, `write_particle` | **verified structurally and in game:** a stock `fire_01l4d.pcf` (59 systems) round-trips with the same systems, children, materials and operator counts; typed options (vectors, colours, times) survive the reader as `{type, value}`. In game, `fire_barrel_big` rendered on `c1m1_hotel` and on the test map, and a `pcf/system` name was rejected by the engine; a system built by `write_particle` shipped in an addon with a manifest renders: five entities drew fire from a copy whose stock file was excluded from the manifest, after `children` were written as `DmeParticleChild` wrappers (direct element references register the name and draw nothing) |
| Collision models (`$collisionmodel`) | glTF `collision: "box"`/`"hull"`, `brush_to_model` brush collision | **verified with the real compiler:** box and convex hull both produce a `.phy` and `hasPhysics: true`; a flat hull falls back to the box with a warning; a brush collision is convex (or `$concave` for several solids) |
| Compile, pack, deploy | run_compile, run_vpk_pack, check_campaign | **verified** |
| Automated play test | `run_map_test`, `-condebug` | **verified** for single-pattern waits. Ordered `markers` and `via: "steam"` are verified: with Steam logged on, a run matched spawn (106.7 s), the finale stages, escape, touch and `Map: credits` with `missing: []`. Long finales and rounds are no longer blocked on this machine; full Versus/Scavenge rounds still need two teams |
| VScript: ship and attach | `write_vscript`, `logic_script`, `vscripts` key | **verified in game**: a map entity `logic_script` with `vscripts "hookprobe"` logged `[HSMCP] hookprobe loaded` and `OnGameEvent_player_spawn` for userids 2-5; a bare `script_execute` runs the code but registers no event hooks |
| VScript static contract | `read_vscript`, `write_vscript` | **verified offline**: Lua habits (`end`, `elseif`, `then`, `nil`, `~=`, `--[[`), unbalanced delimiters with lines, include paths, and the `DirectorOptions` custom-finale stage list (count, missing/extra/undefined stages). Runtime hooks and stage transitions still need `-condebug` |
| VScript: Director hooks and events | `OnGameEvent_*`, `EntFire(director, RunScriptCode)` | **verified in game**: `EntFire("director", "RunScriptCode", ...)` ran (survival/scavenge probes) and `OnGameEvent_player_spawn`/`OnGameEvent_player_death` registered only through `logic_script`; scripted finale stages 1-6 already logged from the finale script |
| Common infected, hordes | `write_spawn_points` (zombie), `write_zombie_border`, nav | tool + static: spawners and the border are written; a live horde still needs a run |
| Special infected | Director spawn set, nav | not yet |
| Tanks, witches | Director, nav, spawn rules | **verified** via `z_spawn` with `sv_cheats`: `Damage Taken from "Tank"` and `calm witch` in the log, 59 s; the tank killed the test player |
| Weapons, ammo, items | `write_item_spawns`, `write_saferoom_stock`, `write_map_parameters` | tool + static: spawner classes, counts, skin and stock row; density keys; a live pickup/placement run still pending |
| Crescendo / panic events | trigger areas, Director, outputs | **verified** in game: `PanicEvent` ran `STAGE_INITIAL_DELAY → STAGE_MEGA_MOB → STAGE_WAIT_FOR_COMBAT_TO_END → STAGE_DONE` (51 s). `OnPanicEventFinished` did not fire on this map, so the stage transition is the evidence |
| Scavenge finale | gas cans, `type 4`, scavenge items | **verified round start and item accounting**: `ForceScavengeStart()` started the round (`OnScavengeRoundStarted: Scavenge started`) and `GetScavengeItemsRemaining()`/`GetScavengeItemsGoal()` returned **16 / 16** on `hsmcp_test_m1`; a gas-can pickup and score are still not automated. After the start the dev map has only its 16 `weapon_scavenge_item_spawn` and no `weapon_scavenge_item`, and a player has no `UseTarget` method, so a pickup needs a map with a real scavenge goal. The test campaign now has `game_scavenge_progress_display` (`progress_display`), spawner `model`/`spawnflags`/`OnItemPickedUp` and per-can targetnames; after `ent_teleport` the `Use`/`Touch` inputs still do not count a pickup, and a scavenge launch with `+map` puts the local client on the **infected** team (the Spitter spawn screen and `SCORE 0 / 16` are on screen), so a survivor pickup needs the team forced first. `jointeam Survivor` plus `god` does force it, and the can **is** the `weapon_scavenge_item_spawn` itself (Valve docs and the AlliedMods plugins agree; there is no separate `weapon_scavenge_item`), with `SpawnItem`, `TurnGlowsOn` and `glowrange` available on the spawner. A scavenge round restarts on its countdown and resets teams, so the `e` press has to land inside a round the client is a survivor in; the pickup remains unproven |
| Mode contracts | `check_modes` | **verified offline** against the test campaign: scavenge counts `weapon_scavenge_item_spawn` (16), survival flags a map with no `trigger_finale`/`func_finale`, coop flags a last chapter with neither a finale nor a changelevel, and duplicate maps/unknown mode names are warnings. This is a static contract, not a played round |
| Survival mode | mission mode, nav, timers | **verified round start and a tank wave**: `ForceSurvivalStart()` started it (`OnSurvivalRoundStarted: Survival started`), the HUD timer counted (`00:07.44`, 4:00 Bronze), and on the next run a Tank arrived 65 s in (`Damage Taken from "Tank" - 98 in 5 hits`, `Tank Count = 0`), wiped the team and the engine restarted the map. `[SURVIVAL]:` stage lines never appear because this install has no loose `survival.nut` (`Script not found (survival)`), so the C++ director drives the waves. A 4-minute bronze run follows: with `director_stop 1` applied 20 s after the start (waves stopped, timer kept) the round reached `04:50.24` against a `07:00.00` Silver Standard, so the Bronze threshold is crossed; the test map has no radio trigger, so the player-facing start remains open |
| Versus mode | mission mode, nav, infected spawns | **verified load**: mission `versus`, `+mp_gamemode versus`, `VSCRIPT: Running anv_versus.nut`; full two-team round not played |
| Mutations / ScriptedMode | VScript mode framework | not yet |
| Weather, fog, sky | `func_precipitation`, `env_fog_controller`, `skyname` | tool + static checks; rain verified visually on an open-sky test map; fog not separately judged |
| Cubemaps | `env_cubemap` in the VMF, `run_build_cubemaps` | verified HDR and LDR on the test campaign (29 s / 24 s); `both` verified |
| Displacements | displacement tools | tools exist, not L4D2-tested |
| Instances | `write_instance`, `read_vmf` with `collapseInstances` | tool (fixture-tested); in-game visual pending |
| Model/material authoring | QC/SMD/DMX source, `studiomdl`, `write_smd`/`write_qc`/`dmx_to_smd`/`gltf_to_smd`/`gltf_to_dmx`/`brush_to_model`, `write_vtf`/`convert_vtf` | tools + real compiler: static, skinned, animated and morph glTF convert, compile with the game's `studiomdl.exe`, and read back with `read_model_info` (bones, sequences and flex counts survive; glTF morph `NORMAL` targets become DMX normal deltas, reported as `flexNormalDeltas`, and an FBX in-between chain exports one flex per shape) `read_qc` now treats `$definebone` as a graph (missing parent, duplicate, cycle) and checks sequence `activity` weights and `loop`/`snap` flags; `collision: "box"`/`"hull"` produces a `.phy` and `hasPhysics: true`; SMD/DMX sources can be written and converted, VTF/DXT is native; HLMV launches and its UI captures, the 3D canvas needs an interactive desktop. A full MDL compiler is still absent (`studiomdl` compiles) |
| glTF / GLB import | `read_gltf`, `gltf_to_smd`, `gltf_to_dmx` | **verified with the real compiler**: static, skinned, animated and morph fixtures convert and compile; GLB, data URI, sparse accessors, strips, collision boxes/hulls and DMX shape keys are fixture-tested; `$staticprop` Rz(90°), the SMD V inversion, the `phys` collision material and the `deltaStateWeights` rule trigger are documented |
| FBX import | `read_fbx`, `fbx_to_smd`, `fbx_to_dmx` | **verified with the real compiler**: binary 7.4 fixtures (static triangle, Y-up axis, two-bone skin with `TransformLink`) and an ASCII file convert and compile; an `AnimationStack` is resampled into its own SMD and compiled with the bind model (`sequenceCount >= 2`); `collision: "hull"` produces a `.phy` with `hasPhysics: true` and a flat hull falls back to the box; shape keys convert to a DMX whose real compile reports `flexdesc`/`flexcontroller`/`flexrule >= 1`; units are reported rather than dropped; 7.5 headers are attempted with a warning |
| Model preview without HLMV | `preview_model`, `run_compile`, `run_nav_generate`, `run_map_test` | tool + room-fixture arithmetic: a sealed dev room is built from the model's bounds, the lowest point is placed on the pedestal, and the engine view is captured; the HLMV-first path measures the capture's luminance spread before falling back |
| Morph targets / flexes | glTF shape keys → DMX `DmeVertexDeltaData` + `DmeCombinationOperator` | **verified with the real compiler**: the generated DMX compiles to `flexdesc >= 1`, `flexcontroller >= 1` and `flexrule >= 1`; position deltas only, normal deltas are legal but empty; ±8 clamp reported |
| Non-campaign add-ons | other addon types | not yet |
| Director defaults and `DirectorOptions` | cvar/read from the game, stage types from stock scripts | **documented and read from the install**; `director_*` defaults and `z_*` health/speed are in `docs/reference/l4d2-complete-reference.md` |
| Special infected stats | `z_*` cvars | **documented** (common 50, boomer 50, hunter/smoker 250, spitter 100, jockey 325, charger 600, tank 4000, witch 1000); behaviours still need a live test |
| Weapon/item stats | `scripts/weapon_*.txt`, `info_map_parameters` | **documented**; placement is tool-checked, balance is a play-test judgement |
| Hammer++ editor-only previews | lighting/fog/sky/particles/ropes | **view-only**; `render_vmf_*` and `run_map_test` are the agent's eyes |
| Propper++ brush → model | `brush_to_model` | **verified with the real compiler:** a VMF box brush becomes an SMD/QC, compiles with the brush as `$collisionmodel`, and `read_model_info` reports the `.phy`; UVs are checked against the VMF `uaxis`/`vaxis` formula. Displacements are refused rather than flattened |
| Static props in a compiled BSP | `read_static_props`, `edit_static_props` | **structural:** add/set/remove and re-read verified; changing model/origin leaves compiled visleafs stale until vbsp |
| Nav connections | `edit_nav_connections` | **structural:** add/remove/set, mirroring and re-read verified; the bot path over the new link is a play-test check |

## Order of work

1. Spawn areas and waves (makes the finale a real fight).
2. Weapons, ammo and items.
3. Crescendo and panic events.
4. Tanks and witches.
5. Scavenge, Survival, Versus.
6. Weather, fog and lighting.
7. VScript waves (event hooks are verified; the waves are not).
8. Displacements and instances.

## Rules

- A row moves to `verified` only with in-game evidence, not because an entity exists.
- A mechanic that needs level design (waves, spawns) still needs a place to happen: a test
  map with only a safe room cannot prove it.
- If a row is `not yet`, say so to the user; do not describe it as supported.
