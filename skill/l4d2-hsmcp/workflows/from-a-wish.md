# Workflow: from a wish to a playable campaign, in two passes

The user should be able to describe a campaign in their own words. This page turns that
description into a build that can be checked, without inventing content or skipping a
requested mechanic.

**A new map or campaign is two passes, and they do not run in one message.**

1. **Pass 1 — design.** Create the workspace with `write_addon_workspace`, then produce
   `workspaces/<addon-name>/plan/DESIGN.md`: the complete route, rooms,
   floors, beats, events, finale, palette, variability and budget. Read-only tools only; no
   `.vmf`. Follow [`design-a-map.md`](design-a-map.md). End the message with the design path
   and stop for approval.
2. **Pass 2 — build.** Read the approved design and build it. Follow
   [`new-campaign.md`](new-campaign.md). The route and beats are fixed; the build pass chooses
   exact assets within the palette and records any deviation in the design's `## 15.
   Amendments`.

A build started before the design is a decision made by accident. A design that needs the chat
to be understood is not finished.

## Contents

- Pass 1 — write the wish back as a design
- Pass 1 — design before geometry
- Pass 2 — build a chapter from the design
- Pass 2 — mechanics, one at a time
- Pass 2 — compile, nav, mission, add-on
- Pass 2 — play test the design
- Pass 2 — report
- Example

## Pass 1 — write the wish back as a design

Read the request and write the design before touching a file. If something is genuinely
ambiguous, choose a sensible default and say what you chose; ask only when the answer changes
the map's identity (chapter count, campaign vs single map, mode). The full template is
[`design-a-map.md`](design-a-map.md); this table is the minimum it must answer.

| Field | What to record |
|---|---|
| Name and chapters | Alphanumeric mission `Name`, one bare map name per chapter, VPK base name |
| Setting and references | The place, time, palette; any film/game/level named by the user |
| Flow per chapter | Spawn, rooms, safe room, exit, finale; approximate size in Hammer units |
| Mechanics | Transition, crescendo/panic, tank, witch, weapons/items, finale type, escape |
| Assets | Materials, models, particles and sounds chosen by `read_game_content`, not memory |
| Constraints | Time of day, weather, indoor/outdoor, one-way drops, no-hordes zones, difficulty |
| Done means | One evidence line per requested mechanic, plus the standard checklist |

Names are content: query them. `read_game_content(kind: "material" | "model" | "particle" |
"sound")` returns the exact strings; `read_fgd_class` returns every key, input and output.
A name from memory is a purple checkerboard or a silent entity.

## Pass 1 — design before geometry

1. Draw the critical path as rooms, not coordinates: spawn → first fight → safe room →
   chapter 2 → … → finale arena → escape.
2. Give every chapter a reason to exist: a set piece, a crescendo, a tank, a witch, a
   one-way drop, a dark room. If it has no beat, it is a corridor with a compile time.
3. Decide where each mechanic lives and which entity carries it. Look the class up in the
   FGD; do not guess a key.
4. Sketch the finale: arena, stage list (`PANIC`, `TANK`, …), escape trigger, outtro. Type 2 is
   the custom finale with a `DirectorOptions` stage list; see
   `references/campaign/custom-finale.md`.
5. Budget: every chapter should be small enough to compile and play in one sitting. A first
   build of two short chapters proves the pipeline; a city can come after.

Room sizes, cover, sightlines and lighting are in
`references/mapping/level-design.md`. The tools check the numbers; the wish decides the
place.

Check the design against `references/mapping/hammer-coverage.md`. If a wish needs an editor
preview or a two-team round, say what will be verified and what will not.

**Write the design to `workspaces/<addon-name>/plan/DESIGN.md` with the full template in
[`design-a-map.md`](design-a-map.md). Set `Status: draft` and stop.** Do not open a VMF, do not
"test the idea with a box". Pass 2 starts only after the user approves the design.

## Pass 2 — build a chapter from the design

Follow `workflows/new-campaign.md` for the exact tool order. The route, rooms, floors, beats,
finale type and palette come from the design; choosing the exact crate or sign within a
palette is execution. Per chapter:

1. `write_vmf`; `write_vmf_solid` for the sealed shell.
2. Shape rooms with clips, hollows and vertex moves; use `write_vmf_fitting` for door
   frames, counters and skirting only after the envelope exists.
3. Place entities from the FGD: spawn, director, zombie spawns, lights, items.
4. Safe room and exit: follow `references/campaign/safe-room-and-transition.md`; the door,
   landmark and changelevel are one set, not three optional entities.
5. Theme the space: query materials/models, set faces, add overlays and props.
6. Before moving on: `read_vmf_leak` sealed, `read_vmf_lint` zero, `read_vmf_rooms` connected.

Do not build all chapters before compiling the first. A leak found on chapter 1 is cheaper
than three chapters of the same mistake.

## Pass 2 — mechanics, one at a time

| Wish | Build | Prove |
|---|---|---|
| Chapter transition | `info_changelevel` + landmark + checkpoint door + nav CHECKPOINT | The next map loads and the log names it |
| Crescendo / panic | `func_button`/`trigger_once` → `director` `ForcePanicEvent`, nav Battlefield | `STAGE_DONE` or the Director's own marker, not just an entity |
| Tank / witch | `z_spawn` with `sv_cheats 1`, spawn area or scripted stage | The spawn line and a screenshot; `Tank Count` is not proof |
| Weapons / items | FGD-checked `weapon_*`, `item_*`, saferoom stock | The pickup appears and is usable |
| Custom finale | `trigger_finale` type 2, stages, escape, outtro | Each stage marker and the credits/changelevel marker |
| Weather | `func_precipitation`, `env_fog_controller` | Game screenshot; a static check only proves the entity exists |
| Survival / Scavenge / Versus | mission mode, mode script, mode entities | Load/HUD and the mode script line; say when a full round is not proven |

Runtime claims need runtime evidence: the `-condebug` log, the nav dump, a screenshot. An
entity that exists is not a mechanic that works.

## Pass 2 — compile, nav, mission, add-on

`run_compile` → `run_nav_generate` → `write_campaign` → `run_vpk_pack` →
`check_campaign` → deploy. The checkpoints in `workflows/new-campaign.md` are not optional;
each one is cheaper than the failure it catches.

## Pass 2 — play test the design

Run the campaign from the spawn, not from a console `map` command if the transition matters.
Record evidence per line of the wish:

```
Wish: a crescendo in the second room
Evidence: <console marker> + screenshot <path>
Wish: a tank before the safe room
Evidence: <z_spawn line>, <screenshot>
Wish: finale stages
Evidence: PANIC … TANK … escape … credits
```

If a requested mechanic cannot be proven with the available client, say which and why. The
answer is "load/HUD verified, full round not played", not "done".

## Pass 2 — report

- What was built: chapters, maps, mechanics, assets.
- Evidence per requested feature, with paths or log lines.
- The design path and every `## 15. Amendments` row; a build that disagrees with the design
  without an amendment is not finished.
- What is not verified, and what it would take.
- Cleanup: test maps, screenshots and backups out of the game install; originals restored.

## Example

Wish: *"A two-chapter swamp-town campaign: a dark safe room, a street crescendo, a tank
before the second safe room, then a finale in a church with two panic waves and an escape."*

Pass 1 design: `workspaces/swamp-town/plan/DESIGN.md` — two maps, `swamp1`/`swamp2`, mission
`SwampTown`, `sky_l4d_urb01`, brick/wood palette, one street crescendo on map 1, tank at the
map 2 safe-room approach, type 2 finale in a church with `PANIC`/`PANIC`/`TANK`, escape to
credits. Every asset queried; every entity class read from the FGD. Approved, then stopped.

Pass 2 build: the same file, built chapter by chapter, each line tested in the order above,
with any deviation recorded as an amendment.
