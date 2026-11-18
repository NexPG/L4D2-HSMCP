# Safe room and chapter transition

A chapter does not end when a player walks into a trigger. It ends when the whole team is
inside a safe room whose door, nav attributes and landmark pair are all correct. Get one wrong
and the map loads, plays, and never advances.

This is read from Valve's own chapters (`c1m1_hotel` → `c1m2_streets`) and confirmed on a
built map.

## The four parts

1. **`info_changelevel`** — a *brush* (despite the `info_` name) over the safe room floor.
   Keyvalues: `map` (next `.bsp`, no path or extension) and `landmark`.
2. **`prop_door_rotating_checkpoint`** - the checkpoint door. Without one, `info_changelevel`
   does not spawn at all. A plain `prop_door_rotating` does not count. The engine looks the
   door up by name: **`checkpoint_exit`** on the safe room being left and
   **`checkpoint_entrance`** on the one being entered. `checkpoint_exit_door` is not the
   name it looks for.
3. **Landmark pair** — `info_landmark` with the same `targetname` in both maps. On the map
   being left it sits in the exit safe room; on the map being entered it sits where survivors
   should appear. Store the position relative to the landmark; the engine uses it to place
   survivors and carried items.
4. **Nav attributes** — CHECKPOINT over both safe rooms, PLAYER_START over the first map's
   spawn. See `references/nav/attributes-and-flow.md`.

## Geometry

The safe room needs a real doorway the player can walk through, with the door entity in it,
and the `info_changelevel` volume covering the room behind the door. A door placed on a solid
wall reads as a door and cannot be entered — that is a geometry bug, not an entity bug.

Minimal safe room: floor, ceiling, four walls, a doorway sized to the door model -- 64 wide
and ~112 tall for `checkpoint_door_02` (58.3 x 105.8) or 72 x 112 for
`checkpoint_door_01` (68.4 x 105) -- the checkpoint door in the opening, `info_changelevel`
over the floor behind it, `info_landmark` in open space, and a light. A 128- or 256-unit
opening around a 58-unit door is a hole beside the door; `read_vmf_lint` reports it as
`l4d2-door-opening-too-wide`. Keep it inside the sealed shell.

A **finale map** ends with a FINALE nav area (`func_nav_attribute_region` spawnflags **64**),
not a second CHECKPOINT. Marking the end CHECKPOINT gives the Director two checkpoints and a
flow it rejects with `NAV ERRORS / Map is unplayable`; that happened on `night_moscow_m2`
until the end region was changed to 64. The start safe room keeps CHECKPOINT (2048) +
MISSION START (128).

## What the engine does

- `info_changelevel` starts the transition when **all survivors** are inside and the
  checkpoint door state is acceptable. A player entering alone is not enough; bots must catch
  up.
- The destination map is loaded, survivors and carried items are placed relative to the
  landmark, and the destination's own checkpoint door and CHECKPOINT area take over.
- A destination map needs its own checkpoint door and CHECKPOINT area even if nothing is
  behind it.

## Bots

Bots follow the nav **flow** to the goal area, not the player. With a CHECKPOINT area and a
checkpoint door they run to the safe room and wait. Without a goal area they wander — that is
what "the bots run around by themselves" looks like. The fix is nav, not AI.

## Symptoms and their cause

| Symptom | Check |
|---|---|
| Walking into the brush does nothing | Is there a checkpoint door? Are all survivors inside? Is the nav area CHECKPOINT? |
| Door is a texture on a wall | Cut a real opening; the door model does not create one |
| Transition fires with one player left behind | Not possible by design — verify all four survivors are inside |
| Arrives in the next map at a wrong height or offset | Landmark positions differ in a way that matters; align them deliberately |
| Console: `info_changelevel ... doesn't have a landmark` | `landmark` keyvalue missing or the `info_landmark` name differs |

Verify with `read_bsp_entities` (compiled map) or `read_entity_report` (source), then a play
test. The entity existing is not proof the transition works.
