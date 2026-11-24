# Terrain nav is empty

**Prevention.** Use `run_nav_generate(via: "steam")` for any map whose world origin is not
open floor. A direct launch puts `nav_mark_walkable` in `listenserver.cfg` before the local
player exists, so it marks the **world origin**; a ladder, a prop or a displaced slope there
produces `Invalid ground position` and an empty mesh. With a real Steam host the same
2048x2048 1:12 terrain patch generated **1,158 nav areas**. Keep the spawn on a flat brush
ring anyway, and block scenery tops with `func_nav_blocker`.

## Symptom

`run_nav_generate` says `generated: true`, but the dump has `Number of Nav Areas: 0`, and
the console shows:

```text
Walkable position marked.
Sampling walkable space...
 NavMesh Visibility List Lengths:  min = 999999999, avg = 0, max = 0
Generation complete!  0.1 seconds elapsed.
```

or, when the mark itself failed:

```text
ERROR: Invalid ground position.
No valid walkable seed positions.  Cannot generate Navigation Mesh.
```

`nav_trouble_report` may then pass trivially, because it has no areas to inspect. A
`run_map_test` still loads the map; the player stands on it, but bots and the Director have
nowhere to go.

## Cause

`nav_generate` samples around one marked walkable position; it is not a free scan of the
whole BSP. The position comes from `nav_mark_walkable`, which uses the **current player**.

1. **The mark ran before the player existed.** `via: "direct"` executes the cfg at server
   start; the local player is not spawned yet, so the mark lands on the world origin. This
   worked by accident on maps whose origin is open floor; on a ladder, a prop or terrain it
   is `Invalid ground position`.
2. **The spawn is on a displacement.** A mark on a displaced surface may not find a solid
   brush under it. A flat brush ring or pad under `info_player_start` is the safe shape; the
   engine's own maps spawn on brush floors, not on terrain.
3. **The nav area is there but not seeded.** A `func_nav_blocker` over the only spawn, or a
   spawn inside a closed brush, leaves no seed.

A different failure looks similar: a **flat silhouette** (a horizon pier, a roof, a counter
top) gets a few tiny `NO_MERGE` areas; the engine then reports `Areas with
non-walkable connections`. Those are not empty nav, but they fail the gate.

## Check

```text
read_nav_dump  path: <map>_nav.txt          # Number of Nav Areas
read_nav_areas path: <map>.nav limit: 2000  # z range of the sampled surface
read_displacements path: <map>.vmf          # minDistance/maxDistance of the patch
```

In the console, `Walkable position marked.` means a mark was placed; `Invalid ground
position` or `No valid walkable seed positions` means the mark itself was rejected. A map
with a walkable floor and 0 areas is one of the causes above, not a missing floor.

## Fix

- Use `run_nav_generate(via: "steam")`: it launches app 550, waits for a host, and retries
  `setpos` to `info_player_start` + `nav_mark_walkable` + `nav_generate` through the client
  console. Measured on the 2048x2048 1:12 patch: 1,158 areas, `fresh`.
- Put a flat brush ring or spawn pad under `info_player_start`, even when the rest of the
  floor is displaced. A 2048 patch with a 512-unit ring and the spawn on the ring is the
  tested shape; the patch itself can rise 170 units.
- Block a decorative top with a `func_nav_blocker` volume instead of deleting the brush:
  that keeps the silhouette and removes the tiny no-merge areas. Santa Monica uses this for
  the horizon pier and for the beach, which is scenery rather than the route.
- Do not read `nav_trouble_report` as proof of terrain nav when the area count is 0; the
  report inspects areas and has nothing to fail on.
