# Crescendo and panic events

A crescendo is a triggered horde: a button or trigger tells the Director to start a panic
wave, the wave runs, and `OnPanicEventFinished` fires when it is over. It is the mechanic
behind every "hold out here" moment.

## Entities

| Part | Entity / key |
|---|---|
| Trigger | `func_button`, `trigger_once` or `trigger_multiple` |
| Start the wave | output to `director` → `ForcePanicEvent` (or `PanicEvent`) |
| The Director | `info_director`, required |
| Wave finished | `info_director` output `OnPanicEventFinished`; in the test map this output did **not** fire, so the Director stage transition (`STAGE_WAIT_FOR_COMBAT_TO_END → STAGE_DONE`) is the reliable evidence |
| Reward / next step | a `logic_relay` fired by that output |
| Defend spot | nav `func_nav_attribute_region` with 32 (Battlestation) |
| Arena | nav region with 256 (Battlefield) |
| Scripted crescendo | `info_director` input `ScriptedPanicEvent <script>` (a `.nut` in `vscripts/`) |

The input and output names above are read from the installed FGD
(`read_fgd_class(classname: "info_director")`), not from a wiki.

## Recipe

```
"crescendo_button"  func_button
    OnPressed  ->  director,ForcePanicEvent

"info_director"
    OnPanicEventFinished  ->  reward_relay,Trigger

func_nav_attribute_region over the arena   spawnflags 256   (Battlefield)
func_nav_attribute_region at the hold spot spawnflags 32    (Battlestation)
```

`BATTLEFIELD` makes the Director spawn the wave inside that region, and **stops ordinary
spawning while survivors stand in it**. Mark the arena, not the whole map. `BATTLESTATION`
tells the Director where the survivors are supposed to hold.

## Verified in game

The test campaign runs a panic event ten seconds after spawn. With `director,PanicEvent` the
log shows:

```
STAGE_INITIAL_DELAY -> STAGE_MEGA_MOB
STAGE_MEGA_MOB -> STAGE_WAIT_FOR_COMBAT_TO_END
STAGE_WAIT_FOR_COMBAT_TO_END -> STAGE_DONE
```

`run_map_test({ map, waitFor: "STAGE_DONE" })` matched in **51 s**. The
`OnPanicEventFinished` output wired to a `point_servercommand` did not produce its marker on
this map; do not rely on it as the only proof. `ForcePanicEvent` produced the same stages.

A manual test: launch the map with `-condebug`, walk into the trigger, and read the log for
`Panic event started` and the `OnPanicEventFinished` marker.

An automated test needs the trigger fired after the map is live. A timer wired to the
trigger's input is the reliable way:

```
logic_timer (8 s) -> crescendo_button,Press
info_director.OnPanicEventFinished -> point_servercommand,Command,echo HSMCP_PANIC_DONE
run_map_test(waitFor: "HSMCP_PANIC_DONE", timeoutSeconds: 120)
```

## Pitfalls

- No `info_director` → the output never exists and the wave never starts.
- A panic that never finishes is usually a spawning problem, not a trigger problem: check
  `MOB SPAWN ERROR`, the safety range, and whether the arena is marked BATTLEFIELD.
- Do not mark the survivors' hold spot BATTLEFIELD as well: spawns halt while they are inside.
- `ScriptedPanicEvent` scripts must sit under `scripts/vscripts/` and end with
  `EndCustomScriptedStage`, or the stage never completes.

## Status

Entity names and the wiring are verified from the FGD. The play test is verified on the test
map: `PanicEvent` reached `STAGE_DONE` in 51 s. The `OnPanicEventFinished` output did not
fire there, so the stage transition is the proof. See `references/mechanics/coverage.md`.
