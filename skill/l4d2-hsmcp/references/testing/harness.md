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

## A mutation or custom mode

Pass `mode: <name>` instead of hand-writing the command:

```
run_map_test
  map: c1m1_hotel
  mode: hsmcp_mut_probe
  waitFor: "Mutation hsmcp_mut_probe loaded"
```

Measured on this client: `+mp_gamemode` is an **unknown command**, and a second argument to
`+map` is ignored (the log says `Script not found (coop)`). The map command itself accepts
the mode, so the harness starts the map once and then runs
`map <map> <mode>` from `cfg/listenserver.cfg`; the mutation's top-level `printl` is what a
marker can match. The mode and its script must already be installed loose or in an add-on
VPK. `mode` is also returned in the result, and the generated command appears in
`commandsRun`.

## Special-infected probe

Use a **playable campaign chapter** with player start, flow and generated nav, not
`hmcp_probe`/`hmcp_backyard`. Add the probe to a VMF, compile, generate nav, then launch:

```
run_map_test
  map: hsmcp_probe_m1
  bsp: <compiled>
  nav: <generated>
  scriptsDir: <probe scripts>
  commands: ["echo HSMCP_ENABLE"]     # forces sv_cheats 1 into listenserver.cfg
  via: steam
  waitFor: "\[HSMCP_SI\] boomer=[1-9]"
```

`SendToConsole("z_spawn boomer")` is the working route. A `point_servercommand` plus
`EntFire` did not execute, and a direct `-insecure` launch on the test campaign attached no
local player (`Cannot execute "z_spawn ...", no player`). Steam launch did.

A probe host with a live `info_changelevel` and checkpoint warp restarts forever on the
loading screen, so strip the exit first (see "A loading bar that never finishes" below).
`write_special_infected_probe` refuses such a host and names the entities; `stripExit: true`
removes them and reports them in `strippedExits`.

This spawns manually, so it proves the probe/class identity, not that a mutation's
`BoomerLimit` was honoured. A zero count with `no player` means the host map is not playable.

**A 38-area test chapter does not host a natural spawn.** Five probe reports over 100 s on the
exit-stripped test chapter, with all four survivors teleported to the far end and
`director_start` issued, logged `0` commons and `0` specials. The Director needs a full-size
flow chapter before "it spawned on its own" can be asserted; do not read that silence as a
failed limit or a failed probe.

### A bench map that can host the Director

A hall of four bays tests spawns, hordes and a finale without shipping a chapter:

- **geometry**: one sealed hall about 2048 × 4608 × 320, split by three walls at
  `y = 1024`, `2048`, `3072`, each with a 256-wide, full-height arch. 12 brushes, sealed,
  no leaks.
- **entities**: `info_player_start` at one end, `info_director` (targetname `director`),
  `info_zombie_spawn` in the middle, one `light` per bay.
- **goal**: the far end is **FINALE** (`func_nav_attribute_region` spawnflags 64) plus a
  `trigger_finale` (`type 0`). Never a bare CHECKPOINT region: that scatters
  `NAV ERRORS — Map is unplayable!` over the screen (`troubleshooting/nav-unplayable.md`).
- **nav**: 45 areas, `playable` after `run_nav_generate`.

With the survivors teleported to the goal (`player.SetOrigin` works on players), the Director
spawns commons on its own: **8 common infected** inside ~100 s. Specials were not seen in a
140 s window — treat "the Director spawns commons" as proven and "it spawns specials" as still
open.

Teleporting is the scripted substitute for walking. A client that stands at the spawn never
leaves the start area as far as the Director is concerned, and then it spawns nothing at all.

## Effective DirectorOptions

`write_options_probe` adds a `logic_script` to a VMF (or use its returned entity with
`edit_bsp_entities` on a compiled map) and writes a `.nut` that prints the Director's merged
`SessionOptions` on `round_start` / `player_spawn`. This is the runtime proof that a
mutation's `MutationOptions` reached the Director; a top-level `printl` in the mutation
script runs before `scriptedmode.nut` merges the tables.

Measured on a copy of `c1m1_hotel.bsp` with a `logic_script` added to the entity lump and a
mutation setting `BoomerLimit=0, SmokerLimit=2, MaxSpecials=3`:

```
[HSMCP_OPTIONS] ModeName=hsmcp_opt
[HSMCP_OPTIONS] BoomerLimit=0
[HSMCP_OPTIONS] SmokerLimit=2
[HSMCP_OPTIONS] MaxSpecials=3
HSMCP_OPTIONS_DONE
```

The event hook is the working shape. `AddThinkToEnt`, a delayed `EntFire(RunScriptCode)`
from `script_execute`, and a `schedule` logic_timer did not print in the same runs.

`SessionOptions` is installed by a **scripted mode**. On a plain `+map` run without one the
global does not exist, and the probe now prints `SessionOptions=absent` instead of throwing
`the index 'SessionOptions' does not exist`; run a mutation (or another scripted mode) when
you need the merged Director options.

## Do not use a stock `.bsp` as a probe host

A compiled map is not a neutral container for a `logic_script`. Two measured failures:

- copying `c1m1_hotel.bsp` to a new name made the engine look under
  `materials/maps/<new-name>/...`, and the load sat at the loading screen for 92 s;
- an **edited** copy staged back under the original name also failed to reach the map in
  one run, while the untouched copy loaded in 26 s.

A renamed or modified stock map is a runtime experiment with the game's own content, not a
fixture. Put the probe in a custom map you control (a VMF compiled under its own name), or
use the test map built for the probe. If you need a stock map's geometry, copy its VMF when
you have it; do not rename the BSP.

## A loading bar that never finishes is a restart loop

A probe host must have **no live chapter exit**. On the test chapters, `selftest_start`
enables `selftest_warp`, which calls `Director.WarpAllSurvivorsToCheckpoint()`; the team lands
in the `info_changelevel` brush, and when the next chapter (`hsmcp_test_m2`) is not installed
the engine restarts the same map instead of loading it. Measured: **53 `Host_NewGame` lines
for the same map and no `Loading:` line at all** in one run, with the client on the loading
screen throughout.

Diagnose from the log, not from patience:

```
console.log | Select-String 'Host_NewGame|Loading:|Map:'
```

One `Host_NewGame`, one `Loading: N seconds`, one `Map:` is a normal load. Repeated
`Host_NewGame` for the same map with no `Loading:` is a loop. `hsmcp_test_m1` from the full
campaign VPK loads in **23 s** (`Loading: 23.17 seconds`); the screen is the campaign poster
at 15 s and gameplay at 35 s.

A probe VMF is therefore built from the chapter with `edit_vmf` `remove` on `to_m2` (the
`info_changelevel` brush), `selftest_start` and `selftest_warp`, then compiled under its own
name. See `troubleshooting/endless-loading.md`.

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


## Do not launch while someone is playing

`run_map_test`, `run_nav_generate`, `run_build_cubemaps` and `nav_trouble_report` refuse to
start when `left4dead2.exe` is already running. Steam allows one instance per account: a test
launch takes the session over and drops the player to the main menu (measured on the owner's
own server). Pass `replaceRunningGame: true` only when that game is yours and may be closed;
the harness then stops that pid first. It never kills every `left4dead2.exe` on the machine,
and it stops only the pid it launched.

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
