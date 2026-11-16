# Finale

The last chapter of a campaign. In L4D2 this is not a special map type — it is a map whose
goal area is FINALE and whose entities give the survivors a way to win.

## What Valve does

Every stock finale uses `trigger_finale` with **type 2 (Custom)**:

| Campaign | Type | Script |
|---|---|---|
| `c1m4_atrium` | 4 (Scavenge) | gas cans, `DirectorScript.MapScript.LocalScript.GasCanPoured()` |
| `c2m5_concert` | 2 | sound board, scripted waves |
| `c3m4_plantation` | 2 | radio, escape gate, `director EndScript` |
| `c4m5_milltown_escape` | 2 | generator, boat escape |
| `c5m5_bridge` | 1 (Gauntlet) | run across, no rescue entity |

No base campaign uses type 0 (Standard). A type 0 finale is not a shortcut that is known to
work; do not present it as one.

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

This wins the campaign without waves. Waves are VScript work and are not built yet; do not
describe an untested wave script as working.

## Checklist

- [ ] `trigger_finale` type 2 compiles and responds to +use
- [ ] `FinaleStart` enables the escape trigger with a deliberate delay
- [ ] `OnStartTouch` fires `FinaleEscapeFinished` and the outtro
- [ ] FINALE nav area exists and is reachable from the checkpoint
- [ ] The escape trigger is not reachable before the finale starts
- [ ] A play test records: finale started, escape triggered, stats crawl ran
