# Nav attributes and flow

A nav file can be valid and still unplayable. What makes it playable is the attribute flags on
its areas and the flow path the Director computes from them.

## Marking attributes

`func_nav_attribute_region` is a brush entity that applies attributes to the nav areas inside
its volume during `nav_generate`. Its `spawnflags` value is the set of attribute bits:

| Value | Attribute | Meaning |
|---|---|---|
| 64 | FINALE | the area the finale happens in |
| 128 | Mission Start | the spawn area of the first map |
| 2048 | Checkpoint | a safe room |
| 8192 | No mobs | do not spawn common infected here |
| 524288 | No threat | the Director should not build threat here |

Combine by adding: the first map's spawn is `128 + 2048 = 2176`; the exit safe room is `2048`.

The attributes land in the nav file and are visible in the dump. The dump calls them "Terror
Spawn Attribute Flags":

| Dump value | Attribute |
|---|---|
| `0x40` | FINALE |
| `0x80` | Mission Start |
| `0x800` | Checkpoint |

The bits map one to one with the entity flags (2048 → `0x800`), which makes the dump a direct
check of what was asked for.

## What a chapter needs

| Map | Areas |
|---|---|
| First chapter | PLAYER_START **and** CHECKPOINT at the spawn; CHECKPOINT in the exit safe room |
| Middle chapter | CHECKPOINT at the arrival safe room; CHECKPOINT in the exit safe room |
| Finale chapter | CHECKPOINT at the arrival safe room; FINALE where the finale runs |

Bots path to the goal area (CHECKPOINT or FINALE). That is why bots run ahead and wait: they
are going to the goal, not following the player. A map with no goal area is why they wander.

## Flow

With a start area and a goal area the Director computes flow. In the dump, areas on the flow
path carry `0x20000000` in **Base Attribute Flags**. If no area carries it, there is no flow:
the Director found no goal, and bots have nowhere to go.

`read_nav_dump` does this reading for you: it returns the decoded attributes per area, the
counts of CHECKPOINT/PLAYER_START/FINALE areas, how many areas are on the escape route, and a
verdict — `playable`, `no-goal`, `no-flow` or `empty`.

The console is the other oracle: `nav_analyze` prints complaints such as
`GetGoalArea: Cannot find end area`, `Checkpoint failed to locate nearby info_change_level` or
`NAV ERRORS - Map is unplayable`. Capture them with `-condebug`.

## Order of operations

1. Geometry and entities first: safe room, checkpoint door, `info_changelevel`.
2. Add the `func_nav_attribute_region` brushes.
3. Generate nav.
4. Read `read_nav` (freshness) and the dump (attributes, flow).
5. Only then claim the chapter is playable.

Changing geometry invalidates the mesh: regenerate rather than reuse.
