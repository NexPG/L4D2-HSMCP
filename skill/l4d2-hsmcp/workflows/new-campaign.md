# Workflow: build a campaign from an approved design (pass 2)

This is the **build pass**. It starts only when `campaigns/<NNN-slug>/DESIGN.md` exists with
`Status: approved`. The creative decisions — chapter count, route, rooms, floors, beats,
finale type, asset palette, variability and budget — are in that file. This pass spends its
attention on geometry, exact assets, compile, nav and evidence.

If the design is still a draft, or there is no design, stop and finish
[`design-a-map.md`](design-a-map.md) first. **No new design decisions here.** Choosing which
concrete crate or sign fits a palette is execution; changing the route, a room's purpose, a
beat, a floor count or the finale type is a design change: append it to the design's
`## 15. Amendments` and get it approved instead of making it silently.

A campaign is numbered and local: `campaigns/<NNN-slug>/`. It never goes into git. The work
below is ordered so each step can fail cheaply.

## 0. Preconditions

- `campaigns/<NNN-slug>/DESIGN.md` exists, its `Status` is `approved`, and its §14 build order
  is the order you are about to use.
- `health` reports the game, compilers, FGD and sidecar. If a piece is missing, stop and say
  what it costs; do not build around it.
- The chapter names are decided: mission `Name` is alphanumeric, map names are bare
  (lowercase, underscores fine), and the VPK base name equals the mission file base name.

## 1. Source geometry

1. `write_vmf` for each chapter.
2. `write_vmf_solid` for the sealed shell: floor, ceiling, walls. A box shell is enough to
   prove the pipeline.
3. Carve only what the chapter needs: the spawn room, the play space, and the **safe room**
   at the exit with a real doorway.
4. Add lights.

Checkpoint: `read_vmf_leak` says `sealed: true` and `read_vmf_rooms` shows the rooms connect.
A leak here is a compiler error later.

## 2. Entities

- `info_player_start` — one on the first map, on the floor in the spawn area. A later
  chapter is spawned by its arrival `info_changelevel` and may have none (21 of the 60 stock
  BSPs have none); `write_safe_room` writes one by default, which is harmless but not the
  transition's placement.
- `info_director` — required.
- `info_zombie_spawn` — at least one, or the map is quiet.
- `info_landmark` — one in the exit safe room, one in the next map's arrival safe room, same
  `targetname`.
- `info_changelevel` — a brush over the exit safe room floor, `map` = next map,
  `landmark` = the shared name.
- `prop_door_rotating_checkpoint` — in the safe room doorway.
- `func_nav_attribute_region` — spawn (`2176` on the first map, `2048` after), exit safe room
  (`2048`), finale corridor (`64` on the last map).

Build the safe room from `references/campaign/safe-room-and-transition.md`; it is the part that
silently fails when any piece is missing.

Checkpoint: `read_vmf_lint` reports 0 and `validate_io` accepts the outputs.

## 3. Compile

`run_compile` with the stock chain or Tools++. Both maps must exit 0 at every stage. Copy the
compiled `.bsp` into the add-on staging tree.

Checkpoint: `sealed`, `lint 0`, `vbsp:0 vvis:0 vrad:0`.

## 4. Nav

1. Generate the mesh with `run_nav_generate` and `addonsToHide` (see
   `references/nav/generation.md`).
2. Put the `.nav` beside its `.bsp` in staging; keep `<map>_nav.txt` as evidence.
3. `read_nav` must say `fresh`.

Checkpoint: `read_nav_dump` says `playable` for every map. The dump shows
CHECKPOINT/PLAYER_START/FINALE on the right areas, and the live `nav_trouble_report` proves the
flow. The dump's `0x20000000` is `MOSTLY_FLAT`, not flow. No flow
means no playable map, even with a valid file.

If the build passed a `navSlopeLimit`, pass the **same value** to `run_campaign_gate`. The
gate regenerates nav; without the limit it uses the game default and can report a short
vertical connection the shipping mesh does not have.

## 5. Mission and add-on

1. `write_campaign` into `addon/missions/<name>.txt`, with the same base name the VPK will
   have.
2. `addoninfo.txt`: app 550, `addonContent_Campaign 1`, campaign tag.
3. `run_vpk_pack` from the staging directory.
4. `check_campaign` against the packed VPK and its mission entry.

Checkpoint: `check_campaign` passes, and the VPK entry list contains every map, nav, mission
and script.

## 6. Deploy and play test

Deploy under one fixed name, remove older archives, restart the game, enable the add-on, and
follow `workflows/playtest.md`. Record what happened; do not call the campaign done without a
play test.

Before the deploy, walk the design's `## 13. Acceptance criteria` line by line. Every
deviation from the design belongs in `## 15. Amendments` with the reason; an amendment is a
decision, not a cleanup. If a design line turned out to be impossible, stop and fix the
design before building around it.
