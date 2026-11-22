# Nav editing: commands and the safe workflow

`run_nav_generate` is the automated path: the engine generates a mesh from the world. This
page is for the cases where a generated mesh needs repair, and for understanding what the
console commands do. The command names and behaviour are L4D2's own.

## Start a session

```
sv_cheats 1
nav_edit 1
z_debug 1
nav_show_area_info -1
nav_selected_set_color 255 0 255 96
nav_selected_set_border_color 0 255 0 255
```

`nav_edit 1` is required for most of the commands; `sv_cheats 1` is required for the cheat
commands. `nav_show_area_info -1` keeps the area id and attributes on screen.

## Selection

| Command | Effect |
|---|---|
| `nav_mark` | Mark the area under the crosshair |
| `nav_flood_select` | Select everything connected to the marked area |
| `nav_clear_selected_set` | Clear the selection |
| `nav_toggle_in_selected_set` | Add/remove the aimed area |
| `nav_begin_selecting` / `nav_end_selecting` | Continuous selection |
| `nav_begin_drag_selecting` / `nav_end_drag_selecting` | Box selection |
| `nav_select_invalid_areas` | Select areas that can break game mechanics |
| `nav_select_blocked_areas` | Select blocked areas |
| `nav_select_obstructed_areas` | Select obstructed areas |
| `nav_select_damaging_areas` | Select damaging areas |
| `nav_select_overlapping` | Select overlapping areas |
| `nav_select_stairs` | Select stair areas |

## Geometry

| Command | Effect |
|---|---|
| `nav_begin_area` / `nav_end_area` | Draw a rectangle by two corners |
| `nav_split` | Split the aimed area along the visible line |
| `nav_merge` | Merge the marked area with the aimed one |
| `nav_connect` / `nav_disconnect` | Add/remove a one-way connection |
| `nav_splice` | Create an area between two unconnected areas (stairs) |
| `nav_delete` / `nav_delete_marked` | Delete the aimed/marked area |
| `nav_corner_place_on_ground` | Drop all corners to the floor |
| `nav_corner_raise` / `nav_corner_lower` | Move corners vertically |
| `nav_chop_selected` | Subdivide selected areas into small pieces |
| `nav_build_ladder` | Mark a ladder |
| `nav_snap_to_grid` | Toggle grid snapping while drawing |

## Attributes and places

These console commands are what a person types in the editor. The same changes can be made as
data — without the game running — with the two tools that read and patch a `.nav`:

| Tool | Use |
|---|---|
| `read_nav_areas` | Every area with its attributes, L4D2 spawn attributes, place, centre, size and connection counts. Filter by `MOB_ONLY`, `SPAWN_NO_MOBS`, a place name |
| `write_nav_areas` | Set/clear attribute and spawn bits on one or more area ids, or assign an existing place. Writes a `.bak` and reads the file back |
| `edit_nav_connections` | Add, remove or replace directional links by area id; mirrored on the target by default. Rewrites only the four connection lists and reads every edited area back |
| `read_nav_ladders` / `write_nav_ladders` | List and patch ladder records: width, top/bottom points, length, direction and the five area ids. The 60-byte record keeps its size |
| `read_nav_hiding_spots` / `write_nav_hiding_spots` | List and patch hiding spots: position and flag bits. The 17-byte record keeps its size |
| `write_nav_places` | Append a place or rename one without renumbering the table; area place ids stay valid |

**Attributes are masks, not values.** An area may carry bits this toolkit has no name for;
`write_nav_areas` changes only the bits named in the call, so those survive. A `.nav` is not
rewritten: the file keeps its length and every other byte.

**Connections are directional and length-variable.** `edit_nav_connections` cannot patch a
bit; it rebuilds the four count+id lists of each edited area and copies the rest of the
record byte-for-byte. `add`/`remove` mirror the opposite direction on the target by default
(north↔south, east↔west); `symmetric: false` is the one-way case, and `set` is exact.

L4D2-specific attribute bits (`TerrorNavAttributeType`): `TANK_ONLY` `0x10000`, `MOB_ONLY`
`0x20000`, `PLAYERCLIP` `0x40000`, `BREAKABLEWALL` `0x80000`, `FLOW_BLOCKED` `0x8000000`,
`OUTSIDE_WORLD` `0x10000000`, `MOSTLY_FLAT` `0x20000000`.

Spawn attributes (`TerrorNavSpawnAttributeType`), the ones the Director reads: `EMPTY`,
`STOP`, `BATTLESTATION`, `FINALE`, `PLAYER_START`, `BATTLEFIELD`, `CHECKPOINT`, `NO_MOBS`,
`THREAT`, `NOTHREAT`, `RESCUE_VEHICLE`, `RESCUE_CLOSET`, `ESCAPE_ROUTE`, `DOOR`, plus the
eight `COMPASS_*` directions for a rescue closet's facing.

| Command | Effect |
|---|---|
| `nav_mark_attribute` / `nav_clear_attribute` | Add/remove one attribute on the selection |
| `wipe_nav_attributes` | Remove every attribute from the selection |
| `nav_place_set` | Assign the current place name |
| `nav_use_place` | Choose the place name |
| `nav_place_pick` / `nav_place_replace` | Pick/replace a place |
| `nav_place_floodfill` | Fill a place across connected areas |
| `select_with_attribute` | Select every area with a chosen attribute |

## Flow and validation

| Command | Effect |
|---|---|
| `nav_analyze` | Recompute flow from the goal |
| `nav_trouble_report` | The 18 checks; selects the offending areas |
| `nav_trouble_report_invalid` | Areas that can break game mechanics |
| `nav_trouble_report_corner_to_corner` | Diagonal connection check |
| `nav_trouble_report_suggestions` | Population suggestions |
| `nav_save` | Save the mesh |
| `nav_save_selected` | Save the selected set for `nav_merge_mesh` |
| `nav_check_file_consistency` | Check the nav against the BSP |
| `nav_recompute_flow` | Recompute flow |

## Safe order

1. Generate a base with `run_nav_generate`.
2. Load the map and run `nav_trouble_report` (`nav_trouble_report` tool does this and
   returns the selected areas).
3. Fix the **world** first: a hole, a step above 18 units, a 32-unit bank, a missing floor,
   a displacement that does not seal. Deleting nav areas hides a geometry problem.
4. Fix the remaining nav: connect `CHECKPOINT`/`FINALE` to the route, remove orphans, mark
   `NO MOBS`/`BATTLEFIELD`/`BATTLESTATION` where the Director needs them.
5. `nav_analyze`, then `nav_save`.
6. Regenerate the mesh from the final BSP and re-run `nav_trouble_report`. A saved mesh is
   not fresh after a compile.

## What the agent can and cannot do

The agent can run the non-mouse commands through the game console (`run_map_test` with a
`commands` list, or a dedicated test), read the dump, and reason about the result. Drawing
an area with the mouse, dragging a corner and clicking a connection are a person at the
screen; the file-level equivalent is `run_nav_generate` on corrected geometry, or a
hand-edited nav through the engine. Do not claim a manual nav edit was automated.
