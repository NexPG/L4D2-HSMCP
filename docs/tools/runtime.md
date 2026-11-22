# Runtime harness

7 tools: launching and probing the game: run_map_test, nav generation, console commands and class/nav probes.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Game runs and probes

| Tool | What it does |
|---|---|
| `run_map_test` | Launches an installed map and watches the engine's console log for an ordered sequence of patterns (or one), then closes the game. |
| `run_nav_generate` | Generates nav meshes the only way Left 4 Dead 2 can: it launches the game client as a listen server, with `sv_cheats 1` and `nav_edit 1`, and waits for the engine to write each map's `.nav`. |
| `write_class_probe` | Writes a `logic_script` and a `.nut` that counts live entities by classname at chosen seconds and prints `HSMCP_CLASS <step> <class> <count>`. |
| `write_nav_probe` | Samples the live nav mesh with VScript at chosen points and prints spawn/base attributes and whether each required attribute is present. |
| `write_options_probe` | Writes a `logic_script` and a `.nut` that print the Director's effective merged `SessionOptions` on `round_start` / `player_spawn`, then `HSMCP_OPTIONS_DONE`. |
| `write_special_infected_probe` | Adds a `logic_script` to a playable VMF that spawns the requested special-infected classes with `SendToConsole("z_spawn <class>")` after the local player exists, then prints their live counts and the effective `SessionOptions` keys. |

## Console channel

| Tool | What it does |
|---|---|
| `send_console_command` | Runs a console command in a running Source game through the engine's `WM_COPYDATA` channel (`Valve001`), the same path `-hijack` uses. |
