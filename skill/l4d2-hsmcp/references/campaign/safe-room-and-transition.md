# Safe room and chapter transition

A chapter does not end when a player walks into a trigger. It ends when the whole team is
inside a safe room whose door, nav attributes and landmark pair are all correct. Get one wrong
and the map loads, plays, and never advances.

This is read from Valve's own chapters (`c1m1_hotel` → `c1m2_streets`) and confirmed on a
built map.

## The four parts

1. **`info_changelevel`** — a *brush* (despite the `info_` name) over the safe room floor.
   Keyvalues: `map` (next `.bsp`, no path or extension) and `landmark`.
2. **`prop_door_rotating_checkpoint`** - the checkpoint door. Without one near the
   transition's `info_landmark`, `info_changelevel` does not spawn at all. A plain
   `prop_door_rotating` does not count. The engine resolves the **class near the landmark**;
   20 of the 57 stock chapters leave it unnamed. `checkpoint_exit` /
   `checkpoint_entrance` are the canonical names, but a name is advice, not the lookup key.
   `check_transition` fails a safe room with no class within 1024 units of the landmark and
   reports the name as info.
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

Minimal safe room: floor, ceiling, four walls, a doorway that fits the door model, the
checkpoint door in the opening, `info_changelevel` over the floor behind it, `info_landmark`
in open space, and a light. Door dimensions, hinge placement and swing clearance are in
[`../mapping/doors.md`](../mapping/doors.md); a 128- or 256-unit opening around a 58-unit door
is a hole beside the door, which `read_vmf_lint` reports as `l4d2-door-opening-too-wide`. Keep
it inside the sealed shell.

A **finale map** ends with a FINALE nav area, not a second CHECKPOINT. Marking the end
CHECKPOINT gives the Director two checkpoints and a flow it rejects with
`NAV ERRORS / Map is unplayable`; that happened on `night_moscow_m2` until the end region was
changed to FINALE. The flags and how they combine are in
[`../nav/attributes-and-flow.md`](../nav/attributes-and-flow.md); this page keeps only the
transition's own contract.

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
