# L4D2 campaign authoring — what the guides agree on

A synthesis of the ten public references that matter most for an agent building a Left 4 Dead 2
campaign. Sources are listed at the end; this page turns them into contracts the tools check.

## Hammer++: the settings that decide whether the map works

- L4D2 is **32-bit** (or the `x86-64` beta branch). The current Hammer++ builds are x64;
  for a plain L4D2 install use the last x86 build. A x64 Hammer++ can open the map and write
  a VMF the 32-bit game tolerates, but its compilers and VPK tools may not match.
- **I/O delimiter must be commas.** In `hammerplusplus_settings.ini` set
  `IOParamNewDelimiter=0` (the "Use special I/O delimiter (ESC)" option off). ESC-separated
  outputs are the classic "entity I/O does nothing" bug; Hammer++ and Hammer write the
  commas L4D2 expects. The project's VMF writer also uses commas; `read_vmf_lint` reports
  `io-esc-delimiter` if a file has the ESC form.
- **FGD**: use the game's `left4dead2.fgd` and, for Hammer++, its bundled Tools++ FGD.
  Missing classes are a FGD-mount problem, not a nonexistent entity.
- **Game configuration**: copy the stock Hammer game/build settings; point Game Directory
  at `left4dead2`, Game Executable at `left4dead2.exe`, and the compile tools at
  `bin/vbsp.exe`, `bin/vvis.exe`, `bin/vrad.exe` (or the Tools++ builds).
- **Assets for Hammer++**: Hammer++ reads L4D2 VPKs; a custom asset VPK must be packed with
  L4D2's `vpk.exe` and mounted with a `gameinfo.txt` search path. Loose `materials/` and
  `models/` are simpler and work in both editor and game.
- **Instances are fullbright in the lighting preview and do not cast shadows**; that is a
  preview limitation, not a lighting error. Collapse instances before counting entities.
- **VisGroups, groups and cordon** are editor organization; they do not affect the compiled
  map. A VMF can carry a cordon that leaves geometry out, so `read_vmf` should say when one
  is active.
- **I/O is not a string**: an output is `target,input,parameter,delay,times`. A quote or a
  newline in a parameter breaks the VMF; the writer must refuse it.

## The campaign is a folder, then a VPK

- `addons/<name>.vpk` contains `addoninfo.txt`, `missions/<name>.txt`, `maps/<map>.bsp` +
  `.nav`, and optional `scripts/vscripts/`, `materials/`, `models/`, `sound/`.
- The mission base name **is** the campaign identity; the VPK base name should match it.
- `addoninfo.txt` keys are `addonSteamAppID`, `addontitle`, `addonauthor`, `addonversion`,
  `addonContent_Campaign`, `addonDescription` (the older `addonTitle` spelling is not read
  by every scanner).
- Test both places: the staging tree and the installed VPK. `check_campaign(vpk: ...)` reads
  the archive as installed.

## Map sequence and flow

| Map | Goal at the end |
|---|---|
| first | CHECKPOINT (start safe room carries CHECKPOINT + MISSION START) |
| middle | CHECKPOINT |
| last | FINALE |

- The Director builds flow **backwards from the goal**. A map with no goal, or with a goal
  the start cannot reach, reports `GetGoalArea: Cannot find end area` or
  `NAV ERRORS - Map is unplayable`.
- `z_debug 1` and `nav_trouble_report` are the diagnosis; never declare a mesh playable from
  the file existing. `read_nav_dump` is the offline check; `nav_trouble_report` runs the
  engine's 18 checks and returns the selected areas' coordinates. `run_campaign_gate` is the
  one call that runs both plus lint, compile, props, `check_finale` and a map test.
- A finale map needs `trigger_finale` **over** the FINALE area. If it is not, the escape
  route is chosen from the centre of the FINALE areas and the trigger disagrees with it.
- `trigger_finale` type 2 loads `scripts/vscripts/<map>_finale.nut`. `type 0` has no stage
  list and never reaches the escape phase; `type 1` is the gauntlet and needs
  `info_target nav_flow_target` near the rescue vehicle; `type 4` is Scavenge.
- The last map needs the disabled arrival `info_changelevel` (`spawnflags 2`) or the
  Director reports no exit checkpoint and refuses the finale.

## The safe room is a named contract

- `prop_door_rotating_checkpoint` on the safe room being **left** is named
  **`checkpoint_exit`**. On the safe room being **entered** it is
  **`checkpoint_entrance`**. `checkpoint_exit_door` is not the name the engine looks up.
- The door's origin is its **hinge**, two units inside a jamb; a 64 x 112 opening fits
  `checkpoint_door_02` (58.3 x 105.8). A 128/256 opening around a 58-unit leaf is a hole.
- Keep the swing arc clear: no prop within the leaf's width of the hinge. The lint
  `l4d2-door-swing-blocked` reports it.
- The safe room needs a **CHECKPOINT** nav region, an `info_changelevel`, a matching
  `info_landmark` in open space, and four `info_survivor_position` on a below-ground start.

## Boundaries, detail and terrain

- Source is not an open-world engine. Block the non-playable edge with **vehicles, fences,
  trees, buildings, cliffs** and fog, not an invisible wall; then reduce draw distance with
  areaportals/occluders. The eye should read a place, not a seam.
- Set-dress for story: traffic jams, barricades, dumped luggage, shop fronts, trash,
  posters. Details are what separate a box from a street. Keep door approaches and nav
  paths clear.
- Foliage does double duty: it hides the boundary and it is a spawn/ambush surface. Use
  grass models and detail sprites on terrain, not a flat green texture.
- Terrain is displacements: a grid, `write_displacement`, `sculpt_displacement` (noise,
  raise, slope), sew, paint by height/slope. A displaced brush stops contributing to the hull,
  so `write_vmf_terrain` seals every cell by default; for a hand-built patch pass
  `seal: true` or run `seal_displacements`.
- Water is `func_water_analog` plus `water_lod_control`; it is not nav. A boardwalk/bridge
  must join nav on both banks.

## Finale shape

- A custom finale is a stage list in `DirectorOptions`:
  `A_CustomFinale_StageCount`, `A_CustomFinale1..n`, `A_CustomFinaleValue1..n`, with
  `PANIC`, `TANK`, `DELAY`, `SCRIPTED`. `OnBeginCustomFinaleStage(num, type)` is the hook.
- The escape begins on `FinaleEscapeStarted`; the escape trigger fires
  `FinaleEscapeFinished` and `RollStatsCrawl`. A shipping campaign needs a real vehicle and
  a player-visible +use, not only `ForceFinaleStart` from a timer.
- Prepare the arena before the finale: weapons, health, ammo, a defensible holdout, and a
  one-way drop or closing door so the player cannot simply run back.

## Optimization and testing

- vvis likes closed rooms and areaportals; an open sightline from start to end is both a
  performance and a pacing failure. Fog is the cheap last layer, not the first.
- `prop_static` is solidity 6 by default and needs the model's `.phy`. A model without one
  is walked through; `read_static_props` and `read_model_info.hasPhysics` name it. Add a
  clip brush if the shape must block.
- Compile with `-both` and a dual-mode sky; L4D2's stock skies are `_hdr`/`_ldr` names.
- Test: lint -> compile -> nav fresh -> `read_static_props` -> `run_map_test` with the exact
  BSP/nav pair -> screenshots on the requested mechanics.

## Sources

1. World of Level Design, *L4D2/1: Visual Reference Guide to Level Design* — 61 rules for
   story, theme, boundaries, detail, safe rooms, finale preparation, light and optimization.
   <https://www.worldofleveldesign.com/categories/left4dead2_mapping/l4d2-visual-gameplay-reference-guide-campaign-design.php>
2. Valve Developer Community, *L4D2 Campaign Add-on Tutorial* — addon folder, mission file,
   VPK, maps/nav.
   <https://developer.valvesoftware.com/wiki/L4D2_Campaign_Add-on_Tutorial>
3. Valve Developer Community, *Left 4 Dead 2 level design* — index of checkpoints, nav flow,
   elevators, finales.
   <https://developer.valvesoftware.com/wiki/Left_4_Dead_2_level_design>
4. Valve Developer Community, *Checkpoints* — first/middle/last map goals and safe rooms.
   <https://developer.valvesoftware.com/wiki/L4D_Level_Design/Checkpoints>
5. Valve Developer Community, *Nav Flow* — goal areas, `z_debug`, `nav_trouble_report`.
   <https://developer.valvesoftware.com/wiki/L4D_Level_Design/Nav_Flow>
6. Valve Developer Community, *Finale Events Part 1* — `trigger_finale`, FINALE nav, escape
   vehicle.
   <https://developer.valvesoftware.com/wiki/L4D_Level_Design/Finale_Events_Part_1>
7. Valve Developer Community, *Custom Finale* — `<map>_finale.nut`, DirectorOptions stages,
   `OnBeginCustomFinaleStage`.
   <https://developer.valvesoftware.com/wiki/L4D2_Level_Design/Custom_Finale>
8. Valve Developer Community, *Gauntlet Finale* — type 1 and `info_target nav_flow_target`.
   <https://developer.valvesoftware.com/wiki/L4D2_Level_Design/Gauntlet_Finale>
9. Valve Developer Community, *Sorting out Navigation Flow* — checkpoint door names
   `checkpoint_exit` / `checkpoint_entrance`, elevator nav.
   <https://developer.valvesoftware.com/wiki/Sorting_out_navigation_flow>
10. Qdude, *L4D2 Mapping Tutorials* — safe rooms (#5), Director scripts (#9), finales (#14),
    practical Hammer workflows.
    <https://www.youtube.com/watch?v=R1q0B5qoAe8> · <https://www.youtube.com/watch?v=RI0FbBWdA6o> · <https://www.youtube.com/watch?v=yoGZeuXU4vE>
11. Steam Community, *Nav flow Issue (SOLVED)* and *Navigation Mesh* threads — the
    “nav past the end checkpoint” failure and its diagnosis.
    <https://steamcommunity.com/app/550/discussions/3/598517032946829432/>
12. Left 4 Dead Wiki, *Custom Campaigns* — installation and VPK placement.
    <https://left4dead.fandom.com/wiki/Custom_Campaigns>
13. Ceno, *Setting up Hammer++ for the original game* — x86 build, Game/Build Programs,
    `IOParamNewDelimiter=0`, VPK split, asset mount.
    <https://steamcommunity.com/sharedfiles/filedetails/?id=3320444257>
14. Valve Developer Community, *Hammer++* and the compatibility template — the ESC
    delimiter setting must be off; instances are fullbright; x86-64 beta caveat.
    <https://developer.valvesoftware.com/wiki/Hammer%2B%2B>
15. Valve Developer Community, *Common L4D Mapping Problems* — compile setup, leaks,
    invalid solids, the failures that look like a broken editor.
    <https://developer.valvesoftware.com/w?oldid=164160&title=Common_L4D_Mapping_Problems>
17. Valve Developer Community, *List of L4D Series Nav Mesh Attributes* — CHECKPOINT,
    FINALE, NO_MOBS, RESCUE_VEHICLE and the rest.
    <https://developer.valvesoftware.com/wiki/List_of_L4D_Series_Nav_Mesh_Attributes>
18. Valve Developer Community, *Left 4 Dead Infected Populations* — Director populations
    and spawn tuning.
    <https://developer.valvesoftware.com/wiki/Left_4_Dead_Infected_Populations>
19. Source SDK 2013, `src/public/bspfile.h` — the compiler ceilings used by
    `read_map_geometry`.
    <https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/bspfile.h>

The tool contracts behind this page are in `docs/reference/engine-limits-l4d2.md`,
`references/nav/generation.md`, `references/campaign/safe-room-and-transition.md`,
`references/campaign/finale.md` and `references/campaign/custom-finale.md`.
