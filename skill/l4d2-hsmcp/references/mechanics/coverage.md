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
| Finale: start, escape, victory | trigger_finale, FINALE nav, arrival changelevel, FinaleEscapeFinished | **verified on `hsmcp_test_m2`** with a custom type-2 stage list: stages → `FinaleEscapeStarted` → escape → `Map: credits` (70 s). On the current `night_moscow_m2`, the `+map` harness has no player +use, so the campaign-menu start is still open |
| Finale: waves, tanks, specials | spawn areas, Director state machine | custom finale stages verified on `hsmcp_test_m2`: PANIC → DELAY → TANK → DELAY → DELAY, escape and credits (137 s). TANK stage transitioned; bots killing a tank is not proven |
| Director flow, goal area | nav CHECKPOINT/FINALE, info_director | **verified** (dump + bots) |
| Nav generation and attributes | run_nav_generate, func_nav_attribute_region, read_nav_dump | **verified** |
| Assets: textures, models, sizes, skyboxes, particles | `read_game_content`, `read_model_info`, `read_particle`, `write_particle`, `extract_vtf`, `read_soundscape` | **verified** against the stock game: model hulls/sequences/events, VTF decode, particle systems and soundscape waves |
| Sound: WAV, soundscripts, soundscapes | `read_wav`/`convert_wav`, `read_soundscript`/`write_soundscript`, `read_soundscape`/`write_soundscape` | tools + stock-game verification (13k soundscript names, 577 soundscapes); in-game audio mix not judged |
| Particles: `.pcf` read and write | `read_particle`, `write_particle` | **verified structurally:** a stock `fire_01l4d.pcf` (59 systems) round-trips through the writer and parses back with the same systems, children, materials and operator counts; a new system is built from JSON. In-game render not judged |
| Collision models (`$collisionmodel`) | glTF `collision: "box"`/`"hull"`, `brush_to_model` brush collision | **verified with the real compiler:** box and convex hull both produce a `.phy` and `hasPhysics: true`; a flat hull falls back to the box with a warning; a brush collision is convex (or `$concave` for several solids) |
| Compile, pack, deploy | run_compile, run_vpk_pack, check_campaign | **verified** |
| Automated play test | `run_map_test`, `-condebug` | **verified** for single-pattern waits. Ordered `markers` (timeline + missing steps) and `via: "steam"` are implemented and unit-tested; a run reached a spawned survivor with `sb_add`/`director_start`, then the client dropped with `No Steam logon` before the 90 s finale could finish. Long finales/rounds are blocked by the Steam account on this machine, not by the harness |
| VScript: ship and attach | write_vscript, logic_script, printl banner | **verified (load only)** |
| VScript: finale waves, Director hooks | ScriptedMode/DirectorScript API | not yet |
| Common infected, hordes | spawn areas, population, nav | not yet |
| Special infected | Director spawn set, nav | not yet |
| Tanks, witches | Director, nav, spawn rules | **verified** via `z_spawn` with `sv_cheats`: `Damage Taken from "Tank"` and `calm witch` in the log, 59 s; the tank killed the test player |
| Weapons, ammo, items | weapon_* spawns, item placement, saferoom stock | class list read from the FGD (37 classes); placement documented, play test not yet |
| Crescendo / panic events | trigger areas, Director, outputs | **verified** in game: `PanicEvent` ran `STAGE_INITIAL_DELAY → STAGE_MEGA_MOB → STAGE_WAIT_FOR_COMBAT_TO_END → STAGE_DONE` (51 s). `OnPanicEventFinished` did not fire on this map, so the stage transition is the evidence |
| Scavenge finale | gas cans, `type 4`, scavenge items | **verified load/HUD**: mission `scavenge`, 16 `weapon_scavenge_item_spawn`, HUD `SCORE 0 / 16`, gas can visible; full round not played |
| Survival mode | mission mode, nav, timers | **verified load/HUD**: timer at `00:00.00`; the round does not start from the map alone — it needs a finale/panic trigger. Full wave not timed |
| Versus mode | mission mode, nav, infected spawns | **verified load**: mission `versus`, `+mp_gamemode versus`, `VSCRIPT: Running anv_versus.nut`; full two-team round not played |
| Mutations / ScriptedMode | VScript mode framework | not yet |
| Weather, fog, sky | `func_precipitation`, `env_fog_controller`, `skyname` | tool + static checks; rain verified visually on an open-sky test map; fog not separately judged |
| Cubemaps | `env_cubemap` in the VMF, `run_build_cubemaps` | verified HDR and LDR on the test campaign (29 s / 24 s); `both` verified |
| Displacements | displacement tools | tools exist, not L4D2-tested |
| Instances | `write_instance`, `read_vmf` with `collapseInstances` | tool (fixture-tested); in-game visual pending |
| Model/material authoring | QC/SMD/DMX source, `studiomdl`, `write_smd`/`write_qc`/`dmx_to_smd`/`gltf_to_smd`/`gltf_to_dmx`/`brush_to_model`, `write_vtf`/`convert_vtf` | tools + real compiler: static, skinned, animated and morph glTF convert, compile with the game's `studiomdl.exe`, and read back with `read_model_info` (bones, sequences and flex counts survive); `collision: "box"`/`"hull"` produces a `.phy` and `hasPhysics: true`; SMD/DMX sources can be written and converted, VTF/DXT is native; HLMV launches and its UI captures, the 3D canvas needs an interactive desktop. A full MDL compiler is still absent (`studiomdl` compiles) |
| glTF / GLB import | `read_gltf`, `gltf_to_smd`, `gltf_to_dmx` | **verified with the real compiler**: static, skinned, animated and morph fixtures convert and compile; GLB, data URI, sparse accessors, strips, collision boxes/hulls and DMX shape keys are fixture-tested; `$staticprop` Rz(90°), the SMD V inversion, the `phys` collision material and the `deltaStateWeights` rule trigger are documented |
| FBX import | `read_fbx`, `fbx_to_smd` | **verified with the real compiler**: binary 7.4 fixtures (static triangle, Y-up axis, two-bone skin with `TransformLink`) and an ASCII file convert and compile; an `AnimationStack` is resampled into its own SMD and compiled with the bind model (`sequenceCount >= 2`); units and blend shapes are reported rather than dropped; 7.5 headers are attempted with a warning |
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
7. VScript waves and Director hooks.
8. Displacements and instances.

## Rules

- A row moves to `verified` only with in-game evidence, not because an entity exists.
- A mechanic that needs level design (waves, spawns) still needs a place to happen: a test
  map with only a safe room cannot prove it.
- If a row is `not yet`, say so to the user; do not describe it as supported.
