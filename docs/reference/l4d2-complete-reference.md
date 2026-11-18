# Left 4 Dead 2 — the complete reference for map authors and agents

**Purpose.** This is the deep-research companion to the skill: what L4D2 is, what its
mechanics actually do, which entity or cvar owns each one, and which values are the game's
defaults. It is not a walkthrough. The campaign in `campaigns/002-night-moscow/` is an
acceptance test, not the subject.

**How the numbers were obtained.** Every default below was read from the installed game,
not from memory:

- `left4dead2/bin/server.dll` and `bin/engine.dll`: `find <prefix>` in the running console,
  captured through `run_map_test(commands: [...])` and `-condebug`.
- `left4dead2.fgd` + `base.fgd` (446 classes): `read_fgd_class`.
- `pak01_dir.vpk`: `scripts/population.txt`, `scripts/weapon_*.txt`,
  `scripts/melee/*.txt`, `missions/*.txt`.
- The decompiled stock VScripts (`director_base.nut`, `director_gauntlet.nut`,
  `c1m4_atrium_finale.nut`, `c2m5_concert_finale.nut`, `c4m5_milltown_escape_finale.nut`)
  from the L4D2-Decompiled mirror.
- The existing project tests in `docs/reports/` and `skill/.../mechanics/`.

Where a number is a cvar default, it is the **base game** value; difficulty, Director
options and mode cvars can change it.

---

## 1. What the game is

Left 4 Dead 2 is a Source 1 co-op shooter built on the 2009 engine branch with later
backports. The installed engine is **32-bit** (an `x86-64` beta exists). A map is a `.bsp`
compiled by `vbsp`, `vvis`, `vrad`; the game reads it from `left4dead2/maps` or an add-on
VPK. A campaign is a mission file plus one or more maps plus optional VScripts and assets.

Two consequences drive everything in this project:

- **The nav mesh is not optional.** Without a `.nav` whose recorded BSP size matches the
  shipped `.bsp`, the map loads with `NAV ERRORS / Map is unplayable`. The Director, bots,
  common infected and item placement all run on nav.
- **The Director is the game.** A map supplies geometry, nav attributes, spawn points, items
  and events; the Director decides when and where the infected arrive. A beautiful map with
  no nav attributes is a diorama.

## 2. Campaign and mission file

A campaign is a directory packed into `addons/<name>.vpk`:

```
addoninfo.txt
missions/<campaign>.txt        base name == VPK base name
maps/<map>.bsp + <map>.nav
scripts/vscripts/<map>_finale.nut
materials/...  models/...  sound/...
```

`addoninfo.txt` canonical keys: `addonSteamAppID` (550), `addontitle`, `addonauthor`,
`addonversion`, `addonContent_Campaign`, `addonDescription`. The old `addonTitle`/`addonDesc`
spellings are not read by every scanner.

### 2.1 Mission file fields (from the stock campaigns)

| Key | Meaning |
|---|---|
| `Name` | Internal mission name; the VPK base name should match the mission file name |
| `Version` | Mission format version |
| `Author`, `Website` | Metadata |
| `DisplayTitle`, `Description` | Localisation tokens or plain text |
| `Image` | Campaign image under `materials/vgui/maps/` |
| `OuttroImage` | End-of-campaign image |
| `meleeweapons` | Semicolon list of melee weapons available in the campaign |
| `survivor_set` | `1` = L4D1 survivors, `2` = L4D2 survivors (holdout uses this) |
| `BuiltIn` | `0` for a custom campaign |
| `poster` | Loading-poster block: `posterImage`, `posterImage_widescreen`, `posterTitle`, `posterTagline`, character-name coordinates, `character_order` |
| `modes` | `coop`, `versus`, `survival`, `scavenge`, `holdout` |
| `x360ctx`, `x360leaderboard` | Console metadata; harmless on PC |
| `VersusCompletionScore` | Per-chapter Versus travel score |
| `convar` blocks | Per-chapter launch cvars |

`read_campaign` preserves unknown keys; `write_campaign` writes the structural fields and
accepts extra keyvalues.

### 2.2 Modes and their map contract

| Mode | Mission entry | What the map must supply |
|---|---|---|
| Coop | `coop` | Start checkpoint, chapter checkpoints, finale on the last map, nav, items |
| Versus | `versus` | Same map, plus balanced spawns; `VersusCompletionScore`; no finale-only assumptions |
| Survival | `survival` | A defensible arena, a finale/panic trigger to start the wave, nav, item spawns |
| Scavenge | `scavenge` | 16 `weapon_scavenge_item_spawn`, a generator/escape, nav; one map per round |
| Holdout | `holdout` | An arena with a `trigger_standoff`, resupply, nav; used by `holdoutchallenge.txt` |
| Mutation / ScriptedMode | `coop` entry + mutation VScript | The mode script owns the rules; the map still needs nav and a spawn |

Mode is chosen with `+mp_gamemode <mode>` before `+map`. A single-player listen server does
not populate both teams, so Versus/Scavenge tests can prove the mode script and map load,
not a full round.

## 3. Map flow: start, checkpoint, transition, finale

| Chapter | Start | End goal |
|---|---|---|
| First | `PLAYER_START` + `CHECKPOINT` (+ `MISSION START`) | `CHECKPOINT` |
| Middle | `CHECKPOINT` | `CHECKPOINT` |
| Last | `CHECKPOINT` | `FINALE` |

- `info_player_start` is the survivor spawn. A below-ground start also needs four
  `info_survivor_position` entities (one per survivor) or the Director cannot place them.
- `func_nav_attribute_region` applies nav flags during generation. The L4D2 flags are:
  `2` Empty (no wanderers), `32` Battlestation, `64` Finale, `128` Mission Start,
  `256` Battlefield, `1024` Not Clearable, `2048` Checkpoint, `4096` Obscured,
  `8192` No Mobs, `32768` Rescue Vehicle, `65536` Rescue Closet, `524288` No Threat,
  `1048576` Lying Down. Extra keys: `mob_only`, `precise`, `remove_attributes`, `crouch`,
  `stairs`, `tank_only`.
- `info_changelevel` is a **brush** with `map`, `landmark`, and on the arrival map
  `spawnflags 2` (disabled). It marks where the team leaves and where they arrive.
- `info_landmark` is the same point in both maps. Entities transition relative to it.
- Safe-room doors are looked up by name: **`checkpoint_exit`** on the room being left,
  **`checkpoint_entrance`** on the room being entered. `checkpoint_exit_door` is not the
  name.
- `trigger_changelevel` is not the L4D2 path. Use `info_changelevel` + `info_landmark`.
- The last map also needs the disabled arrival `info_changelevel`; without it the Director
  can report `No exit checkpoint could be found` and refuse the finale.

## 4. Nav: the Director's world model

The nav mesh is a set of areas, each with a centre, four corners, flags and connections.
The Director computes **flow** backwards from the goal area; bots and infected path on it.

- Goals: `CHECKPOINT` or `FINALE`. A map with neither is `no-goal`; a goal with no flow path
  is `no-flow`; both read in game as `NAV ERRORS`.
- `func_nav_attribute_region` marks regions during `nav_generate`; `point_nav_attribute_region`
  does the same from a point with `mins`/`maxs`.
- `func_nav_blocker` blocks areas touching its AABB; `func_nav_avoidance_obstacle` makes
  them avoided; `func_nav_connection_blocker` blocks a connection.
- `nav_place_set` / `nav_use_place` assign place names. `scripts/population.txt` uses those
  places to choose common-infected models (`default`, `defaulturban`, `hospital`, `airport`,
  `defaultswamp`, `crescentcity`, `zoo`, etc.).
- `nav_slope_limit` default **0.7** (about 45°). `nav_coplanar_slope_limit` 0.99 (displacement
  0.7). `nav_area_max_size` 50. `nav_corner_adjust_adjacent` 18. `nav_flow_max_survivor_climb_height`
  66; `..._drop_height` 240. `nav_obscure_range` 400. `nav_lying_down_percent` 50.
  `nav_max_auto_area_size` 16384. `nav_quicksave` 1.
- `nav_trouble_report` runs 18 checks: orphan, missing Battlefield/Finale/Checkpoint/
  Mission Start, overlap, corner-to-corner, non-walkable connections, ladders, tiny areas,
  etc. It selects the offending areas. L4D2 has **no** `nav_dump_selected_set_positions`;
  `nav_save_selected` writes `maps/<map>_selected_####.txt` with four corners, attributes
  and connections.
- The engine writes `<map>_nav.txt` beside the generated `.nav`: area centres, connection
  counts, base/terror flags. `read_nav_dump` parses it offline; `nav_trouble_report` is the
  live oracle.
- `nav_generate` needs `sv_cheats 1` and `nav_edit 1`; the game writes the nav on map
  shutdown. Bake the string-table dictionary **before** generating, or the nav records a
  BSP size that the shipped file no longer has.

## 5. The Director

`info_director` is the map's handle on the Director. Its inputs include `PanicEvent`,
`ForcePanicEvent`, `ScriptedPanicEvent`, `EndCustomScriptedStage`, `ForceSurvivorPositions`,
`ReleaseSurvivorPositions`, `FinishIntro`, `StartIntro`, `CreateNewJournal`,
`WriteToJournal`, `ExecuteJournal`, `IncrementTeamScore`, `RunScriptCode`, `RunScriptFile`.
Outputs include `OnGameplayStart`, `OnPanicEventFinished`, `OnCustomPanicStageFinished`,
`OnScavengeRoundStart`, `OnScavengeTimerExpired`, `OnScavengeOvertimeStart`,
`OnScavengeOvertimeCancel`, `OnScavengeIntensityChanged`, `OnTeamScored`, `OnKilled`.

### 5.1 Director state and defaults

| Cvar | Default | Meaning |
|---|---|---|
| `director_intensity_threshold` | 0.9 | Intensity at which the Director builds a peak |
| `director_intensity_relax_threshold` | 0.9 | Intensity below which it relaxes |
| `director_relax_min_interval` / `_max_interval` | 30 / 45 | Seconds between relax checks |
| `director_relax_max_flow_travel` | 3000 | Max flow travel while relaxing |
| `director_build_up_min_interval` | 15 | Min seconds between build-ups |
| `director_sustain_peak_min_time` / `_max_time` | 3 / 5 | Peak hold time |
| `director_clear_count` / `director_clear_timeout` | 2.0 / 10.0 | Area clear checks |
| `director_threat_radius` / `director_threat_clear_radius` | 1000 / 500 | Threat area sizes |
| `director_max_threat_areas` | 4 | Threat area cap |
| `director_special_respawn_interval` | 45 | Seconds between special spawns |
| `director_special_initial_spawn_delay_min` / `_max` | 30 / 60 | First special delay |
| `director_special_initial_spawn_delay_max_extra` | 180 | Extra delay cap |
| `director_special_original_offer_length` | 30 | Special offer window |
| `director_special_finale_offer_length` | 10 | Finale special offer |
| `director_tank_min_interval` / `_max_interval` | 350 / 500 | Tank timing |
| `director_tank_checkpoint_interval` | 15 | Tank checkpoint check |
| `director_custom_finale_tank_spacing` | 10.0 | Tank spacing in a custom finale |
| `director_finale_panic_waves` | 2 | Stock finale panic waves |
| `director_finale_stage_delay` | 5 | Stock finale stage delay |
| `director_ready_duration` / `_radius` | 60 / 300 | Safe-room ready window |
| `director_ingress_range` | 3000 | Spawn ingress range |
| `director_unfreeze_time` | 55 | Intro unfreeze |
| `director_transition_timeout` | 120 | Chapter transition timeout |

Useful test switches (all default 0): `director_no_mobs`, `director_no_specials`,
`director_no_bosses`, `director_no_survivor_bots`, `director_force_tank`,
`director_force_witch`, `director_panic_forever`, `director_short_finale`.
`director_start`/`director_stop` are **cheat-only**; do not use them in a normal client.

### 5.2 DirectorOptions (VScript)

`DirectorOptions` is a Squirrel table. It can be defined in the DirectorScript, MapScript,
MapScript.LocalScript and ChallengeScript; `GetDirectorOptions()` delegates from the first
to the later scopes, so a map script can override a mode default. Common keys (stock
scripts and the wiki):

| Group | Keys |
|---|---|
| Spawning | `CommonLimit`, `MaxSpecials`, `MobSpawnSize`, `MobSpawnMinTime`, `MobSpawnMaxTime`, `MobMinSize`, `MobMaxSize`, `MegaMobSize`, `MegaMobMinSize`, `MegaMobMaxSize`, `SpecialRespawnInterval`, `ZombieSpawnRange`, `ZombieSpawnInFog`, `PreferredMobDirection`, `PreferredSpecialDirection`, `ShouldConstrainLargeVolumeSpawn` |
| Bosses | `TankLimit`, `WitchLimit`, `ProhibitBosses`, `ShouldAllowSpecialsWithTank`, `ShouldAllowMobsWithTank`, `EscapeSpawnTanks`, `TankLimit` |
| Panic | `PanicForever`, `PausePanicWhenRelaxing`, `IntensityRelaxThreshold`, `RelaxMinInterval`, `RelaxMaxInterval`, `RelaxMaxFlowTravel`, `LockTempo`, `SustainPeakMinTime`, `SustainPeakMaxTime`, `MobRechargeRate` |
| Finale | `A_CustomFinale_StageCount`, `A_CustomFinale1..n`, `A_CustomFinaleValue1..n`, `A_CustomFinaleMusic1..n`, `HordeEscapeCommonLimit`, `BileMobSize`, `MusicDynamicMobSpawnSize`, `MusicDynamicMobStopSize` |
| Gauntlet | `GauntletMovementThreshold`, `GauntletMovementTimerLength`, `GauntletMovementBonus`, `GauntletMovementBonusMax`, `BridgeSpan`, `minSpeed`, `maxSpeed`, `speedPenaltyZAdds` |
| Item/health | `director_convert_pills` (cvar), `director_convert_pills_critical_health`, `director_convert_pills_to_defib_health` |

`OnBeginCustomFinaleStage(num, type)` runs when a custom finale enters a stage. `Update()`
runs periodically. `RecalculateLimits()` is a convention used by gauntlet scripts to scale
the common limit with progress and survivor speed.

### 5.3 Panic and crescendo

A crescendo is a triggered horde:

```
func_button -> director,ForcePanicEvent
info_director.OnPanicEventFinished -> reward_relay,Trigger
func_nav_attribute_region (BATTLEFIELD 256) over the arena
func_nav_attribute_region (BATTLESTATION 32) at the hold spot
```

`BATTLEFIELD` makes the Director spawn the wave inside the region and stops ordinary
spawning while survivors stand in it. `BATTLESTATION` marks the intended hold spot.
`ScriptedPanicEvent <script>` runs a `.nut`; the script must call
`EndCustomScriptedStage` or the stage never completes. The verified test reached
`STAGE_INITIAL_DELAY → STAGE_MEGA_MOB → STAGE_WAIT_FOR_COMBAT_TO_END → STAGE_DONE` in 51 s.

## 6. Finales

`trigger_finale` is a point entity with a model (default `models/props_misc/german_radio.mdl`).
Keys: `type`, `ScriptFile`, `StartDisabled`, `FirstUseDelay`, `UseDelay`,
`IsSacrificeFinale`, `VersusTravelCompletion`, `model`, `angles`, `vscripts`.
Inputs: `ForceFinaleStart`, `AdvanceFinaleState`, `Enable`, `Disable`, `FinaleEscapeFinished`,
`FinaleEscapeForceSurvivorPositions`, `FinaleEscapeVehicleReadyForSurvivors`,
`GauntletStopPanic`, `SacrificeEscapeFailed`, `SacrificeEscapeSucceeded`,
`SacrificePlayerBeginsRun`.
Outputs: `FinaleStart`, `FinaleEscapeStarted`, `EscapeVehicleLeaving`, `FinaleWon`,
`FinaleLost`, `FirstUseStart`, `UseStart`, `FinalePause`.

Types:

| `type` | Name | What it needs |
|---|---|---|
| 0 | Standard | A finale area, a panic/escape sequence, a rescue vehicle or escape |
| 1 | Gauntlet | `info_target nav_flow_target` near the rescue vehicle; continuous panic |
| 2 | Custom | `scripts/vscripts/<map>_finale.nut` (or `ScriptFile`); `DirectorOptions` stage list |
| 4 | Scavenge | Gas cans and a generator/escape; usually in Scavenge mode |

The trigger must be **over** the FINALE nav area. The escape route is chosen from the
FINALE area centres; a trigger elsewhere disagrees with it. `FinaleEscapeStarted` is the
event that enables the escape (a `trigger_escape`, a vehicle, a door). `FinaleEscapeFinished`
gives the survivors victory; `env_outtro_stats` runs the campaign stats/credits. A real map
uses a vehicle and a player `+use`, not only `ForceFinaleStart`.

### 6.1 Custom finale stage machine

Stage types in `DirectorOptions` (stock scripts):

| Value | Name | `A_CustomFinaleValueN` |
|---|---|---|
| 0 | `PANIC` | Number of panic waves |
| 1 | `TANK` | Number of tanks |
| 2 | `DELAY` | Seconds to wait |
| 3 | `ONSLAUGHT` / `SCRIPTED` | A VScript name, or `""` for nothing |

`A_CustomFinale_StageCount = N` and `A_CustomFinale1..N` define the sequence. Optional
`A_CustomFinaleMusicN` overrides the music for that stage. The stock `c2m5_concert_finale.nut`
uses 9 stages: PANIC, PANIC, DELAY 15, TANK, DELAY 15, PANIC, DELAY 10, TANK, DELAY random
5–10. `c4m5_milltown_escape_finale.nut` uses 8: PANIC, DELAY 10, TANK, DELAY 10, PANIC,
DELAY 10, TANK, DELAY 15.

`OnBeginCustomFinaleStage(num, type)` receives the 1-based stage number and the type. Stock
scripts clear `MapScript.DirectorOptions`, copy a `SharedOptions` table, then merge a
`PanicOptions`/`TankOptions` table for the stage. `A_CustomFinale_StageCount` shorter than
the number of stages is a real failure: the finale stops at the first missing stage.

### 6.2 Escape and victory

- `trigger_escape` is a brush volume that tells the finale whether survivors are inside.
- `FinaleEscapeStarted` should enable the escape trigger/vehicle.
- `FinaleEscapeFinished` (input to `trigger_finale`) wins the campaign.
- `env_outtro_stats` is the stats entity; `RollStatsCrawl`/credits follow.
- A finale without `FinaleEscapeStarted` wiring can start and never end.

## 7. Survivors and infected

### 7.1 Survivors

| Stat | Base value |
|---|---|
| Health | 100 |
| Incapacitated at | 0 health; revived with a fraction, then black-and-white |
| First aid kit | Heals 80% of missing health |
| Pain pills | +50 temporary health, decays |
| Adrenaline | +25 temporary health, faster actions, decays |
| Defibrillator | Revives a dead survivor |
| Shove | Pushes infected, interrupts specials, no damage |
| Melee | A melee weapon or the shove; melee weapons have their own damage/refire |

Friendly fire, difficulty and Director cvars modify these. `director_convert_pills` (1)
converts pills to defibrillators at critical health; `director_convert_pills_critical_health`
50 and `..._to_defib_health` 25 are the thresholds.

### 7.2 Common and special infected (cvar defaults)

| Infected | Health | Speed | Limit |
|---|---|---|---|
| Common | `z_health` 50 | `z_speed` 250; walk 85; crouch 75 | `z_common_limit` 30; `z_background_limit` 20 |
| Boomer | `z_exploding_health` 50 | `z_exploding_speed` 175 | `z_boomer_limit` 1 |
| Smoker | `z_gas_health` 250 | `z_gas_speed` 210 | `z_smoker_limit` 1 |
| Hunter | `z_hunter_health` 250 | `z_hunter_speed` 300 | `z_hunter_limit` 1 |
| Spitter | `z_spitter_health` 100 | `z_spitter_speed` 210 | `z_spitter_limit` 1 |
| Jockey | `z_jockey_health` 325 | `z_jockey_speed` 250 | `z_jockey_limit` 1 |
| Charger | `z_charger_health` 600 | charge 250→500 | `z_charger_limit` 1 |
| Tank | `z_tank_health` 4000; incap 5000 | `z_tank_speed` 210; walk 100 | Director |
| Witch | `z_witch_health` 1000 | `z_witch_speed` 300; incited 200 | Director |

Other useful defaults: `z_mega_mob_size` 50, `z_mega_mob_spawn_min_interval` 420,
`..._max_interval` 900, `z_minion_limit` 3, `z_finale_spawn_safety_range` 300,
`z_finale_spawn_tank_safety_range` 600, `z_cooldown_spawn_safety_range` 1000,
`z_spawn_flow_limit` 1500, `z_difficulty` Normal. `z_spawn <class>` and `z_health`/`z_kill`
are cheat/test tools.

### 7.3 Director spawning rules

- The Director spawns from nav areas, not only `info_zombie_spawn`; nav attributes are the
  real control (`NO MOBS`, `BATTLEFIELD`, `FINALE`, `CHECKPOINT`, `EMPTY`).
- `info_zombie_border` stops spawns behind it. `info_zombie_spawn` names a population and
  can offer a tank.
- `BATTLEFIELD` confines a panic wave; `BATTLESTATION` marks the hold spot; `NO MOBS`
  suppresses ordinary spawns in a region (not a finale).
- `director_no_mobs`, `director_no_specials`, `director_no_bosses` are the clean test switches;
  `director_stop` is cheat-only and ignored in a normal client.

## 8. Weapons, items and density

### 8.1 Guns (from `scripts/weapon_*.txt`)

| Weapon (script) | Tier | Damage | Pellets | Cycle | Clip | Range |
|---|---|---|---|---|---|---|
| Pistol | 0 | 36 | 1 | 0.15 | 15 | 2500 |
| Magnum | 0 | 80 | 1 | 0.15 | 8 | 3500 |
| SMG | 1 | 20 | 1 | 0.0625 | 50 | 2500 |
| Silenced SMG | 1 | 25 | 1 | 0.0625 | 50 | 2200 |
| MP5 | 1 | 24 | 1 | 0.075 | 50 | 2500 |
| Pump shotgun | 1 | 25 × 10 | 10 | 0.5 | 8 | 3000 |
| Chrome shotgun | 1 | 31 × 8 | 8 | 0.5 | 8 | 3000 |
| Assault rifle | 2 | 33 | 1 | 0.0875 | 50 | 3000 |
| Desert rifle | 2 | 44 | 1 | 0.07 | 60 | 3000 |
| AK-47 | 2 | 58 | 1 | 0.13 | 40 | 3000 |
| SG552 | 2 | 33 | 1 | 0.0825 | 50 | 3000 |
| Auto shotgun | 2 | 23 × 11 | 11 | 0.15 | 10 | 3000 |
| SPAS | 2 | 28 × 9 | 9 | 0.15 | 10 | 3000 |
| Hunting rifle | 2 | 90 | 1 | 0.25 | 15 | 8192 |
| Military sniper | 2 | 90 | 1 | 0.25 | 30 | 8192 |
| AWP | 2 | 115 | 1 | 1.05 | 20 | 8192 |
| Scout | 2 | 90 | 1 | 0.9 | 15 | 8192 |
| Chainsaw | special | 36 | — | 0.175 | 30 fuel | melee |
| Grenade launcher | special | 33 + splash | 1 | 0.5 | 1 | 3000 |

The M60 has no `scripts/weapon_rifle_m60.txt` on this install; its values are engine-side,
so read them with `find`/`z_` or a play test rather than copying a number. The values above
are the scripts' base numbers; difficulty, distance falloff (`RangeModifier`), penetration
and the Director's upgrade chance change the result. `scripts/weapon_*.txt` and
`read_game_content` are the authority for a specific install.

### 8.2 Placement classes

`weapon_<gun>_spawn`, `weapon_ammo_spawn`, `weapon_first_aid_kit_spawn`,
`weapon_pain_pills_spawn`, `weapon_adrenaline_spawn`, `weapon_defibrillator_spawn`,
`weapon_molotov_spawn`, `weapon_pipe_bomb_spawn`, `weapon_vomitjar_spawn`,
`weapon_upgradepack_incendiary_spawn`, `weapon_upgradepack_explosive_spawn`,
`weapon_melee_spawn`, `weapon_gascan_spawn`, `weapon_scavenge_item_spawn`,
`weapon_spawn` (random weapon), `weapon_item_spawn` (random item).

Rules: place on a nav area, just above the floor; safe-room items are forced; outside safe
rooms the Director controls density. `info_map_parameters` overrides density; values are
**items per 100×100 yards**. Defaults: most 6.48, pistols 4, magnum and configurable weapon
`-1` (disabled), chainsaw/upgrade 1.0, finale item clusters 3, cluster range 50, weapon
cluster range 100. `info_map_parameters_versus` has its own table (defibrillator 2.5,
upgrade 1.0, etc.).

### 8.3 Melee

`scripts/melee/*.txt` define `damage`, `refire_delay`, `damage_flags`, viewmodel,
playermodel, sounds and animations. A melee weapon is a `weapon_melee_spawn`; the campaign's
`meleeweapons` list controls which ones appear. Melee does not use ammo; the chainsaw uses
fuel. Melee is the fallback when a survivor is out of ammo, and a shove is the no-damage
interrupt.

## 9. Entities by job

The full schema is `read_fgd_class` (446 classes). The L4D2-specific ones that decide a map:

| Job | Entities |
|---|---|
| Start / checkpoint | `info_player_start`, `info_survivor_position`, `prop_door_rotating_checkpoint`, `func_nav_attribute_region`, `point_nav_attribute_region` |
| Transition | `info_changelevel` (brush), `info_landmark`, `info_transition` |
| Director | `info_director`, `info_zombie_spawn`, `info_zombie_border`, `logic_director_query`, `func_nav_blocker`, `func_nav_avoidance_obstacle`, `func_nav_connection_blocker` |
| Finale | `trigger_finale`, `trigger_escape`, `trigger_standoff`, `env_outtro_stats`, `info_target nav_flow_target`, `info_survivor_position` |
| Panic / crescendo | `func_button`, `trigger_once`, `trigger_multiple`, `logic_relay`, `logic_timer`, `info_director` |
| Items | `weapon_*_spawn`, `weapon_ammo_spawn`, `weapon_scavenge_item_spawn`, `info_map_parameters`, `info_map_parameters_versus`, `info_gamemode` |
| Health / stations | `prop_health_cabinet`, `weapon_first_aid_kit_spawn`, `weapon_defibrillator_spawn`, `prop_minigun`, `prop_mounted_machine_gun` |
| Ambience | `env_fog_controller`, `env_soundscape`, `env_cubemap`, `light_environment`, `env_sun`, `func_precipitation`, `env_steam`, `env_sprite`, `point_spotlight`, `env_projectedtexture` |
| Optimization | `func_areaportal`, `func_areaportalwindow`, `func_occluder`, `func_detail`, `func_detail_blocker`, `func_detail_illusionary`, `func_lod`, `func_nobevel` |
| Logic / scripting | `logic_auto`, `logic_relay`, `logic_timer`, `logic_script`, `point_servercommand`, `point_clientcommand`, `point_template`, `env_entity_maker`, `scripted_item_drop` |
| L4D2 specials | `func_button_timed`, `func_elevator`, `func_buildable_button`, `trigger_upgrade_laser_sight`, `trigger_active_weapon_detect`, `trigger_auto_crouch`, `env_weaponfire`, `logic_versus_random`, `point_script_use_target` |

`logic_script` is omitted from the stock FGD but the engine runs it. The FGD is a schema,
not an engine capability list.

## 10. Console surface

The game's own `find` is the authoritative cvar browser. `run_map_test` can execute
`find <prefix>` after the map loads and return the log; this is how the defaults in this
document were read.

Commands a map/test author uses:

| Command | Use |
|---|---|
| `sv_cheats 1` | Enables cheat commands for a test |
| `director_start`, `director_stop` | Cheat-only Director control; do not ship |
| `director_panic` / `director_force_panic_event` | Start a panic |
| `z_spawn <class>` | Spawn an infected at the crosshair |
| `z_health`, `z_kill` | Inspect/kill infected |
| `nav_generate`, `nav_analyze`, `nav_trouble_report`, `nav_save_selected` | Nav authoring |
| `ent_fire <name> <input>` | Fire an entity input |
| `ent_create <class>` | Create an entity at the crosshair |
| `script_execute <file>`, `script_reload` | VScript |
| `mp_gamemode <mode>` | Select coop/versus/survival/scavenge/holdout |
| `status`, `find <prefix>` | Inspect the server and cvars |

`director_report` prints the Director's state; `z_debug 1` / `nav_show_area_info` visualise
nav; `mat_leafvis 1` shows visleaves. These are test oracles, not map content.

## 11. Limits and budgets

The full ceilings are in `docs/reference/engine-limits-l4d2.md`. The ones a map hits first:

| Item | Limit |
|---|---|
| Coordinates | ±16384 |
| Brushes | 8192 (stock), Tools++ raises or reduces usage |
| Brush sides | 65536 |
| Faces | 65536 |
| Vertices | 65536 |
| Planes | 65536 |
| Texinfo | 12288 |
| Texdata | 2048 |
| Displacements | 2048 |
| Models | 1024 |
| Entities | 8192 (stock), Tools++ internal 65536 |
| Runtime edicts | 2048 |
| Overlays | 512 stock, Tools++ 8192 |
| Switchable lights | 32 stock, Tools++ 96 |
| Lighting/visibility | 16 MB per mode |
| BSP | keep under ~300 MB for a 32-bit process |
| VPK | under 2 GB |

Tools++ also removes the t-junction limit and the detail-prop limit, and can reduce
brushes/brushsides/vertices/planes. `read_map_geometry` reports every lump against its
ceiling; `read_map_report` turns that into a verdict.

## 12. Assets

- **Materials** are `.vmt` files; a VMF stores the name uppercase, without `materials/` and
  without `.vmt`. A VMT names a `.vtf` base texture; `$surfaceprop`, `$bumpmap`, `$phong`,
  `$translucent`, `$alphatest`, `$decal`, `$rectanglemap` and proxies change behaviour.
- **Models** are `.mdl` + `.vvd` + `.dx90.vtx` + `.phy` + materials. A `prop_static` with
  `solidity 6` needs the `.phy`; without it the prop is non-solid. `spawnflags 2` marks a
  decoration (grass, canopy, escalator overlay).
- **Sounds** are `.wav`/`.mp3`/`.ogg` with soundscripts (`scripts/game_sounds_*.txt`).
- **Particles** are `.pcf`; `info_particle_system` names a system.
- **Skyboxes** are six `skybox/<name><side>.vmt` faces plus a `_hdr`/`_ldr` suffix. L4D2
  stores the suffixed name in worldspawn (`sky_l4d_c1_1_hdr`). A bare name draws no sky.
- **Cubemaps** are `env_cubemap` entities; `run_build_cubemaps` captures them in the engine
  and writes the `.vtf` files.
- **Detail sprites** use `detail.vbsp` + `detailmaterial` on worldspawn and only appear on
  displacement surfaces.
- **Overlays/decals** need a face and a material; a clipped face loses its overlay unless it
  is re-created.

## 13. Optimization

- `func_areaportal` seals a doorway and culls what is beyond it; the brush must fill the
  opening exactly or vbsp fails.
- `func_occluder` hides what is behind it per frame; it never fails a compile but costs CPU.
- `func_detail` keeps decorative brushes out of vis; `func_detail_blocker` blocks vis through
  a detail brush; `func_detail_illusionary` is non-solid.
- `func_lod` fades distant geometry; `func_nobevel` skips angled bevel brushsides.
- Hint/skip faces tell vvis where to cut; `func_viscluster` is deprecated in Tools++.
- Block sightlines with buildings, terrain, fog and areaportals. A long open sightline is
  both a performance and a pacing problem.
- Budget lightmaps: displacements are not auto-subdivided, so a fine lightmap scale on a
  displacement multiplies vrad time. `read_lightmap_budget` reports where the luxels went.
- `read_visleaf_stats`, `read_sightlines`, `read_map_report` are the offline checks.

## 14. Testing and evidence

- A direct `left4dead2.exe` launch outside Steam reaches `No Steam logon`; it is a test
  harness, not a normal-client test. Use `steam.exe -applaunch 550 ...` for the normal
  client.
- `run_map_test` launches with `-insecure -condebug -stringtables +map`; it can install a
  BSP/nav pair, install `scripts/vscripts`, run console commands from `cfg/listenserver.cfg`,
  wait for a log marker and capture the game window as a real image.
- A map test proves load, nav, entities and a marker. It does not prove a player-facing
  `+use` flow unless the harness has a spawned player and the map has a reachable button.
  The campaign menu is the final test for a finale.
- The engine appends its string-table dictionary at nav/changelevel time. Bake it before
  nav, ship the nav-generated BSP, and never pair a fresh `.nav` with a pre-bake `.bsp`.
- Clean the game install after a test: remove the deployed VPK, loose maps/nav, `_nav.txt`,
  `_xyz.txt`, `_selected_*.txt`, installed scripts and config backups.

## 15. Failure signatures

| Symptom | Usual cause | First check |
|---|---|---|
| `NAV ERRORS / Map is unplayable` | No nav, stale nav, no goal | `read_nav`, `read_nav_dump`, `nav_trouble_report` |
| `GetGoalArea: Cannot find end area` | No CHECKPOINT/FINALE or no flow | nav dump summary, FINALE/CHECKPOINT regions |
| Bots stand still | Flow disconnected, nav orphan, no goal | `nav_trouble_report` |
| `Map coordinate extents are too large` | Geometry outside ±16384 | `read_map_geometry` |
| `Bad surface extents` | Texture scale out of range | `read_vmf_lint`, `bad-texture-scale` |
| Purple checkerboard | Missing material or model texture | `read_map_dependencies`, `read_game_content(details)` |
| Walk through a prop | `prop_static` model has no `.phy` | `read_static_props`, `read_model_info(hasPhysics)` |
| Door opens through a wall | Origin at the leaf centre, not the hinge | `placeDoor`, `l4d2-door-hinge-at-center` |
| Safe room never activates | Door not named `checkpoint_exit`/`checkpoint_entrance`, no CHECKPOINT | `read_vmf_lint`, nav dump |
| Finale never starts | No player +use, trigger not over FINALE, no script, disabled start | `check_finale`, campaign-menu test |
| Finale starts and never ends | No `FinaleEscapeStarted` wiring/escape trigger | `check_finale` |
| I/O does nothing | Hammer++ ESC delimiter | `health`, `normalize_vmf_io`, `io-esc-delimiter` |
| `Entity <name> encountered an error in RunScript()` | `logic_script` file not installed/mounted | `run_map_test(scriptsDir:)`, VPK contents |
| `Missing stringtable dictionary` | Nav generated before the dictionary bake | `run_nav_generate` `stringtableDictionary` |

## 16. What is verified, and what is not

The project's `skill/l4d2-hsmcp/references/mechanics/coverage.md` is the live scorecard.
As of this pass:

- **Verified in game:** campaign load and chapter transition, checkpoint doors, nav
  generation and flow, custom finale stages in the earlier test campaign, panic event stages,
  tank/witch spawn via `z_spawn`, scavenge/survival/versus load and HUD, weather/rain,
  cubemaps, campaign packaging.
- **Open:** a type-2 finale that starts from the campaign menu on the current test map
  (the `+map` harness has no player +use); full Versus/Scavenge rounds with two teams; a
  full Survival wave; Propper++-style model authoring; HLMV's 3D canvas on this desktop;
  4-way displacement blend support in L4D2.
- **A row is not "supported" because an entity exists.** It needs a tool, a static check,
  a game test with a log marker and a reference page. That is the rule in `coverage.md`.

## 17. Where the detail lives in the skill

| Topic | Skill page |
|---|---|
| Safe room and transition | `references/campaign/safe-room-and-transition.md` |
| Mission file | `references/campaign/mission-file.md` |
| Finale and custom finale | `references/campaign/finale.md`, `custom-finale.md` |
| Add-on and deployment | `references/campaign/addon-and-deployment.md` |
| Nav generation and attributes | `references/nav/generation.md`, `attributes-and-flow.md` |
| Crescendo/panic | `references/mechanics/crescendo-and-panic.md` |
| Tanks and witches | `references/mechanics/tanks-and-witches.md` |
| Weapons and items | `references/mechanics/weapons-and-items.md` |
| Versus / Survival / Scavenge | `references/mechanics/versus.md`, `survival.md`, `scavenge.md` |
| Testing and console | `references/testing/console.md`, `live-debugging.md` |
| Compiling | `references/compiling/toolchain.md` |
| Hammer++ parity | `docs/reference/hammerpp-complete-reference.md` |
