# Custom finale (type 2)

A custom finale is a VScript file the engine loads by name. This is how every stock L4D2
finale works, and it is the only path to a Director-driven finale with waves and a real
escape phase.

## The file

```
addon/scripts/vscripts/<mapname>_finale.nut
```

The name must match the map exactly. A `trigger_finale` with `type 2` loads it automatically
when the finale starts; no `ScriptFile` keyvalue is needed. The script lands in the map script
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
- `SCRIPTED` — an onslaught stage that ends only on `EndCustomScriptedStage` or
  `AdvanceFinaleState`; its value is a script name.

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

## The test campaign's finale

`hsmcp_test_m2_finale.nut`: two DELAY stages of 5 s each (a shipping finale would use PANIC and
TANK). It logs `[HSMCP] finale stage N type T` so an automated run can prove the stages ran,
and the escape point opens on `FinaleEscapeStarted`.

`FinaleEscapeFinished` alone did not end the campaign even after the escape phase; the test
harness adds a `point_servercommand changelevel credits` on the escape trigger, and the credits
map load is the deterministic end. A shipping campaign fires `FinaleEscapeFinished` from a
rescue vehicle script instead.

## Rules

- **Type 0 is not a substitute.** It starts and can spawn a horde, but it has no stage list and
  never reaches the escape phase; `FinaleEscapeFinished` is ignored there.
- The script name is content, not a guess: `<map>_finale.nut`, lowercase as the map is.
- Verify the load in `console.log`: a `Msg`/`printl` at the top, and the stage log lines.
- A wave needs somewhere to spawn: see `references/nav/attributes-and-flow.md` for FINALE
  coverage and the Director's safety range.
