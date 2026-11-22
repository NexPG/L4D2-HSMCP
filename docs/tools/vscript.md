# VScript authoring

2 tools: Squirrel source: writing and checking .nut files, DirectorOptions and include paths.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## VScript source

| Tool | What it does |
|---|---|
| `read_vscript` | Reads a .nut as Squirrel without running it: functions, IncludeScript targets, the DirectorOptions and MutationOptions tables, the custom-finale stage list, whether a load banner exists, and diagnostics. |
| `write_vscript` | Writes a Left 4 Dead 2 VScript (.nut) and optionally attaches it to a map. |
