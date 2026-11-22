# VScript and runtime

11 tools: Squirrel source, scenes, runtime probes, the console channel and weather.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## VScript and scenes

| Tool | What it does |
|---|---|
| `read_vmf_leak` | Whether a .vmf is sealed, WITHOUT compiling it. |
| `read_vmf_rooms` | The rooms of a .vmf, the openings between them, and how they connect -- from the geometry alone, with no compilation and no annotation in the file. |
| `read_vmf_surfaces` | Every face of a .vmf sorted into floor, wall, ceiling and slope, with how much of each a person could actually touch -- and which brush touches which. |
| `read_vscript` | Reads a .nut as Squirrel without running it: functions, IncludeScript targets, the DirectorOptions table, the custom-finale stage list, whether a load banner exists, and diagnostics. |
| `write_vscript` | Writes a Left 4 Dead 2 VScript (.nut) and optionally attaches it to a map. |

## Runtime harness

| Tool | What it does |
|---|---|
| `run_map_test` | Launches an installed map and watches the engine's console log for an ordered sequence of patterns (or one), then closes the game. |
| `run_nav_generate` | Generates nav meshes the only way Left 4 Dead 2 can: it launches the game client as a listen server, with `sv_cheats 1` and `nav_edit 1`, and waits for the engine to write each map's `.nav`. |
| `send_console_command` | Runs a console command in a running Source game through the engine's `WM_COPYDATA` channel (`Valve001`), the same path `-hijack` uses. |
| `write_weather` | Adds Left 4 Dead 2 weather to a map: a `func_precipitation` volume for rain, snow, ash or one of the particle variants, and an `env_fog_controller` for distance fog. |

## Probes

| Tool | What it does |
|---|---|
| `write_class_probe` | Writes a `logic_script` and a `.nut` that counts live entities by classname at chosen seconds and prints `HSMCP_CLASS <step> <class> <count>`. |
| `write_nav_probe` | Samples the live nav mesh with VScript at chosen points and prints spawn/base attributes and whether each required attribute is present. |
