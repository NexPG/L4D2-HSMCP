# Configuration and health

4 tools: toolchain health and the stored add-on author.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Health and author identity

| Tool | What it does |
|---|---|
| `check_game_state` | Reports leftovers from a game run: `*.hsmcp-backup` in cfg/maps/scripts, a `listenserver.cfg` with content, hidden `*.vpk.off` add-ons, and test maps/scripts/add-ons with the `hmcp_`/`hsmcp_` prefix. |
| `health` | State of the Left 4 Dead 2 toolchain this server depends on: repo root, the game's bin directory (which ships with the client, not with srcds), which compilers and .fgd files are present, whether the Python sidecar (srctools) is installed. |
| `read_addon_author` | Reports the author name used for `addonauthor` in addoninfo.txt and `Author` in a campaign mission. |
| `set_addon_author` | Stores the author name written into every generated addon and campaign. |
