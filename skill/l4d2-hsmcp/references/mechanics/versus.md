# Versus

Versus is a mission mode; the map supplies the arena and nav, the mode supplies the teams,
the infected spawn screen and the scoring.

## Mission entry

A `"versus"` block under `"modes"`, with one chapter per map, as in
[`../campaign/mission-file.md`](../campaign/mission-file.md). `write_campaign`
`modes: [{ name: "versus", chapters: [...] }]` writes it.

## Running it

`run_map_test` with `mode: "versus"`; the option and its log markers are in
[`../testing/harness.md`](../testing/harness.md).

## What proves it

- the map loads, not the main menu;
- `console.log` contains `VSCRIPT: Running anv_versus.nut` (the mode's own script);
- a survivor/Infected spawn screen or the Versus HUD appears when the teams are populated;
- the map is playable with the same nav as coop.

The test map loaded in 33 s and ran `anv_versus.nut`. A single-player listen server does not
populate both teams, so the full Versus HUD/round was not observed; that is expected, not a
map defect.

## Pitfalls

- Versus needs a nav mesh; without it the map is unplayable in every mode.
- A map that also carries Scavenge gas-can entities shows them in Versus; they are map
  entities, not mode-gated. Remove them from a map that is not meant to be Scavenge.
- One player is not a Versus round: test the mode script line and map load, then use a
  populated server for the round.
- `mode` runs `map <map> versus` from `cfg/listenserver.cfg`; this client has no `mp_gamemode` command.
