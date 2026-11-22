# Core and configuration

6 tools: health, the addon author, game discovery, paths and text.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Health and author identity

| Tool | What it does |
|---|---|
| `health` | State of the Left 4 Dead 2 toolchain this server depends on: repo root, the game's bin directory (which ships with the client, not with srcds), which compilers and .fgd files are present, whether the Python sidecar (srctools) is installed. |
| `read_addon_author` | Reports the author name used for `addonauthor` in addoninfo.txt and `Author` in a campaign mission. |
| `set_addon_author` | Stores the author name written into every generated addon and campaign. |

## Game discovery

| Tool | What it does |
|---|---|
| `read_source_games` | Left 4 Dead 2 as installed here, discovered from Steam's own files rather than from a hard-coded path: libraryfolders.vdf for the libraries, appmanifest_550.acf for the app, and left4dead2/gameinfo.txt for its name, its SteamAppId, its .fgd files and its instance path. |

## Paths and text

| Tool | What it does |
|---|---|
| `read_text_file` | Reads a UTF-8 text file with a byte cap, optional 1-based line window and no binary guessing: a NUL byte is refused. |
| `write_text_file` | Writes arbitrary UTF-8 text: the primitive for QC, SMD, VMT, VTA, DMX and mission files the structured tools do not model. |
