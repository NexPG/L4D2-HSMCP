# VScript in an add-on

L4D2 supports VScript natively, and an add-on VPK can ship it. This page covers what is
verified: the file path, the attachment entity, and how to prove the engine loaded it.

## Where the file goes

```
addon/scripts/vscripts/<name>.nut
```

No compilation step. The engine loads the `.nut` source; Valve's own scripts ship compiled as
`.nuc`, which is not required for add-ons.

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
  reason and without checking the result.
- Finale victory is an entity input (`trigger_finale.FinaleEscapeFinished`), not a script
  call. See `references/campaign/finale.md`.

Not verified here and therefore not documented as working: scripted finale waves, spawning
customs, Director script hooks. Do not invent API calls; if a script is needed for something
outside the list above, say it is unverified and test with `-condebug`.

## Common failures

| Symptom | Cause |
|---|---|
| No banner | wrong path, script not in the VPK, or `logic_script` missing |
| Banner, then nothing | the script loaded but the function you expect is not called |
| Script errors in console | L4D2 VScript is Squirrel with L4D2 bindings, not Lua or Source 2 |
| Works loose, not in VPK | the archive was packed from a directory without `scripts/` |
