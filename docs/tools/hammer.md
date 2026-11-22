# Hammer and the live editor

13 tools: editor status, launch, capture, menus and the staged live-edit queue.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Editor status and launch

| Tool | What it does |
|---|---|
| `capture_window` | Captures one Windows window as a PNG and returns it as a real image block the agent can see. |
| `close_windows` | Closes HLMV, Hammer or the game when they are no longer needed, so repeated looks do not pile up windows. |
| `open_in_hammer` | Launches Hammer++ on a .vmf and optionally captures its window as an image block. |
| `read_hammerpp` | Reads Hammer++'s own configuration: `hammerplusplus_settings.ini` by section, the game configuration (game directory, executable, FGD, BSP/VIS/RAD/MDL programs), and the keybinding count. |
| `run_hlmv` | Launches the newest model viewer that works on this machine: HLMV++ when it is installed and stays alive, stock HLMV otherwise. |

## Live edits

| Tool | What it does |
|---|---|
| `apply_live_edit` | Sends an approved live edit to Hammer through the shell channel. |
| `hammer_live_edit` | Edits the map that is open in Hammer / Hammer++ through the editor's shell channel: create a point entity (and set its keyvalues), set a keyvalue, delete an entity, or rotate it. |
| `hammer_menu` | Posts a main-menu command to the running Hammer / Hammer++ window: save, save as, Run Map, undo, redo, Check for Problems, load/unload pointfile, center on selection, select all, entity report, show connections, go to brush number. |
| `hammer_status` | Lists running Hammer / Hammer++ / J.A.C.K. |
| `read_edit_journal` | Lists live-edit journal entries newest first: staged, approved, rejected, applied and failed. |
| `review_live_edit` | Approves or rejects a staged live edit; an approved edit can still be rejected (cancelled) before it is applied. |
| `stage_live_edit` | Proposes a live Hammer edit without sending it. |

## Synthetic input

| Tool | What it does |
|---|---|
| `run_input` | Sends a short key sequence to a running window, for interactions a console command cannot express (the `E` pickup, a menu key). |
