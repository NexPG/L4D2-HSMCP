# Terrain nav is empty

**Prevention.** Put the player spawn on an ordinary flat brush, not on a displacement, and
keep the patch's total rise within the measured band: a 2048x2048 patch at 1:12 (170 units)
generated **0** nav areas; 1:24 (85 units) generated 1,211, 96 units worked and 128 failed.
Block scenery tops that nav should not walk with `func_nav_blocker`.

## Symptom

`run_nav_generate` says `generated: true`, but the dump has `Number of Nav Areas: 0`, and
the console shows:

```text
Walkable position marked.
Sampling walkable space...
 NavMesh Visibility List Lengths:  min = 999999999, avg = 0, max = 0
Generation complete!  0.1 seconds elapsed.
```

`nav_trouble_report` may then pass trivially, because it has no areas to inspect. A
`run_map_test` still loads the map; the player stands on it, but bots and the Director have
nowhere to go.

## Cause

`nav_generate` marks a walkable position at the player spawn and samples the surface around
that mark; it is not a free scan of the whole BSP. Two different faults produce the same
empty result:

1. **The spawn is not on a brush.** A patch made entirely of displacements, with
   `info_player_start` on the terrain, produced 0 areas even when the terrain was flat. The
   same patch inside a room with a flat brush ring produced nav normally. The mark needs a
   solid brush surface under it.
2. **The patch rises outside the sampling band.** A 2048x2048 patch with 1:12 slope
   (170 units) produced 0 areas; 85 and 96 units produced areas; 128 and 170 failed. The
   exact band is an engine detail, but the measured working limit is ≤96 units above the
   spawn. This is not `nav_slope_limit`: removing it or setting 0.5 changed nothing.
3. **The mark is on the world origin.** A `via: "direct"` launch puts `nav_mark_walkable`
   in `listenserver.cfg`, before the local player exists. On a map whose origin is open
   floor this happens to work; on one whose origin is inside a ladder, a prop or a
   displaced slope it is `Invalid ground position`. Use `run_nav_generate(via: "steam")`:
   it launches a normal client and retries `setpos`/`nav_mark_walkable`/`nav_generate`
   through the client console after the host spawns.

A third, different failure looks similar: a **flat silhouette** (a horizon pier, a roof, a
counter top) gets a few tiny `NO_MERGE` areas; the engine then reports `Areas with
non-walkable connections`. Those are not empty nav, but they fail the gate.

## Check

```text
read_nav_dump  path: <map>_nav.txt          # Number of Nav Areas
read_nav_areas path: <map>.nav limit: 2000  # z range of the sampled surface
read_displacements path: <map>.vmf          # minDistance/maxDistance of the patch
```

Compare the nav dump's area count with the VMF: a map with a walkable floor and 0 areas is
the spawn/band fault, not a missing floor. In the console, `Walkable position marked.` means
the mark itself was placed; the empty result comes from sampling.

## Fix

- Put a flat brush ring or spawn pad under `info_player_start`, even when the rest of the
  floor is displaced. A 2048 patch with a 512-unit ring and the spawn on the ring is the
  tested shape.
- Keep the patch's rise at or below about 96 units from the spawn. A beach at 48 units is
  safe. If a taller hill is required, split it and generate nav in bands, or accept that
  bots cannot path the upper part.
- A pure displacement floor can still be navved if a small brush pad exists at the spawn;
  the pad must be flush with the terrain edge, or its step (more than 18 units) becomes a
  wall.
- Block a decorative top with a `func_nav_blocker` volume instead of deleting the brush:
  that keeps the silhouette and removes the tiny no-merge areas. Santa Monica uses this for
  the horizon pier and for the beach, which is scenery rather than the route.
- Do not read `nav_trouble_report` as proof of terrain nav when the area count is 0; the
  report inspects areas and has nothing to fail on.
