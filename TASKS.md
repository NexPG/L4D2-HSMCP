# Task list from the Santa Monica run (2026-11-23)

This is the work queue after the `003-santa-monica` play build. It merges the findings from
`.develop-diary/04-log/2026-11-23-santa-monica-playtest.md` (F1-F17, P1-P3) with three
problems the user found in the produced maps:

- **U1 - models are rotated wrong.** Some props are 90 degrees off, some 180.
- **U2 - models have no collision.** The player walks through cars, benches and other props.
- **U3 - terrain is flat.** Every outdoor surface is a box or a wedge; the agent never uses the
  displacement/terrain tools.

Order matters: the first five tasks remove errors that pass every gate but fail the player.
Each task is one commit (code + test + skill page + CHANGELOG), and each is done only when the
new test fails before the change and passes after it, and `pnpm build`, `typecheck`, `lint` and
`test` are clean.

## Priority map

| Priority | Tasks | Why first |
|---|---|---|
| P0 | T01-T05 | The map can be green and still be missing content, a transition, collision, correct prop facing or terrain |
| P1 | T06-T09 | The agent cannot know the player-facing contract, and the harness cannot prove a transition/finale |
| P2 | T10-T12 | Campaign-specific polish and a human play test |

## P0 - correctness that the gates do not see

### T01 - `run_compile` must fail when vbsp deletes a prop (F1, P2)

**Problem.** `vbsp++` prints `Error! ... Deleted.` for a `prop_static` model that must be
dynamic, returns 0, and `run_compile` reports `ok: true`. Five props disappeared from the
first Santa Monica build; lint was clean. A compile that deletes content is not a pass.

**What to do.**
1. Find the compile-log parser used by `run_compile` (`src/maps/typescript/compile/*`,
   `read_compile_log`) and make it collect every `Error!` line with `Deleted.` from every
   stage, not only the stage's `errors` summary.
2. `run_compile` returns `ok: false` (or `ok: true` plus a hard `findings` entry that
   `run_campaign_gate` treats as failure) with the model path and the line.
3. `run_campaign_gate`'s `compile` stage fails on any `Deleted.` line.
4. Test fixture: a tiny sealed VMF with `prop_static` + `models/props/cs_office/trash_can.mdl`
   (a model vbsp refuses as static). Assert `ok === false` / the finding names the model. The
   fixture compiles in seconds; run it with the stock and Tools++ chains if both are present.
5. Skill: `references/compiling/toolchain.md` - "exit 0 is not a pass; read the `Error!`
   lines".

**Why.** This is the only defect found that can ship a map with a missing prop while every
current gate is green.

### T02 - props must not be silently collisionless (U2, F10, P2)

**Problem.** `prop_static` models without a `.phy` have no collision. `write_prop` warns only
for `prop_physics` (`hasPhysics === false`), never for `prop_static`; the gate's `props`
stage reported `missingPhysicsCount: 1` with an empty list. Cars, benches, arcades and carts in
Santa Monica are walk-through.

**What to do.**
1. `read_model_info` (sidecar `model_info`) exposes `$staticprop` as `staticProp: boolean`
   in addition to `hasPhysics`.
2. `write_prop` warnings:
   - `prop_static` + `hasPhysics === false` -> "no collision; add a clip or use dynamic";
   - `prop_static` + `staticProp === false` -> "vbsp will delete it (T01)";
   - `prop_dynamic`/`prop_physics` with `solid 6` + `hasPhysics === false` -> no collision.
3. Add `write_prop` option `collision: "auto" | "clip" | "dynamic" | "none"`:
   - `auto`: if `hasPhysics` -> as asked; else add a `TOOLS/TOOLSCLIP` box from `mins/maxs`
     around the prop (with a small margin), or switch to `prop_dynamic` if the caller asked;
   - `clip`: always add the clip hull;
   - `none`: decorative, and the warning is explicit.
   The clip box uses the model's `mins/maxs` and the prop's yaw; a rotated AABB must be
   converted (use `read_model_info` bounds and a yaw-aware box, or two clips for 90-degree
   rotations).
4. Add `read_vmf_prop_audit` (new small tool) or fix the gate's `props` stage to list every
   `prop_static` with `hasPhysics:false` / `staticProp:false` by model and origin. The list
   must not be empty when the count is non-zero (current bug).
5. Tests: a VMF with `trash_can` (no .phy) as static -> warning/clip; a model with .phy ->
   no warning; the gate's props finding lists the model.
6. Skill: `references/mechanics/weapons-and-items.md`? no - put the rule in
   `references/mapping/entities.md` and `references/tools/primitives.md`: "a static prop is
   visual only unless it ships collision; add a clip or use dynamic".

**Why.** The user sees a map where objects are ghosts. A visual prop without collision is not
a bug the compiler reports; the authoring layer has to.

### T03 - a transition check across two maps (P1, F17)

**Problem.** Map 2 had no `checkpoint_entrance`; all gates were green. Lint is per-map and
cannot see the name pair; the transition stage does not exist.

**What to do.**
1. Add `check_transition` (new tool, `src/campaigns/typescript/tools/` or `src/maps/`):
   inputs `first` and `next` `.bsp` (or a mission + map list).
   Reads the entity lumps (existing `readEntityLump`) and returns:
   - `info_changelevel.map` in the first equals the next map name;
   - `info_landmark` targetnames match;
   - `checkpoint_exit` exists in the first;
   - `checkpoint_entrance` exists in the next;
   - both have a CHECKPOINT nav area (read the `.nav` if given);
   - each door origin is in a real opening (reuse the lint's doorway logic or a small
     point-in-solid / opening-width check).
   A missing item is a named failure with the map and what to add.
2. Add a `transition` stage to `run_campaign_gate`, between `campaign` and `test`, running
   the check for every adjacent mission pair. It must fail the gate on any missing item.
3. Tests: the Santa Monica pair passes; a fixture pair with the arrival door renamed fails
   naming `checkpoint_entrance`; a pair with mismatched landmarks fails.
4. Skill: `references/campaign/safe-room-and-transition.md` - add the two-name table and
   "the arrival map needs its own door, area and landmark even if the player never uses it".
5. Campaign: the current map 2 already has the door; verify with the new tool.

**Why.** This is the exact error that would have shipped; the tool sees the pair, which no
per-map check can.

### T04 - model facing is a contract, not a guess (U1)

**Problem.** The agent placed props with yaw 0/90/180 guesses. Stock models have different
forward axes (cars, benches, doors, arcade cabinets, food carts, helicopter), and a yaw that
looks right in coordinates can be 90 or 180 off in the world. There is no facing report and no
placement helper that says "face this point".

**What to do.**
1. Add `write_prop` `facing` (a point or a direction) and `modelForward` (default `+X`) /
   `yawOffset`; compute the yaw from the direction and the model's forward. This does not
   invent the forward axis, but it makes the intent explicit and prevents sign errors.
2. Measure and document the forward axis for the common L4D2 families, with a screenshot or
   `preview_model` evidence:
   - cars (`props_vehicles/car*`, `cara_*`): long axis and nose;
   - benches (`bench001`): seat faces which way;
   - doors (`door_urban`, `checkpoint_door`): hinge + leaf, already `placeDoor`;
   - arcade (`arcadegame01`), food cart, concession sign: front;
   - helicopter (`helicopter_rescue`): nose;
   - Ferris wheel / coaster: plane and entrance.
   Put the table in `references/mapping/hammer-tabs.md` or a new
   `references/mapping/model-facing.md`; it is knowledge, not code.
3. Add a **visual check** step: `preview_model` (or a new `render_model_view` contact sheet
   front/right/back/left) before a family is used in a map; "no model placed without looking
   at it" goes into `checklists/campaign-ready.md`.
4. Audit Santa Monica: every prop family placed in `build.mjs` gets a screenshot or
   `preview_model`; correct the yaw in the build. Record the corrected values in the table.
5. Test: a unit test for the `facing` -> yaw math (four quadrants + 90/180), and a screenshot
   for at least cars, benches, arcade and helicopter.

**Why.** The user's maps have 90/180 errors. A coordinate convention cannot tell an agent
which way a model was authored; the table plus a visual check is the only reliable fix.

### T05 - terrain is a first-class step, not a flat box (U3)

**Problem.** Every outdoor surface in Santa Monica is a box/wedge. The toolkit already has
`write_vmf_terrain`, `write_displacement`, `sculpt_displacement`, `sew_displacements`,
`read_displacements`, but the skill's `level-design.md` never mentions them, so the agent
defaults to flat boxes.

**What to do.**
1. Add a `slope` option to `write_vmf_terrain` (`from`, `to`, `along: x|y`) so a beach or a
   dune is one call: a grid at `floorZ`, displacement, slope, noise, sew, seal. The existing
   `sculpt_displacement` already has `slope`, but a terrain builder that cannot make the
   basic slope forces a second tool call and is easy to skip.
2. Add a **heightfield** option (control points or a small function) if the slope is not
   enough; a beach needs "waterline at z0, dunes at z+32, flat pad at the houses". A list of
   `[x, y, z]` control points interpolated over the grid is enough and is testable.
3. Keep the building pads flat: terrain under a house/safe room/street is a flat sub-patch or
   the building sits on a flat pad; document the seam (nav does not like a 1-unit lip).
4. Test: a 2048 x 2048 patch, slope ~1:12, noise 16, power 4, sealed; compile, nav
   (`playable`/fresh), `nav_trouble_report` pass, screenshot. A steep slope >45 must not be
   walkable; a ≤45 must be.
5. Skill: `references/mapping/level-design.md` new section "Outdoor ground is a terrain
   patch": when to use `write_vmf_terrain`, the flat-pad rule, the nav slope limit, the seal
   caveat (a displacement does not seal), and the blend material.
6. Campaign 003: replace the flat beach/wedge with a terrain patch from the seawall to the
   houses (waterline, wet sand, dry sand, dune), keep the street and house pads flat; rebuild,
   nav, screenshot. This is the acceptance test for U3.

**Why.** Flatness is not a bug in a tool; it is a missing step in the workflow. The agent has
the tools and does not know they are the answer.

## P1 - knowledge and harness

### T06 - the player-facing mechanics page (the user's instruction gap)

**Problem.** The skill explains entities, not what the player does. The user's example: "to
load the next chapter you must enter the safe room and close the door". The current
`safe-room-and-transition.md` says "door state is acceptable" and never states the action;
the agent can build a green map that never advances.

**What to do.** New `references/mechanics/chapter-and-finale-play.md` (or a section in the
two campaign pages), one paragraph per mechanic:
- chapter: all survivors inside, the checkpoint door **closed**, the transition starts; bots
  path to CHECKPOINT; the destination has its own named door, area and landmark;
- finale: `trigger_finale` type 2 stages; `FinaleEscapeStarted` unlocks the escape; the player
  reaches the rescue zone; `FinaleEscapeFinished` + outtro + `changelevel credits`; the
  helicopter model is decoration, not the vehicle;
- no infected: `DirectorOptions` values and the timer; `director_stop` is a cheat;
- weather: stand inside the `func_precipitation` volume; type 6 for visible rain;
- water: non-solid; the bed is walkable unless blocked;
- spawn: the nav PLAYER_START area, not `info_player_start`;
- safe-room supplies and the `*_spawn` classes.
Link it from `SKILL.md`, `campaign-ready.md`, `safe-room-and-transition.md` and `finale.md`.
Add one line to `checklists/campaign-ready.md`: "the player action for every requested
mechanic is written down and was performed once".

**Why.** This is the gap the user named. It is documentation, but it is the difference between
a map that compiles and a map that plays.

### T07 - make the transition/finale testable (F12)

**Problem.** A map `logic_timer` with `RunScriptCode` (warp to checkpoint) and the generated
`hsmcp_schedule.nut` (`ent_fire finale ForceFinaleStart`) did not run in a direct `+map` test:
no warp, no finale markers, no `script_execute` in the log. The transition and the escape are
therefore unproven.

**What to do.**
1. Reproduce on a minimal VMF: a `logic_timer` with `OnTimer -> point_servercommand echo`, and
   the generated schedule; find whether the timer is disabled, the output is malformed, or
   `listenserver.cfg` runs before the entities.
2. Fix the harness or document the working pattern (e.g. a `logic_auto` + a delay, a
   `point_clientcommand`, or `run_map_test` `commands` after spawn).
3. Add to `run_campaign_gate`: an optional `transitionTest` that warps a survivor to the
   checkpoint, closes the door, and waits for `Map: <next>`; and a finale test that starts the
   finale and waits for `HSMCP_ESCAPE_STARTED`.
4. Tests: the Santa Monica transition and finale, with the log lines recorded.

**Why.** Until this works, "the transition is built" is not "the transition works"; the user
has to play it by hand and a regression is invisible.

### T08 - nav tests and the remaining nav gaps (F3, F7, F8)

**Problem.** `read_vmf_rooms` default step 16 throws `VoxelBudgetError` on a real map;
`func_nav_blocker` is runtime-only (verified, docs added); the spawn is the nav PLAYER_START
area (docs added). There are no regression tests for the last two.

**What to do.**
1. `read_vmf_rooms`: auto-coarsen the step (or a default from the map extents) and return a
   note; test a 3,000-unit map without an explicit step.
2. Tests: a flat pad with a clip slab above has no nav area; a flat sea bed with a steep
   sawtooth has no nav area; moving `info_player_start` without moving the nav start still
   spawns at the nav area (or at least a test that documents the engine result is impossible
   offline - then a skill-only note).
3. Document (already partly in `references/nav/generation.md`): runtime vs generation, the
   clip-slab/steep-wedge patterns, the spawn rule.

**Why.** These were the hardest bugs in the run; a test keeps the next agent from undoing them.

### T09 - documentation sweep (F2, F4, F5, F14, F15, F16)

**What to do.**
- F2: `hdr: true` is `vrad -both`; an HDR-only sky needs `allowMissingSkyFaces` and loses the
  LDR fallback. Put it in `references/compiling/toolchain.md` / `worldspawn-and-damage.md`.
- F4: a disabled `info_changelevel` still needs a brush; document in
  `safe-room-and-transition.md` for an arrival-only checkpoint.
- F5: L4D2 `weapon_*_spawn` / `weapon_first_aid_kit_spawn` classes; add the table to
  `weapons-and-items.md`.
- F14: `particle-rain-storm` is the visible L4D2 rain; plain `rain` may be invisible. Add to
  `weather.md`.
- F15: shop front recipe (sign band, glazing, awning colour); `level-design.md`.
- F16: `read_bsp_entities` shows one key per output; use the connection tools for duplicates;
  note in `references/mapping/entities.md`.

**Why.** Each is a fact the next agent would otherwise rediscover with a compile or a failed
play test.

## P2 - the campaign and the play test

### T10 - apply T02/T04/T05 to campaign 003

**What to do.**
- Replace flat beach with terrain (T05); keep street/house pads flat.
- Audit every prop family for facing (T04) and collision (T02); add clips or dynamic where
  the player can touch it; correct yaws.
- Improve chapter-1 light (F11): a wider/less shadowed street or a sky with the sun in the
  travel direction; shops (F15) get a real front.
- Rebuild, nav, gate, screenshots; keep the screenshots as evidence.

### T11 - play the transition and the finale once

**What to do.** Launch the campaign from the menu (not `+map`), play chapter 1 to the safe
room, close the door, see chapter 2 load; on the pier, start the finale, reach the helicopter,
see the credits. Record the log lines and screenshots in the diary. If it fails, the failure
is a bug with a repro, not an unknown.

### T12 - cleanup and release

**What to do.** Remove test maps/navs from `campaigns/` and the game; `check_game_state` clean;
`pnpm docs:tools`; version bump + CHANGELOG; push; CI green. Update
`2026-11-23-santa-monica-playtest.md` with what is now closed.

## Acceptance for every task

- A test that fails before the change and passes after it.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` clean.
- The skill already contains the prevention, not only the code.
- The diary entry is marked closed with the commit.
- For a visual change: a screenshot or a `preview_model` / `render_vmf_view` image.

## Start here

**T01**, then **T02**, **T03**, **T04**, **T05**. After T03 the next campaign build cannot ship
a broken transition; after T01/T02 it cannot ship a missing or ghost prop; after T04/T05 the
next maps have the two qualities the user asked for: models pointing the right way with
collision, and ground that is not a flat box.
