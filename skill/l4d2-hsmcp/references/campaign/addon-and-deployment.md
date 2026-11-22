# Add-on and deployment

A campaign ships as one VPK in `<game>/left4dead2/addons/`. The add-on tree is what the game
mounts; the VPK name decides how the mission is found.

## Staging tree

```
addon/
    addoninfo.txt
    missions/my_campaign.txt          base name == VPK base name
    maps/my_map_a.bsp
    maps/my_map_a.nav
    maps/my_map_b.bsp
    maps/my_map_b.nav
    scripts/vscripts/my_finale.nut    optional VScript
    materials/vgui/maps/my_map_a.vmt  optional chapter image
```

`addoninfo.txt` (the keys are case-sensitive in the add-on scanner):

```
"addoninfo"
{
    "addonSteamAppID"       "550"
    "addontitle"            "My Campaign"
    "addonauthor"           "<author from read_addon_author>"
    "addonversion"          "1"
    "addonContent_Campaign" "1"
    "addonDescription"      "A two-chapter campaign."
}
```

`addonTitle`, `addonTag` and `addonDesc` are older spellings; a scanner that does not match
them leaves the add-on unlisted. `addonTagline` is optional.

**The BSP must carry the string-table dictionary.** `run_nav_generate` bakes it; if you ship
a BSP from another pipeline, the engine logs `missing stringtable dictionary, don't ship this
way` and a client may spend a long time rebuilding it. `read_map_dependencies` reports the
dictionary as a packed entry; `read_nav` being `fresh` is the pair check.

`run_vpk_pack` calls the game's own `vpk.exe`, then reads the archive back and compares its
entry list with the staging tree. A file the packer dropped is reported, not assumed away.

## Deployment rules

1. **One campaign at a time in the game.** Deploy under a fixed name
   (`hsmcp_campaign.vpk`), remove earlier `hsmcp*.vpk` first. The numbered history lives in
   `campaigns/`, the game holds the latest.
2. **The add-on must be enabled** in *Extras → Add-ons*. A disabled add-on is mounted; its
   campaign is not offered.
3. **Restart the game** after replacing the VPK. Add-ons are mounted at startup.
4. **Launch through Steam for the normal-client test.** A direct `left4dead2.exe` launch
   outside Steam reaches `No Steam logon` and drops to the menu; that is an auth failure,
   not a broken add-on. Use `steam.exe -applaunch 550 ...` or the Steam UI.
5. **Do not edit the game's addons by hand** as part of a build. Copy from the project's
   `dist/` output so the archive that was verified is the archive that shipped.

## After deploy

```
check_campaign(vpk: "<game>/left4dead2/addons/hsmcp_campaign.vpk", entry: "missions/my_campaign.txt")
```

This checks the archive as installed, not the staging copy. If the campaign is still missing
in game, use `troubleshooting/campaign-not-in-menu.md` rather than repacking blindly.

## What not to ship

- `.bak` files, loose maps, nav dumps, console logs.
- A second campaign in the same VPK.
- A mission whose base name differs from the VPK.
- A disabled or duplicate `addonContent_Campaign` flag.
