# Custom finale (type 2)

A custom finale is a VScript file the engine loads by name. This is how every stock L4D2
finale works, and it is the only path to a Director-driven finale with waves and a real
escape phase.

## The file

```
addon/scripts/vscripts/<mapname>_finale.nut
```

The name must match the map exactly. A `trigger_finale` with `type 2` loads it automatically
when the finale starts; the FGD key is `type` (displayed as "Finale Type"), not
`FinaleType`. No `ScriptFile` keyvalue is needed. The script lands in the map script
scope (`DirectorScript.MapScript`).

## Stages

The stage list lives in `DirectorOptions`:

```squirrel
PANIC <- 0; TANK <- 1; DELAY <- 2; SCRIPTED <- 3;

DirectorOptions <-
{
    A_CustomFinale_StageCount = 4

    A_CustomFinale1 = PANIC
    A_CustomFinaleValue1 = 1      // number of panic waves
    A_CustomFinale2 = DELAY
    A_CustomFinaleValue2 = 10     // seconds
    A_CustomFinale3 = TANK
    A_CustomFinaleValue3 = 1      // number of tanks
    A_CustomFinale4 = DELAY
    A_CustomFinaleValue4 = 8

    TankLimit = 1
    WitchLimit = 0
    CommonLimit = 20
    HordeEscapeCommonLimit = 15
    EscapeSpawnTanks = false
}

function OnBeginCustomFinaleStage( num, type )
{
    printl( "[TAG] finale stage " + num + " type " + type );
}
```

- `PANIC` — a horde wave; its value is how many.
- `TANK` — a tank wave; its value is how many.
- `DELAY` — a pause in seconds.
- `ONSLAUGHT` / `SCRIPTED` — value `3`, an onslaught stage that ends only on
  `EndCustomScriptedStage` or `AdvanceFinaleState`; its value is a script name (or `""`).

`A_CustomFinaleMusicN` overrides the music for that stage. Stock finales also use
`SharedOptions` and copy it into `MapScript.DirectorOptions` on each stage:

```squirrel
function OnBeginCustomFinaleStage( num, type )
{
    MapScript.DirectorOptions.clear()
    foreach ( key, val in SharedOptions )
        MapScript.DirectorOptions[key] <- val
}
```

The stock patterns are the best templates: `c2m5_concert_finale.nut` (9 stages, two tanks),
`c4m5_milltown_escape_finale.nut` (8 stages), `c1m4_atrium_finale.nut` (31 stages with
`ONSLAUGHT` delays and a gas-can counter). Read them from the installed VPK or the
L4D2-Decompiled mirror before inventing a sequence.

Multiple finales can be declared with prefixes `A_`..`E_`; the Director picks one.

## The escape

After the last stage the engine fires `trigger_finale`'s **`FinaleEscapeStarted`**. Wire it to
enable the escape trigger, then that trigger fires `FinaleEscapeFinished` (plus
`RollStatsCrawl`) when survivors enter. That is the victory.

```
finale.FinaleEscapeStarted  -> escape_trigger.Enable
escape_trigger.OnStartTouch -> finale.FinaleEscapeFinished
escape_trigger.OnStartTouch -> outtro.RollStatsCrawl
```

## Contract check

`check_finale_contract(path, nav)` reads a VMF or BSP and the `.nav` without launching the
game. It checks exactly one `trigger_finale`, `type` in 0/1/2/4, gas-can spawns for type 4,
and FINALE/RESCUE_VEHICLE/ESCAPE_ROUTE nav areas. A type-2 map normally has **no
`ScriptFile`**: the engine loads `<map>_finale.nut` from the map script scope, so the tool
warns rather than failing. The official `c2m5_concert` and `c3m4_plantation` pass with that
warning; `c5m5_bridge` (type 1) passes with 6,066 FINALE areas and 10 RESCUE_VEHICLE areas.

A pass is a structural contract, not a played finale; the last stage, escape and credits are
still a live test.

## The test campaign's finale

`hsmcp_test_m2_finale.nut`: five stages — PANIC, DELAY 5, TANK, DELAY 5, DELAY 10. It
logs `[HSMCP] finale stage N type T` so an automated run can prove the stages ran, and the
escape point opens on `FinaleEscapeStarted`.

Verified in game: stages 1 (PANIC), 2 (DELAY), 3 (TANK), 4 (DELAY), 5 (DELAY), then
`HSMCP_ESCAPE_STARTED`, `HSMCP_ESCAPE_TOUCHED`, `Host_Changelevel` and the credits map,
in 137 s. The TANK stage transitioned; the test does not prove the bots killed a tank,
because the stage clock moved on. A final PANIC stage was replaced by DELAY: its commons did
not clear, and the stage hung instead of reaching the escape.

`FinaleEscapeFinished` alone did not end the campaign even after the escape phase; the test
harness adds a `point_servercommand changelevel credits` on the escape trigger, and the
credits map load (`Host_Changelevel`) is the deterministic end. A shipping campaign fires
`FinaleEscapeFinished` from a rescue vehicle script instead.

## Rules

- **Type 0 is not a substitute.** It starts and can spawn a horde, but it has no stage list and
  never reaches the escape phase; `FinaleEscapeFinished` is ignored there.
- The script name is content, not a guess: `<map>_finale.nut`, lowercase as the map is.
- Verify the load in `console.log`: a `Msg`/`printl` at the top, and the stage log lines.
- A wave needs somewhere to spawn: see `references/nav/attributes-and-flow.md` for FINALE
  coverage and the Director's safety range.
