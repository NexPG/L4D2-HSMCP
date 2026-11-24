# Workflow: build and deploy

For a campaign that already exists. The goal is a reproducible build: same source, same
archive, verified after packing.

## The build script

Keep the ordering in one script so nobody has to remember it:

1. Clear staging `maps/` and `missions/` so a removed chapter cannot ship.
2. Rebuild every `.vmf` through the tools, or copy the built `.bsp` if the source is stable.
3. Compile each map; stop on any non-zero stage.
4. Copy `nav/*.nav` beside the maps.
5. Write the mission file and verify it.
6. Pack the staging directory with `run_vpk_pack`.
7. Compare the archive's entry list with the staging tree.
8. Remove older `hsmcp*.vpk` from the game's addons and copy the new archive under the fixed
   name.

The legacy reference implementation is `campaigns/001-hsmcp-test/build.mjs`; read it before
writing another. A new addon's build script lives in its workspace
(`workspaces/<name>/build.mjs`).

## Fixed name, one campaign

The game keeps one campaign. The project keeps the numbered history. Deploying under a new
name every time is how the menu fills with stale copies and the wrong chapter loads.

## Verify after packing

- `check_campaign(vpk: ..., entry: "missions/<name>.txt")`.
- VPK entry count equals the staging file count.
- `read_nav` for each map says `fresh` against the `.bsp` that shipped.
- No `.bak`, no loose maps, no console logs in the archive.

## Deploy

```
<game>/left4dead2/addons/hsmcp_campaign.vpk   ← the only campaign archive
```

Restart the game, enable the add-on in *Extras → Add-ons*, then play.

## If it does not appear

Do not repack blindly. Read `troubleshooting/campaign-not-in-menu.md`; the cause is almost
always the mission name, the `Name` field or the add-on being disabled.
