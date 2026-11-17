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
| Finale: start, escape, victory | trigger_finale, FINALE nav, arrival changelevel, FinaleEscapeFinished | **verified** with a custom type-2 stage list: stages → `FinaleEscapeStarted` → escape → `Map: credits` (70 s) |
| Finale: waves, tanks, specials | spawn areas, Director state machine | custom finale PANIC/TANK stages are implemented; horde spawns on the arena. Stage completion depends on the bots killing the wave/tank, which the test run does not prove |
| Director flow, goal area | nav CHECKPOINT/FINALE, info_director | **verified** (dump + bots) |
| Nav generation and attributes | run_nav_generate, func_nav_attribute_region, read_nav_dump | **verified** |
| Assets: textures, models, sizes, skyboxes, particles | read_game_content (details), read_model_info | **verified** |
| Compile, pack, deploy | run_compile, run_vpk_pack, check_campaign | **verified** |
| Automated play test | run_map_test, `-condebug` | **verified** |
| VScript: ship and attach | write_vscript, logic_script, printl banner | **verified (load only)** |
| VScript: finale waves, Director hooks | ScriptedMode/DirectorScript API | not yet |
| Common infected, hordes | spawn areas, population, nav | not yet |
| Special infected | Director spawn set, nav | not yet |
| Tanks, witches | Director, nav, spawn rules | not yet |
| Crescendo / panic events | trigger areas, Director, outputs | not yet |
| Weapons, ammo, items | weapon_* spawns, item placement, saferoom stock | not yet |
| Scavenge finale | gas cans, `type 4`, scavenge items | not yet |
| Survival mode | mission mode, nav, timers | not yet |
| Versus mode | mission mode, nav, infected spawns | mission parsing only |
| Mutations / ScriptedMode | VScript mode framework | not yet |
| Weather, fog, sky | env_fog_controller, skybox, map properties | not yet |
| Displacements | displacement tools | tools exist, not L4D2-tested |
| Instances | read_vmf collapse, no writer | read-only |
| Model/material authoring | mdl/vmt/vtf pipeline | partial (`run_vtf_convert`) |
| Non-campaign add-ons | other addon types | not yet |

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
