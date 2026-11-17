# Live debugging: launch, move, trigger, read

The agent can run the game itself. This page is the whole loop: start a map, make something
happen, and prove it from the console log.

## Launch and watch

```
run_map_test(
  map: "my_map",
  waitFor: "Map: credits",      // a regex the successful run must produce
  timeoutSeconds: 120,
  extraArgs: ["+sv_pausable", "0", "+sv_cheats", "1"],
  confirm: true
)
```

It truncates `left4dead2/console.log`, launches the map with `-condebug`, waits, closes the
game, and returns `matched`, `reason` (`matched` / `exited` / `timeout`) and the log tail.

Why the two arguments:

- `+sv_pausable 0` — an unfocused single-player game can pause, and a paused game never fires
  a timer.
- `+sv_cheats 1` — `point_servercommand` and some debug commands need it.

**A stale log is a false pass.** `run_map_test` truncates the file; if you launch the game by
hand, truncate it yourself. A marker that exists at startup (`Mission credits …`) matches in
five seconds and proves nothing.

## Moving survivors

| Method | Use |
|---|---|
| `Director.WarpAllSurvivorsToCheckpoint()` | chapter maps; warps the team to the exit checkpoint |
| `Director.WarpAllSurvivorsToFinale()` | finale maps; the checkpoint call fails with `No exit checkpoint could be found` |
| `setpos x y z` | the local player only; `sv_cheats`; needs a live player |
| `point_teleport` | entity-driven, works from a timer |

`setpos` in `listenserver.cfg` does nothing: the config runs before the player entity exists.
It is not broken; there is nobody to move. Use a **timer** or a VScript call after the map is
live.

## Triggering entities

```
ent_fire <target> <input> [parameter] [delay]
```

Only the server or a listen-server host may use it. `trigger_finale` is the usual target:

| Input | Effect |
|---|---|
| `ForceFinaleStart` | starts the finale now |
| `AdvanceFinaleState` | increments the finale state |
| `FinaleEscapeFinished` | victory, but only accepted once the finale is in its escape phase |

`changelevel credits` (through `point_servercommand` or the console) ends a test campaign
deterministically; the log then shows `---- Host_Changelevel ----` and `Map: credits`.

## Markers

Put one in the map or script and wait for it:

- `printl( "[TAG] step" )` in VScript, or `Msg`.
- `point_servercommand` `Command` = `echo TAG_STEP` (no quotes, so the VMF parses).
- Engine lines worth knowing: `Finale started`, `Map: credits`, `Host_Changelevel`,
  `NAV ERRORS`, `MOB SPAWN ERROR`, `Director failed to spawn a special`,
  `[INTROS] … Unfreezing team`.

`Map: <name>` is a changelevel; `Host_NewGame on map <name>` is a direct `map` command. Both
prove a map loaded; a mission file being read at startup proves nothing.

## Recipes

**Chapter transition.** Put the team in the safe room and close the door:

```
timer 10s -> director RunScriptCode Director.WarpAllSurvivorsToCheckpoint()
timer 10s -> checkpoint_door Close
wait for the next map's name in the log
```

**Finale.** Start it, then end it:

```
timer 6s  -> finale ForceFinaleStart
timer 24s -> director RunScriptCode Director.WarpAllSurvivorsToFinale()
escape trigger -> finale FinaleEscapeFinished
escape trigger -> point_servercommand "changelevel credits"   (test harness only)
wait for "Map: credits"
```

**Nav.** `nav_edit 1`, then `select_with_attribute CHECKPOINT` or `select_with_attribute
FINALE` in the console highlights the marked areas; `read_nav_dump` reads the same facts
offline.

**Spawning.** If the horde is missing, check the log for `MOB SPAWN ERROR`. On a compact map
lower `z_spawn_safety_range`, `z_finale_spawn_safety_range` and
`z_finale_spawn_mob_safety_range`, and remember that BATTLEFIELD halts spawning while
survivors stand in it.

## Rules

1. A marker must be impossible to produce except by the step under test.
2. Truncate the log; stale lines are the most common false pass.
3. Two independent markers are better than one (for example `Finale started` plus
   `Map: credits`).
4. An entity that exists is not a mechanic that works. Run it.
