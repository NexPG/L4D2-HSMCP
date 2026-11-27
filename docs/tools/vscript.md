# VScript authoring

7 tools: Squirrel source: writing and checking .nut files, DirectorOptions and include paths.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## VScript source

| Tool | What it does |
|---|---|
| `check_vscript_contract` | Checks a .nut against the engine's game-event contract: every `OnGameEvent_<name>` hook must name an event in `resource/modevents.res`, and every `event_data.<field>` read inside it must be a field that event declares. |
| `read_vscript` | Reads a .nut as Squirrel without running it: functions, IncludeScript targets, the DirectorOptions and MutationOptions tables, the custom-finale stage list, whether a load banner exists, and diagnostics. |
| `read_vscript_api` | Lists the Left 4 Dead 2 VScript contract this server knows: game events from the engine's own `resource/modevents.res`, the `OnGameEvent_<event>` hook names derived from them, named hooks such as OnMapSpawn, and the DirectorOptions/MutationOptions catalogue with each key's expected type. |
| `write_vscript` | Writes a Left 4 Dead 2 VScript (.nut) and optionally attaches it to a map. |

## Script catalogue

| Tool | What it does |
|---|---|
| `read_script_catalog` | Lists the VScript files the SDK and game carry: `.nut` source, `.nuc` compiled, or both, by category (`usetargets`, `entitygroups`, `mutations`, `anv*`, `director`, `root`) with bytes, `IncludeScript` edges and whether only the compiled file exists. |

## Director options

| Tool | What it does |
|---|---|
| `check_director_options` | Validates the DirectorOptions/MutationOptions table in a .nut without running it: known keys, number/boolean types, non-negative limits, MinSpecials <= MaxSpecials and the read_vscript diagnostics. |
| `write_director_options` | Writes or replaces a DirectorOptions/MutationOptions table in an existing or new .nut. |
