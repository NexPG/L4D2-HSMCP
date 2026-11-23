# "NAV ERRORS — Map is unplayable!"

The map loads, survivors stand in it, the HUD works — and a panel in the middle of the screen
says **NAV ERRORS / Map is unplayable!** with a CONTINUE button.

It is not a missing `.nav` and not a geometry leak. The engine's own **nav goal check**
failed: a coop chapter must have a reachable goal of the right kind, not just a nav
attribute.

## Measure it, do not guess

`nav_trouble_report` runs the engine's checks and names the failing one:

```
nav_trouble_report
  map: <map>
  bsp: <compiled>
  nav: <generated>
  expected: checkpoint      # or finale for the last chapter
```

Measured on a 45-area hall whose far end carried a `func_nav_attribute_region` with
**CHECKPOINT** but had no checkpoint door and no `info_changelevel`:

```
Missing Checkpoint: passed false, 43 areas
```

43 is 45 areas minus the two that carried the attribute: the engine considers every other
area unable to reach a goal it recognises, so it calls the map unplayable — while the map
itself plays normally.

## The fix: give the chapter a real end

| Chapter kind | What the nav goal needs | Tool |
|---|---|---|
| middle chapter | `info_changelevel` + `prop_door_rotating_checkpoint` + landmark pair, CHECKPOINT nav | `write_safe_room`, `write_changelevel` |
| last chapter | `trigger_finale` + FINALE nav | `write_finale_setup` |
| bench / probe map with no exit | **FINALE**, never a bare CHECKPOINT region | `write_finale_setup` (or a FINALE region + `trigger_finale`) |

A bare CHECKPOINT region with nothing to check point *at* is the mistake: it is an attribute
without an end. Regenerate nav after the entities exist.

Measured after the swap on the same hall: `Missing Finale` **passes**, the panel is gone, and
the screenshot shows ordinary gameplay. (`Missing Battlefield` still reports 45 areas and does
**not** raise the panel — in coop that check is informational.)

## Verify before shipping

1. `nav_trouble_report` → `Missing Checkpoint`/`Missing Finale` must be `passed: true`.
2. `run_map_test` + `capture_window` (or `screenshot: true`): the panel is a HUD overlay, not
   a console line, so the log can look perfectly clean while the screen says unplayable.

## What not to conclude

- A tool-level verdict of `goal-present` from `run_nav_generate` is not the engine's goal
  check; it counts areas and a goal attribute, and it does not prove the chapter ends
  anywhere. The dump's `0x20000000` is `MOSTLY_FLAT`, not flow.
- `NAV ERRORS` is not about the mesh being stale. A stale nav prints
  `NAV ERRORS — Map is unplayable` too, but `read_nav` compares the nav with the BSP; check
  that first, then run the report above.
