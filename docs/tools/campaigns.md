# Campaigns

21 tools: mission files, modes, finales, gates, posters and campaign scaffolding.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Campaign and mission files

| Tool | What it does |
|---|---|
| `check_campaign` | Checks a campaign against the files it references: every chapter's .bsp exists in a maps directory or in a VPK, every chapter image exists under materials/vgui, chapter numbering has no gaps, and every mode has chapters. |
| `check_finale` | Checks a finale as a contract, not as a trigger that exists. |
| `check_modes` | Checks each mission mode against the maps it lists, without the engine: scavenge needs `weapon_scavenge_item_spawn`; survival needs a `trigger_finale`/`func_finale` or the timer never starts; the last coop/versus chapter needs a finale or a changelevel; a map repeated inside one mode is a warning; a mode name outsid... |
| `read_campaign` | Reads a Left 4 Dead 2 campaign file: the `mission` block, its modes (coop, versus, survival, scavenge) and each mode's numbered chapters with the map, display name and image. |
| `read_mission_poster` | Reads the `poster` block of a mission file: `posterImage`, the widescreen variant, `fullscreen` and every extra key. |
| `run_campaign_gate` | Runs a campaign through one gate instead of a checklist an agent can forget: mission check, VMF lint, compile, nav generation with the string-table dictionary baked, a fresh BSP/nav pair, static-prop collision, every chapter transition (door class near the landmark, matching landmark, arrival volume), the finale con... |
| `write_campaign` | Writes a campaign file from a name and a list of modes with numbered chapters. |
| `write_intro_camera` | Writes a `point_viewcontrol` and a `logic_auto` that enables it OnMapSpawn, optionally disabling it after `holdSeconds` through a `logic_timer`. |
| `write_item_spawns` | Places item/weapon spawners at points: the L4D2 `weapon_*_spawn` classes, with an optional `count`, skin or classname override for a spawner the enum does not list. |
| `write_mission_poster` | Sets a campaign mission's `poster` block: `posterImage`, optional `posterImage_widescreen`, and `fullscreen`. |
| `write_rescue_closet` | Writes an `info_survivor_rescue` point, plus optional ordered survivor positions for the rescue closet. |
| `write_saferoom_stock` | Places a row of saferoom stock at an origin: medkit, pills, ammo and pistols by default, or a chosen list. |
| `write_zombie_border` | Writes an `info_zombie_border` point, the marker that tells the Director where infected spawning stops. |

## Campaign scaffolding

| Tool | What it does |
|---|---|
| `check_campaign_wiring` | Checks chapters against each other, which no single-map tool can. |
| `check_transition` | Checks one chapter pair, both ways, which neither chapter can answer alone: the departure `info_changelevel` names the next map and carries a landmark that exists in both maps, the arrival volume has `spawnflags 2`, and each safe room has a `prop_door_rotating_checkpoint` **within 1024 units of that landmark**. |
| `write_changelevel` | Writes a chapter transition as the pair the engine uses: an `info_changelevel` brush volume with `map` and `landmark`, and an `info_landmark` point with that name. |
| `write_finale_setup` | Writes the finale end of a campaign: a `trigger_finale` with the game's type numbers (standard 0, gauntlet 1, custom 2, scavenge 4), its model, optional ScriptFile, and up to four ordered `info_survivor_position`s for the escape. |
| `write_map_parameters` | Writes `info_map_parameters` (or the versus variant) with the 18 item-density keys the game reads, named the way a mapper says them: pistol, ammo, painPills, adrenaline, defibrillator, molotov, pipeBomb, vomitJar, meleeWeapon, chainsaw, gasCan, oxygenTank, propaneTank, upgradepack, magnum, configurableWeapon, itemCl... |
| `write_safe_room` | Builds a chapter's safe room in one call: a `prop_door_rotating_checkpoint` with its origin on the hinge (through place_door, so the model hull decides the swing), an `info_player_start`, four `info_survivor_position`s and the map's `info_director` if it has none. |
| `write_safe_room_prefab` | Places an official house prefab (default `prop_swamphouse01`) and wires it as a chapter safe room in the same call: the prefab is pasted with a targetname prefix, then `write_safe_room` adds the `prop_door_rotating_checkpoint`, `info_player_start`, four survivor positions and the Director. |
| `write_spawn_points` | Writes the entities a map spawns from, as a family rather than one class: one `info_player_start`, one to four ordered `info_survivor_position`s, one or more `info_zombie_spawn`s (with population and offer_tank), or `info_survivor_rescue`. |
