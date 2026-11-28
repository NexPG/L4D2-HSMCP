# Publish to the Steam Workshop

L4D2's Workshop predates ISteamUGC content transfer. `SetItemContent`,
`updateItemContent` and SteamCMD's `workshop_build_item` all answer `Invalid Parameter` for
an L4D2 VPK, while the legacy `ISteamRemoteStorage::PublishWorkshopFile` path works — the
same path the game's own Authoring Tools use. The tools handle that split; this page says
what to prepare and in what order.

## Contents

- What the tools need
- Before the first upload
- Publish, verify, release
- Which call changes which field
- Credits table
- A fork keeps the original's script path
- Additional images, videos and descriptors
- Required items (foundations)
- Update an existing item
- Delete an item
- Limits and failure modes

## What the tools need

| Need | Why | Check |
|---|---|---|
| Steam is running and signed in | The tools use the running client as the credential; no password is stored or requested | `read_workshop_account` |
| A built add-on VPK | Content is one file; L4D2 installs it as `addons/workshop/<id>.vpk` | `run_vpk_pack` |
| `addoninfo.txt` inside the VPK | The game menu reads the title and author from it; the Workshop page does not replace it | `validate_addon` |
| A preview image | The Workshop card; `.jpg` or `.png` | `publish_workshop_item` `previewPath` |
| The owning account | Steam refuses writes to another account's item | `read_workshop_item` `ownerSteamId` |

The Steam Cloud quota is the staging limit for the legacy path. `read_workshop_account`
reports it; it is about 2 GB on a normal L4D2 account. A larger VPK fails at `FileWrite`,
not at the publish step.

## Before the first upload

1. Build the VPK with `run_vpk_pack` from the staging folder. The manifest at the root is
   `addoninfo.txt`, not a copy of the Workshop text.
2. Run `validate_addon` on the staging folder. Fix every error before the upload; a broken
   VPK becomes a broken Workshop item, not a rejected one.
3. Run `read_workshop_account`. It reports the account, the item count, the Cloud quota and
   whether the on-demand helper is built.
4. Run `publish_workshop_item` with `dryRun: true` and `confirm: true`. It checks the VPK,
   preview, media paths and video ids without touching Steam. The central guard requires
   `confirm` even for a dry run.

## Publish, verify, release

Publish private first — that is the default:

```
publish_workshop_item {
  vpkPath: "workspaces/my-addon/dist/my_addon.vpk",
  title: "My Addon",
  description: "What it does and what it needs.",
  previewPath: "workspaces/my-addon/preview.jpg",
  tags: ["Scripts"],
  visibility: "private",
  confirm: true
}
```

The result carries `itemId`, the canonical `url`, the created item, the dependency change
and any `warnings`. If the content publish succeeded but the media or dependency step
failed, the item still exists and the warning names the failed step; fix it with
`update_workshop_item` rather than publishing a second item.

Verify with `read_workshop_item`: title, description, tags, main preview, `children` and
`additionalPreviews`. Subscribe to the item in the Steam client and test the downloaded VPK
if the change is player-visible. Then release it:

```
update_workshop_item { itemId: "<id>", visibility: "public", confirm: true }
```

## Which call changes which field

| Field | Path | Why |
|---|---|---|
| content VPK | legacy update | ISteamUGC content transfer is not enabled for L4D2 |
| main preview | legacy update (or ISteamUGC for a preview-only change) | both accept it; the legacy commit keeps it with the content |
| title, description, tags, visibility | legacy update when content or preview changes; ISteamUGC otherwise | one commit with the content avoids a second history entry |
| additional images and YouTube videos | ISteamUGC, consumer app **550** | the legacy API has only the main preview |
| content descriptors, key-value tags, language | ISteamUGC, consumer app **550** | legacy API has no field for them |
| required items | ISteamUGC `AddDependency` | `addoninfo.txt` and the VDF have no dependency field |
| deletion | ISteamUGC `DeleteItem` | irreversible |

**The app id is part of the contract.** The client initialises as 563 (Authoring Tools).
Every ISteamUGC `updateItem` must pass **550** (L4D2); 563 and the default fail with
`a parameter is invalid`. `publish_workshop_item`, `update_workshop_item` and
`read_workshop_account` do this already; hand-written calls must too.

## Credits table

Steam Workshop renders `[table]`, `[tr]`, `[th]` and `[td]` (verified on a live item, not only
on the forum parser). Use it when credits need two aligned columns:

```text
Credits:
[table]
[tr][th]Author[/th][th]Add-on[/th][/tr]
[tr][td][url=https://steamcommunity.com/id/xkcdjerry]senzawa[/url][/td][td][url=https://steamcommunity.com/sharedfiles/filedetails/?id=3816477245]Dynamic Light [fixed][/url][/td][/tr]
[tr][td][url=https://steamcommunity.com/id/alkashproduction]Sw1ft[/url][/td][td][url=https://steamcommunity.com/sharedfiles/filedetails/?id=2261165699]Dynamic Light[/url][/td][/tr]
[/table]
```

Links inside cells stay clickable, and a `[fixed]` in the link text is printed literally. If a
page ever shows the raw tags, fall back to bold labels and `[url]` lines.

## A fork keeps the original's script path

A fork is a replacement, not a sibling. Keep the real script at the original's path — for Dynamic
Light, `scripts/vscripts/dynamic_light.nut` — and point `director_base_addon.nut` at that name.
The engine loads only one file for the path, and the Add-ons menu marks the variants red. Keep the
original's class, globals, commands, settings path and entity names too; a fork changes only the
behaviour the user asked for, and a rename breaks existing settings and chat commands. Rename
anything only on an explicit request. The rule and the trade-off are in
[`../references/scripting/addons.md`](../references/scripting/addons.md).

## Additional images, videos and descriptors

`additionalPreviewPaths` appends images; `additionalPreviewVideos` appends YouTube ids (11
characters, not a URL). `removeAdditionalPreviewIndexes` removes by the 0-based position in
`read_workshop_item`'s `additionalPreviews`; read the item first, because the indexes move.

Mature-content descriptors use Steam's numbers: 1 nudity/sexual, 2 frequent violence/gore,
3 adult-only sexual, 4 gratuitous sexual, 5 any mature content. They are sent only through
ISteamUGC and only on an update that also changes the item.

## Required items (foundations)

A library, framework or shared asset pack stays a separate Workshop item. The dependent
add-on lists it as a required item and keeps the library's files out of its own VPK. Pass
the ids in `dependencies` to publish, or `dependencies` / `removeDependencies` to update.
The result's `dependencies` block reports `added`, `removed` and every `failed` id; a Steam
result code other than 1 is a failure, not a silent no-op.

## Update an existing item

Pass only what changes. `vpkPath` replaces the content; `previewPath` replaces the main
preview; `tags` replaces the whole list and `[]` clears it. The tool reads the item first,
refuses one the signed-in account does not own, and returns `before` and `after` so the
change can be checked without a second call.

Use `dryRun: true` on an update to read the item and the plan. The guard still needs
`confirm: true`.

## Delete an item

`delete_workshop_item` is permanent. Use `dryRun: true` first to see the item it would
delete, then `confirm: true`. A private item can be deleted the same way; the owner check is
the same as for an update.

## Limits and failure modes

- **No password.** A tool never accepts, stores or logs one. If Steam is not running, the
  call fails with "Steam is not reachable"; start the client and sign in.
- **One content commit at a time.** The legacy upload stages the VPK in Steam Cloud, then
  publishes. Do not retry a timed-out publish blindly; call `read_workshop_items` first,
  because the item may already exist.
- **Private by default.** A private item is visible only to the owner; `read_workshop_item`
  by another account returns "not found".
- **`Invalid Parameter` on content** is the L4D2 UGC path, not a bad file. Use these tools,
  not SteamCMD. The symptom table is
  [`troubleshooting/workshop-upload.md`](../troubleshooting/workshop-upload.md).
- **Steam caching.** The Workshop page and the client can show the old title or preview for
  a short time after an update. `read_workshop_item` reads Steam's own state; use
  `timeUpdated` and the returned fields, not a browser refresh, as evidence.
