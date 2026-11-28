# Add-on and deployment

A campaign ships as one VPK in `<game>/left4dead2/addons/`. The add-on tree is what the game
mounts; the VPK name decides how the mission is found.

## Contents

- Staging tree
- Content flags: the add-on browser groups by these
- Foundation addons and required items
- Large add-ons: numbered archives
- Deployment rules
- After deploy
- What not to ship

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

`addoninfo.txt` lives at the VPK root. This is the shape the add-on scanner reads:

```
"AddonInfo"
{
    "addonSteamAppID"      "550"
    "addontitle"           "My Add-on"
    "addonversion"         "1"
    "addonauthor"          "<author from read_addon_author>"
    "addonDescription"     "One line: what it is."
    "addonContent_Script"  "1"
}
```

- `addonSteamAppID` is 550 (Left 4 Dead 2).
- `addontitle` is the name in the add-on list; a missing title hides the add-on.
- Community authoring guides quote ceilings of 31 (version), 119 (author) and 1023
  (description) characters; the toolkit does not enforce them.
- `addonContent_*` keys are tags: `Campaign`, `Map`, `Skin`, `Weapon`, `BossInfected`,
  `CommonInfected`, `Survivor`, `Sound`, `Music`, `Script`, `Prop`. Set the ones that describe
  the content to `"1"`; a pure script add-on uses `addonContent_Script`. The file→flag table is
  below.
- `AddonAuthorSteamID`, `AddonURL0` and `AddonTagline` are optional/deprecated; `//` comments
  are accepted.
- **`addonDescription` is one line.** A literal newline makes the quoted string unterminated
  (`unterminated quoted string`), and `\n` is stored as backslash-n, not a line break.
  Multi-line prose belongs on the Workshop page, which is separate from this file. A fork that
  needs "what changed, then the original description" joins them on one line with a sentence
  break.
- Older spellings (`addonTitle`, `addonTag`, `addonDesc`) are not the documented keys; a
  scanner that does not alias them leaves the add-on unlisted or unlabelled.

**The BSP must carry the string-table dictionary.** `run_nav_generate` bakes it; the
compile/nav pair and the bake detail are in
[`../compiling/toolchain.md`](../compiling/toolchain.md). `read_nav` being `fresh` is the pair
check.

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

## Foundation addons and required items

Some Workshop add-ons are **foundations**: a script library, a framework, a shared asset pack
or a mode layer that other add-ons build on. They are installed alongside the add-on that uses
them, not copied into it. A foundation is usually updated by its author; a copy freezes an old
version and can disagree with the add-ons built for the current one.

- Declare the foundation as a **required item** on the Workshop item. `publish_workshop_item`
  `dependencies` and `update_workshop_item` `dependencies` set it by id through Steam's
  `AddDependency`; the item editor's *Add/Remove Required Items* is the same operation by
  hand. Neither `addoninfo.txt` nor `workshop_build_item.vdf` has a field for it, and
  `write_workshop_vdf` cannot set it.
- Do not copy the foundation's scripts, globals, hooks or assets into your VPK "to make it
  standalone". A second copy means two globals with the same name, doubled hooks or two
  competing entity factories; the last one loaded wins, or both run.
- A script that needs a library should detect its global at load and, when it is absent, print
  a short chat line that names the required item and stop. Do not silently fall back to a
  bundled copy; that is the duplication the required item exists to avoid.
- A fork of a foundation-based add-on keeps the foundation required and **replaces** the
  original: keep the original's script path, class, global, command and settings names, and let
  the shared path mark the two as conflicting. Change only the behaviour the user asked for;
  rename anything only on an explicit request. The script-side pattern is in
  [`../scripting/addons.md`](../scripting/addons.md).

This is a dependency on a **different add-on**, not on a map asset. For assets the rule is the
opposite: an asset that is not in the game or in the map's pakfile must be packed, because the
player does not have it. The upload sequence, including required items, is
[`../../workflows/publish-to-workshop.md`](../../workflows/publish-to-workshop.md).

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
