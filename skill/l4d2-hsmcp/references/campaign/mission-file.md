# Mission file

The file that makes a campaign a campaign. Without it the game loads a map and shows nothing
in the campaign list.

## Shape

`missions/<name>.txt`, Valve KeyValues with a `mission` wrapper:

```
"mission"
{
    "Name"          "MyCampaign"     // A-Z and 0-9 only
    "Version"       "1"              // digits only
    "Author"        "<author from read_addon_author>"
    "DisplayTitle"  "My Campaign"    // what the menu shows
    "Description"   "Two chapters."
    "Image"         "maps/c1"        // VGUI path, no extension

    "modes"
    {
        "coop"
        {
            "1" { "Map" "my_map_a" "DisplayName" "Chapter One" }
            "2" { "Map" "my_map_b" "DisplayName" "Chapter Two" }
        }
    }
}
```

`write_campaign` writes this shape and refuses structurally invalid input. `read_campaign`
parses it, preserving unknown keys and nested blocks. `check_campaign` reports on the files it
references without refusing.

The spec's `keyvalues` field writes any key it does not model, at mission, mode or chapter
level: `"Version"`, `"VersusCompletionScore"`, a mod's own field. Structural keys (`Name`,
`modes`, `Map`, `convar`) keep their dedicated fields and are refused there, so the writer
cannot produce two conflicting copies. Nothing in the mission format is closed to the agent.

## Rules that decide whether the game sees it

| Rule | Failure it prevents |
|---|---|
| Mission base name equals the VPK base name | Archive visible in the add-on list, campaign not in the campaign list |
| `Name` is alphanumeric only | Silent rejection; `My_Campaign` is not a valid `Name` |
| `Image` present and resolvable | Menu entry without a picture, or no entry |
| Chapters numbered from `"1"` without gaps | Chapters missing or out of order in the lobby |
| `Map` is a bare `.bsp` name | Path or extension breaks the lookup |
| `DisplayName` on every chapter | Blank lobby entry |
| `convar` block when the map is compact | `MOB SPAWN ERROR` and no horde; sets `z_spawn_safety_range` and the finale variants |

A chapter can carry launch convars of its own:

```
"2"
{
    "Map" "my_map_b"
    "DisplayName" "Chapter Two"
    "convar"
    {
        "z_finale_spawn_mob_safety_range" "100"
    }
}
```

The campaign-level `Image` is what the menu draws; chapter images are optional and live under
`materials/vgui/`.

## Checking

```
check_campaign(path: "campaigns/001/src/missions/my_campaign.txt", mapsDirs: ["campaigns/001/addon/maps"])
```

It reports `chapter-numbering`, `map-not-a-name`, `map-file-missing`, `image-missing` and
`display-name-missing`. A campaign can be a work in progress, so it reports and does not stop
the build; `write_campaign` is the tool that refuses invalid structure.

`check_modes` is the next question: can each map run the mode it is listed under? It counts
`weapon_scavenge_item_spawn` for scavenge, looks for a `trigger_finale`/`func_finale` on a
survival map, and warns when the last coop/versus chapter has neither a finale nor a
changelevel. A BSP that exists only in a VPK is reported as skipped, not passed.

```
check_modes(path: "campaigns/001/src/missions/my_campaign.txt", mapsDirs: ["campaigns/001/addon/maps"])
```

When reading a campaign already installed in the game, point it at a VPK and an entry:

```
check_campaign(vpk: "<game>/left4dead2/pak01_dir.vpk", entry: "missions/campaign1.txt")
```
