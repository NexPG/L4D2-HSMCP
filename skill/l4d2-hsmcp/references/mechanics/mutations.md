# Mutations and custom modes

A Left 4 Dead 2 mutation is an add-on with three files. There is no separate mutation
manifest and no entry in a global list:

```
<addon>/
  addoninfo.txt                 addonSteamAppID 550, addonContent_Script 1
  modes/<name>.txt              base, maxplayers, menu metadata, optional convar block
  scripts/vscripts/<name>.nut   MutationOptions <- { ... } (optional for a convar-only mode)
```

The mode name is the filename stem and the console argument. The engine also accepts a
compiled `scripts/vscripts/<name>.nuc`; Valve's own `dash`, `holdout`, `shootzones` and
`gunbrain` modes ship that way.

## Start from the tools

```
write_mutation({
  directory: "my_mutation",
  name: "my_mutation",
  title: "My Mutation",
  description: "One sentence the menu shows.",
  author: "me",
  base: "coop",
  convars: { z_common_limit: 0 },
  directorOptions: { CommonLimit: 0, TankLimit: 2 }
})
```

It writes `modes/my_mutation.txt`, `scripts/vscripts/my_mutation.nut` and, when absent,
`addoninfo.txt`. Existing files are refused unless `overwrite: true`; a replacement gets a
`.bak`.

Read what is there with `read_game_mode` (base, maxplayers, menu fields, convars, companion
script, `addoninfo.txt`) and validate the whole add-on with `check_mutation`.

## The contract `check_mutation` enforces

- the block name equals the filename stem (`"my_mutation"` in `my_mutation.txt`);
- `base` is `coop`, `versus`, `survival`, `scavenge`, `realism`, `none`, the mode's own name
  (Valve's sample pattern), or another `modes/<base>.txt` in the same add-on;
- `maxplayers` agrees with the base (4 for coop/realism/survival, 8 for versus/scavenge);
- `hasdifficulty`, `singlechapter` and `playercontrolledzombies` are `0` or `1`;
- a menu title and description exist;
- the companion `.nut` parses as Squirrel and has `MutationOptions` or `DirectorOptions`;
- `addoninfo.txt` sets `addonContent_Script 1` when a script ships.

A convar-only mutation with no script is valid; the warning says so rather than failing.

## Validate the options table

`check_director_options(path)` reads the table without running it: known
`DirectorOptions`/`MutationOptions` keys, number/boolean types, non-negative limits,
`MinSpecials <= MaxSpecials`, and the `read_vscript` Lua diagnostics. Unknown keys are
information, not errors, because the catalogue is not the engine's complete API.

```text
check_director_options(path: "scripts/vscripts/my_mutation.nut")
```

To change only the table in an existing script, `write_director_options` replaces it and
leaves the rest of the file alone; `write_mutation` builds the whole mode.

Measured: a table with `CommonLimit = 0; MinSpecials = 0; MaxSpecials = 2` passes; one with
`TankLimit = -1; MinSpecials = 3; MaxSpecials = 2` fails on the sign and the impossible pair.
The stock no-mob script (`santa_monica_nomobs.nut`) has no table literal and passes, because
it assigns `DirectorOptions` fields at runtime; a pass is a table check, not a live Director
proof.
`check_mutation` also resolves the special-infected set and fails a negative limit or
`MinSpecials > MaxSpecials`; `write_mutation` refuses to write such a set.

## Director settings

`MutationOptions` is read at map load and overrides `DirectorOptions`. Both are Squirrel
tables; `read_vscript` reports either one. Typical mutation keys: `CommonLimit`,
`MegaMobSize`, `WanderingZombieDensityModifier`, `MaxSpecials`, `TankLimit`, `WitchLimit`,
`SpecialRespawnInterval`.

For logic beyond static values, the script also gets `Notifications` hooks and VSLib-style
helpers. This toolkit checks the source and the mode contract; it does not emulate Squirrel.

## Special-infected sets

`read_special_infected` answers "what will spawn" without running the game. It takes a
`.nut`, a `modes/<name>.txt`, or the add-on directory and resolves each class in this order:

1. `MutationOptions` (`SmokerLimit`, `BoomerLimit`, `HunterLimit`, `SpitterLimit`,
   `JockeyLimit`, `ChargerLimit`, `TankLimit`, `WitchLimit`);
2. `DirectorOptions`, if the mutation does not set that class;
3. `z_<class>_limit`, or `z_versus_<class>_limit` for a Versus mutation, from the mode's
   `convar` block.

A limit of `0` disables the class; an absent key inherits the base mode. The result also has
`MaxSpecials`, `MinSpecials`, `MaxConcurrentSpecials` and `SpecialRespawnInterval`, and flags
a negative limit, a non-number, `MinSpecials > MaxSpecials`, `MaxConcurrentSpecials >
MaxSpecials`, and every class disabled. It cannot prove a class actually spawned; that is a
`run_map_test` observation.

## Pack and test

```
run_vpk_build({ dir: "my_mutation", out: "my_mutation.vpk" })
```

Copy the VPK into `left4dead2/addons/` and launch:

```
run_map_test({
  map: "c1m1_hotel",
  mode: "my_mutation",
  waitFor: "Mutation my_mutation loaded"
})
```

`write_mutation` puts `printl("Mutation <name> loaded")` at the top of the generated script,
so that marker is a real proof that the engine read the mode and ran its script.

Measured on this client:

| Attempt | Result |
|---|---|
| `+mp_gamemode my_mutation` | `Unknown command "mp_gamemode"` |
| `+map c1m1_hotel my_mutation` | second argument ignored, `Script not found (coop)` |
| `map c1m1_hotel my_mutation` from `listenserver.cfg` | **matched `Mutation ... loaded` in 15 s** |

`run_map_test` therefore takes `mode` and writes the map command into the run's
`listenserver.cfg`; the generated command is listed in `commandsRun`.

To prove the values reached the Director, not just the file, add `write_options_probe` to
the test map and wait for `HSMCP_OPTIONS_DONE`; it prints the merged `SessionOptions` at
`round_start`. The measured run is in `references/testing/harness.md`.

Remove the test VPK from `addons/` afterwards. A mutation that stays installed changes the
menu for every later run.

## Stock references

Inside `pak01_dir.vpk`:

- `modes/dash.txt`, `modes/holdout.txt`, `modes/shootzones.txt`, `modes/gunbrain.txt` — sample
  mutation modes with `base` equal to their own name;
- `modes/l4d1coop.txt`, `modes/l4d1vs.txt` — convar-only modes based on `coop` and `versus`.

Extract one with `run_vpk_extract` and read it with `read_game_mode` before inventing fields.
