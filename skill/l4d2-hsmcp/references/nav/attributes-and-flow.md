# Nav attributes and flow

A nav file can be valid and still unplayable. What makes it playable is the attribute flags on
its areas and the flow path the Director computes from them.

## Marking attributes

`func_nav_attribute_region` is a brush entity that applies attributes to the nav areas inside
its volume during `nav_generate`. Its `spawnflags` value is the set of attribute bits:

| Value | Attribute | Meaning |
|---|---|---|
| 2 | Empty | no wandering zombies; use around the start, outside the checkpoint |
| 32 | Battlestation | the spot a crescendo defends |
| 64 | FINALE | the finale area; apply it **liberally**, the horde spawns here |
| 128 | Mission Start | the spawn area of the first map |
| 256 | Battlefield | a crescendo arena; **spawning halts while survivors are inside** |
| 2048 | Checkpoint | a safe room; no zombies spawn here |
| 8192 | No mobs | do not spawn common infected here |
| 32768 | Rescue vehicle | where the rescue vehicle stands |
| 65536 | Rescue closet | a respawn closet |
| 524288 | No threat | the Director should not build threat here |

Combine by adding: the first map's spawn is `128 + 2048 = 2176`; the exit safe room is `2048`.

**FINALE vs BATTLEFIELD is the trap.** A finale map needs FINALE over a large area with
spawn space; marking the same area BATTLEFIELD stops infected spawning while survivors stand
in it. In a test map that is the whole play space, so nothing spawns and the finale never
advances (`MOB SPAWN ERROR: ANYWHERE = Empty spawn area set`).

## Small maps and the safety range

The Director refuses spawn areas closer than a safety range. On a compact map every area is
closer, so the console spams `MOB SPAWN ERROR: ANYWHERE = Empty spawn area set` and no horde
appears. The convars are `z_spawn_safety_range`, `z_finale_spawn_safety_range` and
`z_finale_spawn_mob_safety_range`; a mission chapter can carry them in its own `convar` block:

```
"1"
{
    "Map" "my_map"
    "convar"
    {
        "z_spawn_safety_range"          "100"
        "z_finale_spawn_safety_range"   "100"
        "z_finale_spawn_mob_safety_range" "100"
    }
}
```

Lowering them cut the errors on the test map from ~1800 to ~60 in the first seconds, but a map
this small still starves the Director later. The durable fix is space: a real arena with
hidden spawn areas, not a corridor.

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
| Finale chapter | CHECKPOINT at the arrival safe room; FINALE **liberally** over the arena and its spawn space |

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
