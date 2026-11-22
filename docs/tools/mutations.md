# Game modes and mutations

3 tools: modes/*.txt definitions, MutationOptions scripts, validation and add-on scaffolding.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Mutation definitions and scaffolding

| Tool | What it does |
|---|---|
| `check_mutation` | Checks a Left 4 Dead 2 mutation before it is packed: the mode block name matches the filename, the base is built-in or a mode in this addon, maxplayers agrees with the base, boolean fields are 0/1, menu title/description exist, the companion scripts/vscripts/<name>.nut (or .nuc) is found, addoninfo.txt sets addonCon... |
| `read_game_mode` | Reads a Left 4 Dead 2 `modes/<name>.txt` mutation definition: the root mode name, base mode, maxplayers, hasdifficulty/singlechapter/playercontrolledzombies, the menu title/description/image/author, every `convar` override, and unknown keys. |
| `write_mutation` | Scaffolds a Left 4 Dead 2 mutation add-on: `modes/<name>.txt` with base, player count, menu metadata and convar overrides, `scripts/vscripts/<name>.nut` with a MutationOptions table, and `addoninfo.txt` with addonContent_Script 1 when it is not already there. |
