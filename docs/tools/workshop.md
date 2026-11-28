# Steam Workshop

8 tools: account status, listing, reading, publishing, updating and deleting L4D2 Workshop items, and the offline VDF descriptor.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Publishing and item management

| Tool | What it does |
|---|---|
| `delete_workshop_item` | Permanently deletes an L4D2 Workshop item owned by the signed-in Steam account. |
| `publish_workshop_item` | Publishes a new L4D2 Workshop item from a built VPK. |
| `read_workshop_account` | Reports the Steam account and L4D2 Workshop state on this machine: the running Steam client's persona, SteamID64 and accountId, the L4D2 app ids, how many items the account has published, and the Steam Cloud quota the legacy uploader stages content through. |
| `read_workshop_item` | Reads one L4D2 Workshop item by id: title, description, visibility, tags, main preview, additional images and videos, owner, dates, statistics, supported game versions and the Web URL. |
| `read_workshop_items` | Lists the signed-in Steam account's L4D2 Workshop items: published by default, or subscribed, favorites or played. |
| `update_workshop_item` | Updates an existing L4D2 Workshop item owned by the signed-in account. |

## Offline descriptor

| Tool | What it does |
|---|---|
| `read_workshop_vdf` | Reads a `workshop_build_item.vdf`: appid, publishedfileid, contentfolder, previewfile, visibility, title, description and change note. |
| `write_workshop_vdf` | Writes a `workshop_build_item.vdf` for inspection or archival. |
