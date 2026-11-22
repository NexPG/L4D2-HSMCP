# VScript in an add-on

L4D2 supports VScript natively, and an add-on VPK can ship it. This page covers what is
verified: the file path, the attachment entity, and how to prove the engine loaded it.

## Where the file goes

```
addon/scripts/vscripts/<name>.nut
```

No compilation step. The engine loads the `.nut` source; Valve's own scripts ship compiled as
`.nuc`, which is not required for add-ons.

`read_vscript` checks a `.nut` without running it, and `write_vscript` uses the same checker
before it writes:

- **Errors** (the engine would not compile): `end`, `elseif`, `then`, `nil`, `~=`, `--[[`,
  and unbalanced `{}`/`()`/`[]` with the line the delimiter opened on.
- **Warnings**: a Lua `--` line comment, a missing `printl`/`Msg` banner, `IncludeScript`
  with a `.nut` extension or a `scripts/vscripts/` prefix.
- **DirectorOptions**: `A_CustomFinale_StageCount` must be a positive integer; every
  `A_CustomFinaleN` up to it must exist, a stage beyond it is a warning, and a stage value
  the file never defines is a warning. A missing `OnBeginCustomFinaleStage` is information:
  the stage list still runs, but no script logic runs with it.
- **Unknown DirectorOptions/MutationOptions keys are information, not errors.** The
  catalogue is not the engine's full set, and a false error on a valid script is worse than
  a missed note.
- **Quoted numeric options are warnings.** `TankLimit = "2"` is a string; the engine reads a
  number there. `check_vscript_contract` reports it; `read_vscript` reports the syntax and
  table shape.

`local` is **valid Squirrel** (it declares a local variable); it is not a Lua mistake. The
checker does not flag it. When given a `vmf`, `write_vscript` also adds the `logic_script`
entity for you.

## The event contract

`read_vscript_api` reads the engine's own `resource/modevents.res` and lists all stock game
events with their typed fields (338 in this install). `check_vscript_contract` then checks a
script:

- every function named `OnGameEvent_<event>` must use an event that exists — a misspelling
  never runs and leaves no console error;
- every `event_data.<field>` read inside such a hook must be a field that event declares;
- the `read_vscript` diagnostics and the quoted-numeric-option warning are included.

Unknown hooks are warnings, not errors, because an add-on may register its own event. A
known hook still needs a runtime `printl` marker to prove the engine called it.

## How the map attaches it

A `logic_script` entity:

```
"classname" "logic_script"
"vscripts"  "my_finale"      // no .nut extension
```

`vscripts` may take a list; one name is enough for a single script. The same key is used by
Valve's traffic-message script in `c4m5_milltown_escape`.

## Verify the load without playing

Launch the map with `-condebug` and read `<game>/left4dead2/console.log`:

```
Start-Process "<game>/left4dead2.exe" `
  -ArgumentList '-novid','-console','-insecure','-condebug','+map','my_map'
Select-String -Path "<game>/left4dead2/console.log" -Pattern '[MYTAG]' -SimpleMatch
```

Put a `printl( "[MYTAG] script loaded" )` at the top of the script. If the banner appears, the
path, the packing and the `logic_script` wiring are all correct. If it does not, the problem is
one of those three, not the script body.

## Custom finale stages

A type-2 `trigger_finale` loads `<map>_finale.nut`. The stage list is a `DirectorOptions`
table; the engine walks it and calls `OnBeginCustomFinaleStage( num, type )` as each stage
begins:

```squirrel
PANIC <- 0
TANK <- 1
DELAY <- 2

DirectorOptions <-
{
	A_CustomFinale_StageCount = 5
	A_CustomFinale1 = PANIC
	A_CustomFinaleValue1 = 1
	A_CustomFinale2 = DELAY
	A_CustomFinaleValue2 = 5
	A_CustomFinale3 = TANK
	A_CustomFinaleValue3 = 1
	A_CustomFinale4 = DELAY
	A_CustomFinaleValue4 = 5
	A_CustomFinale5 = DELAY
	A_CustomFinaleValue5 = 10
	TankLimit = 1
}

function OnBeginCustomFinaleStage( num, type )
{
	printl( "[MYTAG] finale stage " + num + " type " + type );
}
```

`read_vscript` checks the count against the stages, reports a stage the file never defines,
and reports an `A_CustomFinaleN` beyond the count. It cannot prove that a stage transition
fires in game; the console line from `OnBeginCustomFinaleStage` is that proof, and it needs
a loaded finale on a running map.

## What the API covers

The readable reference is the Authoring Tools' scripting SDK:

```
<game>/sdk_content/scripting/scripts/vscripts/
```

Useful files: `scriptedmode.nut` (mode framework), `holdout.nut`, `dash.nut`,
`entitygroups/rescue_helicopter_group.nut` (rescue and outtro wiring), `sm_utilities.nut`.

Verified for this project:

- `printl`, `Msg` — console output.
- `DirectorOptions` is the table the Director reads for tuning; do not set it without a
  reason and without checking the result. It is the non-cheat way to suppress infected:
  `CommonLimit`, `MaxSpecials`, `TankLimit`, `WitchLimit` and `MobSpawnSize` set to 0.
  `director_stop` is a **cheat command** and is ignored in a normal client.
- The stock FGD does not declare `logic_script`; `read_vmf_lint` tolerates it and its
  `vscripts` key. The engine still creates it and runs the script.
- Finale victory is an entity input (`trigger_finale.FinaleEscapeFinished`), not a script
  call. See `references/campaign/finale.md`.

Not verified here and therefore not documented as working: scripted finale waves, spawning
customs, and the full function catalogue. `read_vscript_api` covers the game-event and
DirectorOptions/MutationOptions part; it does not pretend to list every engine global. Do not
invent API calls; if a script is needed for something outside the catalogue, say it is
unverified and test with `-condebug`.

## Common failures

| Symptom | Cause |
|---|---|
| No banner | wrong path, script not in the VPK, or `logic_script` missing |
| Banner, then nothing | the script loaded but the function you expect is not called |
| Script errors in console | L4D2 VScript is Squirrel with L4D2 bindings, not Lua or Source 2 |
| Works loose, not in VPK | the archive was packed from a directory without `scripts/` |
