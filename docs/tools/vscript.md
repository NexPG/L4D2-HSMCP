# VScript authoring

4 tools: Squirrel source: writing and checking .nut files, DirectorOptions and include paths.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## VScript source

| Tool | What it does |
|---|---|
| `check_vscript_contract` | Checks a .nut against the engine's game-event contract: every `OnGameEvent_<name>` hook must name an event in `resource/modevents.res`, and every `event_data.<field>` read inside it must be a field that event declares. |
| `read_vscript` | Reads a .nut as Squirrel without running it: functions, IncludeScript targets, the DirectorOptions and MutationOptions tables, the custom-finale stage list, whether a load banner exists, and diagnostics. |
| `read_vscript_api` | Lists the Left 4 Dead 2 VScript contract this server knows: game events from the engine's own `resource/modevents.res`, the `OnGameEvent_<event>` hook names derived from them, named hooks such as OnMapSpawn, and the DirectorOptions/MutationOptions catalogue with each key's expected type. |
| `write_vscript` | Writes a Left 4 Dead 2 VScript (.nut) and optionally attaches it to a map. |
