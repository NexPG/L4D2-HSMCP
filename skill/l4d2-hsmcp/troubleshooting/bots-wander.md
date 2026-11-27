# Bots wander instead of advancing

Bots are not supposed to follow the player around. They path to the **goal area** — CHECKPOINT
for a chapter, FINALE for a finale map — using the nav flow. If they scatter, the map has no
goal, or the goal is unreachable.

## Diagnose with the nav dump

`nav_generate` writes `<map>_nav.txt`. Check, in this order:

1. **A goal attribute exists.** CHECKPOINT or FINALE under "Terror Spawn Attribute Flags"
   (the flag table is in [`../references/nav/attributes-and-flow.md`](../references/nav/attributes-and-flow.md)).
   No goal attribute → the Director has no destination.
2. **Flow was computed.** The live `nav_trouble_report`/`nav_analyze` says the goal is reachable;
   the dump's `MOSTLY_FLAT` bit is not flow (see the same page). None → no flow, and bots have
   nowhere to go.
3. **The goal is reachable.** Every area along the path must be connected; a gap in the mesh
   splits it.

## Fixes

| Cause | Fix |
|---|---|
| No `func_nav_attribute_region` with CHECKPOINT/FINALE | add the region, regenerate nav |
| Region volume misses the areas (wrong bounds) | cover the safe room or finale floor, regenerate |
| Attribute added after the nav was generated | regenerate; attributes are applied at generation |
| Mesh has a break (door, step, clip brush) | fix the geometry or the nav connection, then regenerate |

Do not patch bot behaviour. In L4D2 it is a consequence of the mesh, not a setting.

## What normal looks like

Bots run ahead toward the safe room and wait there. If the player falls behind they may keep
going. They still fight, revive and heal. A bot standing at the exit door doing nothing is
usually a bot waiting for the team to arrive, not a broken bot.
