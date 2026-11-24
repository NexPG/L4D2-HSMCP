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

## Content flags: the add-on browser groups by these

`addoninfo.txt` declares **what the add-on is** with `addonContent_*` keys; the browser groups
by them, and a pack without the matching key installs and works but is listed uncategorised.
`validate_addon` compares the flags with the files present:

| Files | Flag |
|---|---|
| `missions/*.txt` | `addonContent_Campaign` |
| `maps/*.bsp` | `addonContent_Map` |
| `models/**/*.mdl` | `addonContent_Model` |
| `materials/**/*.vmt` / `*.vtf` | `addonContent_Material` |
| `sound/**/*.wav` (and mp3/ogg) | `addonContent_Sound` |
| `particles/*.pcf` | `addonContent_Particle` |
| `scripts/vscripts/*.nut` | `addonContent_Script` |

A **single map with no `missions/` file is a map add-on, not a broken campaign**: the
validator reports it as `addon-single-map` and asks for `addonContent_Map`. Soundtrack and
voice packs use `addonContent_Music` and `addonContent_Sound`; a model or texture pack needs no
map at all.

## Large add-ons: numbered archives

A VPK is a directory file plus numbered data archives of about 200 MB each (`pak01_000.vpk`,
`pak01_001.vpk`, …). The game reads all of them; you do not ship them individually.

`run_vpk_pack` writes the single-archive form. For a campaign over the chunk size, use the
game's own tool with the multi-chunk switch, from the add-on's staging directory:

```
"<game>/bin/vpk.exe" -M a my_campaign @files.txt
```

`-M` splits into numbered archives, `a` adds/creates, `@files.txt` is one root-relative path
per line. Verify the result with `verify_vpk` (entry count, total size, archive chain) rather
than assuming the chunking worked. L4D2's `vpk.exe` writes v1; do not use another game's
`vpk.exe` for an L4D2 add-on.

`run_vpk_pack` calls the game's own `vpk.exe`, then reads the archive back and compares its
entry list with the staging tree. A file the packer dropped is reported, not assumed away.

## Deployment rules

1. **One campaign at a time in the game.** Deploy under a fixed name
   (`hsmcp_campaign.vpk`), remove earlier `hsmcp*.vpk` first. The history lives in the addon's
   workspace (`workspaces/<name>/dist/`), and the legacy `campaigns/`; the game holds only the
   latest.
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
