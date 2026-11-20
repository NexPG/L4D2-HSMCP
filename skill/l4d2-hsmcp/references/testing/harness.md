# A play test with assertions

`run_map_test` starts a map, then either waits for one `waitFor` pattern or for an ordered
list of `markers`. Each marker is searched from the end of the previous match, so a line
that occurs earlier (`Loading:` once per map) cannot satisfy a later step, and the result is
a timeline with the matching line and the time.

This is the difference between "the map loaded" and "the finale started, the tank stage
followed, the escape unlocked, the credits loaded".

## A finale, as a timeline

```
run_map_test
  map: hsmcp_test_m2
  markers:
    - { name: probe,      pattern: "probe executed",          withinSeconds: 30 }
    - { name: spawn,      pattern: "Allowing spawning",       withinSeconds: 90 }
    - { name: panic,      pattern: "finale stage 1 type 0",   withinSeconds: 60 }
    - { name: tank,       pattern: "finale stage 3 type 1",   withinSeconds: 60 }
    - { name: escape,     pattern: "FinaleEscapeStarted",     withinSeconds: 80 }
    - { name: credits,    pattern: "Map: credits",            withinSeconds: 120 }
  commands: ["script_execute hsmcp_probe"]
  via: steam
```

`withinSeconds` is measured from the previous marker, not from launch. A step that should
follow in 20 seconds fails in 20 seconds.

## The trap: `commands` run before the map's entities exist

`commands` are written to `cfg/listenserver.cfg`. The engine executes that file at **server
start**, before the map's entities are spawned. `ent_fire finale ForceFinaleStart` there
finds nothing and does nothing, and the test looks like a broken map.

`script_execute` does run at that point, and VScript's `EntFire(target, input, value, delay)`
schedules the action for later, when the entity exists. A probe installed through
`scriptsDir` is the reliable way to touch entities after spawn:

```squirrel
// scripts/vscripts/hsmcp_probe.nut
printl("[HSMCP] probe executed");
EntFire("selftest_echo", "Command", "sb_add", 12, null);      // a survivor bot to possess
EntFire("selftest_echo", "Command", "director_start", 18, null);
EntFire("finale", "ForceFinaleStart", "", 50, null);
```

- `scriptsDir` copies the file into `<game>/scripts/vscripts` for the run and restores what
  was there. Write the `.nut` **without a BOM**: VScript reports `expression expected` at
  line 1 for a UTF-8 BOM.
- `point_servercommand` + `Command` is how a probe runs a console command later; `sb_add`
  adds a survivor bot and `director_start` starts the Director when a stock map does not
  spawn the team by itself.

## When the assertion is minutes away

`EntFire` schedules in seconds and the harness only waits 15 s after the last marker, so a
four-minute survival round or a slow boss needs a different clock: a map entity's.

`schedule` writes `scripts/vscripts/hsmcp_schedule.nut` for the run. It spawns a
`point_servercommand` and one `logic_timer` per entry, whose `OnTimer` output runs the command
on the server at that second:

```json
{
  "schedule": [
    { "atSeconds": 60, "command": "echo HSMCP_TICK_60" },
    { "atSeconds": 240, "command": "echo HSMCP_TICK_240" },
    { "atSeconds": 300, "command": "director_stop 1" }
  ]
}
```

A marker can then match `HSMCP_TICK_240` four minutes in, and the screenshot follows it.
`AddOutput` carries its parameter comma-separated, so a scheduled command cannot contain a
comma, a double quote or a newline; the generator refuses those instead of writing a broken
timer.


## The environment limit

A direct `left4dead2.exe` launch reaches `Disconnect: No Steam logon` after about a minute.
`via: "steam"` launches through `steam.exe -applaunch 550` without `-insecure`, which is the
normal-client path. On this machine it still ends with
`STEAMAUTH: Client ... received failure code 8` / `No Steam logon` at about two minutes, so
the account, not the launcher, is the limit. A finale that needs 90 seconds cannot be proved
there; the harness reports the timeline up to the drop and the missing steps rather than a
false pass. A machine with a logged-on Steam client removes the block without a tool change.

Short proofs that finish before the drop (map load, HUD, a screenshot, the first mode
script) are unaffected.

## Reading the result

- `matched` is true only when every marker was reached.
- `timeline` is the reached prefix, with the exact line and time; it is the evidence to quote.
- `missing` names the first step that did not happen and everything after it.
- `logTail` is the last 25 lines, for the line the pattern did not anticipate.
- The full log stays at `<game>/left4dead2/console.log`.

## Hidden addons and a killed run

`addonsToHide` renames an archive to `*.off` and restores it at the end. A run that is killed
mid-flight never reaches the restore, and the campaign then vanishes from the menu (the
`AddOn Campaigns` list is built at startup). `run_map_test` now restores every `*.vpk.off` in
`addons/` before it hides anything and returns `addonsRestored`.

## Driving the menu

The campaign menu can be walked with synthetic input:

1. click `PLAY CAMPAIGN` (SendInput absolute), then press `Down` -- the flyout is a hover list
   that the keyboard enters from below;
2. `Down` to `Single Player`, `Enter`;
3. `Right` on `CAMPAIGN` opens the list, `Down` to `AddOn Campaign...`, `Enter`;
4. the add-on campaign list appears, with the campaign's `addontitle`, author and description.

Everything up to the last step works with `SendInput` clicks and `SendKeys` arrows. The final
`SELECT` inside the add-on list did not accept Enter, Space, `e` or a synthetic click in this
build, even though the row highlights on hover -- that last press needs a real pointer or the
gamepad button.
