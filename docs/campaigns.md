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

## Chapter transitions

A campaign advances through `info_changelevel`, not through the generic `trigger_changelevel`.
That is read from the game's own maps, not from a wiki:

- `c1m1_hotel` ends with `info_changelevel` **as a brush**, carrying `map c1m2_streets` and
  `landmark c1m1_c1m2_landmark`.
- `c1m2_streets` carries `info_landmark` with the same `targetname` where survivors arrive.
- The brush fires when survivors walk into it. It has no inputs and needs no `logic_auto`.
- `trigger_changelevel` exists in `base.fgd`, but none of the stock L4D2 chapters uses it. A
  map built on it loads fine and never advances — the chapter change simply does not happen.

So a transition is a pair: a brush entity with a destination and a landmark name, plus an
`info_landmark` with that name in **both** maps. The one in the map being left sits at the
exit; the one in the map being entered sits where the survivors should appear.

Three more things are required, and none of them is optional:

- a `prop_door_rotating_checkpoint` in the safe room — without one, `info_changelevel` does
  not even spawn;
- nav areas in both safe rooms carrying **CHECKPOINT**, and **PLAYER_START** on the first
  map's spawn area;
- an `info_changelevel` brush that covers the safe room floor.

`func_nav_attribute_region` marks those attributes during generation. Its `spawnflags` are the
attribute bits: 128 Mission Start, 2048 Checkpoint, 64 Finale, 8192 No mobs, 524288 No threat.
`nav_generate` writes `<map>_nav.txt` beside the mesh, and that dump is the oracle: attributes
appear as "Terror Spawn Attribute Flags" (`0x800` is CHECKPOINT, `0x40` FINALE), and areas on
the computed flow path get `0x20000000` in "Base Attribute Flags". No flow path means the
Director found no goal.

Bots do not follow the player as their first rule: they path to the goal area (CHECKPOINT or
FINALE). If the player falls behind, they run ahead and wait there. A map with no goal area is
why bots appear to run around on their own.

`read_vmf_lint` reports the structural faults that otherwise compile clean:
`l4d2-trigger-changelevel`, `l4d2-changelevel-no-landmark`,
`l4d2-changelevel-landmark-missing`, `l4d2-changelevel-no-brush`,
`l4d2-changelevel-no-checkpoint-door`, `l4d2-changelevel-no-checkpoint-nav` and
`l4d2-finale-type-standard`. A clean lint is not proof that the transition fires — only a play
test is — but it catches every failure this project has hit so far.
`read_nav_dump` returns the mesh verdict (`playable`, `no-goal`, `no-flow`, `empty`) from the
engine's own dump.

## The finale

Every stock finale uses `trigger_finale` with `type 2` (Custom): a radio, generator or sound
board starts the sequence. `type 0` (Standard) and `type 1` (Gauntlet) exist in the FGD, but no
base campaign uses either, so a finale that completes by itself is not something to assume.

The engine does expose the end of a finale as an input, and the Authoring Tools' own rescue
template (`sdk_content/scripting/scripts/vscripts/entitygroups/rescue_helicopter_group.nut`)
uses exactly these:

- `FinaleEscapeFinished` — "Give the survivors a victory."
- `FinaleEscapeForceSurvivorPositions` — hold them on the vehicle.
- `env_outtro_stats` `RollStatsCrawl` — the stats crawl.

So a minimal completable finale is entity work, not a script: a `trigger_finale` (type 2) whose
`FinaleStart` enables a `trigger_multiple` after the wave delay, and that trigger's
`OnStartTouch` fires `FinaleEscapeFinished` on the finale and `RollStatsCrawl` on the outtro.
`info_survivor_rescue` marks where the rescue stands; it is not required for the victory.

## VScript in an add-on

An add-on VPK can carry VScript, and the engine loads it:

- put the file at `scripts/vscripts/<name>.nut` inside the add-on;
- attach it with a `logic_script` entity whose `vscripts` keyvalue is `<name>` (no extension);
- verify the load without playing: launch the map with `-condebug` and read
  `left4dead2/console.log` for the script's `printl` banner.

The game ships its scripts compiled as `.nuc`; the readable sources in the Authoring Tools
(`sdk_content/scripting/scripts/vscripts/`) are the reference for the API.

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
- `nav_generate` writes `<map>_nav.txt` beside the mesh: area centres, connection counts and
  the attribute flags. It is the only readable view of a `.nav`, and it is the evidence that
  the mesh has the attributes and the flow path the Director needs. Keep it with the `.nav`.

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
