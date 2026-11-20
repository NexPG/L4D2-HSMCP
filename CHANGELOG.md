# Changelog

Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`, with a
prerelease suffix (`-alpha`, `-beta`) while the toolchain is still being proven on the
target game. A version is bumped in the same commit as the change it describes, together
with a line here.

## 0.0.135-alpha - 2026-11-21

- **The entity layer has universal primitives, not a closed menu.** `write_brush_entity`
  takes any classname, a box volume, arbitrary keyvalues and outputs; `write_point_entity`
  does the same for a point class at an origin. The trigger/mover/logic builders are
  shortcuts over this path, and a class with no named builder is still one call away.
  This is the design rule in `references/tools/primitives.md`: every capability must be
  reachable through a general operation, and deleting a convenience tool must not remove it.
- **Tool count: 198.** Tests: 167 files, 1580 passed, 33 skipped.

## 0.0.134-alpha - 2026-11-21

- **UI materials and cubemap layout.** `write_loading_screen` turns a PNG into the VTF and
  `UnlitGeneric` VMT a campaign poster or map thumbnail needs, deriving `$basetexture` from
  the path under `materials/`; `write_cubemap_grid` lays `env_cubemap` samples on a regular
  grid inside a bounds box (128-sample cap).
- **`write_addoninfo` writes the manifest without packing.** It carries the appid, title,
  author, version, tag and `addonAICredit`, and parses the result back as KeyValues.
- **`check_vmt` and `check_sound` validate the files before a pack.** The VMT check names an
  unknown shader, a missing `$basetexture`, a filesystem path or `.vtf` in the texture name,
  non-numeric compile flags, duplicate keys and, with material roots, missing textures. The
  sound check reports a WAV that is not 16-bit PCM at 22050/44100 and every soundscript wave
  that is absent.
- **Tool count: 196.** Tests: 167 files, 1578 passed, 33 skipped.

## 0.0.133-alpha - 2026-11-21

- **Every packed addon carries AI provenance.** `run_vpk_pack` appends
  `"addonAICredit" "Created by AI via L4D2-HSMCP <version>"` to `addoninfo.txt` by default;
  the version is read from the toolkit's `package.json`, so it moves with the build. The same
  key is asked for in the skill when a manifest is written by hand, and `validate_addon`
  reports its absence as information.
- **Triggers, movers and logic have guided builders.** `write_trigger` writes the brush volume
  and the class-specific keys (`wait`, `damage`/`damagetype`, `speed`/`pushdir`, `gravity`) and
  refuses a teleport or look trigger with no `target`; `write_mover` writes
  `func_movelinear`, `func_rotating` or `func_tracktrain` with the origin at the volume centre
  and refuses a tracktrain with no path; `write_logic` writes the point class and its
  `connections`, with `RefireTime`, `InitialValue`, `startvalue`/`max` defaults. L4D2 has no
  `func_pendulum`, so the mover enum does not offer one.
- **Compiled:** a sealed room with a `trigger_multiple`, a `func_movelinear` and a
  `logic_relay` reaches vbsp with no leak and all three classes in the entity lump.
- **Tool count: 191.** Tests: 166 files, 1572 passed, 33 skipped.

## 0.0.132-alpha - 2026-11-21

- **Shipping an addon has an offline path.** Four tools close the gap between a working
  staging folder and a Workshop build. `write_content_manifest` adds or removes an entry in
  the particle, soundscript or soundscape manifest the engine actually reads; a file that is
  not listed is never loaded, which is the usual reason a custom asset ships silent. It
  normalizes paths, skips duplicates case-insensitively, preserves comments and writes the
  stock `soundscaples_manifest` spelling for a new soundscape manifest.
- **`write_localization` writes and updates `lang`/`Tokens` files.** Closecaption is
  UTF-16LE with a BOM; an existing file keeps its encoding, a new one defaults to UTF-16LE,
  and existing tokens are updated in place with the rest of the file left alone.
- **`write_workshop_vdf` prepares the SteamCMD build file** with appid 550, content folder,
  preview, visibility, title, description and change note. Uploading remains a Steam action;
  the file and paths do not.
- **`validate_addon` checks the folder before it is packed.** It parses `addoninfo.txt`,
  reads every `.nut` as Squirrel, follows the three manifests and warns about referenced files
  that are absent (they may be stock), and warns when closecaption is not UTF-16LE.
- **Tool count: 188.** Tests: 165 files, 1561 passed, 33 skipped.

## 0.0.131-alpha - 2026-11-21

- **A local VScript addon test: bots carry pills and adrenaline but cannot use them above 20 HP.**
  The addon is test content and is not part of this repository. A `mapspawn_addon` starts a
  `logic_script` think function. When a bot brings pain pills or adrenaline into its hands
  while total health (permanent plus temporary) is at least 20, the poller switches it to
  another carried weapon; the item stays in the inventory, so the bot can carry it or give it
  to a teammate. Below 20 the addon does nothing and the bot is free to use it. This replaced
  an earlier hidden-inventory prototype that removed the item; the request was to let the bot
  keep it. Verified on `c1m1_hotel`: three bots at 30 HP were switched to the pistol and still
  carried all three pills; at 10 HP there were no lock lines and no `pills_used` above 20.
- **Medkits are deliberately out of scope.** Bots use them exactly as vanilla; the request was
  pills and adrenaline. The "they use medkits in the safe room" observation was vanilla
  behaviour, not a failure of the pill rule.
- **The addon exposed a real VScript-checker mistake.** `read_vscript` said event hooks need
  a `logic_script`, even in `mapspawn_addon.nut`, which the engine loads as a global script.
  The message now distinguishes the four global addon scripts from files that need a loader,
  and the addon page records the harder half: an `IncludeScript` from `mapspawn_addon` does
  **not** register `OnGameEvent_*` hooks; they must live in the file the `logic_script` loads.
- **New skill page `references/scripting/addons.md`** covers pure VScript addons, the think
  runner, hook loaders, item control and probe testing with `run_map_test` and `scriptsDir`.
- **`run_vpk_pack` can install what it packs.** `install: true` copies the finished archive
  into the game's `left4dead2/addons`; the entry check now compares names case-insensitively,
  because vpk.exe lowercases `README.md` to `readme.md` and the old check called it missing.
- **Tool count: 184.** Tests: 164 files, 1553 passed, 33 skipped.

## 0.0.130-alpha - 2026-11-21

- **Campaign wiring is built, not just checked.** Six tools close the gap between a
  compile-clean map and a campaign the engine can walk. `write_safe_room` places a
  `prop_door_rotating_checkpoint` on its hinge through `place_door`, an `info_player_start`,
  four ordered `info_survivor_position`s and a director. `write_changelevel` writes the
  `info_changelevel` **brush volume** (an entity with no solids compiles to nothing) and its
  `info_landmark`, distinguishing departure from the arrival volume that stock chapters carry
  with `spawnflags 2`. `write_finale_setup` encodes L4D2's type set -- 0 standard, 1 gauntlet,
  2 custom, 4 scavenge, no 3 -- and refuses a custom finale with no script. `write_spawn_points`
  covers player, survivor, zombie and rescue spawns; `write_map_parameters` writes only the
  density keys chosen, under the FGD's names.
- **`check_campaign_wiring` follows the chain across files.** Given maps in chapter order it
  requires each non-final chapter's changelevel to name the next, compares the landmark pair,
  expects the arrival volume in the destination, checks the checkpoint doors by the names the
  engine looks up, and holds the last chapter to its mode's finale contract. It reads VMF and
  BSP, and on the test campaign it reports no errors.
- **One L4D2 fact corrected in the tools: there is no stock `trigger_escape`.** All 26 stock
  campaign BSPs ship zero of them; escaping is the finale's state machine and the nav FINALE
  areas. The builder does not write the legacy entity.
- **Verified by vbsp.** A sealed room with a departure changelevel, zombie spawn and gauntlet
  finale emits `info_player_start`, `info_zombie_spawn`, `info_changelevel`, `info_landmark`
  and `trigger_finale` in the entity lump. The safe-room builder needs the game's model hull
  and is exercised on this machine.
- **Tool count: 184.** Tests: 164 files, 1552 passed, 33 skipped.

## 0.0.129-alpha - 2026-11-21

- **World dressing has builders, not just `edit_vmf`.** Five tools encode the rules the
  compiler does not enforce. `write_light` writes a `light`, `light_environment`,
  `light_dynamic`, `env_sun` or `shadow_control`; its `_light`/`_ambient` are the four-number
  colour-plus-brightness form, and the environment gets angles and a pitch. `write_postprocess`
  wires an `env_tonemap_controller` through a `logic_auto` because the controller has no
  setting keyvalues at all, and writes `env_fade`, `env_shake` or `color_correction`.
  `write_decal` places `infodecal` on a surface, `write_rope` writes the linked
  `move_rope`/`keyframe_rope` pair, and `write_sprite` writes a sprite or a beam/laser with
  the `info_target`s those entities need to point at. Every builder reads its entity back and
  checks key names against the installed FGD when the sidecar is there.
- **L4D2 spells it `color_correction`.** The class is missing under the `colorcorrection`
  name other Source games use; the builder writes the game's own spelling and warns when the
  `.raw` file is absent or is not a `.raw`.
- **All five compile.** The sealed-room case in `tools-compile.test.ts` writes every entity
  and requires vbsp to emit `light`, `light_environment`, `env_tonemap_controller`,
  `logic_auto`, `infodecal`, `move_rope`, `keyframe_rope`, `env_beam` and `info_target` in the
  entity lump. The unit file reads each one back, including three separate `OnMapSpawn`
  outputs in a `connections` block.
- **Docs and skill pages move with the tools.** `references/mapping/world-dressing.md` states
  the rules per family; the coverage, parity and Hammer++ references name the builders.
- **Tool count: 178.** Tests: 163 files, 1532 passed, 33 skipped.

## 0.0.128-alpha - 2026-11-21

- **`check_bsp` judges the compiled file and its relationship to the source.** Every lump
  descriptor must lie inside the file and none may overlap another; the entity lump must have
  a worldspawn. With a VMF it also reports a stale compile (VMF newer than BSP), a skyname
  that differs, and entity classes present in the source but absent from the result --
  excluding the classes vbsp expands or removes (`func_instance`, `func_detail`,
  `func_group`). A truncated file is a problem, not a thrown exception. Tool 173.
- **Tool count: 173.** Tests: 162 files, 1516 passed, 33 skipped.
## 0.0.127-alpha - 2026-11-21

- **4-way displacement blends are not an L4D2 feature, and the documents now say so.** The
  check was done against the installed game, not against a wiki: 4,645 VMTs scanned, 68
  `WorldVertexTransition`, every one with two base textures; zero `$basetexture3`/`$basetexture4`
  and zero `Enable4WayBlends`. `stdshader_dx9.dll` exports `WorldTwoTextureBlend` and no
  four-way shader; `vbsp.exe` has an `alphas` block and no `alphas2`; `engine.dll` says
  "using WorldTwoTextureBlend on a non-displacement surface". `read_hammerpp` now warns that
  `Enable4WayBlends=1` has nothing to write. The last "verification gap" closes as an engine
  answer rather than a toolkit gap.
- **Tool count stays 172.** Tests: 161 files, 1512 passed, 33 skipped.
## 0.0.126-alpha - 2026-11-21

- **`review_map` runs the checklist in one call, and says what did not run.** Lint, the map's
  own rules file and organisation; when a compiled `.bsp` sits beside it, the budget report,
  lightmap and visleaf statistics and the dependency walk; `deep` adds the room segmentation
  and the longest sight lines. Each section carries its own error, so a missing sidecar or an
  uncompiled map produces "incomplete", not a stack trace or a clean verdict that hides it.
- **`compare_renders` renders the same camera against two VMFs and diffs the frames.** Changed
  pixel count and fraction, mean and maximum channel delta, the bounding box, and a difference
  image with changed pixels red. It uses the offline flat-colour renderer, so the frames are
  comparable: same camera, material hashes and geometry; textures, lightmaps and props are
  outside what it can show.
- **Tool count: 172.** Tests: 161 files, 1512 passed, 33 skipped.
## 0.0.125-alpha - 2026-11-21

- **`diff_vmf` compares what a mapper means by changed.** Brushes added, removed or changed
  (volume, bounds, materials, displacement count), entities added, removed or changed
  (keyvalues and outputs), and worldspawn keys. Matched by Hammer id, so a tool that
  regenerates ids reads as all-added/all-removed -- honest, because the ids really are
  different. A textual diff of a map is unreadable; this is the review tool a machine edit
  needed. Tool 170.
- **Tool count: 170.** Tests: 159 files, 1506 passed, 33 skipped.
## 0.0.124-alpha - 2026-11-21

- **Hotspot texturing: the last Hammer++ data format is covered.** A `.rect` file is plain
  KeyValues, not binary: an optional `output_scale`, then a `Rectangles` block with one
  `rectangle` per panel. `read_rect` and `write_rect` handle it, and `align_faces` takes
  `fitRect` to fit a face onto one rectangle instead of stretching the whole texture over it.
  Verified by the UV algebra: a 256x128 face fitted to a 32..96 / 64..128 hotspot spans
  exactly those coordinates, with scales 4 and 2. L4D2 ships no `.rect` file, so the grammar
  round-trip is the format oracle; the math is checked against the VMF axes.
- **Tool count: 169.** Tests: 158 files, 1502 passed, 33 skipped.
## 0.0.123-alpha - 2026-11-21

- **`read_bsp_faces` reads the compiled result, not the source.** Material, smoothing-group
  bitmask, lightmap footprint and texture vectors come out of FACES, TEXINFO and the texdata
  string table. It is the oracle the face tools needed: a 30-degree turn, a scale of 32 and
  group 13 are now checked against what vbsp wrote, not against what the `.vmf` asked for.
  Tool 167.
- **Terrain is compiled end to end.** A 16-cell sealed patch is subdivided to power 3,
  sculpted with seeded noise, painted to alpha 200 and sewn; the result has no seam and vbsp
  accepts it. The displacement rows stop saying `tool`.
- **Instances are expanded before vbsp.** vbsp has no `func_instance` support and exits with an
  access violation when handed one. `run_compile` now collapses them through srctools, under
  the map's own name, and falls back to a clear refusal when the sidecar is absent. Verified:
  the fragment's light is in the BSP entity lump.
- **`run_pack` writes the ZIP itself.** bspzip needs a Steam install and a VConfig setup, writes
  to a second file rather than in place, and can leave modal error dialogs; it is gone. The
  native writer appends the archive, moves lump 40 and compares every entry byte for byte.
  Verified on `c1m1_hotel`: 1720 → 1721 entries. BSP lump roundtrips (including LZMA) and
  compiled-entity add/update/remove are covered by the same offline test file.
- **Weather compiles.** A rain volume and a fog controller reach the entity lump in the sealed
  room.
- **Tool count: 167.** Tests: 156 files, 1490 passed, 33 skipped.

## 0.0.122-alpha - 2026-11-21

- **An active cordon now changes the compile, as it always claimed to.** `set_cordon` wrote the
  block and `run_compile` passed the whole file to vbsp, so a "one-room test" compiled the city.
  The compile copy is now filtered the way Hammer filters it: a brush whose bounds intersect the
  box is kept whole, a point entity by its origin, a brush entity by its brushes, and an entity
  with no origin and no brush is kept and reported. The filtered copy is compiled under the map's
  own name in a temp directory and its `.bsp`/`.lin` moved back, so `changelevel` names still
  match. `ignoreCordon: true` compiles the whole map. Proven by a control: a leaky open box
  outside the cordon leaks when ignored and is absent from the BSP when applied.
- **Five more Hammer++ rows are verified by the compiler, not by reading.** One room now also
  proves a brush rotated 30 degrees, scaled non-uniformly and mirrored; a counter assembled from
  several brushes; a two-plane (3-point) clip with four convex pieces; a hint slab; and a
  `func_areaportal` filling a sealed doorway. The last two run vbsp **and vvis**. The first
  areaportal attempt leaked because a doorway to the void is not two areas -- the test now has a
  second sealed room beyond the doorway, which is what a portal actually separates.
- **The coverage documents match the code again.** Propper++ (`brush_to_model`), the 3D-skybox
  builder, displacement sealing and the overlay compile had all been recorded as gaps after they
  were closed. `test/tools/coverage.test.ts` now fails when a Tool column names something not
  registered, when a catalogue count drifts, or when a registered tool is absent from the skill.
- **Tool count: 166.** Tests: 155 files, 1483 passed, 33 skipped.

## 0.0.121-alpha - 2026-11-21

- **The displacement leak is explained, and `seal_displacements` repairs it.** The previous entry
  left the cause open; it is not the grid. A `dispinfo` lifted verbatim out of a Hammer-written
  fixture leaks exactly the same way, so `startposition`, its winding and `triangle_tags` are
  innocent. The mechanism is stronger than "the surface moved": **vbsp takes a displaced brush
  out of the hull entirely and emits its surface separately**, so the brush's own volume is void
  and the leak trace runs through it. Measured on one room: bare, it compiles; displaced, it
  leaks; displaced plus a plain duplicate, it compiles. `seal_displacements` writes that
  duplicate -- same planes, no `dispinfo`, tool material -- and `write_displacement` takes
  `seal: true` to do both in one call. A second run recognises its own work and adds nothing.
- **Hollow, vertex edit and overlay now have the compiler's word too.** One sealed room is
  hollowed, has a top edge broadened by `move_vertices`, and receives an `info_overlay` on its
  floor; vbsp accepts the result with no leak. The displacement pair above runs in the same file,
  so the room itself is never the variable.
- **A 3D skybox is now one call.** `build_skybox` copies the selected brushes at 1/16 scale
  around the map origin, places them in a sealed `TOOLS/TOOLSSKYBOX` room chosen outside the
  playable map, and puts the single `sky_camera` at the scaled origin. It refuses a room that
  overlaps the map or leaves the world bounds, and a selection whose scaled origin lands
  inside a copied brush -- which vbsp rejects as "entity in solid volume" rather than as a
  leak. Verified by vbsp: the map plus its second sealed volume compiles with no leak.
- **Tool count: 166.** Tests: 153 files, 1469 passed, 33 skipped.

## 0.0.120-alpha - 2026-11-21

- **`auto_visgroups` fills the tree the way Hammer++'s Auto Visgroups does.** One visgroup per
  entity class and one per world-brush material, both halves written, existing groups reused so
  a second run adds nothing. A solid joins the group of its **dominant material by face area**,
  so one large wall beats four trim faces; tool textures are skipped. On the test campaign it
  builds 14 class groups and one material group over 34 solids with no warnings.
- **`clip_solids` is verified against vbsp.** A sealed room with an interior block cut in half
  compiles with no leak (`tools-compile.test.ts`, skipped where no toolchain exists).
- **Found a real defect: a displaced face stops sealing.** The same sealed room leaks the moment
  its floor (or wall) gets a `dispinfo`, and seals without it. The leak trace runs straight
  through the displaced brush. The writer's structure matches a stock map's displacement block,
  so the next step is comparing against what vbsp expects from `startposition`/`triangle_tags`
  rather than adding a test that hides it.
- **Tool count: 164.** Tests: 151 files, 1442 passed, 33 skipped.

## 0.0.119-alpha - 2026-11-21

- **`align_faces` fits to the texture's real size.** Hammer's Fit knows the VTF's dimensions;
  the offline path assumed 512 texels and warned. It now asks the sidecar for each material's
  VTF size (a 32-pixel preview decode is enough) and uses it, keyed by the material name as the
  `.vmf` stores it. A 64x64 `TOOLS/TOOLSTRIGGER` face is no longer stretched as if it were 512;
  the 512 fallback and its warning remain only for a material that cannot be read.
- **`align_faces` takes `game`** for that lookup, like the other asset-aware tools.
- **Tool count stays 164.** Tests: 151 files, 1440 passed, 33 skipped.

## 0.0.118-alpha - 2026-11-21

- **The gas can is the spawner.** `weapon_scavenge_item_spawn` is the entity the player uses;
  there is no separate `weapon_scavenge_item` (Valve's level-design docs and the AlliedMods
  plugins both say so), so the empty `FindByClassname` was never the bug. The spawner takes
  `SpawnItem`, `TurnGlowsOn`/`Off` and `glowrange`, and the test campaign's cans now carry them.
- **`jointeam Survivor` + `god` works.** The client becomes a survivor with the survivor HUD and
  the teleported can glows in front of it, roughly 40--120 units away depending on where the
  player looked when `ent_teleport` ran. A scavenge round restarts on its countdown and resets
  teams, so the `e` press has to land inside a round the client is a survivor in; the pickup
  remains unproven.
- **Tool count stays 164.** Tests: 151 files, 1439 passed, 33 skipped.

## 0.0.117-alpha - 2026-11-21

- **A killed run no longer leaves a hidden addon.** `addonsToHide` renames an archive to
  `*.off`; a run killed mid-flight skipped the restore and the campaign disappeared from the
  menu, which is scanned at startup. `run_map_test` restores every `*.vpk.off` before hiding
  anything and returns `addonsRestored`.
- **The campaign menu is reachable with synthetic input.** `PLAY CAMPAIGN` (SendInput click) ->
  `Down` into the hover flyout -> `Single Player` (Enter) -> `Right` on `CAMPAIGN` ->
  `Down` to `AddOn Campaign...` -> the list shows `HSMCP Test by NexPG` with the description
  written into `addoninfo.txt`. The last `SELECT` inside that list did not accept Enter, Space,
  `e` or a synthetic click in this build, even with the row highlighted -- a real pointer or the
  gamepad button is still needed there.
- **Scavenge:** `jointeam Survivor` + `god` puts the client on the survivors and a teleported
  can glows about 120 units away -- at the edge of the use range, which fits "the cans are too
  far". The round's countdown restarts the round and resets the team, so the test needs a
  stable round or a re-join after each restart. The pickup stays unproven.
- **Tool count stays 164.** Tests: 151 files, 1439 passed, 33 skipped.

## 0.0.116-alpha - 2026-11-21

- **FBX in-between shapes become their own flexes.** A `BlendShapeChannel` with several shapes
  used to keep only the largest-weight shape; now every shape exports, the largest keeping the
  channel name and the others taking the weight as a suffix (`Smile_25`). Source flexes are one
  control each, so an in-between is a flex an animator drives. Fixture and test added.
- **`$sequence` blocks are checked further:** `fps` must be greater than zero, and an `event`
  whose last argument is a negative frame is reported. Tests cover both.
- **Scavenge: the team can be switched.** Typing `jointeam Survivor` into the console puts the
  local client on the survivors (the HUD, the four survivors and the gas-can glow are all in
  the screenshot), and `ent_teleport` moves a can to the crosshair. The picked-up count still
  stayed 16: a scavenge round restarts on a wipe and the restart resets the team, which also
  destroys the scheduled timers. The pickup needs a stable round (or a re-join after each
  restart), and remains unproven.
- **Campaign menu:** Enter on `PLAY CAMPAIGN` does not open the mode flyout -- it is a
  pointer-only hover menu, while SendInput absolute clicks do reach the game. The exact click
  sequence is still not settled.
- **Tool count stays 164.** Tests: 151 files, 1439 passed, 33 skipped.

## 0.0.115-alpha - 2026-11-21

- **Flex normal deltas.** `gltf_to_dmx` reads a morph target's `NORMAL` accessor and the
  shared DMX writer emits `normals`/`normalsIndices` beside the positions (one entry per
  position that has a normal delta); the result carries `flexNormalDeltas`. The skinned
  morph fixture now includes a normal delta and asserts three of them. FBX shapes still carry
  positions only.
- **`run_map_test` can launch without the console.** `console: false` drops `-console` so a UI
  test's keystrokes reach the game instead of the VGUI console text field; `-condebug` still
  writes `console.log`, so markers keep working.
- **Synthetic input, measured.** `SendInput` with absolute coordinates *does* reach the game:
  a click on `PLAY CAMPAIGN` opened its flyout. `SetCursorPos` plus `mouse_event` does not move
  the game's cursor at all. Full menu navigation is still flaky -- the mode carousel and the
  flyout share screen space and a trained sequence of clicks has not been settled -- so a
  campaign start from the menu is not proven yet. A console-less scavenge run showed why no
  pickup could be tested: with `+map` the local client joins the **infected** team (the Spitter
  spawn screen and `SCORE 0 / 16` are in the screenshot), so `e` was never a survivor use key.
- **Tool count stays 164.** Tests: 151 files, 1437 passed, 33 skipped.

## 0.0.114-alpha - 2026-11-21

- **`read_qc` reads `$definebone` as a graph.** A parent no `$definebone` declares, a bone
  declared twice and a parent cycle are reported with the bone that caused them; the compiler
  only complains late and vaguely about these. `$sequence` now also checks that an `activity`
  weight is numeric and that `loop`/`snap` are used as flags, not with a value.
- **The test campaign has a scavenge goal.** `game_scavenge_progress_display`
  (`progress_display`), the gascan `model`, `spawnflags`, `disableshadows`, `glowstate`, the
  `OnItemPickedUp` output and per-can targetnames went into the VMF and the map was recompiled.
  It did not make the cans usable: after `ForceScavengeStart` the map still has only the
  `weapon_scavenge_item_spawn` entities, `ent_teleport` moves one but its `Use`/`Touch` inputs
  do not count a pickup, and a synthetic mouse click does not reach the game (its UI uses raw
  input) -- keyboard navigation does, but the campaign flyout is pointer-only.
- **Campaign-menu start is blocked on input, not on the game.** The main menu is reachable and
  keyboard-navigable (`PLAY CAMPAIGN` -> screens open with Enter), but flyouts such
  as `Quick Match / Single Player` need a real pointer. Keyboard-only automation cannot pick a
  chapter yet.
- **Tool count stays 164.** Tests: 151 files, 1437 passed, 33 skipped.

## 0.0.113-alpha - 2026-11-21

- **`run_map_test` can run commands minutes into a match.** `schedule` takes
  `{ atSeconds, command }` entries; the harness writes `hsmcp_schedule.nut`, which spawns a
  `point_servercommand` and one `logic_timer` per entry, and `script_execute`s it. A command
  cannot contain a comma, a double quote or a newline, because `AddOutput` carries it
  comma-separated -- the generator refuses instead of writing a broken timer. Verified in
  game: four entries armed, markers at 62.7 s, 78 s and 92.8 s, `scheduleArmed: 4`.
- **Survival passed the Bronze threshold.** With `director_stop 1` applied 20 s after the
  start (waves stop, the timer keeps running) the round reached `04:50.24` against a
  `07:00.00` Silver Standard -- the Bronze bar is crossed, with the caveat that the last
  4.5 minutes had no waves. Tank waves were proven separately (tank at 65 s, wipe, restart).
- **Scavenge pickup is still open, and now it is clear why.** After `ForceScavengeStart` the
  dev map has only its 16 `weapon_scavenge_item_spawn` entities; no `weapon_scavenge_item`
  exists to be used, and a player has no `UseTarget` method, while `EntFire` on the classname
  does nothing. A pickup needs a map with a real scavenge goal.
- **Tool count stays 164.** Tests: 150 files, 1435 passed, 33 skipped.

## 0.0.112-alpha - 2026-11-21

- **A written `.pcf` renders now.** The bug was the child graph: the engine reads
  `children` as `DmeParticleChild` wrappers carrying `name` and a `child` element reference,
  while `Particle.export` wrote the system elements themselves. Such a file registers (no
  `unknown particle system`) and draws nothing. `write_particle` rebuilds every `children`
  array as wrappers and returns `childWrappers`. Proven in game: a stock `fire_01l4d.pcf`
  copied through `source`, shipped in an addon whose manifest excludes the stock file, drew
  fire from five `info_particle_system` entities -- the same run was empty before the fix.
- **Renamed copies render too.** `renames` and the wrapper fix together produce a system that
  draws; the earlier "registers but does not draw" report was this bug.
- **Stock survival maps start with a direct call.** `EntFire("director", ...)` only works on a
  map with an entity named `director` (the test map has one, stock maps do not);
  `ForceSurvivalStart()` called from the script starts the round on `c1m4_atrium` at once
  (`OnSurvivalRoundStarted: Survival started`). The `survival_*` wave convars are unknown
  commands in this build, and `director_stop 1` before the start prevents the round, so a
  4-minute bronze capture still needs a scheduled marker.
- **Scavenge on a stock map:** the player joined team 3 (infected) and
  `GetScavengeItemsRemaining()` returned 0, so a can pickup is still unproven; the test map's
  16/16 accounting remains the evidence for the mode.
- **Tool count stays 164.** Tests: 150 files, 1431 passed, 33 skipped.

## 0.0.111-alpha - 2026-11-20

- **`write_particle` can rename systems.** `renames: { "fire_barrel_big": "my_barrel" }` with
  `source` rewrites the name and every child reference, verified by reading the file back.
  The stock `name` option has to be rewritten too: `Particle.export` copies options over the
  element, so setting `particle.name` alone left the old name in the file.
- **Rename rendering is still open.** A renamed copy shipped in an addon with a manifest
  registered (no unknown-particle line) but eight entities in an eye-height ring drew nothing,
  while the stock system had rendered in the same room. Registration and rendering are
  different problems for a written file.
- **Survival waves run in game.** After `ForceSurvivalStart()`, a Tank arrived 65 s into the
  round (`Damage Taken from "Tank" - 98 in 5 hits`, `Tank Count = 0`), wiped the team, and the
  engine restarted the map. `[SURVIVAL]:` stage lines never appear because this install has no
  loose `survival.nut` (`Script not found (survival)`); the C++ director drives the waves.
  A 4-minute bronze run still needs an arena the bots can hold.
- **Tool count stays 164.** Tests: 150 files, 1431 passed, 33 skipped.

## 0.0.110-alpha - 2026-11-20

- **VScript event hooks run in game.** A `logic_script` entity with `"vscripts" "hookprobe"` in
  the compiled BSP loaded the file (`hsmcp_hookprobe executing script: hookprobe`) and
  `OnGameEvent_player_spawn` fired for userids 2-5; the same file run through `script_execute`
  registered no hooks. `EntFire("director", "RunScriptCode", ...)` already ran in the survival
  and scavenge probes.
- **`read_vscript` explains that split** with an `info` rule (`nut-event-hook-needs-entity`)
  instead of letting a file with `OnGameEvent_*` look ready for `script_execute`.
- **A particle `effect_name` is the bare system name.** `fire_barrel_big` renders; a
  `pcf/system` path such as `fire_01l4d/fire_barrel_big` logs `Attempted to precache unknown
  particle system` and draws nothing. Valve's own `c1m1_hotel` entities use
  `window_glass`/`emergency_light_strobe`. Both the stock map and the test map were watched
  rendering the fire once the prefix was gone.
- **`read_particle` keeps typed options.** Colours, vectors, quaternions and times used to be
  dropped (scalar-only), so reading a system and writing it back lost its colour and size
  initializers — the reason a rebuilt fire registered but stayed invisible. They now come back
  as `{ "type": "vector3", "value": [..] }`, which is the shape `write_particle` accepts.
- **`read_particle` takes `effectName`** and resolves a map's `effect_name` exactly, flagging
  the path form with the rule in `hint`.
- **Custom particle registration:** a `.pcf` shipped in an addon with a
  `particles/particles_manifest.txt` line registered its system (no unknown-particle line; the
  same map without the addon did report it unknown). A rebuilt copy registered but did not
  visibly draw, so `source` rewrites remain the supported way to copy a stock system.
- **Tool count stays 164.** Tests: 150 files, 1430 passed, 33 skipped.

## 0.0.109-alpha - 2026-11-19

- **Survival round started in game.** A probe called `ForceSurvivalStart()` through
  `EntFire("director", "RunScriptCode", ...)` on `hsmcp_test_m1`; the log shows
  `OnSurvivalRoundStarted: Survival started` and the screenshot shows the HUD timer at
  `00:07.44` against a 4:00 Bronze Standard. The full wave to bronze is not timed.
- **Scavenge round started and its item accounting is live.** The same path called
  `ForceScavengeStart()`; `OnScavengeRoundStarted: Scavenge started` and
  `GetScavengeItemsRemaining()`/`GetScavengeItemsGoal()` returned **16 / 16**, with the
  screenshot showing `SCORE 0 / 16` and the enemy team at 0. A gas-can pickup and score
  are still not automated.
- **The engine's mode scripts are absent as loose `.nut` here** (`Script not found
  (survival)` / `<map>_survival`); the C++ director starts and runs the round, which is
  why the scripted `[SURVIVAL]` stage lines are not the evidence. `check_modes` still warns
  that the test map has no radio trigger: `ForceSurvivalStart` is not the player-facing path.
- **Tool count stays 164.** Tests: 150 files, 1428 passed, 33 skipped.

## 0.0.108-alpha - 2026-11-19

- **`check_modes` checks a mode against the maps it lists.** Scavenge needs
  `weapon_scavenge_item_spawn` (an error when none); survival needs a
  `trigger_finale`/`func_finale` (a warning, because the timer otherwise stays at `00:00`);
  a coop/versus campaign whose last chapter has neither a finale nor an `info_changelevel`
  has no ending; a map repeated inside one mode and a mode name outside
  coop/versus/survival/scavenge/mutation*/community* are warnings. A BSP that exists only in
  a VPK is reported as skipped, never passed.
- **Verified against the test campaign:** scavenge finds 16 gas-can spawns; survival on
  `hsmcp_test_m1` is flagged for having no trigger; the coop last chapter (`hsmcp_test_m2`)
  has a finale; an unknown mode and a duplicate map are reported.
- **Long in-game proof:** Steam stayed logged on long enough for the custom finale to run
  through stages 1-6, `HSMCP_ESCAPE_STARTED`, `HSMCP_ESCAPE_TOUCHED` and `Map: credits`.
- **A capture failure no longer loses a matched run.** `run_map_test` catches a
  `captureWindow` error after the last marker and returns `captureError` instead of throwing:
  the game window closing on the credits map was turning a successful timeline into an
  exception.
- **Tool count: 164.** Tests: 150 files, 1428 passed, 33 skipped.

## 0.0.107-alpha - 2026-11-19

- **`read_vscript` checks a `.nut` as Squirrel without running it.** The source is stripped
  of comments and string literals first, so `printl("the end")` is not a Lua terminator. Lua
  habits (`end`, `elseif`, `then`, `nil`, `~=`, `--[[`) are errors; unbalanced
  `{}`/`()`/`[]` name the line the delimiter opened on; `IncludeScript` with a `.nut`
  extension or a `scripts/vscripts/` prefix is a warning, as is a missing load banner.
- **The DirectorOptions custom-finale table is checked.** `A_CustomFinale_StageCount` must
  be positive; every stage up to it must exist (an error when missing); a stage beyond it or
  a stage type the file never defines is a warning; a missing `OnBeginCustomFinaleStage` is
  information. An unknown DirectorOptions key is information, not an error, because the
  catalogue is not the engine's full set.
- **`write_vscript` uses the same checker** and refuses a script that would not compile.
  The old `local` warning was wrong — `local` is valid Squirrel — and is gone.
- **Tool count: 163.** Tests: 149 files, 1425 passed, 33 skipped.

## 0.0.106-alpha - 2026-11-19

- **FBX shape keys become Source flexes.** `fbx_to_dmx` reads `BlendShapeChannel` and its
  `Shape` geometries, computes the delta as the shape's `Vertices` minus the base mesh at
  the control points its `Indexes` names, and writes a DMX model source with one
  `DmeVertexDeltaData` and `DmeCombinationInputControl` per channel plus the combination
  operator. A channel with several in-between shapes exports the largest `FullWeights`
  entry and reports the others.
- **The DMX graph is now shared, not copied.** `dmxmodel.py` holds the Scene/joint/mesh/
  delta/operator assembly and the `deltaStateWeights` detail that makes `studiomdl` write a
  rule; both `gltf_to_dmx` and `fbx_to_dmx` build the same neutral data and call it.
- **Proven with the real compiler:** a skinned triangle with one `BlendShapeChannel` "Smile"
  and three +4 deltas produces a DMX with `DmeMesh`/`DmeVertexDeltaData`/
  `DmeCombinationInputControl`/`DmeCombinationOperator`, and `studiomdl` reports
  `flexdesc`, `flexcontroller` and `flexrule` all at least 1. The QC needs no `$flex`.
- **Tool count: 162.** Tests: 148 files, 1416 passed, 33 skipped.

## 0.0.105-alpha - 2026-11-19

- **FBX collision models.** `fbx_to_smd` takes `collision: "box"` or `"hull"`, the same
  choice as `gltf_to_smd`. The AABB honours `collisionThickness` on a flat axis; the hull is
  outward-wound and falls back to the box with `fbx-hull-fallback` when the mesh is
  coplanar. The shape builder is shared with the glTF path, not copied.
- **The QC gets the collision model.** With the `qc` block the generated file carries
  `$collisionmodel "<name>_phys.smd" { $mass N }`, and the result reports the shape's
  `mode`, triangle count, bounds and byte-verified write.
- **Proven with the real compiler:** a tetrahedron with `collision: "hull"` produces four
  hull faces, `studiomdl` writes `tetra.phy`, and `read_model_info.hasPhysics` is true; a
  flat triangle reports the box fallback and its warning; the QC round-trips `$mass 25`.
- **Tool count stays 161.** Tests: 148 files, 1414 passed, 33 skipped.

## 0.0.104-alpha - 2026-11-19

- **A window is closed only when the process list says it is gone.** `run_hlmv` and
  `open_in_hammer` waited for nothing: they spawned `taskkill` and set `closed: true`
  unconditionally, which is how two HLMVs survived their own calls. The kill is now
  synchronous, retried, and verified; the results carry `closed` and `closedProcesses`.
  `run_map_test` does the same for the game and returns `gameClosed`.
- **Only windows the tool opened are touched.** The pids are snapshotted immediately before
  the launch; a person's HLMV or Hammer is never a target. Hammer is asked to close through
  its window first (so it records a clean shutdown) and force-killed only if it remains.
- **A server stopped mid-call no longer leaves a window behind.** `<stateDir>/windows.json`
  records a window before its launch and drops it after a verified close; the MCP server
  sweeps the ledger at startup. `<stateDir>` is `.hammer-mcp` by default.
- **Evidence:** `run_hlmv` on a stock model returned `closed: true`,
  `closedProcesses: [pid]`, empty before/after lists and an empty ledger; a simulated crash
  (HLMV started by hand, recorded, then swept) closed the pid and cleared the ledger;
  `open_in_hammer` closed the preview map's editor with the same result.
- **Tool count stays 161.** Tests: 148 files, 1410 passed, 33 skipped.

## 0.0.103-alpha - 2026-11-19

- **FBX animations are exported.** `fbx_to_smd` follows `AnimationStack -> AnimationLayer
  -> AnimationCurveNode -> AnimationCurve` (the channel links are `OP` with `d|X`/`d|Y`/
  `d|Z`), samples the keys at `animationFps` and writes one SMD per stack beside the bind
  SMD, with the same node table. The `qc` block adds a `$sequence` per animation.
- **Frames are converted into the bind parent's space**, not the rest parent's:
  `inverse(bind_world[parent]) * anim_world[bone]`. A cluster bind pose that differs from the
  node rest pose therefore does not make the model jump at frame zero.
- **Time is KTime ticks** (46,186,158,000 per second) or seconds for an ASCII export; the
  range decides. Cubic tangents are sampled linearly, the same documented fallback the glTF
  path uses for `CUBICSPLINE`. Multiple layers are merged and reported; a curve target
  outside the skeleton is skipped with `fbx-animation-target`.
- **Proven with the real compiler:** a two-key translation curve becomes a 31-frame SMD at
  30 fps; bone 1 is at X=0 on frame 0 and X=10 on frame 30; `studiomdl` compiles the bind
  SMD and the animation SMD through one QC and `read_model_info` reports `sequenceCount >= 2`.
- **Blend shapes are still counted, not exported**: SMD has no morph target, and flexes
  belong to the glTF/DMX path.
- **Tool count stays 161.** Tests: 147 files, 1406 passed, 33 skipped.

## 0.0.102-alpha - 2026-11-19

- **`run_map_test` now proves an ordered sequence, not one line.** `markers` is a list of
  `{name, pattern, withinSeconds}` assertions searched one after another from the end of the
  previous match. The result carries a `timeline` (the line and time for each step) and
  `missing` (the first step that did not happen and everything after it). A `Loading:` line
  can no longer satisfy a later finale step.
- **The commands trap is documented and worked around.** `cfg/listenserver.cfg` runs at
  server start, before the map's entities exist, so `ent_fire finale ForceFinaleStart` there
  does nothing. A probe installed with `scriptsDir` and started by `script_execute` uses
  VScript `EntFire(..., delay)` to act after spawn; `point_servercommand` runs `sb_add` and
  `director_start` the same way. The probe must be written without a BOM.
- **`via: "steam"` launches through `steam.exe -applaunch 550` without `-insecure`**, waits
  for the game process and captures it. That is the normal-client path; on this machine it
  still drops at about two minutes with `STEAMAUTH failure code 8` / `No Steam logon`, so a
  long finale remains blocked by the Steam account rather than by the launcher.
- **Evidence from the live run:** with a probe adding survivor bots and starting the
  Director, `Allowing spawning` appeared at 93 s with the survivor in the finale area; the
  client dropped before the 90 s finale could finish. The marker harness reported exactly
  that timeline and the missing finale steps.
- **Tool count stays 161.** Tests: 147 files, 1405 passed, 33 skipped.
## 0.0.101-alpha - 2026-11-19

- **FBX is read natively, both encodings.** `read_fbx` describes a binary 7.x or ASCII file
  (axes and units, models, geometries, materials, bones, skins, clusters, animation stacks)
  and `fbx_to_smd` writes the SMD `studiomdl` accepts. The parser is ours: the 7.x record
  layout, the zlib-compressed property arrays, the polygon-index sign bit and the ASCII
  grammar are read directly, with no SDK or third-party importer.
- **The conventions are the ones that make a rig correct.** The bind pose comes from each
  cluster's `TransformLink` rather than node TRS (the rest pose), the hierarchy is written
  parent-first, weights that do not sum to 1 are normalised, and UVs are flipped to cancel
  SMD's own inversion. `axis: "auto"` follows `UpAxis`; `scale` is a deliberate flag because
  FBX centimetres and Source inches are not the same number, and `UnitScaleFactor` is
  reported either way.
- **Omissions are reported, not hidden.** Animation stacks and blend-shape deformers are
  counted and named; SMD has no morph target and this path writes the bind pose only.
  Binary 7.5's 64-bit records are attempted with a warning rather than guessed at.
- **`preview_model` closes the blank-HLMV gap.** It tries HLMV, measures the luminance
  spread of the captured viewport, and when the canvas is a flat rectangle it builds a
  sealed dev-textured room sized from the model, places the model's lowest point on a
  pedestal, compiles it, generates a nav and captures the real game window. The measurement
  is a new PNG reader on the TypeScript side: all five filters, grey/RGB/RGBA.
- **Live Hammer edits check their address before touching the editor.** The shell channel
  addresses an entity by class + origin, with no id, so `hammer_live_edit` now reads the
  saved VMF first and refuses a create where that class already sits, or an edit where the
  address is empty or shared by several entities. It also states the undo truth: create,
  delete and rotate are in Hammer's history, a keyvalue change is not.
- **`read_qc` checks command structure.** A catalogue of the common QC commands validates
  argument counts, numeric bounds, `$bodygroup`/`studio`/`blank`, `$sequence` block numbers
  and events, and reports unknown commands as warnings. It was run over 49 real viewmodel
  QCs from the wild: zero errors and zero unknown commands.
- **Tool count: 161.** Tests: 146 files, 1402 passed, 33 skipped.

## 0.0.100-alpha â€” 2026-11-19

- **Convex-hull collision for glTF.** `gltf_to_smd` now takes `collision: "hull"` beside
  `"box"`: the model's vertices go through `srctools.math.quickhull`, every face is checked
  against the centroid and its winding flipped until it points outward, and the result is
  written as the `<name>_phys.smd` for `$collisionmodel`. A shape a box would approximate
  with a lot of empty space now has a hull that follows it.
- **Flat models fall back, loudly.** A triangle or any coplanar cloud cannot bound a volume;
  the converter writes the box instead and reports why. The result's `mode` says `"hull"` or
  `"box"`, so a caller never has to guess which physics shape it got.
- **Proven with the real compiler.** A tetrahedron produces a four-face hull and compiles to
  a `.phy` with `hasPhysics: true`; the flat case is checked for the box fallback and its
  warning. Tool count stays 158.
- Tests: 143 files, 1378 passed, 33 skipped.

## 0.0.99-alpha â€” 2026-11-19

- **Particle files can be written, not only read.** `write_particle` builds a binary `.pcf`
  from JSON systems, or rewrites an existing loose/game-relative file through `source`.
  Systems carry options, renderers, initializers, emitters, forces, constraints, operators
  and child references; options are plain JSON scalars or `{type, value}` for an explicit DMX
  type. Child names must exist in the same file; the writer points at the same elements
  rather than copying them.
- **The writer is checked by a stock file, not only by its own fixture.** The test rewrites
  `particles/fire_01l4d.pcf` (59 systems) and parses the result back; every system keeps its
  children, materials and operator counts. A dangling child in a stock file cannot be
  referenced, so it is dropped and named in `warnings`.
- **Format.** A PCF is a DMX with `format=pcf`; version 2 is the L4D2 default, version 1 is
  accepted. The file is parsed back with the PCF reader before the call returns, and
  `verified` reports whether the system set survived. In-game rendering is not yet judged.
- **Tool count: 158.** Tests: 143 files, 1376 passed, 33 skipped.

## 0.0.98-alpha â€” 2026-11-19

- **glTF shape keys now become Source flexes.** `gltf_to_dmx` writes a DMX model source with
  one `DmeVertexDeltaData` per morph target and the `DmeCombinationInputControl` /
  `DmeCombinationOperator` that pair them. L4D2's `studiomdl` reads the DMX directly and
  registers `flexdesc`, `flexcontroller` and `flexrule` records; the QC needs **no `$flex`
  command**. The bind skeleton comes from `inverseBindMatrices`, the mesh is one body with
  face sets per material, and the optional QC block points `$body`/`$sequence` at the DMX.
- **The rule trigger was found by A/B compiling.** `DmeMesh.deltaStateWeights` and
  `deltaStateWeightsLagged` must carry one `(0, 0)` per control. With empty arrays the
  compiler writes the flex payload but `flexruleCount` is 0, so nothing drives the flex;
  with the weights it writes one rule per control. `controlValues` use the
  BlenderSourceTools `(0, 0, 0.5)` triple. The test compiles the generated DMX with the real
  `studiomdl.exe` and asserts all three header counts.
- **The result is inspectable.** `read_model_info` now reports `flexdescCount`,
  `flexcontrollerCount` and `flexruleCount`, so a compiled morph model can be checked
  without parsing the MDL by hand.
- **Scope, stated honestly.** Position deltas only; normal deltas are legal but empty arrays
  compile. A delta beyond Â±8 is clamped by studiomdl and reported. Animations remain the SMD
  path (`gltf_to_smd`): a DMX animation log is a separate piece of work.
- **Tool count: 157.** Tests: 143 files, 1374 passed, 33 skipped.

## 0.0.97-alpha â€” 2026-11-19

- **`brush_to_model`: the Propper++ path without the plugin.** A VMF brush is already a
  closed convex volume; `checkVmfSolids` rebuilds its hull and `orderedLoop` winds each
  face, so the converter triangulates the brush's own geometry rather than reimplementing
  plane clipping. The VMF `uaxis`/`vaxis` become UVs (divided by `textureSize`, V inverted
  for SMD), the material directories become `$cdmaterials`, and the origin can stay in
  world space or move to the brush's centre/base. `collision: "brush"` uses the brush
  itself (`$concave` for several solids), `box` writes an AABB, `none` omits the `.phy`.
- **The whole path is proven.** The test writes a 64Ã—64Ã—64 box through the repository's
  own VMF writer, converts it, checks the UVs against the `uaxis` formula, compiles it with
  the game's `studiomdl.exe`, and reads back one bone, one skin and `hasPhysics: true`.
  Displacements are refused rather than flattened.
- **Tool count: 156.** Docs: `references/mapping/brush-to-model.md`; the coverage table's
  Propper++ row is no longer a gap. Tests: 142 files, 1371 passed, 33 skipped.

## 0.0.96-alpha â€” 2026-11-19

- **The licence is GPL-3.0-only again, and the README says it plainly.** At the owner's
  request the `or-later` grant was removed; the front page now carries only
  `GPL-3.0 â€” Copyright (C) 2026 NexPG`, the link to `LICENSE`, and the Valve disclaimer.
  The upstream MIT notices are untouched and remain compatible with GPLv3. `package.json`,
  `third_party/NOTICE`, `NOTICES.md`, `CONTRIBUTING.md`, `third_party/README.md` and the
  skill all state the same licence.
- **glTF animations become SMD sequences.** `gltf_to_smd` now samples every animation at
  `animationFps` (default 30) and writes `<name>_<animation>.smd` with the same bone table
  as the bind pose. `STEP` and `LINEAR` are exact; `CUBICSPLINE` is resampled linearly and
  says so. Animation-only bones are added to the bind SMD even when export is off, so the
  two files cannot disagree. `animations` filters by name.
- **Collision for compiled props.** `collision: "box"` writes `<name>_phys.smd`, a closed
  box around the model (with `collisionThickness` as a minimum on flat axes), and the QC
  block adds `$collisionmodel` with `$mass`. `buildQc` gained a first-class `collision`
  spec. A `prop_static` compiled from the result has a `.phy` and is solid; the test
  compiles one and checks `read_model_info.hasPhysics`.
- **Morph targets are named in the report.** SMD still cannot carry them, but
  `read_gltf` returns `mesh.extras.targetNames` and `gltf_to_smd` lists the ignored names,
  so the follow-up (one SMD/DMX per expression) is planned rather than guessed.
- **The physics material matters.** The generated collision SMD uses the material name
  `phys`: with the render fallback `debug/debugempty`, studiomdl reports a collision
  volume and then writes a 0-byte `.phy`. The end-to-end test compiles the box and asserts
  both the `.phy` file and `hasPhysics`.
- **Tool count: 155** (no new tool names; the new work is in the existing glTF and QC
  tools). Tests: 141 files, 1366 passed, 33 skipped.

## 0.0.95-alpha â€” 2026-11-19

- **glTF/GLB is now a model source.** `studiomdl.exe` has no glTF loader (its extension
  probe chain is `fbx xml obj vta phys sma smd mpp dmx vrm`), so a Blender `.glb` used to
  mean a DCC re-export or a separate compiler. `read_gltf` describes the document without
  converting it; `gltf_to_smd` reads `.gltf` and `.glb` itself â€” JSON, GLB chunks, external
  and `data:` buffers, interleaved and sparse accessors, triangle lists/strips/fans, node
  TRS or matrices, skins with `inverseBindMatrices` and `JOINTS_0`/`WEIGHTS_0` â€” and writes
  the SMD through the same writer the rest of the toolkit uses. The optional `qc` block
  writes the QC in the same call.
- **The conventions are the ones a Source model needs.** Geometry stays in mesh space by
  default (what a Blender `+Y up` export writes), the bind pose comes from the IBM rather
  than node TRS (the "Use Rest Position Armature = off" case), and SMD V is inverted so
  studiomdl's parse-time inversion leaves the glTF UV intact. `axis`, `useNodeTransforms`,
  `parts`, `scale` and `flipV` cover hand-authored files. Morph targets and animations are
  counted and reported, not silently dropped: SMD has no morph target and this path writes
  one bind-pose frame.
- **Proven against the real compiler.** The test suite converts a static and a skinned glTF,
  runs the game's own `studiomdl.exe`, and reads the result back with `read_model_info`
  (the skinned model keeps both bones). That test also documented an official behaviour
  that looks like a bug: `$staticprop` rotates the geometry by studiomdl's default
  `Rz(90Â°)`, so a compiled static prop's hull is rotated relative to its SMD.
- **`$modelname` convention fixed.** `studiomdl` resolves `$modelname` inside the game's
  `models/` directory, as the stock QC prefabs do (`props_junk/box.mdl`). `write_qc` now
  strips a leading `models/`, the QC reader warns about that prefix instead of warning
  about the correct form, and `run_studiomdl` finds a model an old QC wrote to
  `models/models/...` and says why.
- **Tool count: 155.** Parity, the skill catalogue and the test layout are updated in the
  same commit.

## 0.0.94-alpha â€” 2026-11-19

- **The project is now GPL-3.0-or-later.** The `only` was removed at the owner's request.
  Everything still borrowed is MIT (Sycatle, EpicMorg, sourcepp), which is compatible with an
  or-later GPL. `package.json`, README, `CONTRIBUTING.md`, `third_party/NOTICE`,
  `NOTICES.md`, `third_party/README.md` and the skill now state **GPL-3.0-or-later**, and
  README carries the standard "either version 3, or any later version" grant. The MIT
  notices are untouched and still govern the MIT portions.
- **`edit_static_props`: baked props can be fixed without a recompile.** `read_static_props`
  could only say what vbsp baked; this changes skin, solidity, tint, scaling, fade, renderfx
  or flags, or adds/removes a prop. The BSP is rebuilt through srctools and read back. A
  model/origin change or an addition is reported as leaving the compiled `visleafs` stale
  until vbsp runs again; that is a culling warning, not a silent one.
- **Tool count: 153.** Parity, the skill catalogue and the test layout are updated in the
  same commit.

## 0.0.93-alpha â€” 2026-11-19

- **A second pass over the upstream projects, this time module by module, not
  tool by tool.** The first pass removed the trees and kept the tool surface. This pass
  took the mechanisms the libraries had that the tools did not expose:
  - **BSP lumps, including LZMA.** `read_bsp_lump` / `write_bsp_lump` address all 64 lumps
    by name or index and decode Source's `LZMA` framing (`signature, size, packed size,
    properties`), which the old reader could only detect and refuse. A compressed entity
    lump is now readable and writable, and the write preserves the L4D2 field order.
  - **VTF compression and conversion.** Our own DXT1/DXT5 range-fit encoder fills the gap
    srctools leaves (`Saving DXT1 not implemented`); `write_vtf` now takes DXT, and
    `convert_vtf` rebuilds an existing texture in another format or size, verified by
    measured error. `extract_vtf` turns any `.vtf` into a PNG â€” including a texture no VMT
    names, and a chosen face of a cubemap â€” which the material preview could not do.
    `write_cubemap_vtf` assembles six named PNG faces into one cubemap and verifies each.
    `write_vtf` sets the one-bit/eight-bit alpha flag and average reflectivity, so a
    transparent texture is not left flagged opaque and a bright one does not light its
    surroundings as black.
  - **Deep model data.** `read_model_info` now returns per-sequence activities, flags,
    events (type, cycle, options) and bounds; hitbox geometry on the bone each box
    follows; the model name inside each body part; per-skin material tables; `$cdmaterials`,
    surfaceprop, mass, eye/illumination positions, view bounds and `$includemodel`. These
    are mdlpp's structs, not a label list. `dmx_to_smd` converts a DMX model export to
    SMD with its skeleton: node hierarchy, local bone transforms as XYZ Euler angles and
    per-vertex joint weights. The convention is verified against BlenderSourceTools' own
    cube export â€” node names, parents, all four rotations, twelve triangles, UVs and
    weights match. A file without a joint list falls back to one root bone and says so.
  - **Soundscripts.** `read_soundscript` reads one file or the whole game through
    `scripts/game_sounds_manifest.txt`, follows `#base`/`#include`, reports first-definition
    duplicates, strips sound characters and says whether each wave exists (13k names in the
    stock game). `write_soundscript` appends one block without rewriting the file, and
    refuses a name already defined. `convert_wav` now scales an existing `smpl` loop to the
    new sample rate and writes it back (`keepLoop: false` drops it), so conversion is not
    lossy for looped ambience.
  - **QC variables and macros.** `read_qc` expands `$definevariable` and `$definemacro` at
    token level: bare tokens only, first definition wins (as studiomdl does), `\\` continues
    a macro body, and definitions in an included `.qci` are visible to the file that included
    it. A real QC that used to read as unknown `$Macro` now reads as the statements it
    produces. `$pushd` / `$popd` / `$cd` move scriplib's `qdir`, so an `$include` after
    `$pushd "parts"` resolves inside `parts/`, not next to the including file.
- **Windows close themselves.** `run_hlmv` now defaults `close: true` for every call (not
  only screenshots), with a short pause so a person can see the window before it goes.
  `close_windows` is the cleanup primitive for anything left behind: it lists HLMV/Hammer/
  game windows, closes HLMV and the game outright, and asks Hammer to close without
  force-killing an unsaved map unless `force: true`. A live run closed seven leftover HLMV
  windows that had piled up from earlier previews.
- **The licence record is unchanged and still honest.** No new upstream tree was copied;
  these are implementations in TypeScript and Python. sourcepp and EpicMorg remain credited
  for the translations that predate this pass.
- **Nav connections can be edited as data.** `edit_nav_connections` adds, removes or
  replaces the directional links of an area. Links are length-variable, so it rebuilds only
  the four count+id lists and copies the rest of every area record verbatim; `add`/`remove`
  mirror the opposite direction by default, `symmetric: false` is the one-way case, and the
  result is read back area by area. This is the repair path for bots that will not cross a
  threshold, without opening the game console.
  - **Soundscapes.** `read_soundscape` reads one file or the game's `scripts/soundscapes_*.txt`:
    looping beds, random one-shots, child scapes, DSP, fadetime and soundmixer, with every
    wave checked under `sound/`. `write_soundscape` appends one definition for an
    `env_soundscape`, refuses a duplicate name, and parses the result back.
  - **Particles.** `read_particle` opens a `.pcf` and lists every system with its child
    references, operator functions and the materials it draws. `read_game_content` only
    named files; a map pointing `info_particle_system` at a missing system renders nothing,
    and the compiler never complains. Verified against `fire_fx.pcf`: `fire_medium_01`
    carries the expected three children and material.
- **Tool count: 152.** Parity, the skill catalogue and the test layout are updated in the
  same commit.

## 0.0.92-alpha â€” 2026-11-19

- **The project is TypeScript, Python and PowerShell only.** The vendored source trees
  (sourcepp C++, EpicMorg C#) are gone. Nothing imported them at
  runtime, so no tool was lost with them; the toolchain that ships is the same `dist/` plus
  the Python sidecar.
- **What replaced the trees is capability, not a gap.** Seven new tools close the work the
  libraries made possible but the toolkit could not do:
  - `read_dmx` / `write_dmx` â€” the Blender/Crowbar datamodel, binary v4 and KeyValues2, as
    a JSON tree with element references kept as references (a model graph is cyclic).
  - `read_smd` / `write_smd` â€” skeleton, frames, materials, triangles, per-vertex weights and
    the diagnostics studiomdl otherwise reports only as a failed compile. With `write_qc`
    and `run_studiomdl`, a simple prop can be authored without a DCC.
  - `write_vtf` â€” PNG â†’ VTF 7.4 with a full mip chain, no VTFCmd. PNG decoding is our own
    (every filter and colour type is tested), and the pixels are compared after a round-trip.
  - `read_wav` / `convert_wav` â€” a sound's format, duration and loop, and a conversion to the
    16-bit PCM mono/stereo at 22050/44100 Hz that L4D2 actually decodes. Peak and RMS are
    reported, so a silent or clipped source is visible before it ships.
- **Licences got smaller, not looser.** sourcepp and EpicMorg stay, narrowed to the files
  that are genuinely
  translations â€” deleting a vendored tree removes the copy, not the obligation.
- **The registry is data, not code.** `src/hammer/data/hammers.json` stays where it is and
  the sidecar reads it directly.

## 0.0.91-alpha â€” 2026-11-19

- **`src/` tidied: no dumped trees, no stray files.** The C++ trees now use `include/` +
  `source/` instead of `src/` inside `src/`, with the
  five CMake references updated. One icon serves both C# projects (`csharp/assets/`), and the
  Hammer build registry moved out of the C# code tree to `src/hammer/data/`.
- **The layout is documented where it is decided.** `src/README.md` now says why the native
  trees keep their internal layout (the build systems require it), what is not imported
  (submodules, upstream docs), and that non-code data gets a `data/` directory beside
  the language directories.
- **Nothing was built here and nothing pretends otherwise.** No CMake or dotnet is
  installed; `build/` and `obj/` stay ignored.

## 0.0.90-alpha â€” 2026-11-18

- **`run_pakfile_add`: the pakfile is written here, not by `bspzip`.** A map's embedded
  archive is a plain ZIP, so adding a material, model or sound no longer needs the game's
  `bspzip` and a Steam install. The archive is appended and lump 40 is moved to it, so the
  map's other lumps are untouched; the result is read back and every entry compared with the
  file it came from.
- **L4D2's lump descriptor order is respected.** Left 4 Dead 2 writes `version, offset,
  length` where every other Source game writes `offset, length, version`. The writer goes
  through the shared header reader, so it cannot patch the wrong slot and leave a map that
  reads from nowhere. Verified on the probe map, which is L4D2-layout.
- **The ZIP reader and writer are ours.** Stored and deflated entries, a fixed timestamp and
  sorted names, so the same input produces the same bytes; anything else â€” encryption,
  ZIP64, a data descriptor â€” is refused rather than written wrong.

## 0.0.89-alpha â€” 2026-11-18

- **The useful upstream implementations are now in the project.** They are filed by
  module, not by repository: `src/formats/cpp/` (sourcepp: bsppp, vpkpp, vtfpp, mdlpp,
  kvpp, dmxpp) and `src/hammer/csharp/` (the Hammer shell channel, the Core library and the
  build registry). Upstream READMEs, CI, docs, brand images and benchmark suites are not
  imported; the code and the build manifest of each language are.
- **`hammer_status` reports the exact build.** The editor's DLL is hashed and looked up in the
  vendored registry of 182 known builds: Hammer++ 8873 L4D2 x86 is identified as
  `hpp-l4d2-8873-x86`, with its shell support. An unknown build is `null`, not a guess.
  `modified` is `true` only when the title carries `*`; Hammer++ 8873 never marks it, so
  `null` is the honest answer and the schema says so.
- **Licences travel with the code.** Each vendored tree keeps its own `LICENSE`; the
  canonical copies and the record are in `third_party/`. `third_party/NOTICES.md` says which
  path belongs to which project and what it provides.
- **Build output is ignored.** `build/` and `obj/` are gitignored; none of these
  trees is built on this machine (no CMake or dotnet), and the TypeScript server does
  not import them.

## 0.0.88-alpha â€” 2026-11-18

- **Nav areas: read and edit.** `read_nav_areas` lists every area of a `.nav` with its
  attributes, L4D2 spawn attributes, place, centre, size and connection counts;
  `write_nav_areas` sets or clears those attributes in place. The parser handles L4D2's
  version 16 / sub-version 14 record, including the population string and the per-area spawn
  block, and was verified against the real `c1m1_hotel.nav`: 1 582 areas, population
  `c1streets`, 551 areas with spawn attributes.
- **Edits are masks, not replacement values.** An area can carry bits this project has no
  name for (`MOSTLY_FLAT`, `OUTSIDE_WORLD`), and writing a value built only from known names
  would clear them. A patch touches the named bits only, writes a `.bak` first, and reads the
  file back to prove the change landed. A wrong edit is one backup away from undone.
- **Runtime dependencies are no longer listed as borrowed code.** `srctools` is installed
  from `requirements.txt` and imported; its source is not vendored, modified or
  redistributed, so `third_party/NOTICES.md` no longer lists it and its licence file is gone.
  The notices now cover only what was taken into the source tree.

## 0.0.87-alpha â€” 2026-11-18

- **One project, modules by meaning.** `src/` is now eleven semantic modules â€” `hammer/`,
  `maps/`, `models/`, `textures/`, `nav/`, `scripts/`, `campaigns/`, `assets/`, `packages/`,
  `formats/`, `core/` â€” and a module that holds more than one language splits by language
  underneath (`typescript/`, `python/`). Those directories carry source only: no assets, no
  licences, no upstream trees.
- **No vendored repositories.** The parked upstream trees are gone.
  Everything used from them is ported into the module it serves and credited in
  `third_party/NOTICES.md` with the upstream file name; the trees could not be built here and
  nothing imported them.
- **`third_party/` is the paperwork.** `NOTICES.md`, `NOTICE` and `licenses/` â€” one verbatim
  licence file per borrowed work, linked from the notices. No code, no build files, no READMEs
  from upstream.
- **Credits live in the notices.** The README's credits table is a single link to
  `third_party/NOTICES.md`; the notices list only projects whose code or data is actually
  used, and say exactly what was taken.
- **The sidecar moved with its modules.** `src/core/python/main.py` is the entry point and
  puts every `src/*/python/` on `sys.path`, so each module keeps its own Python files. The
  client resolves the script through the repository root instead of a `sidecar/` sibling.
- **A refactor that had lost code was rebuilt, not patched.** The previous attempt dropped
  exports from `space/rooms.ts` and left 295 type errors; the tree now compiles with none and
  the full suite passes (120 files, 1 263 tests).

## 0.0.86-alpha â€” 2026-11-18

- **VPK without `vpk.exe`.** `read_vpk`, `run_vpk_extract` and `run_vpk_build` read and write
  Valve Pak directly: version 1 is written, versions 1 and 2 are read, numbered archives
  (`_000.vpk` â€¦) are followed, and every entry's CRC is checked against the bytes on request.
  Verified against the real `pak01_dir.vpk`: eight sampled entries read with matching CRCs.
  `run_vpk_pack` still drives `vpk.exe` so the two writers can be compared.
- **`read_vtf`.** A `.vtf` header as data â€” version, size, flags, frames, format and whether
  it is a cubemap â€” from 80 bytes. The format table is the full `IMAGE_FORMAT_*` enum from
  sourcepp/vtfpp, not the six entries that turn up in map content.
- **`read_compile_sequences`.** What the user's editor does when they press F9: the binary
  `CmdSeq.wc` (804-byte records), Hammer++'s KeyValues `hammerplusplus_sequences.cfg`, and
  Strata's `cmdseq.wc`. Reports every step with its enabled flag, executable, parameters and
  compiler stage, so a difference from `run_compile` is a fact rather than a mystery. Layout
  ported from Hammer-MCP's `CompileSequences`; a truncated file is refused instead of
  half-read.
- **`read_model_info` gains the parts of a model that placement depends on.** Attachments
  with the bone each follows, body parts and hitbox sets, read from the header the way
  `mdlpp` documents it. `mstudioattachment_t` is 92 bytes in L4D2 â€” not the 60 of the older
  SDK â€” and the name index is relative to the entry itself; verified against
  `v_models/v_rifle.mdl`, which reports 7 attachments over 65 bones with the muzzle 35 units
  forward of the origin.
- **`read_qc` / `write_qc`.** The model source file, the gap between `run_studiomdl` and
  `read_model_info`. The reader follows `$include` with cycle detection and scriplib's
  16-deep limit, and reports the faults that stop a compile: no `$modelname`, no `$body`, a
  sequence declared twice, a model path outside `models/`. It keeps a backslash literal, as
  the grammar does. The writer builds a well-formed QC from parameters and reads it back
  through its own parser before reporting success.
- **`read_autosaves` / `restore_autosave`.** Hammer writes `<map>_NNN.vmf_autosave` into a
  folder the user picked, in one of three places depending on the editor: Hammer++'s
  `hammerplusplus_settings.ini`, the registry key stock Hammer uses, or nowhere. The tools
  find that folder, match autosaves to their map through `versioninfo.originalname` (two maps
  in different folders can share a base name), say which one is newer than the saved `.vmf`,
  and write it out as a normal `.vmf` without touching the original. Layout and locations
  ported from Hammer-MCP's `Autosaves`.
- **`read_vmt` / `write_vmt`.** The file between a face and its texture: shader, parameters,
  `Proxies` and `patch` blocks, `%compile*` flags and the textures it names. Parameter names
  are matched case-insensitively, as the engine does; a missing closing brace is repaired and
  reported, because shipped Valve materials contain them. Behaviour ported from Hammer-MCP's
  `VmtMaterial`. Checked against 300 real materials from `pak01_dir.vpk`: 0 failures, and
  every `patch` has its `include`.
- **Upstream source vendored.** `vendor/sourcepp` (MIT) keeps the upstream tree, its
  `LICENSE` file and the exact build commands, so the algorithm reference survives the
  removal of the temporary `.3d-projects` folder. Nothing there is compiled or published.
  `THIRD-PARTY-NOTICES.md` records the copyright lines and moves the project to the used
  table, and adds three SourceMod navigation repositories as reference-only, including why
  `sourcepawn-navmesh`'s GPL cannot cover the parser it credits to an unlicensed upstream.

## 0.0.85-alpha â€” 2026-11-18

- **Live Hammer / Hammer++ editing.** The editor's built-in shell channel
  (`Worldcraft_ShellMessageWnd`) is now available as `hammer_status`, `hammer_live_edit` and
  `hammer_menu`. The port creates/deletes/rotates point entities, sets keyvalues and runs
  Save, Undo, Redo, Run Map and Check for Problems in the open editor. Verified on Hammer++
  8873 x86: a `light` was created at `0 0 128`, saved, and read back from the VMF.
  Ported from **Hammer-MCP** (MIT); attribution is in `THIRD-PARTY-NOTICES.md`.
- **Licence compliance is rule 0.** `CONTRIBUTING.md`, `NOTICE`, `README.md`, `SKILL.md` and
  the new `THIRD-PARTY-NOTICES.md` state that every borrowed code, FGD, model or data file
  needs a compatible licence, its copyright/permission notice, a source header and a record.
  No licence means no copied code; reference only.
- **Optional external FGD.** `read_fgd_class` and `read_vmf_lint` accept an extra `fgd` path.
  The FGD loader tolerates community extensions such as `vector3` instead of rejecting the
  whole file. This lets a user load `L4D2-FGD-Edits` or another pack from disk without this
  repository redistributing it.
- **`open_in_hammer` waits longer and closes gracefully.** A forced `taskkill` sets
  Hammer++'s "did not shut down correctly" recovery flag; the tool now closes the main window
  first and only force-kills if it will not exit.
- **`run_map_test` waits for the old client to leave the process table** before launching;
  `taskkill` returns before the process is gone and the next `+map` could reach a dying client
  with an empty log.
- **Research reports live in the diary.** The Hammer++/L4D2 research report moved to
  `.develop-diary/04-log/2026-11-18-hammerpp-l4d2-research.md`; the upstream intake audit is
  `.develop-diary/04-log/2026-11-18-upstream-intake.md`.
- **Model and nav authoring references.** `references/mapping/model-authoring.md` covers
  QC/SMD, `studiomdl`, physics, viewmodels and player models; `references/nav/editing.md`
  is the console command set for repairing a generated mesh, with the manual steps named.

## 0.0.84-alpha â€” 2026-11-18

- **Hammer++ complete reference.** `docs/reference/hammerpp-complete-reference.md`
  inventories build 8873: every editor feature, the settings that change output
  (`IOParamNewDelimiter`, `vertices_plus`, HDR preview, instance collapse), the Tools++
  flags and limits (`-l4d2`, `-staticpropformat 9`, `-simpleladders`, AO, texture shadows,
  `-both`), the VMF blocks Hammer++ adds, and a feature â†’ tool matrix.
- **L4D2 complete reference.** `docs/reference/l4d2-complete-reference.md` covers mission
  fields and modes, map flow, nav defaults and the 18 checks, Director defaults and
  `DirectorOptions`, the custom-finale stage machine (PANIC/TANK/DELAY/ONSLAUGHT), escape
  events, survivor/infected health and speed (`z_*` defaults), weapons from the installed
  scripts, `info_map_parameters` densities, entities, console surface, limits, assets,
  optimization and failure signatures.
- **`write_vmf_water`.** Writes a `func_water_analog` volume and a `water_lod_control`
  entity, checks that the material is an installed Water-shader material before writing,
  and rolls the file back if the brush write fails.
- **`place_door`.** Turns a model hull + opening + yaw into the hinge origin with
  `placeDoor`, writes the door entity, and warns when a checkpoint door is not named
  `checkpoint_exit`/`checkpoint_entrance`.
- **`open_in_hammer`.** Launches Hammer++ on a VMF and captures the editor window as a real
  image block. This is the one visual layer a file writer cannot reproduce: the 3D viewport,
  lighting preview, fog, sky, particles and gizmos. The tool does not drive the UI.
- **`read_hammerpp`.** Reads `hammerplusplus_settings.ini` by section, the game
  configuration and build programs, the FGD mount and the keybinding count, and warns when
  the I/O delimiter, precise vertex data, HDR preview or 4-way blends are wrong for L4D2.
- **Nav flags completed.** `read_nav_dump` decodes `no-threat` (0x80000) and `lying-down`
  (0x100000); the L4D2 `func_nav_attribute_region` list is in the references.
- **Honest gaps recorded.** Propper++ (brush â†’ model), hotspot `.rect` lookup, 4-way blend
  verification and the preview-map fallback for HLMV remain open.

## 0.0.83-alpha â€” 2026-11-18

- **`run_campaign_gate`.** One guarded tool runs the campaign through mission check, VMF
  lint, compile, nav generation with the dictionary baked, static-prop collision, the
  finale contract, the engine's `nav_trouble_report`, and a map test that installs the exact
  BSP/nav pair it just produced. It stops at the first hard failure by default and reports
  `stoppedAt`; the shipping BSP is the nav-generated one, not the compile output.
- **`nav_trouble_report`.** Runs the engine's own checks and parses them into passes,
  failures and coordinates. L4D2 has no `nav_dump_selected_set_positions` (that command is
  Source SDK 2013); the selected set is saved with `nav_save_selected`, whose four corners
  and attributes are read back and cleaned up. Offline mode summarises a `_nav.txt` dump
  and refuses to claim the checks it cannot see.
- **`check_finale`.** Reads a VMF or BSP and checks the finale as a contract: type, custom
  script, `DirectorOptions` stage count against the defined stages, gauntlet
  `nav_flow_target`, outtro stats, the disabled arrival changelevel, the FINALE nav area
  under the trigger, `FinaleEscapeStarted` wiring, and a trigger that starts disabled with
  nothing to enable it. A type-2 trigger no longer returns early and skips the rest.
- **Static props know decoration.** `read_static_props` takes the source `vmf` and marks a
  model `decorative` when every instance carries `spawnflags 2`; `missingPhysicsSolidCount`
  is the number that matters, so grass and tree canopies stop reading as walk-through walls.
- **The engine found two geometry bugs the static checks could not.** m2's FINALE region
  stopped at y=3300 while the nav mesh's last row was at y=3225 (`Missing Finale check
  found 3 areas`), and a 32-unit hall floor step made four connections non-walkable. m1's
  32-unit swamp bank generated 40 sloped areas the engine called non-walkable. Both maps
  now pass every `nav_trouble_report` check.
- **Staging is one module.** `src/maps/typescript/game/stage.ts` owns hide/restore and BSP/nav installation
  for the map test, nav generation and the trouble report, instead of three copies that
  could disagree about what they had installed.

## 0.0.82-alpha â€” 2026-11-18

- **Deep research pass.** `docs/reference/l4d2-modding-research-2026.md` collects Hammer/
  Hammer++ setup, campaign/mission contracts, checkpoint/nav/finale rules, Director and
  game modes, entity classes, optimization and limits, the asset pipeline, and a gap table
  against this MCP. `docs/reference/l4d2-campaign-authoring.md` is the shorter synthesis.
- **Hammer++ I/O delimiter is a real failure mode.** Hammer++'s
  `Use special I/O delimiter (ESC)` (`IOParamNewDelimiter=1`) writes ESC-separated outputs;
  L4D2 expects commas and every output silently does nothing. This install had it set to 1
  and is now 0. `health` reports the setting; `read_vmf_lint` reports `io-esc-delimiter`;
  `normalize_vmf_io` rewrites an affected VMF and says why the next save will undo it.
- **Hammer++ health.** `health` reports `hammerplusplus.exe`, the settings file, the I/O
  delimiter and the x86/x64 caveat (L4D2 is 32-bit; current Hammer++ builds are x64, use the
  x86 build or the x86-64 beta).
- **FGD note.** The stock FGD omits `logic_script`; the lint tolerates it. The Tools++ FGD
  (`toolsplusplus.fgd` / `L4D2-FGD-Edits`) is the source for its extra entries.

## 0.0.81-alpha â€” 2026-11-18

- **Checkpoint doors use the names the engine looks up.** `checkpoint_exit` on the safe room
  being left and `checkpoint_entrance` on the one being entered. `checkpoint_exit_door` was
  close enough to look right and wrong enough that the transition logic could not find it.
  `read_vmf_lint` reports `l4d2-checkpoint-door-name`.
- **Door swing clearance.** `l4d2-door-swing-blocked` reports a prop within the leaf's width
  + 16 units of the hinge, the "door opens through the bench" bug.
- **Static prop collision audit.** `read_static_props` reads the compiled static-prop model
  set and reports models with no `.phy`; `read_model_info` now returns `hasPhysics` and
  `physicsPath`; `read_vmf_lint` reports `prop-static-no-physics` and
  `prop-static-not-solid`. `spawnflags 2` marks deliberate decoration. The campaign's trees
  and grass are decoration; buildings/props that must block are checked.
- **`write_vmf_terrain`.** One call builds a floor grid, a displacement on every top face,
  noise with a seed, and a sew. The underlying `write_displacement` / `sculpt_displacement` /
  `sew_displacements` remain the native path.
- **Boundary and detail pass.** Tree line plus a cliff band inside the skybox shell, 120
  grass props in the forest, stock facades/storefronts/dumpsters/lamps, deeper swamp, and
  the stock `mall_escalator` with **positive** roll (negative roll tilted it against the
  23-degree ramp).
- **Ten-guide research.** `docs/reference/l4d2-campaign-authoring.md` and
  `references/campaign/authoring-checklist.md` distil the campaign/addon, checkpoint/nav,
  finale, boundary, terrain, water and optimization advice, with the sources.

## 0.0.80-alpha â€” 2026-11-18

- **`preview_asset`: the eye.** A material is read through its VMT to the `$basetexture`
  VTF, decoded by the sidecar and returned as a real PNG over a checkerboard (no Pillow).
  A model is opened in HLMV and its viewport captured; stock VPK models are now accepted
  (HLMV previously refused every non-loose path). Use it before choosing a texture or a
  prop; a name is not a look.
- **`read_asset_catalog` sees the whole kit.** Categories now include building, roof,
  window, vehicle, foliage, street, interior, prop, fence, light, sign, terrain, escalator
  and stairs, and the reply carries material categories (brick, concrete, plaster, wood,
  metal, roof, tile, ground, grass, asphalt, water, glass, fabric, sign, building) with
  VMF-ready names. Bounds are returned for structural categories.
- **Terrain/water/boundary recipe.** `references/mapping/terrain-water-boundaries.md` gives
  the displacement order (`write_displacement` -> `sculpt_displacement` -> sew -> paint),
  the `func_water_analog` + `water_lod_control` contract, and the tree-line/facade/fog
  boundary rule.
- Campaign 002 gained stock building facades, storefront windows and doors, dumpsters,
  trash cans, street lamps, grass, a deeper swamp basin and a tree line at both map edges;
  the escalator is the stock `mall_escalator` on the 23-degree shaft, not four flat panels.

## 0.0.79-alpha â€” 2026-11-18

- **A rotating door's origin is its hinge.** `placeDoor` (`src/maps/typescript/vmf/door.ts`) turns
  `read_model_info` bounds plus an opening into the hinge origin and floor height. Both
  campaign checkpoint doors were at the centre of a 64-unit opening, so half the leaf went
  through the wall and half the doorway stayed open; they now hang two units inside the jamb.
  `read_vmf_lint` reports `l4d2-door-hinge-at-center`.
- **No-infected mode works without cheats.** `director_stop` is cheat-only and was ignored in
  a normal client, which put commons in the metro. Both maps attach a `logic_script` that
  sets `DirectorOptions.CommonLimit`, `MaxSpecials`, `TankLimit`, `WitchLimit` and
  `MobSpawnSize` to zero and re-applies them on a timer. The stock FGD does not declare
  `logic_script`; the lint now tolerates the class and its `vscripts` key.
- The `trigger_finale` model is a real stock asset (`models/props_placeable/radio_box.mdl`),
  not the FGD's absent `german_radio` default. The finale still needs a campaign-context test;
  the BTR escape remains the deterministic end.
- `read_vmf_lint`'s solid probe converts points to `srctools.math.Vec`; a list made every
  probe raise and return `None`, which is why the door/landmark rules silently passed.

## 0.0.78-alpha â€” 2026-11-18

- **Nav is generated on a dictionary-bearing BSP.** `run_nav_generate` now bakes the
  engine's string-table dictionary with a `-stringtables` changelevel *before* generating,
  so `savedBspSize` describes the file that ships. It returns `fresh`,
  `stringtableDictionary` and `shadowingArchives`, resolves bare add-on names against the
  game's `addons/`, and hides every installed VPK whose index contains the same map. The
  sidecar's `vpk_list` prefix filter was also returning nothing for a path prefix, which had
  made the shadow search silently ineffective. This is the root fix for the stale pair that
  produced "Map is unplayable".
- **The sky name carries its mode suffix.** Stock L4D2 maps store `sky_l4d_c1_1_hdr`, not
  `sky_l4d_c1_1`; the engine asks for `skybox/<skyname><side>.vmt`. `checkSkybox` groups by
  the full name, returns `suggested`, `write_vmf` stores it, and `run_compile` refuses a sky
  with no faces for the lighting mode it is about to build. The default sky is
  `sky_l4d_rural02_hdr`. This fixes the flat/void sky.
- **Asset discovery no longer needs a guessed name.** `read_game_content` accepts an empty
  pattern as a paged browse, and `read_asset_catalog` groups stock models into escalators,
  stairs, doors, vehicles, foliage, street, interiors, lights and signs, with hull bounds,
  plus every sky's LDR/HDR completeness and exact storable name.
- **Geometry that nav cannot cross is refused.** A `wedge` over 45 degrees and a stair rise
  over 18 units now fail unless `steep: true`; the message names the run/steps to use.
- **Lint catches door and landmark mistakes.** `l4d2-door-opening-too-wide` /
  `-too-narrow` compares the opening to the model's horizontal width;
  `l4d2-door-hinge-at-center` catches the door whose origin is in the middle of the opening
  (the origin is the hinge, so half the leaf goes through the wall); `l4d2-landmark-in-solid`
  ignores trigger/region volumes so it does not cry wolf.
- **Door placement is computed, not guessed.** `src/maps/typescript/vmf/door.ts` (`placeDoor`) turns
  `read_model_info` bounds plus the opening into the hinge origin and the floor height; the
  campaign uses it for both checkpoint doors. `read_vmf_lint` tolerates `logic_script`
  (the stock FGD does not declare it) so a VScript map is not reported as unknown.
- **No-infected mode works in a normal client.** `director_stop` is a cheat command and is
  ignored without `sv_cheats`; the maps now attach a `logic_script` that sets
  `DirectorOptions.CommonLimit/MaxSpecials/TankLimit/WitchLimit = 0` and re-applies it on a
  timer. The old `director_stop` output is gone.
- **Tool readout fixes.** `read_nav_dump` parses CRLF dumps (it returned zero areas on every
  real dump), and `read_bsp_entities` / `read_nav_dump` no longer treat an unparsed default
  `limit` as zero.
- **Canonical addon manifest keys** (`addontitle`, `addonauthor`, `addonversion`,
  `addonDescription`), and an engine-limits reference:
  `docs/reference/engine-limits-l4d2.md`.
- Campaign 002 now loads both chapters with no `NAV ERRORS`, uses stock escalator side
  panels on the 23-degree shaft, 16-unit stairs instead of a 51-degree wedge, 64x112 door
  openings around 58-unit doors, and a FINALE nav area at the BTR.

## 0.0.77-alpha â€” 2026-11-18

- **Nav generation now stages the BSP and nav mesh it actually produced.** The engine
  rewrites the BSP stringtable before writing the nav; the old tool returned only the nav,
  so a build paired a fresh mesh with a pre-generation BSP and the game reported
  "Map is unplayable". `run_nav_generate` now returns `bsp`, and the nav docs say to stage
  the pair and check `read_nav` for `fresh`.
- **`navSlopeLimit` is a tool argument.** L4D2's default rejects steep stairs and
  escalators; `navSlopeLimit: 0.5` allowed the 23-degree Moscow escalator to generate nav.
- Full findings from the first wish-to-campaign build are in
  `docs/reports/2026-11-18-wish-build-findings.md`.

## 0.0.76-alpha â€” 2026-11-17

- **The three new Hammer++ helpers were proven end to end.** A sealed probe map was built
  with `merge_solids` (two adjacent brushes to one), `move_to_surface` (a floating brush to
  the floor) and `create_instance_from_selection` (a brush extracted to a file, leaving
  `func_instance`). Stock vbsp then compiled it with exit 0; the only warning was the
  deliberately absent test material. The coverage table marks all three verified.

## 0.0.75-alpha â€” 2026-11-17

- **`references/mapping/level-design.md`.** Room and doorway sizes against the standing
  hull, one decision per room, cover heights, sightlines, verticality, lighting/weather and
  a first-chapter recipe that matches the campaign already proven in game. It is the layer
  between a wish and geometry: the tools measure, this page decides.
- The wish workflow and `SKILL.md` route a new build through it.

## 0.0.74-alpha â€” 2026-11-17

- **A wish-first campaign workflow.** `workflows/from-a-wish.md` turns a user's description
  into a spec (chapters, flow, mechanics, assets, done-means), then hands the spec to the
  build workflow. It requires every asset from `read_game_content`, every entity from
  `read_fgd_class`, and one evidence line per requested mechanic.
- The campaign checklist now opens with the brief and closes with per-wish evidence, so
  "map loads" cannot stand in for "the tank and the finale work". `SKILL.md` and README
  route a description through the new page first.

## 0.0.73-alpha â€” 2026-11-17

- **Three Hammer++ editing operations became one call each.** `merge_solids` replaces
  convex brushes with the one brush around them and refuses a non-convex or overlapping
  selection; `move_to_surface` drops or raises brushes to a traced floor or ceiling, with
  optional alignment to the surface; `create_instance_from_selection` writes a selection as
  an instance and leaves a `func_instance`, taking a brush entity whole.
- These were reachable through primitives before; they are helpers now, not new limits.

## 0.0.72-alpha â€” 2026-11-17

- **New troubleshooting page for mapping edits.** `troubleshooting/mapping-edits.md` covers
  a prefab pasted in the wrong place or invisible, a skewed texture, a moved brush that
  Hammer++ still draws at the old position, an overlay lost to a clip, and a brush entity
  that did not move. Each has symptom, cause, check and fix, with the tool that answers it.
- The stale capability list in `SKILL.md` is corrected: nav generation and model compilation
  are tools, and the unsupported list now names two-team rounds, a full Survival wave, the
  headless HLMV canvas and the genuinely manual design work.

## 0.0.71-alpha â€” 2026-11-17

- **Hammer++'s `vertices_plus` stays in step with geometry edits.** `transform_solids` and
  `move_vertices` move the exact face loop through the same matrix as the plane;
  `clip_solids` drops it from cut and surviving faces because their loop changed. Before
  this, a moved brush kept its old loop and Hammer++ would draw it where it used to be.
- Unknown Hammer++ root blocks still survive byte-for-byte; the coverage page now documents
  both behaviours.

## 0.0.70-alpha â€” 2026-11-17

- **`insert_prefab` now turns as well as moves.** It takes `rotate` (yaw degrees) and
  `pivot`; the whole fragment is transformed, including solids owned by brush entities.
  Point entities have their `origin`, `angles` and `angle` turned with the geometry, so a
  rotated prefab no longer leaves its entities facing the old way. Hidden solids and a
  nested `func_instance` still return warnings.
- The previous warning about brush-entity geometry not moving is gone because it now moves.

## 0.0.69-alpha â€” 2026-11-17

- **`insert_prefab` and `set_face_uv` were proven end to end.** A prefab brush plus an
  `info_target` was pasted into a copy of the test campaign, a face was given a skewed U/V
  pair, and vbsp compiled the map with no errors; the compiled BSP then loaded in game and
  was captured. The coverage table marks both verified.

## 0.0.68-alpha â€” 2026-11-17

- **`set_face_uv`: the face sheet's U/V vectors by hand.** `align_faces` derives axes from a
  mode, so it cannot make a deliberately skewed pair. The new tool writes the U and V
  vectors, their offsets and scales, and the side's `rotation`; an omitted vector keeps the
  face's current one. Geometry is checked untouched and the axes are checked against the
  same reader rules (no axis along the normal, no zero scale, no degenerate pair) before
  the write.

## 0.0.67-alpha â€” 2026-11-17

- **Coverage docs stopped claiming HLMV launch is missing.** `run_hlmv` launches the editor
  and `capture_window` returns its UI; only the 3D canvas needs an interactive desktop. The
  "genuinely missing" list now names that environment limit instead of an absent operation,
  and the mechanics table says the same.

## 0.0.66-alpha â€” 2026-11-17

- **`insert_prefab` validates what it appended.** A fragment pasted into a file without a
  trailing newline now starts on its own line, and the write is refused unless the target
  ends up with exactly the old entity count plus the prefab's root entities.

## 0.0.65-alpha â€” 2026-11-17

- **`insert_prefab`: paste a saved Hammer prefab into a map.** A prefab is a `.vmf`
  fragment, not a live `func_instance`. World brushes and root entities are inserted, every
  brush/side/entity id is remapped to a free one, and the fragment can be offset. Every
  inserted world brush is checked as a valid solid before the write.
- Brush-entity geometry is inserted but the offset is not applied inside it, and point
  entities without an origin cannot move; the tool returns a warning instead of pretending
  the whole fragment moved. The Hammer coverage table no longer has a `Prefabs` gap.

## 0.0.64-alpha â€” 2026-11-17

- **Split-screen was researched and tested.** The PC build has an unsupported
  `ss_enable 1` / `ss_splitmode 2` mode, usually driven by a community `split-screen.txt`,
  a controller and menu add-ons. Launching the map with `+ss_enable 1 +ss_splitmode 2` did
  not split the viewport here; the frame stayed single-player.
- `testing/multi-client.md` now separates the three paths: split-screen (one account, one
  client, unverified for two teams), a dedicated server with survivor bots and one client on
  Infected, and a second Steam account. Split-screen bypasses `No Steam logon` but does not
  by itself prove a Versus/Scavenge two-team round.

## 0.0.63-alpha â€” 2026-11-17

- **Multi-client testing was attempted and its limit documented.** Two clients start with
  `-multirun -windowed` (the second fails D3D in fullscreen), connect to the local listen
  server and load the map, but Steam drops the second with `No Steam logon` / failure code
  8: one account cannot authenticate twice. `-insecure` is not a workaround.
- New `testing/multi-client.md` lists the solo options: a dedicated server plus one client
  (survivor bots, client on Infected), a second Steam account, or split-screen; and says a
  single client only proves mode load/HUD, not a two-team round.

## 0.0.62-alpha â€” 2026-11-17

- **Survival's setup phase is documented.** Loading the map in `survival` gives the HUD but
  leaves the timer at `00:00.00`; the round needs a `trigger_finale` / `ForcePanicEvent`.
  Waiting 45 s without one produced no wave and no timer movement. `mechanics/survival.md`
  now says this explicitly, so a later test does not mistake the setup phase for a broken
  map or a finished wave.
- No functional changes.

## 0.0.61-alpha â€” 2026-11-17

- **Versus is verified to load.** The mission lists `hsmcp_test_m1` under `versus`, and
  `run_map_test` with `extraArgs: ["+mp_gamemode", "versus"]` loaded it in 33 s and ran
  `VSCRIPT: Running anv_versus.nut`. The map is playable with the same nav as coop. A
  single-player listen server does not populate both teams, so the full Versus HUD/round was
  not observed.
- New reference `mechanics/versus.md`: mission block, launch argument, the mode-script
  evidence, and the pitfall that Scavenge gas cans are map entities and show in Versus too.

## 0.0.60-alpha â€” 2026-11-17

- **Scavenge is verified.** The mission lists `hsmcp_test_m1` under `scavenge`, and the map
  has 16 `weapon_scavenge_item_spawn` points. `run_map_test` with
  `extraArgs: ["+mp_gamemode", "scavenge"]` loaded it in 32 s: the HUD showed
  `SCORE 0 / 16`, the `01:30.00` round timer, `SECONDS UNTIL ROUND BEGINS`, and a gas can in
  the frame. A full two-team round was not played.
- New reference `mechanics/scavenge.md`: mission block, the 16 gas-can points, the launch
  argument, HUD evidence, and the leak pitfall when a spawn sits outside the hull.

## 0.0.59-alpha â€” 2026-11-17

- **Survival mode is verified.** The mission file now lists `hsmcp_test_m1` under a
  `survival` mode, and `run_map_test` with `extraArgs: ["+mp_gamemode", "survival"]` loaded
  the map and showed the Survival HUD with the timer at `00:00.00` in 33 s. No special
  entity was needed beyond nav and a spawn; a full survival wave was not timed.
- New reference `mechanics/survival.md`: mission block, the launch argument, the HUD proof,
  and the pitfalls (`NAV ERRORS`, mission fallback, harmless `survival_record`).

## 0.0.58-alpha â€” 2026-11-17

- **Tanks and witches are verified.** Test timers at 12 s and 22 s issued
  `sv_cheats 1; z_spawn tank` / `z_spawn witch` from a `point_servercommand`.
  `run_map_test` matched `Damage Taken from "Tank"` in **59 s**, the log contains the
  calm-witch line, and the screenshot shows the death screen with the tank.
- The spawn and panic timers are now gated behind `HSMCP_SELFTEST`; a normal campaign build
  deploys them disabled, so the map does not spawn a tank on every load.
- New reference `mechanics/tanks-and-witches.md`: commands, the log lines that prove each
  entity, and the small-arena warning.

## 0.0.57-alpha â€” 2026-11-17

- **Crescendo/panic is verified in game.** The test map starts a panic event ten seconds
  after spawn with `director,PanicEvent`; the Director logs
  `STAGE_INITIAL_DELAY â†’ STAGE_MEGA_MOB â†’ STAGE_WAIT_FOR_COMBAT_TO_END â†’ STAGE_DONE` and
  `run_map_test({ waitFor: "STAGE_DONE" })` matched in **51 s**. `ForcePanicEvent` produced
  the same stages.
- `OnPanicEventFinished` did not fire on this map, with either input, so the docs no longer
  present it as the only proof; the stage transition is the reliable evidence.

## 0.0.56-alpha â€” 2026-11-17

- **PANIC and TANK finale stages are verified in game.** The test finale runs
  PANIC â†’ DELAY â†’ TANK â†’ DELAY â†’ DELAY, then `HSMCP_ESCAPE_STARTED`,
  `HSMCP_ESCAPE_TOUCHED`, `Host_Changelevel` and the credits map in **137 s**. A final PANIC
  stage was replaced by DELAY: its commons did not clear and the stage hung. The TANK stage
  transitioned, but bots killing a tank is not proven.
- `verify-finale.mjs` now waits for `Host_Changelevel`, the line that actually appeared;
  `Map: credits` did not. The old wait caused a false timeout after the campaign had already
  reached credits.

## 0.0.55-alpha â€” 2026-11-17

- **`run_map_test` can install the BSP too.** `bsp` and `nav` are now both optional: the tool
  copies them beside the map, reports `bspInstalled`/`navInstalled`, and restores any
  previous files in a `finally`. The earlier `nav`-only version launched the main menu when
  the map itself was not installed.
- **Rain is verified visually.** A synthetic open-sky test map with `func_precipitation`
  loaded and the captured frame shows rain streaks. The same map's nav is `no-flow` (one
  area, no goal), so it still shows `NAV ERRORS`; that is a test-map nav defect, not a
  weather defect. The distinction is documented in `troubleshooting/nav-stale.md`.
- Fog was compiled and loaded but is not separately judged; the coverage says so.

## 0.0.54-alpha â€” 2026-11-17

- **`run_map_test` can install the nav with the map.** A loose BSP copied for a test does
  not bring its `.nav`, and the game opens on `NAV ERRORS â€” Map is unplayable!`. The new
  `nav` argument copies the mesh beside the map and restores the previous one in a
  `finally`; the result reports `navInstalled`.
- Found in the weather test: the first screenshot of the arena was an unplayable map with
  the nav error screen. Copying the nav fixed it. The finding is in
  `troubleshooting/nav-stale.md`.
- Weather entities were added and compiled, but the closed brick arena cannot prove rain or
  fog visually; that check needs an open-sky map and remains pending.

## 0.0.53-alpha â€” 2026-11-17

- **`write_skybox_copy`** (97th tool): the copy/scale/move half of a 3D skybox. It copies
  selected brushes at 1/16 scale around the map origin and moves them so the origin lands at
  `targetOrigin`, where `sky_camera` should sit. It warns when the map has no camera or the
  camera is elsewhere, and it refuses hidden or displaced brushes. Sealing the skybox area
  and choosing what to copy remain design work.
- With this, the only remaining limitation in the skill is 3D-skybox design; every Hammer
  operation has a tool.

## 0.0.52-alpha â€” 2026-11-17

- **`run_map_test` can show the agent the running game.** With `screenshot: true` it waits
  for the marker, lets the frame settle, captures the game window and returns a real MCP
  image block. The default method is `screen` because the game canvas is 3D; `window`
  (`PrintWindow`) produces a black canvas for the game renderer.
- Verified live: `run_map_test` matched `Host_NewGame on map hsmcp_test_m1`, captured a
  2560Ã—1440 frame after 2.5 s and returned a 2.7 MB PNG image block showing the campaign
  loading screen. The game process was stopped afterwards.
- The screenshot workflow is documented with the marker advice: match a post-load line such
  as `Loading: [0-9]`, not the first map-name line, before asking for a picture.

## 0.0.51-alpha â€” 2026-11-17

- **The agent can see a GUI.** `run_hlmv` now optionally captures the HLMV window and
  returns it as a real MCP image block; `capture_window` (96th tool) captures any window by
  process id or name. `window` mode uses `PrintWindow` and works while another window is in
  front; `screen` mode brings the window forward for a 3D canvas.
- HLMV launch fixed for this build: `VPROJECT` plus the game directory as cwd and a relative
  model path. `-game` produced `Unable to find gameinfo.txt`.
- Verified: HLMV launched on the compiled sample, the window title showed the model, and a
  real PNG image block came back. The 3D canvas is black on this sandbox desktop; that is an
  environment limit and is documented rather than claimed as a rendered model.

## 0.0.50-alpha â€” 2026-11-17

- **`run_hlmv`** (95th tool): launches the game's HLMV on one compiled model, after resolving
  it against the game's `models/` tree and refusing a missing file. It returns the process id
  immediately; HLMV is a GUI, so there is no screenshot and no machine-readable result.
  `read_model_info` remains the answer for bounds, sequences and materials.
- Verified live: the sample model compiled, HLMV opened on it (`processId` returned), and the
  test model directory was removed after the process was closed. Model preview is no longer
  a gap; only 3D-skybox layout remains in the skill's limitation list.

## 0.0.49-alpha â€” 2026-11-17

- **`export_vmf_map`** (94th tool): exports a `.vmf` to Valve's `.map` format 220. Every
  brush face keeps its three points, material, `uaxis`/`vaxis` and scale; every entity keeps
  its keyvalues and outputs. VMF-only data (visgroups, instances, displacements) cannot exist
  in the format and is reported as warnings instead of disappearing.
- With this, no Hammer parity row says "not covered". The remaining limitations are tracked
  in the skill coverage: HLMV preview, 3D-skybox layout and the checks that need a person at
  the screen.

## 0.0.48-alpha â€” 2026-11-17

- **Model authoring primitives** (91â€“93): `read_text_file` and `write_text_file` handle
  arbitrary QC/SMD/VMT source text with no template, and `run_studiomdl` compiles a QC with
  the game's own `studiomdl.exe`, reads `$modelname`, and proves the `.mdl`, `.vvd`, `.vtx`
  and `.phy` exist instead of trusting the exit code.
- Verified in game with Valve's `wood_railing001.qc` sample: compiled in **395 ms** into
  `models/hsmcp_test/rail.mdl` (1,864 bytes) plus `.vvd`, `.vtx` and `.phy`. The test model
  directory was removed afterwards; the source sample was not modified.
- Model authoring is no longer a gap: the remaining model-related gap is launching HLMV to
  preview a compiled model.

## 0.0.47-alpha â€” 2026-11-17

- **`run_build_cubemaps` can pack the result into a copy of the map.** `pack: true` with
  `outBsp` writes a new `.bsp` containing the built `.vtf` files and reports the pakfile
  count and how many entries were added. Nothing is packed unless asked; the game install
  is still restored.
- Verified in game: an HDR build packed one new entry into the copy, which then held six
  pakfile entries (five `.vtf`, one `.dct`). The generated copy and the materials directory
  were removed after the check.

## 0.0.46-alpha â€” 2026-11-17

- **`run_build_cubemaps`** (90th tool): builds a map's cubemaps with the engine's own
  `-buildcubemaps` launch mode â€” load the map, capture every sample, write `.vtf`, quit.
  Supports HDR, LDR or both, copies the files out, and restores the map, materials
  directory and hidden add-ons in a `finally`. Verified on the test campaign: HDR in 29 s
  (`c0_0_64_hdr.pwl.vtf`, 76,536 bytes), LDR in 24 s (`c0_0_64.pwl.vtf`, 4,968 bytes), both
  modes in one call; the game install was left clean.
- The engine launch mode replaces the earlier attempt to inject `point_servercommand` /
  `point_clientcommand` + `logic_auto`: that path logged an empty ` is not writable!!!`
  even with the original map name and a writable materials directory.
- The test campaign now compiles one `env_cubemap` at the arena centre, so the map has a
  non-empty CUBEMAPS lump to build.

## 0.0.45-alpha â€” 2026-11-17

- **README rewritten for readers, not maintainers.** It now answers what the project is,
  what an agent can do with it, what is required, how to install it, a typical campaign
  workflow, where the documentation is and what state the project is in. The internal
  architecture diagram, design-rule list and root-file table were removed; the root-file
  table moved to `CONTRIBUTING.md`, where contributor material belongs. The status is stated
  as alpha only, without a list of what is proven or finished.
- No functional changes.

## 0.0.44-alpha â€” 2026-11-17

- **The repository root is now a documented, tested set.** README lists the job of every
  tracked root file, and `test/support/structure.test.ts` fails when a new tracked file
  appears at the root without being added to the allowlist and the table. Machine-specific
  files (`.mcp.json`, `config.json`) and generated trees (`dist/`, `node_modules/`,
  `campaigns/`, `.develop-diary/`, `.hammer-mcp/`) are ignored by design, not clutter.
- Audit result: no redundant tracked root files. The config, tsconfig, lockfile, licence and
  history files all have a job; nothing was deleted.

## 0.0.43-alpha â€” 2026-11-17

- **Every experiment now has to leave a document for the agent.** The diary records the
  process; `skill/l4d2-hsmcp/troubleshooting/` and `references/` are what the agent reads
  while working: symptom â†’ cause â†’ check â†’ fix, what each error means, what it affects, and
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

## 0.0.42-alpha â€” 2026-11-17

- **`edit_bsp_entities`** (89th tool): adds, updates or removes entities in a compiled
  `.bsp`. The new entity text is appended and only lump 0's directory entry moves, so the
  pakfile, brush data and lighting stay where they were. Compiled outputs are ordinary
  keyvalues. This is the primitive `buildcubemaps` needs: `point_servercommand` plus
  `logic_auto` in a copy of the map, without recompiling it. Refuses a compressed entity
  lump, an empty op list, and a result with no worldspawn; verified on the fixture BSP that
  the header points at the appended lump and the map still reads back.
- The compiled entity lump leaves `primitives.md`'s gap list. The remaining real gaps are
  the engine cubemap step and model authoring.

## 0.0.41-alpha â€” 2026-11-17

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

## 0.0.40-alpha â€” 2026-11-17

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

## 0.0.39-alpha â€” 2026-11-17

- **`write_campaign` accepts arbitrary keyvalues at mission, mode and chapter level.** Its
  structured fields covered `Name`, the title, the author and the convar block, and nothing
  else: another menu. The `keyvalues` fields now write `Version`, `VersusCompletionScore`, a
  mod's own keys, anything the format allows. Structural keys keep their dedicated fields and
  are refused there, so the writer cannot emit two conflicting copies.
- The mission format is no longer listed as a gap in `primitives.md`; the remaining real
  gaps are the engine cubemap step, writing a compiled BSP's entity lump, model authoring and
  exact face-alignment copying.

## 0.0.38-alpha â€” 2026-11-17

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

## 0.0.37-alpha â€” 2026-11-17

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

## 0.0.36-alpha â€” 2026-11-17

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
  engine â€” all false for a Windows-only L4D2 toolkit that already runs the game.

## 0.0.35-alpha â€” 2026-11-17

- **Conventional Commits are a written project rule.** `CONTRIBUTING.md` and diary rule 11
  spell out the format: `type(scope): imperative summary`, allowed types, an optional scope,
  a body that explains why, and `!`/`BREAKING CHANGE:` for a break. A subject that does not
  parse is a defect even when the change is right.
- Two decisions shared the ID D33; the language decision is now D61 and the correction is
  recorded as D60.

## 0.0.34-alpha â€” 2026-11-17

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

## 0.0.33-alpha â€” 2026-11-17

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

## 0.0.32-alpha â€” 2026-11-17

- **`write_instance`** (82nd tool): places a `func_instance` from an instance `.vmf`, with
  origin, angles and fixup style. The file is resolved next to the target map and read first â€”
  a missing instance is an error, not an empty object â€” and nested instances are reported.
  Tested on the fixture: one solid, one entity, the entity appears in `read_vmf` with
  `fixup_style "1"`; a missing file is refused.
- Instances leave the Hammer gap list: reading (`collapseInstances`) and writing both exist.
  The remaining gaps are 3D skybox, engine cubemap building, arch/torus and model authoring.

## 0.0.31-alpha â€” 2026-11-17

- **`write_overlay`** (81st tool): puts an `info_overlay` decal on a brush face from a side id,
  a point on the face, a material and a size. The format is read from Valve's own
  `sdk_content/mapsrc/styleguide_urban.vmf`; the tool computes the basis normal/U/V, checks
  that the point is on the plane, and adds the entity. Tested on the campaign VMF: `side 3`,
  `decals/blood1`, 64Ã—64 â†’ normal `0 0 1`, four corners, `lint 0`.
- Hammer's overlay tool is no longer a gap in `hammer-coverage.md`; an in-game look at the
  decal is still pending. The skill's Hammer-tab map gained the overlay row.

## 0.0.30-alpha â€” 2026-11-17

- The project goal is recorded in the charter and the diary: the agent must have **all** of
  Hammer++ and more. `references/mapping/hammer-coverage.md` is the scorecard: every feature,
  its tool, and an honest `verified` / `tool` / `gap` status.
- `read_game_content` gains `kind: "sound"` â€” the sound browser (635 `ambient` files on this
  install), alongside materials, models with sizes, and particles.
- The coverage page names the real gaps: overlays/decals, instances/prefabs writing, 3D
  skybox, building cubemaps in the engine, arch/torus primitives, and model authoring.

## 0.0.29-alpha â€” 2026-11-17

- The skill gains `references/mechanics/crescendo-and-panic.md`: the `func_button` /
  `trigger_once` â†’ `director ForcePanicEvent` wiring, `OnPanicEventFinished`, and the nav
  Battlefield (256) / Battlestation (32) split, with the automated test recipe. Entity names
  are read from the installed FGD; the play test is still pending.
- A project rule now says the agent's documentation is part of the product: every error,
  command, self-test recipe, asset and mechanic needs a page, and a question the agent had to
  ask is a documentation gap to close the same day.

## 0.0.28-alpha â€” 2026-11-17

- The skill gains `references/mechanics/weapons-and-items.md`: all 37 `weapon_*` spawn classes
  read from the installed FGD, grouped by tier and use, plus the placement rules â€” spawn on a
  nav area, not inside the floor, and do not give `Must Exist` to safe-room items because it
  duplicates them after a transition.
- The mechanics table records the class list as verified and the placement as documented but
  not yet play-tested.

## 0.0.27-alpha â€” 2026-11-17

- **The finale is a real custom finale now.** `trigger_finale` type 2 loads
  `scripts/vscripts/<mapname>_finale.nut` automatically; the script declares an
  `A_CustomFinale_StageCount` list (PANIC/DELAY/TANK/SCRIPTED) and receives
  `OnBeginCustomFinaleStage`. After the last stage the trigger fires `FinaleEscapeStarted`,
  which opens the escape point.
- The test campaign's script runs two DELAY stages (a shipping finale would use PANIC and
  TANK), and the verification passes: `[HSMCP] finale stage 1/2` â†’ `HSMCP_ESCAPE_STARTED` â†’
  escape touch â†’ `Map: credits` at 70 s.
- Type 0 is gone from the test map: it starts but has no stage list and never reaches the
  escape phase.
- `FinaleEscapeFinished` alone still does not end the campaign even after the escape phase, so
  the test harness adds `changelevel credits` on the escape trigger. A shipping campaign would
  fire the input from a rescue vehicle script.
- The skill gains `references/campaign/custom-finale.md` with the stage table, the callback,
  the escape wiring and the type-0 warning.

## 0.0.26-alpha â€” 2026-11-17

- The skill gains `references/testing/live-debugging.md`: how an agent runs the game itself
  (`run_map_test`, `-condebug`, `+sv_pausable 0`, `+sv_cheats 1`), moves survivors
  (`WarpAllSurvivorsToCheckpoint` vs `WarpAllSurvivorsToFinale`, why `setpos` in a config
  silently does nothing), fires entity inputs, plants markers, and the recipes for testing a
  transition, a finale, nav attributes and spawning. It also names the false passes: a stale
  log, `Mission credits` at startup, and `Host_NewGame` versus `Map:`.

## 0.0.25-alpha â€” 2026-11-17

- **The campaign is completable again, and this time it is verified.** A 768Ã—768 arena with
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

## 0.0.24-alpha â€” 2026-11-17

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
  campaign does not reach the credits map. The user's observation stands â€” a stats crawl or
  credits means the survivors escaped; the correct marker is `Host_NewGame on map credits`,
  not `Mission credits`.

## 0.0.23-alpha â€” 2026-11-17

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

## 0.0.22-alpha â€” 2026-11-17

- `read_game_content` now browses assets the way Hammer's tabs do, with the numbers that
  matter: `details: true` on a model returns its hull bounds (`mins`, `maxs`, `size`) â€” the
  size the model viewer shows and the number needed before placing a building â€” and
  `kind: "particle"` lists `.pcf` files for the Particle Browser. Verified against the
  install: 246 `props_urban` models with sizes, 52 particle systems.
- The skill gains `references/mapping/hammer-tabs.md` (every Hammer++ tab mapped to the tool
  that replaces it, and recipes for roads, skyboxes, buildings and street props) and
  `references/mechanics/coverage.md`, an honest table of which L4D2 mechanics are verified and
  which are still `not yet`.
- Mechanics coverage is now the project's definition of done: a row moves to verified only
  with in-game evidence. The open rows are the next blocks â€” spawn areas and waves, weapons
  and items, crescendos, tanks and witches, Scavenge/Survival/Versus, weather, VScript waves,
  displacements and instances.

## 0.0.21-alpha â€” 2026-11-17

- **`write_vscript`** (80th tool) writes a L4D2 `.nut`, refuses unbalanced braces, warns
  about Lua habits (`local`, `end`, `--[[`) and about a missing `printl`/`Msg` banner, and
  can attach the script to a map by adding a `logic_script` entity with `vscripts` set to the
  file's base name. A compiled map is refused by name, like every other `.vmf` tool.
- The scripting reference now points at the tool, so an agent can ship a script and attach it
  without hand-editing the VMF.

## 0.0.20-alpha â€” 2026-11-17

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

## 0.0.19-alpha â€” 2026-11-17

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
  needs the disabled arrival `info_changelevel` â€” without it the Director reports
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

## 0.0.18-alpha â€” 2026-11-17

- **The chapter transition is verified end to end without a human.** The engine needs two
  things, not one: every survivor inside the `info_changelevel` volume **and** the checkpoint
  door closed (`CheckpointDoorClosed`). `verify.ps1` builds with `HSMCP_SELFTEST=1`, the map's
  timer warps the team into the safe room and closes the door, and the game loads
  `hsmcp_test_m2` â€” recorded as `transition: PASS`.
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

## 0.0.17-alpha â€” 2026-11-17

- The agent skill is added at `skill/l4d2-hsmcp/`, structured for progressive disclosure:
  a short `SKILL.md` router, then `references/` (campaign, nav, scripting, mapping,
  compiling, tools), `workflows/`, `troubleshooting/` and `checklists/`. `opencode.json`
  points at it so it is available in this repository.
- The skill documents only what the project has verified â€” mission rules, the safe-room
  transition, nav attributes and flow, the finale inputs, add-on VScript, the tool catalogue â€”
  and names what is not built yet instead of inventing it.
- Campaign 001: the checkpoint door stood on a solid wall. The corridor now ends in a real
  doorway and a safe room behind it, with the changelevel volume over the room floor. Nav was
  regenerated: 12 areas per map, CHECKPOINT on both safe rooms, FINALE in the radio corridor,
  and the flow path reaching the safe room.

## 0.0.16-alpha â€” 2026-11-17

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

## 0.0.15-alpha â€” 2026-11-17

- An add-on VPK can carry VScript: `scripts/vscripts/hsmcp_finale.nut` is packed into the
  campaign, attached through a `logic_script` entity and verified in the running game â€” the
  `[HSMCP] hsmcp_finale loaded` banner appears in `console.log` with `-condebug`.
- The finale is now completable with entities: `trigger_finale` type 2 starts on **+use**,
  `FinaleStart` enables an escape `trigger_multiple` after ten seconds, and its `OnStartTouch`
  fires `FinaleEscapeFinished` and the outtro stats â€” the same inputs the Authoring Tools'
  rescue template uses. Stock campaigns never use type 0, so the earlier standard-finale
  attempt was replaced rather than tuned.
- `docs/campaigns.md` gains "The finale" and "VScript in an add-on", with the exact inputs and
  the console-log check.
- Campaign 001: exit corridor and changelevel (0.0.14) plus this finale; both maps rebuilt,
  nav regenerated (1346 bytes, fresh) and the 7-entry archive redeployed.

## 0.0.14-alpha â€” 2026-11-17

- Chapter transitions use L4D2's own mechanism: an `info_changelevel` brush with `map` and
  `landmark`, plus a matching `info_landmark` in both maps. Every stock chapter works this
  way; `trigger_changelevel` exists in `base.fgd` but is not part of the campaign flow, which
  is why the test campaign loaded and never advanced.
- Campaign 001 gets a visible exit: an east-wall doorway, a lit corridor and the changelevel
  brush at its end, replacing the invisible trigger brush. Both maps were rebuilt, nav was
  regenerated (1346 bytes, fresh against the new `.bsp`) and the archive redeployed.
- `docs/campaigns.md` gains "Chapter transitions" and "The finale": all stock finales use
  `trigger_finale` type 2 (Custom) with a VScript, so a script-free finale is still open.

## 0.0.13-alpha â€” 2026-11-17

- The upstream credit names the original developers' studio, **Project Society Studio**, and
  stops there: the README does not restate a copyright line, because `LICENSE-MIT` already
  carries the MIT notice verbatim.

## 0.0.12-alpha â€” 2026-11-17

- README drops the "What works today" feature table. The project has only just entered
  development, and the page now says so plainly: the map and campaign pipeline is the first
  piece being built, and the feature set will keep expanding.
- Upstream credit names **Project Society Studio**, which is how the original authors identify
  themselves; the MIT notice in `LICENSE-MIT` is unchanged.

## 0.0.11-alpha â€” 2026-11-17

- README gains a full Requirements section: L4D2 (app 550) and its Authoring Tools (app 563),
  Node, pnpm, Python/srctools, Windows, disk; recommended Hammer++ and standalone Tools++,
  the VTF tools, Steam for nav and testing; and the agent side (MCP client, skill,
  permission to run local tools and launch the game once per map for nav).

## 0.0.10-alpha â€” 2026-11-17

- README rewritten around what this project is: an agent toolkit for Left 4 Dead 2 maps,
  campaigns, VScripts, models and addons. It states the early-development status, how the
  pieces fit together, what works today and what is planned.
- `docs/campaigns.md` added: mission format and naming rules, addon layout, nav generation,
  deployment, and the checks `check_campaign` performs.
- Provenance points at `Sycatle/hammer-mcp`, the upstream this fork grew from; the MIT
  notice and copyright remain in `LICENSE-MIT`.

## 0.0.9-alpha â€” 2026-11-17

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

## 0.0.8-alpha â€” 2026-11-16

- The project moved to its own repository, `NexPG/L4D2-HSMCP`, with the full history. The
  old fork's remote is gone; metadata, clone URL and CI badge point at the new home.
- The upstream MIT notice and the provenance in `NOTICE` stay exactly where the licences
  require them.

## 0.0.7-alpha â€” 2026-11-16

- Campaign metadata is now shaped the way L4D2 matches it: the mission file's base name
  equals the VPK's (`hsmcp_campaign.txt` in `hsmcp_campaign.vpk`), `"Name"` is alphanumeric,
  and `"Image"` is set. The addon manifest carries `addonSteamAppID 550` and
  `addonContent_Campaign 1`.
- The staging tree is cleaned before a rebuild, so a renamed mission cannot survive and
  register a second campaign.

## 0.0.6-alpha â€” 2026-11-16

- `campaigns/` is ignored as a directory (root-anchored `/campaigns/`), not merely for the
  files inside it.
- Deployment keeps exactly one campaign in the game: the build removes earlier
  `hsmcp*.vpk` archives from `left4dead2/addons/` and copies the new one as
  `hsmcp_campaign.vpk`. History stays in the numbered campaign directories, where any run
  can be rebuilt and deployed again.

## 0.0.5-alpha â€” 2026-11-16

- Test campaigns are local only (`campaigns/` is ignored) and live in numbered directories:
  a README stating the date, project version, what was attempted and what came out, plus
  the source maps, staging tree, build script and packed VPK.
- The build script deploys the archive to the game's `left4dead2/addons/`, so a campaign
  can be opened in the game directly.
- `001-hsmcp-test` re-laid out under that convention.

## 0.0.4-alpha â€” 2026-11-16

- First campaign built through the tools: two sealed chapters with a transition and a
  finale, a mission file, an addon manifest and a packed VPK. `check_campaign` passes on
  the unpacked tree and on the archive itself.
- `campaigns/hsmcp-test/` keeps the source `.vmf` files, the mission and a `build.mjs` that
  reproduces the build; compiled maps and the VPK are build output.

## 0.0.3-alpha â€” 2026-11-16

- `run_vpk_pack`: packs a staging directory into an addon VPK with the game's own
  `vpk.exe`, writes the addon manifest when given one, and reads the archive back through
  the sidecar to prove every staging file made it in. Overwrites only on request.
- The pack output is an ordinary L4D2 addon tree: `addoninfo.txt`, `missions/`, `maps/`,
  `materials/vgui/maps/`.

## 0.0.2-alpha â€” 2026-11-16

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

## 0.0.1-alpha â€” 2026-11-16

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
