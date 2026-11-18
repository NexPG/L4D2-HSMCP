# Campaign authoring checklist

The ten-guide synthesis is `docs/reference/l4d2-campaign-authoring.md`. The two complete
references are `docs/reference/l4d2-complete-reference.md` and
`docs/reference/hammerpp-complete-reference.md`. The research logs live in the development
diary (`04-log/`), not in the published reference. This is the order to work in and the
contracts the tools enforce.

## 1. Skeleton

- [ ] `missions/<campaign>.txt` base name matches the VPK base name.
- [ ] `addoninfo.txt`: `addonSteamAppID`, `addontitle`, `addonauthor`, `addonversion`,
      `addonContent_Campaign`, `addonDescription`.
- [ ] `maps/<map>.bsp` + `<map>.nav`; `scripts/vscripts/<map>_finale.nut` if type 2.

## 2. Map goals

- [ ] First map: start `func_nav_attribute_region` **2176** (CHECKPOINT + MISSION START);
      end CHECKPOINT, or FINALE on the last map.
- [ ] Middle maps: arrival CHECKPOINT; end CHECKPOINT.
- [ ] Last map: arrival CHECKPOINT; end **FINALE (64)**; `trigger_finale` **over** the
      FINALE area.
- [ ] `info_changelevel` + matching `info_landmark`; last map has the disabled arrival
      changelevel (`spawnflags 2`).

## 3. Safe room

- [ ] Door targetname **`checkpoint_exit`** on the room being left,
      **`checkpoint_entrance`** on the room being entered.
- [ ] Door origin is the hinge, 2 units inside the jamb; opening 64 x 112 for
      `checkpoint_door_02`, 72 x 112 for `checkpoint_door_01`.
- [ ] Keep the leaf's width + 16 units clear of props; the lint
      `l4d2-door-swing-blocked` checks it.
- [ ] 4 `info_survivor_position` on a below-ground start.

## 4. Finale (last map)

- [ ] `trigger_finale` type 2; script `scripts/vscripts/<map>_finale.nut`.
- [ ] DirectorOptions stage list (`PANIC`, `TANK`, `DELAY`, `SCRIPTED`).
- [ ] Escape trigger: `FinaleEscapeStarted` -> enable; `OnStartTouch` ->
      `FinaleEscapeFinished`, `RollStatsCrawl`, credits.
- [ ] `env_outtro_stats`; a real +use object or a trigger the player can understand.
- [ ] Test from the campaign menu, not only `+map`.

## 5. World

- [ ] Boundaries: vehicles/fences/trees/buildings/cliffs, then fog; no bare ground-to-sky seam.
- [ ] Terrain: grid -> displace -> sculpt -> sew -> paint; keep flat under doors/props.
- [ ] Water: `func_water_analog` + `water_lod_control`; boardwalk joined to nav.
- [ ] Detail: props, grass, trash, signs, lights; keep door approaches and nav clear.
- [ ] `read_static_props` / `read_model_info.hasPhysics`: a prop without `.phy` needs a clip
      brush; `spawnflags 2` is decoration only.

## 6. Gate

- [ ] `run_compile` clean; `read_map_geometry` under limits.
- [ ] `run_nav_generate` `fresh: true`, dictionary true, dump `playable`.
- [ ] `nav_trouble_report` returns `pass`: orphan, missing Finale/Checkpoint/Battlefield,
      overlap, corner-to-corner, non-walkable connections. A failure comes with the selected
      areas' coordinates; fix the geometry rather than deleting nav areas.
- [ ] `check_finale`: type, script, DirectorOptions stage count, FINALE area, arrival
      changelevel and `FinaleEscapeStarted` wiring.
- [ ] `read_static_props` with the `vmf`: a missing `.phy` on a decorative model is not a
      failure; on a solid prop it is.
- [ ] `run_map_test` with the exact nav-generated BSP/nav pair; screenshot per requested
      mechanic. `NAV ERRORS` or `Map is unplayable` in the log fails the run.
- [ ] `check_campaign(vpk: ...)` reads the installed archive.
- [ ] Or run all of the above as `run_campaign_gate` and require `ok: true`.

The gate's shipping BSP is the **nav-generated** one. The engine appends its string-table
dictionary at nav time; shipping the compile output beside a nav made from the baked copy
is the stale pair that reads in game as `Map is unplayable`.
