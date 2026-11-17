# Changelog

Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`, with a
prerelease suffix (`-alpha`, `-beta`) while the toolchain is still being proven on the
target game. A version is bumped in the same commit as the change it describes, together
with a line here.

## 0.0.59-alpha — 2026-11-17

- **Survival mode is verified.** The mission file now lists `hsmcp_test_m1` under a
  `survival` mode, and `run_map_test` with `extraArgs: ["+mp_gamemode", "survival"]` loaded
  the map and showed the Survival HUD with the timer at `00:00.00` in 33 s. No special
  entity was needed beyond nav and a spawn; a full survival wave was not timed.
- New reference `mechanics/survival.md`: mission block, the launch argument, the HUD proof,
  and the pitfalls (`NAV ERRORS`, mission fallback, harmless `survival_record`).

## 0.0.58-alpha — 2026-11-17

- **Tanks and witches are verified.** Test timers at 12 s and 22 s issued
  `sv_cheats 1; z_spawn tank` / `z_spawn witch` from a `point_servercommand`.
  `run_map_test` matched `Damage Taken from "Tank"` in **59 s**, the log contains the
  calm-witch line, and the screenshot shows the death screen with the tank.
- The spawn and panic timers are now gated behind `HSMCP_SELFTEST`; a normal campaign build
  deploys them disabled, so the map does not spawn a tank on every load.
- New reference `mechanics/tanks-and-witches.md`: commands, the log lines that prove each
  entity, and the small-arena warning.

## 0.0.57-alpha — 2026-11-17

- **Crescendo/panic is verified in game.** The test map starts a panic event ten seconds
  after spawn with `director,PanicEvent`; the Director logs
  `STAGE_INITIAL_DELAY → STAGE_MEGA_MOB → STAGE_WAIT_FOR_COMBAT_TO_END → STAGE_DONE` and
  `run_map_test({ waitFor: "STAGE_DONE" })` matched in **51 s**. `ForcePanicEvent` produced
  the same stages.
- `OnPanicEventFinished` did not fire on this map, with either input, so the docs no longer
  present it as the only proof; the stage transition is the reliable evidence.

## 0.0.56-alpha — 2026-11-17

- **PANIC and TANK finale stages are verified in game.** The test finale runs
  PANIC → DELAY → TANK → DELAY → DELAY, then `HSMCP_ESCAPE_STARTED`,
  `HSMCP_ESCAPE_TOUCHED`, `Host_Changelevel` and the credits map in **137 s**. A final PANIC
  stage was replaced by DELAY: its commons did not clear and the stage hung. The TANK stage
  transitioned, but bots killing a tank is not proven.
- `verify-finale.mjs` now waits for `Host_Changelevel`, the line that actually appeared;
  `Map: credits` did not. The old wait caused a false timeout after the campaign had already
  reached credits.

## 0.0.55-alpha — 2026-11-17

- **`run_map_test` can install the BSP too.** `bsp` and `nav` are now both optional: the tool
  copies them beside the map, reports `bspInstalled`/`navInstalled`, and restores any
  previous files in a `finally`. The earlier `nav`-only version launched the main menu when
  the map itself was not installed.
- **Rain is verified visually.** A synthetic open-sky test map with `func_precipitation`
  loaded and the captured frame shows rain streaks. The same map's nav is `no-flow` (one
  area, no goal), so it still shows `NAV ERRORS`; that is a test-map nav defect, not a
  weather defect. The distinction is documented in `troubleshooting/nav-stale.md`.
- Fog was compiled and loaded but is not separately judged; the coverage says so.

## 0.0.54-alpha — 2026-11-17

- **`run_map_test` can install the nav with the map.** A loose BSP copied for a test does
  not bring its `.nav`, and the game opens on `NAV ERRORS — Map is unplayable!`. The new
  `nav` argument copies the mesh beside the map and restores the previous one in a
  `finally`; the result reports `navInstalled`.
- Found in the weather test: the first screenshot of the arena was an unplayable map with
  the nav error screen. Copying the nav fixed it. The finding is in
  `troubleshooting/nav-stale.md`.
- Weather entities were added and compiled, but the closed brick arena cannot prove rain or
  fog visually; that check needs an open-sky map and remains pending.

## 0.0.53-alpha — 2026-11-17

- **`write_skybox_copy`** (97th tool): the copy/scale/move half of a 3D skybox. It copies
  selected brushes at 1/16 scale around the map origin and moves them so the origin lands at
  `targetOrigin`, where `sky_camera` should sit. It warns when the map has no camera or the
  camera is elsewhere, and it refuses hidden or displaced brushes. Sealing the skybox area
  and choosing what to copy remain design work.
- With this, the only remaining limitation in the skill is 3D-skybox design; every Hammer
  operation has a tool.

## 0.0.52-alpha — 2026-11-17

- **`run_map_test` can show the agent the running game.** With `screenshot: true` it waits
  for the marker, lets the frame settle, captures the game window and returns a real MCP
  image block. The default method is `screen` because the game canvas is 3D; `window`
  (`PrintWindow`) produces a black canvas for the game renderer.
- Verified live: `run_map_test` matched `Host_NewGame on map hsmcp_test_m1`, captured a
  2560×1440 frame after 2.5 s and returned a 2.7 MB PNG image block showing the campaign
  loading screen. The game process was stopped afterwards.
- The screenshot workflow is documented with the marker advice: match a post-load line such
  as `Loading: [0-9]`, not the first map-name line, before asking for a picture.

## 0.0.51-alpha — 2026-11-17

- **The agent can see a GUI.** `run_hlmv` now optionally captures the HLMV window and
  returns it as a real MCP image block; `capture_window` (96th tool) captures any window by
  process id or name. `window` mode uses `PrintWindow` and works while another window is in
  front; `screen` mode brings the window forward for a 3D canvas.
- HLMV launch fixed for this build: `VPROJECT` plus the game directory as cwd and a relative
  model path. `-game` produced `Unable to find gameinfo.txt`.
- Verified: HLMV launched on the compiled sample, the window title showed the model, and a
  real PNG image block came back. The 3D canvas is black on this sandbox desktop; that is an
  environment limit and is documented rather than claimed as a rendered model.

## 0.0.50-alpha — 2026-11-17

- **`run_hlmv`** (95th tool): launches the game's HLMV on one compiled model, after resolving
  it against the game's `models/` tree and refusing a missing file. It returns the process id
  immediately; HLMV is a GUI, so there is no screenshot and no machine-readable result.
  `read_model_info` remains the answer for bounds, sequences and materials.
- Verified live: the sample model compiled, HLMV opened on it (`processId` returned), and the
  test model directory was removed after the process was closed. Model preview is no longer
  a gap; only 3D-skybox layout remains in the skill's limitation list.

## 0.0.49-alpha — 2026-11-17

- **`export_vmf_map`** (94th tool): exports a `.vmf` to Valve's `.map` format 220. Every
  brush face keeps its three points, material, `uaxis`/`vaxis` and scale; every entity keeps
  its keyvalues and outputs. VMF-only data (visgroups, instances, displacements) cannot exist
  in the format and is reported as warnings instead of disappearing.
- With this, no Hammer parity row says "not covered". The remaining limitations are tracked
  in the skill coverage: HLMV preview, 3D-skybox layout and the checks that need a person at
  the screen.

## 0.0.48-alpha — 2026-11-17

- **Model authoring primitives** (91–93): `read_text_file` and `write_text_file` handle
  arbitrary QC/SMD/VMT source text with no template, and `run_studiomdl` compiles a QC with
  the game's own `studiomdl.exe`, reads `$modelname`, and proves the `.mdl`, `.vvd`, `.vtx`
  and `.phy` exist instead of trusting the exit code.
- Verified in game with Valve's `wood_railing001.qc` sample: compiled in **395 ms** into
  `models/hsmcp_test/rail.mdl` (1,864 bytes) plus `.vvd`, `.vtx` and `.phy`. The test model
  directory was removed afterwards; the source sample was not modified.
- Model authoring is no longer a gap: the remaining model-related gap is launching HLMV to
  preview a compiled model.

## 0.0.47-alpha — 2026-11-17

- **`run_build_cubemaps` can pack the result into a copy of the map.** `pack: true` with
  `outBsp` writes a new `.bsp` containing the built `.vtf` files and reports the pakfile
  count and how many entries were added. Nothing is packed unless asked; the game install
  is still restored.
- Verified in game: an HDR build packed one new entry into the copy, which then held six
  pakfile entries (five `.vtf`, one `.dct`). The generated copy and the materials directory
  were removed after the check.

## 0.0.46-alpha — 2026-11-17

- **`run_build_cubemaps`** (90th tool): builds a map's cubemaps with the engine's own
  `-buildcubemaps` launch mode — load the map, capture every sample, write `.vtf`, quit.
  Supports HDR, LDR or both, copies the files out, and restores the map, materials
  directory and hidden add-ons in a `finally`. Verified on the test campaign: HDR in 29 s
  (`c0_0_64_hdr.pwl.vtf`, 76,536 bytes), LDR in 24 s (`c0_0_64.pwl.vtf`, 4,968 bytes), both
  modes in one call; the game install was left clean.
- The engine launch mode replaces the earlier attempt to inject `point_servercommand` /
  `point_clientcommand` + `logic_auto`: that path logged an empty ` is not writable!!!`
  even with the original map name and a writable materials directory.
- The test campaign now compiles one `env_cubemap` at the arena centre, so the map has a
  non-empty CUBEMAPS lump to build.

## 0.0.45-alpha — 2026-11-17

- **README rewritten for readers, not maintainers.** It now answers what the project is,
  what an agent can do with it, what is required, how to install it, a typical campaign
  workflow, where the documentation is and what state the project is in. The internal
  architecture diagram, design-rule list and root-file table were removed; the root-file
  table moved to `CONTRIBUTING.md`, where contributor material belongs. The status is stated
  as alpha only, without a list of what is proven or finished.
- No functional changes.

## 0.0.44-alpha — 2026-11-17

- **The repository root is now a documented, tested set.** README lists the job of every
  tracked root file, and `test/support/structure.test.ts` fails when a new tracked file
  appears at the root without being added to the allowlist and the table. Machine-specific
  files (`.mcp.json`, `config.json`) and generated trees (`dist/`, `node_modules/`,
  `campaigns/`, `.develop-diary/`, `.hammer-mcp/`) are ignored by design, not clutter.
- Audit result: no redundant tracked root files. The config, tsconfig, lockfile, licence and
  history files all have a job; nothing was deleted.

## 0.0.43-alpha — 2026-11-17

- **Every experiment now has to leave a document for the agent.** The diary records the
  process; `skill/l4d2-hsmcp/troubleshooting/` and `references/` are what the agent reads
  while working: symptom → cause → check → fix, what each error means, what it affects, and
  what is verified in game versus static-only. Rule 14 in the diary and CONTRIBUTING.
- **The game install is cleaned after every run.** Test maps, `materials/maps/<test>/`,
  `.nav`, VPKs and backups are removed; modified originals are restored and checked. Rule 15
  and `references/testing/game-environment-cleanup.md`, with the checklist.
- **Cubemap findings documented.** `env_cubemap` is an internal, compile-time entity: Valve
  L4D2 maps have none in the entity lump but do have a non-empty CUBEMAPS lump, and injecting
  one into a compiled BSP logs `Attempted to create unknown entity type env_cubemap`. The
  `buildcubemaps` checklist, the meaning of the default-cubemap lines, the
  `is not writable!!!` errors and the add-on shadowing case are in
  `troubleshooting/cubemaps-do-not-build.md`. A complete `.vtf` build is still **not
  verified**; no test artefact was left in the game.

## 0.0.42-alpha — 2026-11-17

- **`edit_bsp_entities`** (89th tool): adds, updates or removes entities in a compiled
  `.bsp`. The new entity text is appended and only lump 0's directory entry moves, so the
  pakfile, brush data and lighting stay where they were. Compiled outputs are ordinary
  keyvalues. This is the primitive `buildcubemaps` needs: `point_servercommand` plus
  `logic_auto` in a copy of the map, without recompiling it. Refuses a compressed entity
  lump, an empty op list, and a result with no worldspawn; verified on the fixture BSP that
  the header points at the appended lump and the map still reads back.
- The compiled entity lump leaves `primitives.md`'s gap list. The remaining real gaps are
  the engine cubemap step and model authoring.

## 0.0.41-alpha — 2026-11-17

- **`subdivide_displacements`** (88th tool): Hammer's Subdivide. Raises a displacement's
  power from 2 or 3 to 3 or 4, samples the old grid bilinearly so the silhouette survives,
  rounds alpha, renormalises normals and keeps non-walkable triangle tags non-walkable. The
  warning names the seam that may crack if its neighbour was not subdivided, and the result
  is read back to prove power and vertex count. With this, `.map` export is the only Hammer
  operation still marked "not covered".
- The diary now states how proof works: file-format changes are proved by static readers and
  tests, but visuals and runtime behaviour are only `verified` after a game run. A batch of
  game checks is pending for weather, clone/skybox, exact alignment, mission extras and
  subdivision; none of them is called verified yet.

## 0.0.40-alpha — 2026-11-17

- **`copy_face_alignment`** (87th tool): Hammer's copy alignment. Copies one face's exact
  `uaxis`/`vaxis` -- direction, offset and scale -- onto selected faces, optionally with the
  material and an explicit lightmap scale. The axes are not recomputed from each target's
  normal, so brick carries on from the same place instead of restarting; faces pointing a
  different way are reported, and axes the reader rejects are refused. `FaceSelector` gained
  `sideIds`, so a caller can name one exact target face rather than a whole solid.
- The parity table's "Alt+click (copy alignment)" gap is closed; displacement subdivision
  and `.map` export are the two remaining "not covered" rows.
- This is the third named gap closed under the no-templates rule, after `set_worldspawn`
  and arbitrary mission keys.

## 0.0.39-alpha — 2026-11-17

- **`write_campaign` accepts arbitrary keyvalues at mission, mode and chapter level.** Its
  structured fields covered `Name`, the title, the author and the convar block, and nothing
  else: another menu. The `keyvalues` fields now write `Version`, `VersusCompletionScore`, a
  mod's own keys, anything the format allows. Structural keys keep their dedicated fields and
  are refused there, so the writer cannot emit two conflicting copies.
- The mission format is no longer listed as a gap in `primitives.md`; the remaining real
  gaps are the engine cubemap step, writing a compiled BSP's entity lump, model authoring and
  exact face-alignment copying.

## 0.0.38-alpha — 2026-11-17

- **The project rule is now written down: hands untied, not a menu.** An agent must be able
  to do everything Hammer++ can and more through general operations, not choose from
  prepared answers. `CONTRIBUTING.md` (rule 4), the README design rules and
  `skill/.../references/tools/primitives.md` state it: every shortcut must sit on a
  reachable primitive, an enum may only mirror the engine's complete list, and a missing
  capability is a named gap rather than a canned subset.
- **`set_worldspawn`** (86th tool): sets or removes any key on `worldspawn`, not the four
  `set_map_properties` knows. `worldspawn` is not an `entity` block, so `edit_vmf` could not
  reach it; that made the four-key tool a menu. `id` and `classname` stay protected, every
  change is reported, and the brush count is checked before writing.
- `set_map_properties` is now explicitly a shortcut over `set_worldspawn`, not the limit of
  what can be set.

## 0.0.37-alpha — 2026-11-17

- **`clone_solids`** (85th tool): Hammer's copy/paste. Copies selected brushes with fresh
  solid and side ids while keeping materials, texture axes and smoothing groups byte for
  byte, and can apply one move, rotation, scale or mirror to the copy. Copying plus scaling
  is the missing half of the 3D skybox workflow; sealing and layout remain manual. Hidden
  and displaced brushes are refused, `count` cannot be combined with a transform, and every
  copy is checked as a solid before the write. Verified on the campaign map: 37 solids in,
  38 out, the copy valid.
- `transform_solids` and `clone_solids` now share one matrix builder, so a pivot cannot mean
  two different things in two tools.
- The parity table covers Copy/Paste; the 3D skybox moves from "copy gap" to "layout gap".

## 0.0.36-alpha — 2026-11-17

- **`write_weather`** (84th tool): adds rain, snow, ash or a particle variant as a
  `func_precipitation` volume, and distance fog as an `env_fog_controller`. The precipitation
  types come from the stock FGD, the brush is checked by `read_vmf_solids`'s reader, and a
  second fog controller or an inverted fog range is refused. Static checks only: whether the
  weather looks right is an eye question, and the page says so.
- **The coverage tables no longer understate what exists.** `arch`, `sphere`, `torus`,
  `cone` and `stairs` were already in `write_vmf_solid`; the skill still called arch/torus a
  gap. The instances row now mentions `write_instance`, and a duplicate weapons row is gone.
- **The Hammer parity page stopped naming machines this project does not use.** It said the
  compilers run under Wine, cubemaps need `gmod-mcp`, and the server never talks to a live
  engine — all false for a Windows-only L4D2 toolkit that already runs the game.

## 0.0.35-alpha — 2026-11-17

- **Conventional Commits are a written project rule.** `CONTRIBUTING.md` and diary rule 11
  spell out the format: `type(scope): imperative summary`, allowed types, an optional scope,
  a body that explains why, and `!`/`BREAKING CHANGE:` for a break. A subject that does not
  parse is a defect even when the change is right.
- Two decisions shared the ID D33; the language decision is now D61 and the correction is
  recorded as D60.

## 0.0.34-alpha — 2026-11-17

- **CI runs on the machine the project targets.** The workflow moved from `ubuntu-latest`
  to `windows-latest` and from Node 20/22 to 22/24, and the pass-floor check is a `pwsh`
  step instead of `bash`. It now tests the platform the toolkit actually drives.
- **The suite no longer needs the Python sidecar to check VMF writes.** The instance and
  skybox tests assert the written VMF text directly, so a bare runner can prove the tools
  without a sidecar it does not have. This was the Ubuntu failure.
- **The layout rules are enforced by tests.** `test/support/structure.test.ts` fails the
  build on a loose `.test.ts` at the test root, an unlisted or empty test directory, a flat
  file in `docs/`, a `docs/` directory without an index, or a broken relative link in the
  README, `docs/` or the skill.

## 0.0.33-alpha — 2026-11-17

- **`write_sky_camera`** (83rd tool): places the single `sky_camera` a 3D skybox needs, with
  its scale, refuses a second one, and warns when the map has no `skyname`. The 3D skybox is
  now `partial` in the Hammer coverage: the camera is a tool, copying and scaling the
  geometry is still manual.
- **The project is organised into logical directories.** `docs/` is split into `campaign/`,
  `map/` and `reference/` with an index; `test/` now mirrors `src/` (`bsp/`, `vmf/`, `space/`,
  `render/`, `compile/`, `campaign/`, `kv/`, `tools/`) instead of 80 files in one folder, with
  `test/README.md` stating the rules. All imports, fixture paths and cross-links were updated;
  the suite still passes at 1055 tests.
- The diary rules now say it for every future change: a flat dump of files is a structural
  defect, and moving a file includes updating every link in the same commit.

## 0.0.32-alpha — 2026-11-17

- **`write_instance`** (82nd tool): places a `func_instance` from an instance `.vmf`, with
  origin, angles and fixup style. The file is resolved next to the target map and read first —
  a missing instance is an error, not an empty object — and nested instances are reported.
  Tested on the fixture: one solid, one entity, the entity appears in `read_vmf` with
  `fixup_style "1"`; a missing file is refused.
- Instances leave the Hammer gap list: reading (`collapseInstances`) and writing both exist.
  The remaining gaps are 3D skybox, engine cubemap building, arch/torus and model authoring.

## 0.0.31-alpha — 2026-11-17

- **`write_overlay`** (81st tool): puts an `info_overlay` decal on a brush face from a side id,
  a point on the face, a material and a size. The format is read from Valve's own
  `sdk_content/mapsrc/styleguide_urban.vmf`; the tool computes the basis normal/U/V, checks
  that the point is on the plane, and adds the entity. Tested on the campaign VMF: `side 3`,
  `decals/blood1`, 64×64 → normal `0 0 1`, four corners, `lint 0`.
- Hammer's overlay tool is no longer a gap in `hammer-coverage.md`; an in-game look at the
  decal is still pending. The skill's Hammer-tab map gained the overlay row.

## 0.0.30-alpha — 2026-11-17

- The project goal is recorded in the charter and the diary: the agent must have **all** of
  Hammer++ and more. `references/mapping/hammer-coverage.md` is the scorecard: every feature,
  its tool, and an honest `verified` / `tool` / `gap` status.
- `read_game_content` gains `kind: "sound"` — the sound browser (635 `ambient` files on this
  install), alongside materials, models with sizes, and particles.
- The coverage page names the real gaps: overlays/decals, instances/prefabs writing, 3D
  skybox, building cubemaps in the engine, arch/torus primitives, and model authoring.

## 0.0.29-alpha — 2026-11-17

- The skill gains `references/mechanics/crescendo-and-panic.md`: the `func_button` /
  `trigger_once` → `director ForcePanicEvent` wiring, `OnPanicEventFinished`, and the nav
  Battlefield (256) / Battlestation (32) split, with the automated test recipe. Entity names
  are read from the installed FGD; the play test is still pending.
- A project rule now says the agent's documentation is part of the product: every error,
  command, self-test recipe, asset and mechanic needs a page, and a question the agent had to
  ask is a documentation gap to close the same day.

## 0.0.28-alpha — 2026-11-17

- The skill gains `references/mechanics/weapons-and-items.md`: all 37 `weapon_*` spawn classes
  read from the installed FGD, grouped by tier and use, plus the placement rules — spawn on a
  nav area, not inside the floor, and do not give `Must Exist` to safe-room items because it
  duplicates them after a transition.
- The mechanics table records the class list as verified and the placement as documented but
  not yet play-tested.

## 0.0.27-alpha — 2026-11-17

- **The finale is a real custom finale now.** `trigger_finale` type 2 loads
  `scripts/vscripts/<mapname>_finale.nut` automatically; the script declares an
  `A_CustomFinale_StageCount` list (PANIC/DELAY/TANK/SCRIPTED) and receives
  `OnBeginCustomFinaleStage`. After the last stage the trigger fires `FinaleEscapeStarted`,
  which opens the escape point.
- The test campaign's script runs two DELAY stages (a shipping finale would use PANIC and
  TANK), and the verification passes: `[HSMCP] finale stage 1/2` → `HSMCP_ESCAPE_STARTED` →
  escape touch → `Map: credits` at 70 s.
- Type 0 is gone from the test map: it starts but has no stage list and never reaches the
  escape phase.
- `FinaleEscapeFinished` alone still does not end the campaign even after the escape phase, so
  the test harness adds `changelevel credits` on the escape trigger. A shipping campaign would
  fire the input from a rescue vehicle script.
- The skill gains `references/campaign/custom-finale.md` with the stage table, the callback,
  the escape wiring and the type-0 warning.

## 0.0.26-alpha — 2026-11-17

- The skill gains `references/testing/live-debugging.md`: how an agent runs the game itself
  (`run_map_test`, `-condebug`, `+sv_pausable 0`, `+sv_cheats 1`), moves survivors
  (`WarpAllSurvivorsToCheckpoint` vs `WarpAllSurvivorsToFinale`, why `setpos` in a config
  silently does nothing), fires entity inputs, plants markers, and the recipes for testing a
  transition, a finale, nav attributes and spawning. It also names the false passes: a stale
  log, `Mission credits` at startup, and `Host_NewGame` versus `Map:`.

## 0.0.25-alpha — 2026-11-17

- **The campaign is completable again, and this time it is verified.** A 768×768 arena with
  four cover pillars was added south of the main room; nav grew from 12 to 38 areas per map,
  and `MOB SPAWN ERROR` / special-spawn failures dropped to zero once the Director's safety
  range was lowered. The safety ranges are per-chapter mission convars, and `write_campaign`
  / `read_campaign` now read and write the `convar` block.
- The standard finale still never reaches its escape phase, so the test map ends with a
  deliberate `point_servercommand changelevel credits` from the escape trigger. That is a
  scripted end for the harness, not a template; a shipping campaign needs a VScript finale.
- Victory is verified by the credits map loading: `---- Host_Changelevel ----` then
  `Map: credits`, at 66 seconds. `Map:` is a changelevel; `Host_NewGame on map credits` is a
  direct `map` command, and `Mission credits ver 1 loading...` is startup noise.
- `verify-finale.mjs` waits for `Map: credits`. The mechanics table marks the finale victory
  verified with a scripted end, and the Director-driven escape phase still `not yet`.

## 0.0.24-alpha — 2026-11-17

- The nav-attribute trap is documented and fixed in the test map: FINALE must be applied
  liberally, while BATTLEFIELD stops infected spawning for as long as survivors stand in it.
  The finale corridor was both, so the Director had an empty spawn set. Battlefield is gone;
  FINALE now covers the whole eastern half.
- `info_zombie_spawn` points moved from between nav areas to two area centres.
- The remaining spawn blocker is the Director's safety range: on a ~700-unit map every area is
  closer than `z_spawn_safety_range` / `z_finale_spawn_safety_range` /
  `z_finale_spawn_mob_safety_range`. Setting them to 100 dropped `MOB SPAWN ERROR` from ~1800
  to ~60 in the first seconds and removed special-spawn failures, but a map this small still
  starves the Director later. The convars and the mission `convar` block are in the docs.
- `read_nav_dump` decodes the full spawn-attribute set (empty, battlestation, battlefield,
  rescue vehicle, rescue closet, no-mobs) instead of only checkpoint/finale.
- Victory is still not automated: the finale starts and the escape trigger fires, but the
  campaign does not reach the credits map. The user's observation stands — a stats crawl or
  credits means the survivors escaped; the correct marker is `Host_NewGame on map credits`,
  not `Mission credits`.

## 0.0.23-alpha — 2026-11-17

- **Correction: the finale victory is not verified.** 0.0.20 claimed it from
  `Mission credits ver 1 loading...`, but the engine loads every mission file at startup,
  credits included. The real marker is the map starting: `Host_NewGame on map credits`. A
  rerun with that marker did not win: `Finale started` and `HSMCP_ESCAPE_TOUCHED` appear,
  the credits map does not.
- The standard finale cannot spawn: 1662 `MOB SPAWN ERROR` and 47
  `Director failed to spawn a special` lines. `AdvanceFinaleState` on a timer did not move it
  to the escape phase. The map needs a real combat area with spawnable nav, then waves.
- `run_map_test` truncates `console.log` instead of deleting it. A delete that silently leaves
  yesterday's lines made a wait-for match return in five seconds on a stale marker.
- The finale map gets a Battlefield nav region; the spawn errors remain, so the region alone is
  not the fix.
- `verify-finale.mjs` now waits for `Host_NewGame on map credits`, not `Mission credits`.
  The mechanics coverage table marks the finale as start/escape verified, victory not yet.

## 0.0.22-alpha — 2026-11-17

- `read_game_content` now browses assets the way Hammer's tabs do, with the numbers that
  matter: `details: true` on a model returns its hull bounds (`mins`, `maxs`, `size`) — the
  size the model viewer shows and the number needed before placing a building — and
  `kind: "particle"` lists `.pcf` files for the Particle Browser. Verified against the
  install: 246 `props_urban` models with sizes, 52 particle systems.
- The skill gains `references/mapping/hammer-tabs.md` (every Hammer++ tab mapped to the tool
  that replaces it, and recipes for roads, skyboxes, buildings and street props) and
  `references/mechanics/coverage.md`, an honest table of which L4D2 mechanics are verified and
  which are still `not yet`.
- Mechanics coverage is now the project's definition of done: a row moves to verified only
  with in-game evidence. The open rows are the next blocks — spawn areas and waves, weapons
  and items, crescendos, tanks and witches, Scavenge/Survival/Versus, weather, VScript waves,
  displacements and instances.

## 0.0.21-alpha — 2026-11-17

- **`write_vscript`** (80th tool) writes a L4D2 `.nut`, refuses unbalanced braces, warns
  about Lua habits (`local`, `end`, `--[[`) and about a missing `printl`/`Msg` banner, and
  can attach the script to a map by adding a `logic_script` entity with `vscripts` set to the
  file's base name. A compiled map is refused by name, like every other `.vmf` tool.
- The scripting reference now points at the tool, so an agent can ship a script and attach it
  without hand-editing the VMF.

## 0.0.20-alpha — 2026-11-17

- **The finale is verified end to end.** `verify-finale.mjs` deploys a self-test build, starts
  the finale (`Finale started`), warps the team into the corridor, and the escape trigger
  fires `FinaleEscapeFinished`; the engine then loads `Mission credits`. That credits load is
  the victory marker.
- `env_outtro_stats` is presentation, not the win: `OnOuttroStatsDone` did not report during
  the run, and the campaign completed anyway. The docs and the skill now say so.
- The test escape zone moved into the finale corridor, so the warp lands inside it; the
  self-test uses `WarpAllSurvivorsToFinale` and `+sv_pausable 0`.
- Gate G is complete: spawn, bots, chapter transition, finale start, escape, victory/credits.
  What remains is combat quality: this tiny map cannot spawn a mob
  (`Director failed to spawn a special`), so waves and specials are the next block, not a
  completion blocker.

## 0.0.19-alpha — 2026-11-17

- **`run_nav_generate`** (78th tool) wraps the whole nav loop: loose copies, the VPK moved
  aside, `sv_cheats 1` + `nav_edit 1`, launch, wait for the mesh, collect `.nav` and the
  engine dump, clean the rotating backups, restore the config and the archives. It returns
  the mesh size, the dump, the decoded verdict and the flow warnings. Verified on both maps
  of campaign 001: `playable`, 12 areas, no flow warnings, everything restored.
- **`run_map_test`** (79th tool) launches an installed map with `-condebug`, waits for a
  console pattern, closes the game and returns the match and log tail. It is the automated
  half of a play test.
- The finale starts without a human: `trigger_finale` **type 0** plus `ForceFinaleStart`
  produces `Finale started`; type 2 without a finale script starts nothing. A finale map also
  needs the disabled arrival `info_changelevel` — without it the Director reports
  `No exit checkpoint could be found`. The lint gains
  `l4d2-finale-no-arrival-changelevel`, and the incorrect `l4d2-finale-type-standard` warning
  is gone.
- The escape trigger is touched after the warp (`HSMCP_ESCAPE_TOUCHED`), but victory and the
  outtro are not reached yet: the standard finale cannot spawn a mob (`MOB SPAWN ERROR`) on
  this test map, so its state machine does not advance to the escape phase. That is the next
  block: a combat area with spawn nav, then waves/rescue.
- `Director.WarpAllSurvivorsToCheckpoint()` fails on a finale map (no exit checkpoint); the
  self-test uses `WarpAllSurvivorsToFinale()`. `run_map_test` accepts `extraArgs`, used with
  `+sv_pausable 0 +sv_cheats 1` so an unfocused game does not pause.

## 0.0.18-alpha — 2026-11-17

- **The chapter transition is verified end to end without a human.** The engine needs two
  things, not one: every survivor inside the `info_changelevel` volume **and** the checkpoint
  door closed (`CheckpointDoorClosed`). `verify.ps1` builds with `HSMCP_SELFTEST=1`, the map's
  timer warps the team into the safe room and closes the door, and the game loads
  `hsmcp_test_m2` — recorded as `transition: PASS`.
- `read_nav_dump` (77th tool) parses the engine's `<map>_nav.txt`, decodes CHECKPOINT,
  PLAYER_START, FINALE and the escape route, and returns a `playable` / `no-goal` / `no-flow`
  / `empty` verdict.
- `read_vmf_lint` gains the L4D2 campaign rules: `trigger_changelevel`,
  `l4d2-changelevel-no-landmark`, `-landmark-missing`, `-no-brush`, `-no-checkpoint-door`,
  `-no-checkpoint-nav`, `l4d2-finale-type-standard`, `l4d2-no-director`. Three new tests.
- `run_vtf_convert` is registered again: it was defined and documented but never added to the
  tool list, and its argument still carried the Wine-era `Z:` prefix, which is wrong on
  Windows. It now passes the native path.
- Cleanup from the dead-code audit: unused imports in fourteen tool modules, dead constants
  (`LUMP_PAKFILE`, `MASK_NAMES`, the unused `.lmp` test path), the `garrys-mod` keyword, and
  stale GMod/Lua/Linux wording in descriptions and docs. The GMod-era measurement pages now
  carry a historical banner.
- The skill gains `references/mapping/editor-and-fgd.md` (Hammer++, Tools++ flags,
  L4D2-FGD-Edits and the rule that only the stock FGD is a shipping authority) and
  `references/testing/console.md` (nav/entity commands, `-condebug`, and why `setpos` in a
  config silently does nothing).

## 0.0.17-alpha — 2026-11-17

- The agent skill is added at `skill/l4d2-hsmcp/`, structured for progressive disclosure:
  a short `SKILL.md` router, then `references/` (campaign, nav, scripting, mapping,
  compiling, tools), `workflows/`, `troubleshooting/` and `checklists/`. `opencode.json`
  points at it so it is available in this repository.
- The skill documents only what the project has verified — mission rules, the safe-room
  transition, nav attributes and flow, the finale inputs, add-on VScript, the tool catalogue —
  and names what is not built yet instead of inventing it.
- Campaign 001: the checkpoint door stood on a solid wall. The corridor now ends in a real
  doorway and a safe room behind it, with the changelevel volume over the room floor. Nav was
  regenerated: 12 areas per map, CHECKPOINT on both safe rooms, FINALE in the radio corridor,
  and the flow path reaching the safe room.

## 0.0.16-alpha — 2026-11-17

- A chapter transition needs more than `info_changelevel`: a `prop_door_rotating_checkpoint`
  must exist (without one the changelevel never spawns), and the nav areas must carry
  CHECKPOINT, with PLAYER_START on the first map. `func_nav_attribute_region` applies those
  attributes during generation, and the `<map>_nav.txt` dump proves it: `0x800` is CHECKPOINT,
  `0x40` FINALE, and `0x20000000` marks the computed flow path.
- Campaign 001 now has all of it: a checkpoint door at the exit and at the second map's start,
  Mission Start + Checkpoint on the spawn area, Checkpoint in the exit corridor and Finale in
  the radio corridor. Nav regenerated with those attributes and the flow path present.
- `docs/campaigns.md` records the three non-optional requirements and explains why bots run
  ahead: they path to the goal area, not to the player.
- `nav.ps1` captures each generation's console log and reports flow and checkpoint errors, so
  a mesh that exists but has no goal is caught without a play test.

## 0.0.15-alpha — 2026-11-17

- An add-on VPK can carry VScript: `scripts/vscripts/hsmcp_finale.nut` is packed into the
  campaign, attached through a `logic_script` entity and verified in the running game — the
  `[HSMCP] hsmcp_finale loaded` banner appears in `console.log` with `-condebug`.
- The finale is now completable with entities: `trigger_finale` type 2 starts on **+use**,
  `FinaleStart` enables an escape `trigger_multiple` after ten seconds, and its `OnStartTouch`
  fires `FinaleEscapeFinished` and the outtro stats — the same inputs the Authoring Tools'
  rescue template uses. Stock campaigns never use type 0, so the earlier standard-finale
  attempt was replaced rather than tuned.
- `docs/campaigns.md` gains "The finale" and "VScript in an add-on", with the exact inputs and
  the console-log check.
- Campaign 001: exit corridor and changelevel (0.0.14) plus this finale; both maps rebuilt,
  nav regenerated (1346 bytes, fresh) and the 7-entry archive redeployed.

## 0.0.14-alpha — 2026-11-17

- Chapter transitions use L4D2's own mechanism: an `info_changelevel` brush with `map` and
  `landmark`, plus a matching `info_landmark` in both maps. Every stock chapter works this
  way; `trigger_changelevel` exists in `base.fgd` but is not part of the campaign flow, which
  is why the test campaign loaded and never advanced.
- Campaign 001 gets a visible exit: an east-wall doorway, a lit corridor and the changelevel
  brush at its end, replacing the invisible trigger brush. Both maps were rebuilt, nav was
  regenerated (1346 bytes, fresh against the new `.bsp`) and the archive redeployed.
- `docs/campaigns.md` gains "Chapter transitions" and "The finale": all stock finales use
  `trigger_finale` type 2 (Custom) with a VScript, so a script-free finale is still open.

## 0.0.13-alpha — 2026-11-17

- The upstream credit names the original developers' studio, **Project Society Studio**, and
  stops there: the README does not restate a copyright line, because `LICENSE-MIT` already
  carries the MIT notice verbatim.

## 0.0.12-alpha — 2026-11-17

- README drops the "What works today" feature table. The project has only just entered
  development, and the page now says so plainly: the map and campaign pipeline is the first
  piece being built, and the feature set will keep expanding.
- Upstream credit names **Project Society Studio**, which is how the original authors identify
  themselves; the MIT notice in `LICENSE-MIT` is unchanged.

## 0.0.11-alpha — 2026-11-17

- README gains a full Requirements section: L4D2 (app 550) and its Authoring Tools (app 563),
  Node, pnpm, Python/srctools, Windows, disk; recommended Hammer++ and standalone Tools++,
  the VTF tools, Steam for nav and testing; and the agent side (MCP client, skill,
  permission to run local tools and launch the game once per map for nav).

## 0.0.10-alpha — 2026-11-17

- README rewritten around what this project is: an agent toolkit for Left 4 Dead 2 maps,
  campaigns, VScripts, models and addons. It states the early-development status, how the
  pieces fit together, what works today and what is planned.
- `docs/campaigns.md` added: mission format and naming rules, addon layout, nav generation,
  deployment, and the checks `check_campaign` performs.
- Provenance points at `Sycatle/hammer-mcp`, the upstream this fork grew from; the MIT
  notice and copyright remain in `LICENSE-MIT`.

## 0.0.9-alpha — 2026-11-17

- Gate F answered: `nav_generate` runs in the client's listen server, not a dedicated
  binary, and it requires `sv_cheats 1` **and** `nav_edit 1`; without `nav_edit` it does
  nothing. The map must be loose, because a `.nav` cannot be written beside a map inside a
  VPK.
- `campaigns/001-hsmcp-test/nav.ps1` automates the loop: loose maps, generate, collect
  `nav/`, restore the game config, re-pack and deploy.
- Both maps now carry analysed nav meshes (version 16/14, `savedBspSize` matches), and the
  addon has 6 entries (two maps, two navs, mission, manifest).
- A transition needs a landmark: both maps carry `info_landmark landmark_transition` and
  `trigger_changelevel.landmark` points at it.

## 0.0.8-alpha — 2026-11-16

- The project moved to its own repository, `NexPG/L4D2-HSMCP`, with the full history. The
  old fork's remote is gone; metadata, clone URL and CI badge point at the new home.
- The upstream MIT notice and the provenance in `NOTICE` stay exactly where the licences
  require them.

## 0.0.7-alpha — 2026-11-16

- Campaign metadata is now shaped the way L4D2 matches it: the mission file's base name
  equals the VPK's (`hsmcp_campaign.txt` in `hsmcp_campaign.vpk`), `"Name"` is alphanumeric,
  and `"Image"` is set. The addon manifest carries `addonSteamAppID 550` and
  `addonContent_Campaign 1`.
- The staging tree is cleaned before a rebuild, so a renamed mission cannot survive and
  register a second campaign.

## 0.0.6-alpha — 2026-11-16

- `campaigns/` is ignored as a directory (root-anchored `/campaigns/`), not merely for the
  files inside it.
- Deployment keeps exactly one campaign in the game: the build removes earlier
  `hsmcp*.vpk` archives from `left4dead2/addons/` and copies the new one as
  `hsmcp_campaign.vpk`. History stays in the numbered campaign directories, where any run
  can be rebuilt and deployed again.

## 0.0.5-alpha — 2026-11-16

- Test campaigns are local only (`campaigns/` is ignored) and live in numbered directories:
  a README stating the date, project version, what was attempted and what came out, plus
  the source maps, staging tree, build script and packed VPK.
- The build script deploys the archive to the game's `left4dead2/addons/`, so a campaign
  can be opened in the game directly.
- `001-hsmcp-test` re-laid out under that convention.

## 0.0.4-alpha — 2026-11-16

- First campaign built through the tools: two sealed chapters with a transition and a
  finale, a mission file, an addon manifest and a packed VPK. `check_campaign` passes on
  the unpacked tree and on the archive itself.
- `campaigns/hsmcp-test/` keeps the source `.vmf` files, the mission and a `build.mjs` that
  reproduces the build; compiled maps and the VPK are build output.

## 0.0.3-alpha — 2026-11-16

- `run_vpk_pack`: packs a staging directory into an addon VPK with the game's own
  `vpk.exe`, writes the addon manifest when given one, and reads the archive back through
  the sidecar to prove every staging file made it in. Overwrites only on request.
- The pack output is an ordinary L4D2 addon tree: `addoninfo.txt`, `missions/`, `maps/`,
  `materials/vgui/maps/`.

## 0.0.2-alpha — 2026-11-16

- Campaign files: `read_campaign`, `write_campaign` and `check_campaign`. The schema was
  read from the game's own `missions/campaign1.txt` inside `pak01_dir.vpk`; a campaign can
  be written, checked against its maps and images, and the game's own campaigns can be
  checked in place.
- The sidecar can list and read VPK entries (`vpk_list`, `vpk_read`), so campaigns and
  their maps are checked without extracting a 1 GB archive.
- Sky checks accept Left 4 Dead 2's `_hdr`-prefixed sky faces, and dependency resolution
  does the same; `write_vmf` now defaults to `sky_l4d_c1_1`, a sky this game really has.
- The probe fixture is compiled by this game's own compilers (BSP 21, L4D2 field order),
  not inherited from Garry's Mod.
- Test environment: the repo root default was one level too high, which had silently
  skipped every game-content test on a normal checkout. With it fixed, 1020 tests pass on
  Windows against the real install.

## 0.0.1-alpha — 2026-11-16

First version of the Left 4 Dead 2 fork.

- Targets **Left 4 Dead 2 only** (BSP 21, `left4dead2.fgd`, game appid 550). Other Source
  games and the Garry's Mod subsystems were removed.
- **Windows only**: the game's own compilers run natively; the Wine/Proton layer and the
  Linux paths are gone.
- Reads L4D2's lump directory, whose field order differs from every other Source game.
  Counts on `c1m1_hotel.bsp` match Valve's `vbspinfo` exactly.
- Compiles with the stock chain and with standalone **Tools++** (`vbsp++.exe` family),
  naming the chain that actually ran.
- Python sidecar (srctools 2.7.0) installed and used for FGD, VMF and VPK work.
- 71 tools. Tests pass on Windows with the game installed (947 passed, 94 skipped at the
  time of writing).
