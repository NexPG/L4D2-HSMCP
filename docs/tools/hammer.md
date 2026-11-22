# Hammer editor

5 tools: editor status, Hammer++ settings, launching, window capture and HLMV.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Editor status and launch

| Tool | What it does |
|---|---|
| `capture_window` | Captures one Windows window as a PNG and returns it as a real image block the agent can see. |
| `close_windows` | Closes HLMV, Hammer or the game when they are no longer needed, so repeated looks do not pile up windows. |
| `open_in_hammer` | Launches Hammer++ on a .vmf and optionally captures its window as an image block. |
| `read_hammerpp` | Reads Hammer++'s own configuration: `hammerplusplus_settings.ini` by section, the game configuration (game directory, executable, FGD, BSP/VIS/RAD/MDL programs), and the keybinding count. |
| `run_hlmv` | Launches the newest model viewer that works on this machine: HLMV++ when it is installed and stays alive, stock HLMV otherwise. |
