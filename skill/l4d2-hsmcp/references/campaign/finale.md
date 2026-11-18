# Finale

The last chapter of a campaign. In L4D2 this is not a special map type — it is a map whose
goal area is FINALE and whose entities give the survivors a way to win.

## What Valve does

Every stock finale uses `trigger_finale` with **type 2 (Custom)**. The FGD keyvalue is
`type` -- the display name is "Finale Type"; `FinaleType` is not a key and the engine
ignores it.

| Campaign | Type | Script |
|---|---|---|
| `c1m4_atrium` | 4 (Scavenge) | gas cans, `DirectorScript.MapScript.LocalScript.GasCanPoured()` |
| `c2m5_concert` | 2 | sound board, scripted waves |
| `c3m4_plantation` | 2 | radio, escape gate, `director EndScript` |
| `c4m5_milltown_escape` | 2 | generator, boat escape |
| `c5m5_bridge` | 1 (Gauntlet) | run across, no rescue entity |

No base campaign uses type 0 (Standard). But type 0 is **not broken**: firing
`ForceFinaleStart` on a type 0 finale on a map with a FINALE nav area and an arrival
`info_changelevel` makes the Director log `Finale started`. That is the scriptless path this
project uses. Type 2 without a finale script starts nothing.

## Inputs that end a finale

The FGD exposes the ending as inputs on `trigger_finale`:

- `FinaleEscapeFinished` — "Give the survivors a victory."
- `FinaleEscapeForceSurvivorPositions` — hold them on the vehicle.
- `FinaleEscapeVehicleReadyForSurvivors` — survivors comment that the vehicle stopped.

The Authoring Tools' rescue template
(`sdk_content/scripting/scripts/vscripts/entitygroups/rescue_helicopter_group.nut`) wires
exactly this: a trigger on the rescue vehicle fires `FinaleEscapeFinished`, then the outtro.

## Minimal completable finale

Entity work, no script required:

1. `trigger_finale` type 2, model for the radio/generator/board, `StartDisabled 0`.
   A survivor **+use** on it fires `FinaleStart`.
2. A `trigger_multiple` (clients only) away from the trigger, `StartDisabled 1`.
   `FinaleStart` enables it after a delay — that delay is the finale.
3. The escape trigger's `OnStartTouch` fires `FinaleEscapeFinished` on the finale and
   `RollStatsCrawl` on an `env_outtro_stats`.
4. Mark the finale area FINALE in nav, and put the escape point inside the playable space.
5. Add the **disabled** `info_changelevel` that marks the arrival (`spawnflags 2`,
   `map` = previous chapter, same landmark). Without it the Director logs
   `No exit checkpoint could be found` and refuses to start the finale.

This wins the campaign without waves. Waves are VScript work and are not built yet; do not
describe an untested wave script as working.

## The standard finale's limit

Type 0 starts (`Finale started`) and its horde can spawn once the map has space and a sane
safety range, but on the test map it never reaches the escape phase, so `FinaleEscapeFinished`
alone does not end the campaign. The test campaign therefore ends with a deliberate
`point_servercommand` `changelevel credits` from the escape trigger. That is a **test
harness**, not a template: a shipping campaign needs a scripted custom finale (`type 2` with a
`ScriptFile`).

## Confirming the win

The credits map loading is the victory marker. The reliable line in the test run was:

```
---- Host_Changelevel ----
```

`Map: credits` may follow, but `Host_Changelevel` is the line the harness waits for. Do
**not** use `Mission credits ver 1 loading...` — every mission file, credits included, is
loaded at startup.

`env_outtro_stats` is the stats crawl, not the victory. On the test map the custom finale
reaches its escape phase; the harness ends the campaign with a deliberate
`point_servercommand` `changelevel credits`. A shipping campaign fires
`FinaleEscapeFinished` from a rescue vehicle script instead.

## Checklist

- [ ] `trigger_finale` type 2 compiles and responds to +use
- [ ] `FinaleStart` enables the escape trigger with a deliberate delay
- [ ] `OnStartTouch` fires `FinaleEscapeFinished` and the outtro
- [ ] FINALE nav area exists and is reachable from the checkpoint
- [ ] The escape trigger is not reachable before the finale starts
- [ ] A play test records: finale started, escape triggered, stats crawl ran
