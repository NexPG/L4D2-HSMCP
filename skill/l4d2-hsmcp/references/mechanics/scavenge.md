# Scavenge

Scavenge is a mission mode. The map supplies gas-can spawn points; the mode supplies the
round timer, scores and infected spawns.

## Mission entry

A `"scavenge"` block under `"modes"`, with one chapter per map, as in
[`../campaign/mission-file.md`](../campaign/mission-file.md). `write_campaign`
`modes: [{ name: "scavenge", chapters: [...] }]` writes it.

## Gas cans

The standard arena has **16** `weapon_scavenge_item_spawn` point entities. They are normal
point entities, so `edit_vmf` places them; no special brush or entity class is needed.
Spread them around the playable area. A spawn outside the sealed map makes vbsp report
`Entity ... leaked!` and the compile fails — check the arena bounds with
`read_vmf_solids`.

## Running it

`run_map_test` with `mode: "scavenge"`; the option and its log markers are in
[`../testing/harness.md`](../testing/harness.md).

## What proves it

- HUD shows `SCORE 0 / 16` and the round timer (`01:30.00` in the test);
- `SECONDS UNTIL ROUND BEGINS` counts down;
- a gas can is visible in the frame;
- the player joins the Infected team and gets the spawn-location screen.

The test campaign's `hsmcp_test_m1` produced exactly this frame. It proves the mode and the
gas-can entities; a full round with both teams is not played.

## Pitfalls

- A gas-can spawn outside the hull leaks the map; vbsp names the entity position.
- `weapon_scavenge_item_spawn` is a point entity, not a brush; do not tie it to one.
- The mode starts from the mission entry; if the mission has no `scavenge` mode the game may
  fall back to the menu.
- The HUD is the evidence, not the map name alone.
