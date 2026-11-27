# Survival mode

Survival is a mission mode, not a separate map format. The map needs a playable nav, a
spawn, and a mission file that lists it under `survival`.

## Mission entry

A `"survival"` block under `"modes"`, with one chapter per map, as in
[`../campaign/mission-file.md`](../campaign/mission-file.md). `write_campaign`
`modes: [{ name: "survival", chapters: [...] }]` writes it.

## Running it

`run_map_test` with `mode: "survival"`; the option, the `map <map> survival` launch and the
`mp_gamemode` warning are in [`../testing/harness.md`](../testing/harness.md).

## Starting the round

Loading the map in Survival is not enough: the HUD shows the timer at `00:00.00` and waits.
A `trigger_finale` / `ForcePanicEvent` is what starts the survival finale. On the test map
without that trigger the timer stayed at zero and no wave began; that is the expected
setup phase, not a broken map.

Place a `trigger_finale` in the arena and start it (a radio `+use`, or `ForceFinaleStart`
from a relay/timer). Verify the timer leaves `00:00.00` before claiming a wave ran.

## What proves it

- the game loads the map, not the main menu;
- the Survival HUD is visible: a timer starting at `00:00.00` and the survival-icon panel;
- `console.log` reaches `Loading: <n> seconds`;
- the HUD and the mode marker are stronger evidence than a map name alone.

The test campaign's `hsmcp_test_m1` was run this way and the captured frame shows the
Survival timer. That proves the mission mode and map load; it does not yet time a full
survival wave.

## What is still required for a shipping Survival map

- a nav mesh that is fresh against the final BSP;
- a spawn area the Director can use;
- a mission file whose base name matches the VPK;
- no `trigger_finale` requirement in this test: the mode started from the map alone. A map
  that only finales can start may need a `trigger_finale`; verify per map.

## A survival arena's nav

Survival is a round in one arena, so the nav says "this is the arena, do not stop spawning".
Two `func_nav_attribute_region` brushes carry it: **BATTLEFIELD** over the play space (infected
keep spawning while survivors are inside) and **NOT_CLEARABLE** over the same space (the
Director will not mark it cleared when it empties). The flags and their combinable values are
in [`../nav/attributes-and-flow.md`](../nav/attributes-and-flow.md).

A map that also has a CHECKPOINT region for coop gets both ends; the mode picks the goal.

## Pitfalls

- `Unknown command: survival_record` is a harmless client-side console line in this setup.
- If the map name is in a mission without a `survival` mode, the game may fall back to the
  menu; check the mission file and pass `mode: "survival"` to `run_map_test`.
- No `.nav` means `NAV ERRORS — Map is unplayable!`, even in Survival.
