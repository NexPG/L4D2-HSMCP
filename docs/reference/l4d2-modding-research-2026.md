# L4D2 modding research — 2026

**Purpose:** turn the public L4D2/Hammer/Hammer++ documentation into contracts for this
project's skill and MCP, not into a tutorial for one test map. The campaign in
`campaigns/002-night-moscow/` is only an acceptance test.

**Primary sources** are listed at the end. Valve Developer Community pages are often behind
an anti-bot page when fetched; their search snippets and oldid/printable forms were used, and
the facts below are the ones repeated across sources and confirmed in game where possible.

## 1. What a campaign actually is

```
addons/<campaign>.vpk
  addoninfo.txt
  missions/<campaign>.txt     base name == VPK base name
  maps/<map>.bsp + .nav
  scripts/vscripts/<map>_finale.nut
  materials/...  models/...  sound/...
```

- The mission file is the campaign identity and the campaign-menu metadata. It lists modes
  (`coop`, `versus`, `survival`, `scavenge`), chapters (`Map`, `DisplayName`), and optional
  `convar` blocks. `check_campaign` already checks chapters/maps/images against files or a
  VPK.
- `addoninfo.txt` is a separate KeyValues file; the canonical keys are `addonSteamAppID`,
  `addontitle`, `addonauthor`, `addonversion`, `addonContent_Campaign`, `addonDescription`.
  The older `addonTitle`/`addonDesc` spellings are not read by every scanner.
- A VPK can be packed with the game's `vpk.exe`; a staging tree and the installed archive
  are two different things and both must be checked.
- Custom assets need a `gameinfo.txt` search path in Hammer++ or a loose `materials/` /
  `models/` tree. Hammer++ only reads L4D2 VPKs; a L4D1 VPK is not the same container
  version.

## 2. Hammer and Hammer++

### Hammer 4/Hammer++ model

- Brush geometry is planes + texture axes; displacements replace a face with a vertex grid;
  overlays are decals on a face; instances are separate VMFs expanded at compile time.
- VisGroups, groups and cordon are editor organization; cordon can exclude geometry from a
  compile, so a source file can look complete and compile a smaller map.
- Entity I/O is `target,input,parameter,delay,times`. It is a structured string, not free
  text: a quote or newline in a parameter breaks the VMF.
- The FGD is the entity schema: class, keyvalues, inputs, outputs, spawnflags. A class
  missing from the FGD is a *mount* problem, not a missing engine class (`logic_script` is
  the notable stock omission; the engine still runs it).

### The Hammer++ traps

- **L4D2 is 32-bit** (or the `x86-64` beta). Current Hammer++ builds are x64; for a plain
  L4D2 install use the last x86 build. A x64 editor can open a map, but its compiler/VPK
  tools may not match the 32-bit game.
- **I/O delimiter:** Hammer++ has `Use special I/O delimiter (ESC)`. For L4D2 it must be
  **off**; `IOParamNewDelimiter=0` in `hammerplusplus_settings.ini`. ESC-separated outputs
  are the classic "my I/O does nothing" failure. Our VMF writer uses commas; the linter
  reports `io-esc-delimiter` if a file carries ESC bytes.
- **Game configuration:** copy the stock Hammer game/build settings; Game Directory is
  `left4dead2`, Game Executable `left4dead2.exe`, compilers `bin/vbsp.exe`, `vvis.exe`,
  `vrad.exe` (or Tools++ builds). An absent gameinfo is the `Unable to find gameinfo.txt`
  error.
- **Instances are fullbright in the lighting preview and cast no shadows**; this is a
  preview limitation, not a map lighting result.
- **FGD:** use `left4dead2.fgd` plus the Tools++ FGD bundle (`L4D2-FGD-Edits` adds useful
  QOL and Hammer++/Tools++ entries). A wrong FGD reports valid classes as unknown.
- **Assets:** the editor and the game need the same search path. Packing an override VPK as
  `pak01_dir.vpk` / `pak02_dir.vpk` is a different mechanism from the add-on `addons/*.vpk`.

## 3. Map sequence, checkpoints and nav

| Map | Arrival | Exit goal |
|---|---|---|
| first | PLAYER_START + CHECKPOINT | CHECKPOINT |
| middle | CHECKPOINT | CHECKPOINT |
| last | CHECKPOINT | FINALE |

- The Director builds flow **backwards from the end goal**. `nav_analyze` computes flow;
  `z_debug 1` shows it; `nav_trouble_report` lists orphans, missing checkpoints/finales,
  overlaps and tiny areas. A file with a nav mesh is not a playable map.
- `func_nav_attribute_region` applies flags during nav generation. The ones that matter:
  CHECKPOINT (2048), FINALE (64), MISSION START (128), BATTLEFIELD (256), BATTLESTATION (32),
  NO MOBS (8192), RESCUE VEHICLE (32768), RESCUE CLOSET (65536), EMPTY (2), NOT CLEARABLE
  (1024), OBSCURED (4096).
- **Checkpoint doors are named by the engine:** `checkpoint_exit` on the room being left,
  `checkpoint_entrance` on the room being entered. `checkpoint_exit_door` is not the name.
- A below-ground start needs `info_survivor_position` entities; the Director cannot place a
  spawn in a safe room it cannot find.
- `info_changelevel` + matching `info_landmark`; the last map needs the disabled arrival
  changelevel (`spawnflags 2`) or the Director refuses the finale.
- The map must seal, but **a displacement does not seal**: the brush hull under it does.

## 4. Finales

- `trigger_finale` types: **0 Standard**, **1 Gauntlet**, **2 Custom**, **4 Scavenge**.
- Type 2 loads `scripts/vscripts/<map>_finale.nut`; the stage list is `DirectorOptions`
  (`A_CustomFinale_StageCount`, `A_CustomFinale1..n`, values) with `PANIC`, `TANK`, `DELAY`,
  `SCRIPTED`. `OnBeginCustomFinaleStage(num,type)` is the hook.
- The trigger must be **over** the FINALE nav area; otherwise the escape route is chosen from
  the FINALE area centres and disagrees with the trigger.
- Gauntlet (`type 1`) needs `info_target nav_flow_target` near the rescue vehicle; without it
  the flow lets infected spawn behind the survivors.
- Escape: `FinaleEscapeStarted` enables the escape trigger; `FinaleEscapeFinished` +
  `RollStatsCrawl` end the campaign. A real map has a vehicle and a +use object, not only a
  server command.
- Stock finales are often two-part: a button enables the trigger, then a player +uses it.
  `ForceFinaleStart` is not a test of the player-facing flow.

## 5. Director, infected and game modes

- `info_director` is mandatory for campaign Director behavior. Without it, flow/spawning is
  absent.
- The Director chooses spawns from nav areas, not only `info_zombie_spawn`; the nav
  attributes are the controls (`NO MOBS`, `BATTLEFIELD`, `FINALE`, `CHECKPOINT`).
- Panic/crescendo: a button/trigger starts a `director` panic or a `trigger_finale`; the
  arena uses BATTLEFIELD/BATTLESTATION and a nav region so tanks/witches do not spawn inside
  it. `director_stop` is **cheat-only** and is ignored in a normal client.
- The non-cheat no-infected pattern is a `logic_script` that sets
  `DirectorOptions.CommonLimit/MaxSpecials/TankLimit/WitchLimit/MobSpawnSize = 0` and
  re-applies it on a timer. Verified in game.
- Game modes: campaign/coop, versus, survival, scavenge, holdout. Each has its own goal and
  nav contracts; a campaign map can be made multi-mode compatible with extra survivor starts,
  finale/panic entities and nav regions. `check_campaign` checks mission modes, not gameplay.

## 6. Entities and mechanics worth having a contract for

| Job | Entities |
|---|---|
| Start / checkpoint | `info_player_start`, `info_survivor_position`, `func_nav_attribute_region`, `prop_door_rotating_checkpoint` |
| Transition | `info_changelevel`, `info_landmark`, `trigger_changelevel` (not L4D2's path) |
| Finale | `trigger_finale`, `env_outtro_stats`, `info_target nav_flow_target` (gauntlet), escape vehicle |
| Director | `info_director`, `logic_script`, `point_servercommand`, `logic_auto`, `logic_timer` |
| Weapons/items | `weapon_*_spawn` (rifle, smg, shotgun, sniper, pistol), `weapon_first_aid_kit_spawn`, `weapon_pain_pills_spawn`, `weapon_molotov_spawn`, `weapon_pipe_bomb_spawn`, `weapon_vomitjar_spawn`, `weapon_ammo_spawn` |
| Ambience | `env_soundscape`, `env_fog_controller`, `env_cubemap`, `light_environment`, `env_sun`, `func_precipitation` |
| Optimization | `func_areaportal`, `func_occluder`, `func_detail`, `func_lod`, hint/skip faces |
| Water/terrain | `func_water_analog`, `water_lod_control`, displacements, `detail.vbsp`/`detailmaterial` |
| Testing | `point_clientcommand`, `point_teleport`, `logic_timer`, `ent_fire`, `script_execute` |

The exact keyvalues are in `left4dead2.fgd`; `read_fgd_class` is the authority.

## 7. Optimization and limits

- Source is not an open-world engine. Block sightlines with buildings, terrain, fog, and
  areaportals; a long open sightline is both a performance and a pacing problem.
- `func_areaportal` needs a closed area and a portal brush; `func_occluder` hides a group of
  props behind it; `func_detail` keeps decorative brushes out of vis; hint/skip faces tell
  vvis where to cut.
- 32-bit ceilings (from `bspfile.h`): coordinates ±16384, brushes 8192, brush sides 65536,
  faces 65536, vertices 65536, planes 65536, texinfo 12288, texdata 2048, dispinfo 2048,
  models 1024, entities 8192, runtime edicts 2048, lighting/visibility 16 MB per mode.
- Compile `hdr: true` (`-both`) with a dual-mode sky (`_hdr` and `_ldr` faces); L4D2 stock
  maps store `sky_l4d_c1_1_hdr`, not `sky_l4d_c1_1`.
- `prop_static` solidity 6 requires the model's `.phy`; a model without one is non-solid.
  Mark grass/tree canopies/escalator overlays `spawnflags 2`; add clip brushes where a model
  must block.
- VPK size: keep under 2 GB; BSP under ~300 MB for a 32-bit process.

## 8. Asset pipeline

- Material names in a VMF are uppercase, no `materials/` prefix, no `.vmt` suffix.
- A VMT is not a texture: `$basetexture` must resolve to a VTF. `read_game_content(details)`
  and `preview_asset` are the two halves: existence and appearance.
- Models: bounds are around the origin; `read_model_info` gives `mins/maxs` and
  `hasPhysics`; `preview_asset` opens HLMV. HLMV's 3D canvas is blank on some desktops
  (OpenGL capture), so a preview-map fallback is still needed.
- Sky: `skybox/<skyname><side>.vmt`; stock names carry `_hdr`/`_ldr`. A bare base name is
  looked up literally and draws no sky.
- Water: `func_water_analog` volume + `water_lod_control`; not nav; boardwalk/bridge.
- Terrain: grid -> `write_displacement` -> `sculpt_displacement` -> `sew_displacements` ->
  `paint_displacement`; detail sprites only appear on displacement surfaces.

## 9. What our MCP already covers, and the gaps

| Area | Guides say | MCP today | Gap / next action |
|---|---|---|---|
| Addon/mission | folder, VPK, addoninfo | `write_campaign`, `check_campaign`, `run_vpk_pack`, canonical addoninfo | good |
| Mission modes | coop/versus/survival/scavenge | `write_campaign` modes | add a mode-specific validator |
| Hammer++ setup | x86, FGD, I/O commas, gameinfo | no health check for these | add to `health` / `read_source_games` |
| I/O delimiter | commas, ESC breaks | writer commas; linter now reports ESC | add a normalizer and parse both |
| FGD | stock + Tools++ | `read_fgd_class` reads stock | mount Tools++ FGD, tolerate `logic_script` (done) |
| Brush/entity editing | Hammer tools | `write_vmf_solid`, `edit_vmf`, `write_vmf_fitting` | good |
| Instances/visgroups/cordon | native concepts | `read_vmf`/instance tools | report active cordon; expand instances by default for counts? |
| Nav flow | goal, `nav_trouble_report` | `read_nav_dump` offline, `run_nav_generate` | add a tool that runs `nav_trouble_report` and returns structured findings |
| Checkpoint/finale | names, goals, trigger over FINALE | lint rules added | good; add finale stage validator |
| Finale script | `<map>_finale.nut`, DirectorOptions | `write_vscript` | add a finale template/validator and a campaign-menu test |
| Doors | hinge, jamb, swing | `placeDoor`, lint | expose a `place_door` tool; door assembly helper |
| Static props | solidity/.phy | `read_static_props`, `hasPhysics`, lint | good; clip-brush helper |
| Terrain | displacements | `write_vmf_terrain` | add paint/water convenience + height-aware prop placement |
| Water | `func_water_analog` | campaign manually | add `write_vmf_water` |
| Boundaries | vehicles/fences/trees/fog | recipe + campaign cliff | add `write_vmf_boundary` / 3D skybox helper |
| Optimization | areaportals/occluders/hints | readers (`read_visleaf_stats`, `read_sightlines`) | add writers for areaportal/occluder/hint-skip |
| Assets/eyes | all assets, previews | catalog + `preview_asset` (material works, model blank) | preview-map fallback; contact sheets; full index |
| Limits | 32-bit ceilings | `read_map_geometry`, docs | good; add a budget gate |
| Testing | compile/nav/play | `run_compile`, `run_nav_generate`, `run_map_test` | add one `run_campaign_gate` |

## 10. Priority backlog

1. **Campaign gate** — lint, compile, nav fresh, static prop collision, `nav_trouble_report`,
   `run_map_test` with the exact pair, screenshots. This is the single highest-value tool.
2. **Nav trouble-report tool** — run `nav_trouble_report` and parse orphan/missing
   goal/tiny/overlap, not just the dump.
3. **Finale validator + campaign-menu test** — type, script, trigger over FINALE, escape
   outputs; test from the menu, not `+map`.
4. **Hammer++ health** — x86 build, FGD, I/O delimiter, gameinfo, VPK compressor.
5. **Asset eyes** — preview-map fallback for models; contact sheet for a category; full
   material index with previews.
6. **Terrain/water/boundary writers** — `write_vmf_water`, boundary ring/3D skybox, paint
   height/slope, height-aware prop placement.
7. **Optimization writers** — areaportal/occluder/hint-skip plus a budget report.
8. **Mode validators** — survival/versus/scavenge goals and item/finale entities.

## Sources

1. World of Level Design, *L4D2/1: Visual Reference Guide to Level Design*.
   <https://www.worldofleveldesign.com/categories/left4dead2_mapping/l4d2-visual-gameplay-reference-guide-campaign-design.php>
2. Valve Developer Community, *L4D2 Campaign Add-on Tutorial*.
   <https://developer.valvesoftware.com/wiki/L4D2_Campaign_Add-on_Tutorial>
3. Valve Developer Community, *Left 4 Dead 2 level design*.
   <https://developer.valvesoftware.com/wiki/Left_4_Dead_2_level_design>
4. Valve Developer Community, *Checkpoints*.
   <https://developer.valvesoftware.com/wiki/L4D_Level_Design/Checkpoints>
5. Valve Developer Community, *Nav Flow*.
   <https://developer.valvesoftware.com/wiki/L4D_Level_Design/Nav_Flow>
6. Valve Developer Community, *Nav Meshes*.
   <https://developer.valvesoftware.com/wiki/L4D_Level_Design/Nav_Meshes>
7. Valve Developer Community, *Finale Events Part 1*.
   <https://developer.valvesoftware.com/wiki/L4D_Level_Design/Finale_Events_Part_1>
8. Valve Developer Community, *Custom Finale*.
   <https://developer.valvesoftware.com/wiki/L4D2_Level_Design/Custom_Finale>
9. Valve Developer Community, *Gauntlet Finale*.
   <https://developer.valvesoftware.com/wiki/L4D2_Level_Design/Gauntlet_Finale>
10. Valve Developer Community, *Sorting out Navigation Flow*.
    <https://developer.valvesoftware.com/wiki/Sorting_out_navigation_flow>
11. Qdude, *L4D2 Mapping Tutorials* (basics, navmesh, Director, panic, finales, multi-mode).
    <https://www.youtube.com/playlist?list=PLlSOQKLM6OlFJqGLXrEjDQFzwDf88GZ0S>
12. Valve Developer Community, *Hammer++*.
    <https://developer.valvesoftware.com/wiki/Hammer%2B%2B>
13. Ceno, *Setting up Hammer++ for the original game*.
    <https://steamcommunity.com/sharedfiles/filedetails/?id=3320444257>
14. Mrfunreal, *L4D2-FGD-Edits*.
    <https://github.com/Mrfunreal/L4D2-FGD-Edits>
15. Valve Developer Community, *Common L4D Mapping Problems*.
    <https://developer.valvesoftware.com/w?oldid=164160&title=Common_L4D_Mapping_Problems>
16. Valve Developer Community, *List of L4D Series Nav Mesh Attributes*.
    <https://developer.valvesoftware.com/wiki/List_of_L4D_Series_Nav_Mesh_Attributes>
17. Valve Developer Community, *Left 4 Dead Infected Populations*.
    <https://developer.valvesoftware.com/wiki/Left_4_Dead_Infected_Populations>
18. Source SDK 2013, `src/public/bspfile.h`.
    <https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/bspfile.h>
19. Hammer++ website, tools/updates.
    <https://ficool2.github.io/HammerPlusPlus-Website/>
20. Steam Community nav-flow threads.
    <https://steamcommunity.com/app/550/discussions/3/598517032946829432/>
