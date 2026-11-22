# The loading bar never finishes

The campaign poster is on screen, the loading bar fills part way or stays empty, and gameplay
never starts. The process is alive, so it reads as a slow load. It is usually a **restart
loop**, not a slow load.

## Read the log first

```
Get-Content "<game>\left4dead2\console.log" | Select-String 'Host_NewGame|Loading:|Map:'
```

- A normal load prints **one** `Host_NewGame on map <name>`, **one** `Loading: N seconds` and
  then `Map: <name>`.
- A loop prints `Host_NewGame on map <same map>` again and again and **no** `Loading:` line at
  all. Measured on `hsmcp_probe_natural`: **53 restarts in one two-minute run, zero
  `Loading:` lines**, and the client sat on the loading screen the whole time.

The engine never completed a transition, restarted the map, and the screen never advanced.

## The two causes seen in this project

1. **A probe host with a live chapter exit.** The test chapters carry an `info_changelevel`
   brush (`map hsmcp_test_m2`) and a checkpoint-warp chain:
   `logic_relay selftest_start` → `logic_timer selftest_warp` →
   `Director.WarpAllSurvivorsToCheckpoint()`. With only the first chapter staged as a loose
   `.bsp`, the warp puts the team inside the changelevel volume, the engine cannot open the
   next map, and it restarts the current one forever.
2. **A renamed or edited stock `.bsp`.** `c1m1_hotel.bsp` copied to a new name looks for
   `materials/maps/<new-name>/...`; an edited copy under the original name also failed to
   reach the map. Put a probe in a map you compiled under its own name.

A fixture room (`hmcp_probe`, `hmcp_backyard`) is a third, different failure: it loads but has
no real flow, so nothing spawns and the run proves nothing.

## Look at the screen, twice

`capture_window` with `method: "screen"` returns the real frame:

```
capture_window
  processName: left4dead2
  method: screen
  out: .hammer-mcp/scratch/map-load-15s.png
```

Measured on this machine, `hsmcp_test_m1` from the campaign VPK:

- **15 s**: campaign poster, "Joining a Campaign game", loading bar about half;
- **35 s**: gameplay, HUD, four survivors. `console.log` says `Loading: 23.17 seconds`.

So ~20–26 s is a normal load here. Take two captures: one half-filled bar at 15 s cannot be
told apart from a loop on its own.

## Fixes

- **Probe on a map with no exit.** Copy the VMF, remove the `info_changelevel` brush entity and
  the `selftest_start` / `selftest_warp` chain, then compile under its own name. `edit_vmf`
  `op: "remove"` on a `targetname` removes the brush entity together with its solids (measured:
  42 → 39 entities, 53 → 52 solids, zero `info_changelevel` left).
  `write_special_infected_probe` does the same check and refuses a host that still has one;
  pass `stripExit: true` and it removes the exit entities and reports them in `strippedExits`.
- **Or install the whole campaign.** A mission plus every chapter in one VPK lets the
  transition resolve; a loose `.bsp` alone does not.
- Check the install afterwards with `check_game_state`; it must report `clean: true`.
