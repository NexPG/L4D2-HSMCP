# Campaign wiring: safe room, chapter change, finale, spawns

A chapter is a sequence of files the engine walks through, and every step is an entity the
next map has to agree with. Each file can be valid on its own and the campaign still breaks:
a changelevel that names the wrong map, a landmark that exists in one file, a safe-room door
whose name the engine does not look up. This page is the wiring behind the geometry, and the
tools that write and check it.

## Contents

- The chain, in one picture
- Builders
- Checking a whole campaign
- L4D2 facts that make this different from other Source games
- Evidence

## The chain, in one picture

```
[map 1] checkpoint_exit door
        info_changelevel(s)  map=map2  landmark=L1
        info_landmark named L1
[map 2] info_changelevel  map=map2  landmark=L1  spawnflags=2 (arrival, Disable Touch)
        info_landmark named L1
        checkpoint_entrance door
        ... gameplay ...
        checkpoint_exit door
        info_changelevel(s)  map=map3  landmark=L2
```

The **landmark pair** is the contract: both maps carry an `info_landmark` with the same
`targetname`, and each map's `info_changelevel` names it. The engine places the team at the
destination landmark; it does not use coordinates across maps.

## Builders

### `write_spawn_points`

```
write_spawn_points(path, kind: "player", origin: [0, 0, 16], angles: [0, 90, 0])
write_spawn_points(path, kind: "survivor", gameMode: "coop", positions: [...4...])
write_spawn_points(path, kind: "zombie", spawns: [{origin: [...], population: "2", offerTank: true}])
write_spawn_points(path, kind: "rescue", origin: [...])
```

- L4D2 has **one** survivor spawn class: `info_player_start`. A second one is refused because
  the Director spawns the team around one; it is not a second spawn point.
- `info_survivor_position` is for scripted placement: four ordered positions (`Order` 1-4),
  optionally filtered by `GameMode` (`coop`, `versus`, `survival`, `scavenge`), with
  `SurvivorName`, `HideWeapons`, `SurvivorConcept` and `SurvivorIntroSequence`.
- `info_zombie_spawn` is where common infected enter. `population` is `default` or a number;
  `offer_tank` lets the Director offer a tank from that spawn. A map with no spawn point is a
  quiet map, not a broken one.
- `info_director` is required for a campaign map; without it there is no Director behaviour.
  `read_fgd_class` lists its panic, special and finale inputs and outputs exactly.
- `info_survivor_rescue` marks a rescue; the model is editor-only in normal play.

### `write_safe_room`

```
write_safe_room(path, role: "exit",
                opening: {axis: "x", min: -32, max: 32, at: 0, floorZ: 0}, yaw: 90,
                playerStart: {origin: [0, 0, 16], angles: [0, 0, 0]})
```

One call writes the door, the player start, four survivor positions and `info_director` when
the map has none. It delegates the door to `place_door`, so the origin is on the hinge and the
model hull decides the swing rather than the middle of the opening.

- The door class is `prop_door_rotating_checkpoint`, never a plain `prop_door_rotating`.
- The door is resolved by **class near the landmark**, not by name, and the safe-room contract
  (1024-unit radius, names as advice) is in
  [`../campaign/safe-room-and-transition.md`](../campaign/safe-room-and-transition.md).
- Four survivor positions default to a 48-unit square around the player start and the call
  says so. Move them; spawn points inside a wall or on a prop are a common first-pass bug.
- It does **not** write the changelevel volume. That is `write_changelevel`, and a safe room
  with a door but no volume does not change the chapter.

### `write_changelevel`

```
write_changelevel(path, role: "departure", map: "c2m2", landmark: "c2m1_c2m2_landmark",
                  bounds: {mins: [...], maxs: [...]})
write_changelevel(path, role: "arrival", map: "c2m2", landmark: "c2m1_c2m2_landmark",
                  bounds: {mins: [...], maxs: [...]})
```

- `info_changelevel` is a **brush entity**: it needs a volume, and the builder ties a box to
  it. A VMF `info_changelevel` with no solids is an entity that compiles to nothing.
- Departure: `map` is the **next** chapter, `spawnflags` 0. Arrival: `map` is **this** map,
  `spawnflags` 2 ("Disable Touch"). Stock chapters carry the arrival volume so the team is
  placed at the landmark; without it the transition still happens but placement is a fallback.
- The builder refuses a departure that names its own map and an arrival that names another.
  That is the mistake that produces a chapter that loops to itself.
- It writes an `info_landmark` at the volume centre (or `origin`) with the pair name. The
  matching landmark in the other map is the caller's job and the result says which.
- `trigger_changelevel` exists in `base.fgd`, but no stock L4D2 chapter uses it. It is not the
  campaign transition; `info_changelevel` is.

### `write_finale_setup`

```
write_finale_setup(path, type: "gauntlet", origin: [...], angles: [...],
                   escapePositions: [...4...])
write_finale_setup(path, type: "custom", origin: [...], scriptFile: "finale_mycampaign")
write_finale_setup(path, type: "scavenge", origin: [...])
```

- The types and their contracts are in [`../campaign/finale.md`](../campaign/finale.md); the
  builder accepts **0 standard, 1 gauntlet, 2 custom, 4 scavenge** (there is no type 3).
- A **custom** finale needs a `ScriptFile`; the builder refuses one without it. Custom finales
  start disabled (`StartDisabled 1`) and are enabled by their script or a button. Stock c2m5
  is the model: `StartDisabled 1`, type 2.
- Gauntlet finales start enabled and need `info_target nav_flow_target` for the nav flow;
  `check_finale` reports whether it exists.
- Scavenge is type 4 and is used with the mission's scavenge mode and gas-can spawns.
- Stock L4D2 maps ship **no** `trigger_escape` entities. Escaping is the finale's own state
  machine plus the nav FINALE areas and survivor positions; do not add legacy triggers.
- `escapePositions` writes ordered `info_survivor_position`s; four is what the game expects.
- The builder does not write nav. Run `run_nav_generate`, then mark the finale and escape
  areas FINALE with `func_nav_attribute_region` (or the nav tools), then `check_finale`.

### `write_item_spawns` and `write_saferoom_stock`

`write_item_spawns` places L4D2 `weapon_*_spawn` classes at points, with `count` and `skin`;
`write_saferoom_stock` is a 48-unit row of medkit/pills/ammo/pistol shortcuts. A spawner
is a candidate: `info_map_parameters` density decides whether it becomes an item.
`write_zombie_border` marks where infected spawning stops; `write_rescue_closet` writes
the rescue point and ordered survivor positions. Nav still has to mark the rescue area.

### `write_map_parameters`

```
write_map_parameters(path, densities: {pistol: 4, ammo: 8, gasCan: 0, magnum: -1})
write_map_parameters(path, versus: true, densities: {molotov: 2})
```

- One entity carries the item densities: `info_map_parameters`, or
  `info_map_parameters_versus` for the versus override. The builder writes only the keys you
  give, under the FGD's names (`PistolDensity`, `GasCanDensity`, ...), so leaving a value out
  keeps the game default.
- `-1` disables a weapon's density. `0` is legal and means "do not place this".
- `finaleItemClusterCount` and the cluster ranges control the finale's item pile.
- Density is a probability, not a count; check the result in a loaded map.

### `info_gamemode` and the mode switch

`info_gamemode` names no mode. The engine fires `OnCoop`, `OnVersus`, `OnSurvival`,
`OnScavenge` and their `*PostIO` forms when a round starts; each output usually targets a
relay, a nav blocker or a `point_template` spawn. A map with no `info_gamemode` is the same
in every mode (official `c1m1_hotel` is), which is valid for a coop-only chapter.

`check_gamemode_contract(path)` reads a VMF or BSP and lists which modes are wired, whether
each mode target exists, scavenge spawners with no `OnScavenge`, and unknown or non-numeric
`info_map_parameters` keys. Measured: `c2m1_highway` has two `info_gamemode` (coop, versus
and survival wired, scavenge on the second) and passes; `c5m5_bridge` wires coop, versus and
survival. A target that exists nowhere is a mode switch that does nothing.

## Checking a whole campaign

```
check_campaign_wiring(maps: ["c1m1.vmf", "c1m2.bsp", "c1m3.vmf"], mode: "coop")
```

This is the cross-file check no single-map tool can do:

- every non-final chapter has an outgoing `info_changelevel` naming the next map;
- the named landmark exists in both maps;
- the destination has the arrival volume (`spawnflags 2`) for that landmark;
- the first map has `info_player_start`; a later chapter is normally spawned by its arrival
  `info_changelevel` and may have none (21 of the 60 stock BSPs have none), while
  `info_director` should be present on every playable map;
- each safe room has a `prop_door_rotating_checkpoint` within 1024 units of the pair's
  landmark; the name is reported as advice, and a stock unnamed door passes;
- the last chapter has a `trigger_finale` unless the mode is survival; scavenge needs type 4.

Findings are errors, warnings and info; `overall` is fail, warn or pass. It reads `.vmf` and
`.bsp`, so run it before compile and again on the shipping files. It does not replace
`check_finale` (finale contract), `check_gamemode_contract` (mode switch and map densities) or
`check_modes` (mission mode contract); they answer different questions.

## L4D2 facts that make this different from other Source games

- `info_changelevel` is a brush; `trigger_changelevel` is not the L4D2 transition.
- The safe-room door is `prop_door_rotating_checkpoint`, resolved by class near the landmark
  (not by name).
- One `info_player_start`, not a team spawn pair.
- The finale type set skips 3 and stock campaigns use gauntlet (1) or custom (2); scavenge is
  its own type 4.
- Finale escape is not a `trigger_escape` volume.
- `info_map_parameters` is where item density lives, not the mission file.
- A closed door's sounds come from the **model**, not the entity: `read_model_keyvalues` on a
  door model returns its `door_options` (`open`, `close`, `move`, `pound`, `locked`,
  `unlocked`). L4D2's `prop_door_rotating` sound-override keys are broken, so the documented
  workaround is `logic_auto` → door → `AddOutput "SoundMoveOverride Doors.Move14"`. A door
  recompiled without `door_options` still swings but loses the sound infected make when they
  pound on it.

## Evidence

- `test/campaign/campaignbuild.test.ts` writes every family and reads it back, including the
  brush volume, the arrival spawnflags, the custom finale's disabled state and the density key
  names. It also runs the checker on a synthetic two-chapter chain and on the test campaign.
- `test/vmf/tools-compile.test.ts` compiles a room with a changelevel volume, zombie spawn and
  gauntlet finale; vbsp emits all five classes.
- The runtime behaviour behind these entities was verified earlier on `hsmcp_test_m2`: the
  chapter change, finale stages, escape and `Map: credits`. This batch makes the writing and
  static checking match that knowledge; it does not re-run the game.
