# Campaigns

A Left 4 Dead 2 campaign is a mission file plus the maps it names, shipped together as an
addon VPK. This page is the practical contract the tools enforce; every rule here was read
from the game's own files or measured on a real install, not copied from a wiki.

## The mission file

`missions/<name>.txt`, Valve KeyValues with a `"mission"` wrapper:

```
"mission"
{
    "Name"          "MyCampaign"     // A-Z and 0-9 only
    "Version"       "1"              // digits only
    "Author"        "NexPG"
    "DisplayTitle"  "My Campaign"    // what the menu shows
    "Description"   "Two chapters."
    "Image"         "maps/c1"        // campaign image; required for the menu entry

    "modes"
    {
        "coop"
        {
            "1" { "Map" "my_map_a" "DisplayName" "Chapter One" "Image" "maps/my_map_a" }
            "2" { "Map" "my_map_b" "DisplayName" "Chapter Two" "Image" "maps/my_map_b" }
        }
    }
}
```

Rules that matter:

- **The mission file's base name equals the VPK's.** `missions/my_campaign.txt` belongs in
  `my_campaign.vpk`. A mismatch is how a campaign ends up in the add-on list but not in the
  campaign list.
- **`Name` is alphanumeric only.** Underscores and spaces are not allowed.
- **Chapters are numbered from `"1"`, with no gaps.** The game indexes them by that key.
- **`Map` is a `.bsp` name**, without a path or extension.
- **`Image` is a VGUI material path without the extension**, resolved under
  `materials/vgui/`. The campaign-level image is what the menu draws.
- A mode with no chapters is invalid; a chapter with no `DisplayName` is a warning.

`read_campaign` parses this (including modes and unknown keys), `write_campaign` writes it,
and `check_campaign` verifies the structure and the files it references. Unknown keys and
nested blocks are preserved so a rewrite cannot silently drop a shipped field.

## The addon tree

```
addon/
    addoninfo.txt
    missions/my_campaign.txt
    maps/my_map_a.bsp
    maps/my_map_a.nav
    maps/my_map_b.bsp
    maps/my_map_b.nav
    materials/vgui/maps/my_map_a.vmt   (optional chapter image)
```

`addoninfo.txt`:

```
"addoninfo"
{
    "addonSteamAppID"       "550"
    "addonTitle"            "My Campaign"
    "addonAuthor"           "NexPG"
    "addonVersion"          "1"
    "addonTag"              "campaign"
    "addonContent_Campaign" "1"
}
```

`run_vpk_pack` packs the directory root-relative with the game's `vpk.exe`, then reads the
archive back and compares its entry list with the staging tree: a file the pack dropped is
reported, not inferred.

## Navigation

There is no offline nav generator. The game generates the mesh:

- `nav_generate` needs **`sv_cheats 1` and `nav_edit 1`**; without `nav_edit` it silently
  produces nothing.
- The map must be **loose** in `left4dead2/maps/`. A `.nav` cannot be written beside a map
  inside a VPK.
- `nav_generate` also analyses; the resulting file records the `.bsp` size it belongs to.
  `read_nav` compares that with the map and reports `fresh` or `stale`.
- Nav editing needs the engine, and on Windows the game client is the engine that is
  installed — a separate `srcds` binary is not required for this step.

## Deploying

The game loads any `.vpk` in `left4dead2/addons/`. Two rules keep the menu honest:

1. **One campaign at a time in the game.** Deploy under a fixed name and remove earlier
   archives first; the project keeps the numbered history, the game keeps the latest.
2. **The add-on must be enabled** in *Extras → Add-ons*. A disabled add-on is mounted, but
   its campaign is not offered.

If a campaign is still missing in game:

- restart the game after copying the VPK;
- check `Name` and the file/VPK name match;
- start with `-allowdebug`, run `developer 2` and `mission_reload` in the console — the game
  prints which mission files it read and what it rejected;
- make sure there is no second VPK with the same campaign `Name`.

## Checking without the game

```
check_campaign(path: "missions/my_campaign.txt", mapsDirs: ["maps"], materialsDirs: ["materials"])
check_campaign(vpk: "left4dead2/pak01_dir.vpk", entry: "missions/campaign1.txt", vpks: ["..."])
```

The check reports:

- `chapter-numbering` — a missing or out-of-order chapter key;
- `map-not-a-name` — a path or `.bsp` in `Map`;
- `map-file-missing` — the map exists in neither a directory nor a VPK;
- `image-missing` — no `.vmt` or `.vtf` under `materials/vgui/`;
- `display-name-missing` — a chapter with nothing to show in the lobby.

It reports and never refuses: a campaign can be a work in progress. `write_campaign` is the
tool that refuses structurally invalid input, because writing it would produce a file the
game cannot read.
