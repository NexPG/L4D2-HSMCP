# Live editing

7 tools: editing the open map through Hammer's shell channel, and the staged approval queue.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

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
