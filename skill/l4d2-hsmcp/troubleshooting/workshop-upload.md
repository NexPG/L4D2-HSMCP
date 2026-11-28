# Workshop upload fails or the item does not change

**Prevention.** Upload L4D2 content only through `publish_workshop_item` and
`update_workshop_item`. They use the legacy `ISteamRemoteStorage` path, which is the only
content path L4D2 accepts. Do not use SteamCMD `workshop_build_item` or ISteamUGC
`SetItemContent`: both answer `Invalid Parameter` for an L4D2 VPK. Publish private, read the
item back, then release it.

## Contents

- Why the usual path fails
- Symptoms
- The app id trap
- What to read back

## Why the usual path fails

L4D2's Workshop was built before ISteamUGC file transfer. The app can create an item, read
it, set metadata, add dependencies and delete it, but it cannot accept content through
`SetItemContent`. SteamCMD uses the same UGC content call, so it fails identically. The
legacy `PublishWorkshopFile` and the legacy update request are what the game's Authoring
Tools still use; the toolkit compiles a small helper for exactly those two calls.

## Symptoms

| What you see | Cause | Check | Fix |
|---|---|---|---|
| `ERROR! Failed to update workshop item (Invalid Parameter)` from SteamCMD | SteamCMD uses the UGC content path L4D2 does not enable | the same content through `publish_workshop_item` succeeds | use the tool; delete the empty item SteamCMD created |
| `a parameter is invalid` from an ISteamUGC `updateItem` | the call used app id 563 (Authoring Tools) or the client default | the item's consumer app is 550 | pass **550**; the tools already do |
| `Steam is not reachable` | the Steam client is closed, signed out, or still starting | `read_workshop_account` | start Steam, sign in, retry |
| `SteamRemoteStorage.FileWrite refused ... quota is probably too small` | the VPK is larger than the Cloud quota the legacy path stages through | `read_workshop_account` `cloud.quotaAvailable` | shrink the VPK, free Cloud space, or split the add-on |
| `Workshop item ... was not found` | the id is wrong, the item is private to another account, or the item was deleted | `read_workshop_items` on the owning account | use the owner's account and the id from `read_workshop_items` |
| `belongs to SteamID ..., not the signed-in account` | the item is not owned by the current client | `read_workshop_item` `ownerSteamId` | switch Steam accounts; do not retry the write |
| publish returned no item id after a timeout | the outcome is unknown; Steam may have created the item | `read_workshop_items` sorted by last update | reuse the item and `update_workshop_item`; do not publish again blindly |
| title or tags changed, content is the old VPK | the update used a metadata-only path, or a different item id | `read_workshop_item` `timeUpdated` and the item id | call `update_workshop_item` with `vpkPath` |
| main preview or description still looks old | Steam's Workshop page caches the previous revision | `read_workshop_item` already returns the new value | wait for the page cache; the item state is what matters |
| required library still reported missing | the dependency was not added, or the wrong id was used | `read_workshop_item` `children` | `update_workshop_item` `dependencies`; result code 1 is OK |
| item exists but is invisible to other players | it is private or unlisted, or the Workshop agreement is not accepted | `read_workshop_item` `visibility`; publish `needsAgreement` | `update_workshop_item` `visibility: "public"`; accept the agreement in Steam |
| the VPK downloads but the game does not list the add-on | `addoninfo.txt` is not at the VPK root, or the item is not subscribed | `read_vpk`/`run_vpk_pack` output and the item's content | repack with addoninfo at the root; subscribe and restart |

## The app id trap

The Steam client initialises as **563** so it can create an item for L4D2. It must then
address the item as consumer app **550** for every `updateItem` call. With 563 the library
returns `a parameter is invalid` even for a title change. `read_workshop_account` prints both
ids; a hand-written call that fails on every field is almost always this.

## What to read back

`read_workshop_item` is the evidence: `title`, `description`, `tags`, `visibility`,
`previewUrl`, `additionalPreviews`, `children`, `timeUpdated` and `url`. A publish that
returns an id but warns about a media or dependency step has still created the item; fix the
warning with `update_workshop_item` instead of making a second item. See
[`../workflows/publish-to-workshop.md`](../workflows/publish-to-workshop.md).
