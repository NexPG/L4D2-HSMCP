# Workflow: a campaign from scratch

A campaign is numbered and local: `campaigns/<NNN-slug>/`. It never goes into git. The work
below is ordered so each step can fail cheaply.

## 0. Preconditions

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

- `info_player_start` — one, on the floor, in the spawn area.
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

1. Generate the mesh with `references/nav/generation.md`.
2. Put the `.nav` beside its `.bsp` in staging; keep `<map>_nav.txt` as evidence.
3. `read_nav` must say `fresh`.

Checkpoint: the dump shows CHECKPOINT/PLAYER_START/FINALE on the right areas and
`0x20000000` on the flow path. No flow means no playable map, even with a valid file.

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
