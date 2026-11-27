# Finale

The last chapter of a campaign. In L4D2 this is not a special map type — it is a map whose
goal area is FINALE and whose entities give the survivors a way to win.

`trigger_finale` is a **point** entity with a world model (radio, generator, sound board); it
starts on **+use** or from an input, not by walking into it.

## What Valve does

Stock finales use types **1, 2 and 4**; no base campaign uses type 0 (Standard). The FGD
keyvalue is `type` -- the display name is "Finale Type"; `FinaleType` is not a key and the
engine ignores it.

| Campaign | Type | Script |
|---|---|---|
| `c1m4_atrium` | 4 (Scavenge) | gas cans, `DirectorScript.MapScript.LocalScript.GasCanPoured()` |
| `c2m5_concert` | 2 | sound board, scripted waves |
| `c3m4_plantation` | 2 | radio, escape gate, `director EndScript` |
| `c4m5_milltown_escape` | 2 | generator, boat escape |
| `c5m5_bridge` | 1 (Gauntlet) | run across, no rescue entity |

Type 0 is **not broken**: firing `ForceFinaleStart` on a type 0 finale on a map with a FINALE
nav area and an arrival `info_changelevel` makes the Director log `Finale started`. That is the
scriptless path this project uses as a test. Type 2 is the Director-driven custom finale: it
loads `scripts/vscripts/<map>_finale.nut`; without that file (or a `ScriptFile` key) it starts
nothing.

## Inputs that end a finale

The FGD exposes the ending as inputs on `trigger_finale`:

- `FinaleEscapeFinished` — "Give the survivors a victory."
- `FinaleEscapeForceSurvivorPositions` — hold them on the vehicle.
- `FinaleEscapeVehicleReadyForSurvivors` — survivors comment that the vehicle stopped.

The Authoring Tools' rescue template
(`sdk_content/scripting/scripts/vscripts/entitygroups/rescue_helicopter_group.nut`) wires
exactly this: a trigger on the rescue vehicle fires `FinaleEscapeFinished`, then the outtro.

## Minimal completable finale

Two shapes, and they are not interchangeable:

**Shipping (type 2, script-driven).** `trigger_finale` type 2 plus
`scripts/vscripts/<map>_finale.nut` with a `DirectorOptions` stage list: the file, stages and
escape wiring are [`custom-finale.md`](custom-finale.md). A survivor **+use** on the trigger
fires `FinaleStart`; the stages run; `FinaleEscapeStarted` enables the escape trigger; its
`OnStartTouch` fires `FinaleEscapeFinished` and `RollStatsCrawl` on an `env_outtro_stats`.

**Scriptless test (type 0).** A type 0 trigger on a FINALE area with an arrival
`info_changelevel` starts and can spawn a horde, but it has no stage list and never reaches
the escape phase; `FinaleEscapeFinished` is ignored. Use it to prove the trigger and the nav,
not as a shipping template.

Both need FINALE nav (see `references/nav/attributes-and-flow.md`) and the **disabled**
`info_changelevel` that marks the arrival (`spawnflags 2`, `map` = previous chapter, same
landmark). Without it the Director logs `No exit checkpoint could be found` and refuses to
start the finale.

## The standard finale's limit

Type 0 starts (`Finale started`) and its horde can spawn once the map has space and a sane
safety range, but on the test map it never reaches the escape phase, so `FinaleEscapeFinished`
alone does not end the campaign. The test campaign therefore ends with a deliberate
`point_servercommand` `changelevel credits` from the escape trigger. That is a **test
harness**, not a template: a shipping campaign needs a type-2 custom finale with its
`<map>_finale.nut` stages (a `ScriptFile` key is optional).

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
- [ ] `scripts/vscripts/<map>_finale.nut` exists, declares the stage list and logs each stage
- [ ] `FinaleStart` runs the stages; `FinaleEscapeStarted` enables the escape trigger
- [ ] `OnStartTouch` fires `FinaleEscapeFinished` and the outtro
- [ ] FINALE nav area exists and is reachable from the checkpoint
- [ ] The escape trigger is not reachable before the finale starts
- [ ] A play test records: finale started, stage lines, escape triggered, stats crawl ran
