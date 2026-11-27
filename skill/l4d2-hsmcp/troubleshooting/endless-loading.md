# The loading bar never finishes

The campaign poster is on screen, the loading bar fills part way or stays empty, and gameplay
never starts. The process is alive, so it reads as a slow load. It is usually a **restart
loop**, not a slow load.

## Contents

- Read the log first
- The four causes seen in this project
- Look at the screen, twice
- The client never joins: `net_SignonState`
- Fixes

## Read the log first

```
Get-Content "<game>/left4dead2/console.log" | Select-String 'Host_NewGame|Loading:|Map:'
```

- A normal load prints **one** `Host_NewGame on map <name>`, **one** `Loading: N seconds` and
  then `Map: <name>`.
- A loop prints `Host_NewGame on map <same map>` again and again and **no** `Loading:` line at
  all. Measured on `hsmcp_probe_natural`: **53 restarts in one two-minute run, zero
  `Loading:` lines**, and the client sat on the loading screen the whole time.

The engine never completed a transition, restarted the map, and the screen never advanced.

## The four causes seen in this project

1. **A probe host with a live chapter exit.** The test chapters carry an `info_changelevel`
   brush (`map hsmcp_test_m2`) and a checkpoint-warp chain:
   `logic_relay selftest_start` → `logic_timer selftest_warp` →
   `Director.WarpAllSurvivorsToCheckpoint()`. With only the first chapter staged as a loose
   `.bsp`, the warp puts the team inside the changelevel volume, the engine cannot open the
   next map, and it restarts the current one forever.
2. **A renamed or edited stock `.bsp`.** `c1m1_hotel.bsp` copied to a new name looks for
   `materials/maps/<new-name>/...`; an edited copy under the original name also failed to
   reach the map. Put a probe in a map you compiled under its own name.
3. **A map name longer than 30 characters.** The nav header stores 32 bytes, but the engine
   fails signon at 31 characters. Measured: a 37-character preview name and a 31-character
   one both stayed at the menu; the same room at 30 characters (`hsmcp_preview_bench001_mwtehbv5`)
   and at 11 (`prevcartest`) loaded in 16.3 s. Keep custom names ≤30; `preview_model` caps its
   generated name.
4. **The compile BSP, not the nav-generated one.** `run_nav_generate` bakes the string-table
   dictionary into its own copy. Joining the compile output prints
   `String Table dictionary for downloadables should be rebuilt, only found N of M strings`
   and `Netchannel: failed reading message net_SignonState from loopback`, then leaves the
   client at the main menu with no `Loading:` line. The fix is to launch the pair the
   generator produced (`run_nav_generate` → `maps[0].bsp` + `maps[0].nav`), which is what
   `run_campaign_gate` and `preview_model` now do.

A fixture room (`hmcp_probe`, `hmcp_backyard`) is a different failure: it loads but has
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

## The client never joins: `net_SignonState`

A launch can print `Host_NewGame on map <name>` and `Map: <name>` and still leave the client at
the main menu, with:

```text
Netchannel: failed reading message net_SignonState from loopback.
---> DIDN'T FINISH PARSING net_SignonState
```

That is the client failing to parse the server's signon packet, not a slow map. Two checks:

1. **Kill every game process and retry.** A second `left4dead2.exe` at the menu, or a stale
   loopback connection, makes the new client join the wrong server. `run_map_test` with
   `replaceRunningGame: true` closes the ones it can find; `taskkill /IM left4dead2.exe /F /T`
   is the manual version. Confirm with `check_game_state` (`clean: true`).
2. **Use the pair, not two files.** If the same run also prints
   `String Table dictionary for downloadables should be rebuilt, only found N of M strings`,
   the BSP and nav came from different steps. Ship `run_nav_generate`'s `maps[0].bsp` and
   `maps[0].nav`; the compile BSP has no baked dictionary. If the dictionary marker is present
   but the count is short, the bake was killed while the engine was still appending entries:
   regenerate nav (the tool waits for the BSP size to stop changing), do not reuse the file.

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
