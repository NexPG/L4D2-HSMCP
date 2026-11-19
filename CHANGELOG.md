# Changelog

Versions follow [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`, with a
prerelease suffix (`-alpha`, `-beta`) while the toolchain is still being proven on the
target game. A version is bumped in the same commit as the change it describes, together
with a line here.

## 0.0.94-alpha — 2026-11-19

- **The project is now GPL-3.0-or-later.** The `only` was removed at the owner's request.
  Everything still borrowed is MIT (Sycatle, EpicMorg, sourcepp), which is compatible with an
  from the notices. `package.json`, README, `CONTRIBUTING.md`, `third_party/NOTICE`,
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

## 0.0.93-alpha — 2026-11-19

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
    measured error. `extract_vtf` turns any `.vtf` into a PNG — including a texture no VMT
    names, and a chosen face of a cubemap — which the material preview could not do.
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
    cube export — node names, parents, all four rotations, twelve triangles, UVs and
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

## 0.0.92-alpha — 2026-11-19

- **The project is TypeScript, Python and PowerShell only.** The four vendored source trees
  runtime, so no tool was lost with them; the toolchain that ships is the same `dist/` plus
  the Python sidecar.
- **What replaced the trees is capability, not a gap.** Seven new tools close the work the
  libraries made possible but the toolkit could not do:
  - `read_dmx` / `write_dmx` — the Blender/Crowbar datamodel, binary v4 and KeyValues2, as
    a JSON tree with element references kept as references (a model graph is cyclic).
  - `read_smd` / `write_smd` — skeleton, frames, materials, triangles, per-vertex weights and
    the diagnostics studiomdl otherwise reports only as a failed compile. With `write_qc`
    and `run_studiomdl`, a simple prop can be authored without a DCC.
  - `write_vtf` — PNG → VTF 7.4 with a full mip chain, no VTFCmd. PNG decoding is our own
    (every filter and colour type is tested), and the pixels are compared after a round-trip.
  - `read_wav` / `convert_wav` — a sound's format, duration and loop, and a conversion to the
    16-bit PCM mono/stereo at 22050/44100 Hz that L4D2 actually decodes. Peak and RMS are
    reported, so a silent or clipped source is visible before it ships.
  either remains. sourcepp and EpicMorg stay, narrowed to the files that are genuinely
  translations — deleting a vendored tree removes the copy, not the obligation.
- **The registry is data, not code.** `src/hammer/data/hammers.json` stays where it is and
  the sidecar reads it directly.

## 0.0.91-alpha — 2026-11-19


  remaining C++ trees now use `include/` + `source/` instead of `src/` inside `src/`, with the
  five CMake references updated. One icon serves both C# projects (`csharp/assets/`), and the
  Hammer build registry moved out of the C# code tree to `src/hammer/data/`.
- **The layout is documented where it is decided.** `src/README.md` now says why the four
  native trees keep their internal layout (the build systems require it), what is not imported
  (submodules, upstream docs), and that non-code data gets a `data/` directory beside
  the language directories.
- **Nothing was built here and nothing pretends otherwise.** No CMake or dotnet is
  installed; `build/`, `target/` and `obj/` stay ignored.

## 0.0.90-alpha — 2026-11-18

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
  sorted names, so the same input produces the same bytes; anything else — encryption,
  ZIP64, a data descriptor — is refused rather than written wrong.

## 0.0.89-alpha — 2026-11-18

- **The four useful upstream implementations are now in the project.** They are filed by
  module, not by repository: `src/formats/cpp/` (sourcepp: bsppp, vpkpp, vtfpp, mdlpp,
  channel, the Core library and the build registry). Upstream READMEs, CI, docs, brand
  images and benchmark suites are not imported; the code and the build manifest of each
  language are.
  `.vtx` exist, and refuses with an actionable message when the binary is absent. The
  alternative to `run_studiomdl`: one binary, no Crowbar, DMX/glTF sources the 2009 compiler
  cannot read.
- **`hammer_status` reports the exact build.** The editor's DLL is hashed and looked up in the
  vendored registry of 182 known builds: Hammer++ 8873 L4D2 x86 is identified as
  `hpp-l4d2-8873-x86`, with its shell support. An unknown build is `null`, not a guess.
  `modified` is `true` only when the title carries `*`; Hammer++ 8873 never marks it, so
  `null` is the honest answer and the schema says so.
- **Licences travel with the code.** Each vendored tree keeps its own `LICENSE`; the
  canonical copies and the record are in `third_party/`. `third_party/NOTICES.md` says which
  path belongs to which project and what it provides.
- **Build output is ignored.** `build/`, `target/` and `obj/` are gitignored; none of these
  trees is built on this machine (no CMake or dotnet), and the TypeScript server does
  not import them.

## 0.0.88-alpha — 2026-11-18

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

## 0.0.87-alpha — 2026-11-18

- **One project, modules by meaning.** `src/` is now eleven semantic modules — `hammer/`,
  `maps/`, `models/`, `textures/`, `nav/`, `scripts/`, `campaigns/`, `assets/`, `packages/`,
  `formats/`, `core/` — and a module that holds more than one language splits by language
  underneath (`typescript/`, `python/`). Those directories carry source only: no assets, no
  licences, no upstream trees.
  Everything used from them is ported into the module it serves and credited in
  `third_party/NOTICES.md` with the upstream file name; the trees could not be built here and
  nothing imported them.
- **`third_party/` is the paperwork.** `NOTICES.md`, `NOTICE` and `licenses/` — one verbatim
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

## 0.0.86-alpha — 2026-11-18

- **VPK without `vpk.exe`.** `read_vpk`, `run_vpk_extract` and `run_vpk_build` read and write
  Valve Pak directly: version 1 is written, versions 1 and 2 are read, numbered archives
  (`_000.vpk` …) are followed, and every entry's CRC is checked against the bytes on request.
  Verified against the real `pak01_dir.vpk`: eight sampled entries read with matching CRCs.
  `run_vpk_pack` still drives `vpk.exe` so the two writers can be compared.
- **`read_vtf`.** A `.vtf` header as data — version, size, flags, frames, format and whether
  it is a cubemap — from 80 bytes. The format table is the full `IMAGE_FORMAT_*` enum from
  sourcepp/vtfpp, not the six entries that turn up in map content.
- **`read_compile_sequences`.** What the user's editor does when they press F9: the binary
  `CmdSeq.wc` (804-byte records), Hammer++'s KeyValues `hammerplusplus_sequences.cfg`, and
  Strata's `cmdseq.wc`. Reports every step with its enabled flag, executable, parameters and
  compiler stage, so a difference from `run_compile` is a fact rather than a mystery. Layout
  ported from Hammer-MCP's `CompileSequences`; a truncated file is refused instead of
  half-read.
- **`read_model_info` gains the parts of a model that placement depends on.** Attachments
  with the bone each follows, body parts and hitbox sets, read from the header the way
  `mdlpp` documents it. `mstudioattachment_t` is 92 bytes in L4D2 — not the 60 of the older
  SDK — and the name index is relative to the entry itself; verified against
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
  build commands, so the algorithm reference survives the removal of the temporary
  `.3d-projects` folder. Nothing there is compiled or published. `THIRD-PARTY-NOTICES.md`
  records the copyright lines and moves the three projects to the used table, and adds three
  SourceMod navigation repositories as reference-only — including why `sourcepawn-navmesh`'s
  GPL cannot cover the parser it credits to an unlicensed upstream.

## 0.0.85-alpha — 2026-11-18

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

## 0.0.84-alpha — 2026-11-18

- **Hammer++ complete reference.** `docs/reference/hammerpp-complete-reference.md`
  inventories build 8873: every editor feature, the settings that change output
  (`IOParamNewDelimiter`, `vertices_plus`, HDR preview, instance collapse), the Tools++
  flags and limits (`-l4d2`, `-staticpropformat 9`, `-simpleladders`, AO, texture shadows,
  `-both`), the VMF blocks Hammer++ adds, and a feature → tool matrix.
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
- **Honest gaps recorded.** Propper++ (brush → model), hotspot `.rect` lookup, 4-way blend
  verification and the preview-map fallback for HLMV remain open.

## 0.0.83-alpha — 2026-11-18

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

## 0.0.82-alpha — 2026-11-18

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

## 0.0.81-alpha — 2026-11-18

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

## 0.0.80-alpha — 2026-11-18

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

## 0.0.79-alpha — 2026-11-18

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

## 0.0.78-alpha — 2026-11-18

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

## 0.0.77-alpha — 2026-11-18

- **Nav generation now stages the BSP and nav mesh it actually produced.** The engine
  rewrites the BSP stringtable before writing the nav; the old tool returned only the nav,
  so a build paired a fresh mesh with a pre-generation BSP and the game reported
  "Map is unplayable". `run_nav_generate` now returns `bsp`, and the nav docs say to stage
  the pair and check `read_nav` for `fresh`.
- **`navSlopeLimit` is a tool argument.** L4D2's default rejects steep stairs and
  escalators; `navSlopeLimit: 0.5` allowed the 23-degree Moscow escalator to generate nav.
- Full findings from the first wish-to-campaign build are in
  `docs/reports/2026-11-18-wish-build-findings.md`.

## 0.0.76-alpha — 2026-11-17

- **The three new Hammer++ helpers were proven end to end.** A sealed probe map was built
  with `merge_solids` (two adjacent brushes to one), `move_to_surface` (a floating brush to
  the floor) and `create_instance_from_selection` (a brush extracted to a file, leaving
  `func_instance`). Stock vbsp then compiled it with exit 0; the only warning was the
  deliberately absent test material. The coverage table marks all three verified.

## 0.0.75-alpha — 2026-11-17

- **`references/mapping/level-design.md`.** Room and doorway sizes against the standing
  hull, one decision per room, cover heights, sightlines, verticality, lighting/weather and
  a first-chapter recipe that matches the campaign already proven in game. It is the layer
  between a wish and geometry: the tools measure, this page decides.
- The wish workflow and `SKILL.md` route a new build through it.

## 0.0.74-alpha — 2026-11-17

- **A wish-first campaign workflow.** `workflows/from-a-wish.md` turns a user's description
  into a spec (chapters, flow, mechanics, assets, done-means), then hands the spec to the
  build workflow. It requires every asset from `read_game_content`, every entity from
  `read_fgd_class`, and one evidence line per requested mechanic.
- The campaign checklist now opens with the brief and closes with per-wish evidence, so
  "map loads" cannot stand in for "the tank and the finale work". `SKILL.md` and README
  route a description through the new page first.

## 0.0.73-alpha — 2026-11-17

- **Three Hammer++ editing operations became one call each.** `merge_solids` replaces
  convex brushes with the one brush around them and refuses a non-convex or overlapping
  selection; `move_to_surface` drops or raises brushes to a traced floor or ceiling, with
  optional alignment to the surface; `create_instance_from_selection` writes a selection as
  an instance and leaves a `func_instance`, taking a brush entity whole.
- These were reachable through primitives before; they are helpers now, not new limits.

## 0.0.72-alpha — 2026-11-17

- **New troubleshooting page for mapping edits.** `troubleshooting/mapping-edits.md` covers
  a prefab pasted in the wrong place or invisible, a skewed texture, a moved brush that
  Hammer++ still draws at the old position, an overlay lost to a clip, and a brush entity
  that did not move. Each has symptom, cause, check and fix, with the tool that answers it.
- The stale capability list in `SKILL.md` is corrected: nav generation and model compilation
  are tools, and the unsupported list now names two-team rounds, a full Survival wave, the
  headless HLMV canvas and the genuinely manual design work.

## 0.0.71-alpha — 2026-11-17

- **Hammer++'s `vertices_plus` stays in step with geometry edits.** `transform_solids` and
  `move_vertices` move the exact face loop through the same matrix as the plane;
  `clip_solids` drops it from cut and surviving faces because their loop changed. Before
  this, a moved brush kept its old loop and Hammer++ would draw it where it used to be.
- Unknown Hammer++ root blocks still survive byte-for-byte; the coverage page now documents
  both behaviours.

## 0.0.70-alpha — 2026-11-17

- **`insert_prefab` now turns as well as moves.** It takes `rotate` (yaw degrees) and
  `pivot`; the whole fragment is transformed, including solids owned by brush entities.
  Point entities have their `origin`, `angles` and `angle` turned with the geometry, so a
  rotated prefab no longer leaves its entities facing the old way. Hidden solids and a
  nested `func_instance` still return warnings.
- The previous warning about brush-entity geometry not moving is gone because it now moves.

## 0.0.69-alpha — 2026-11-17

- **`insert_prefab` and `set_face_uv` were proven end to end.** A prefab brush plus an
  `info_target` was pasted into a copy of the test campaign, a face was given a skewed U/V
  pair, and vbsp compiled the map with no errors; the compiled BSP then loaded in game and
  was captured. The coverage table marks both verified.

## 0.0.68-alpha — 2026-11-17

- **`set_face_uv`: the face sheet's U/V vectors by hand.** `align_faces` derives axes from a
  mode, so it cannot make a deliberately skewed pair. The new tool writes the U and V
  vectors, their offsets and scales, and the side's `rotation`; an omitted vector keeps the
  face's current one. Geometry is checked untouched and the axes are checked against the
  same reader rules (no axis along the normal, no zero scale, no degenerate pair) before
  the write.

## 0.0.67-alpha — 2026-11-17

- **Coverage docs stopped claiming HLMV launch is missing.** `run_hlmv` launches the editor
  and `capture_window` returns its UI; only the 3D canvas needs an interactive desktop. The
  "genuinely missing" list now names that environment limit instead of an absent operation,
  and the mechanics table says the same.

## 0.0.66-alpha — 2026-11-17

- **`insert_prefab` validates what it appended.** A fragment pasted into a file without a
  trailing newline now starts on its own line, and the write is refused unless the target
  ends up with exactly the old entity count plus the prefab's root entities.

## 0.0.65-alpha — 2026-11-17

- **`insert_prefab`: paste a saved Hammer prefab into a map.** A prefab is a `.vmf`
  fragment, not a live `func_instance`. World brushes and root entities are inserted, every
  brush/side/entity id is remapped to a free one, and the fragment can be offset. Every
  inserted world brush is checked as a valid solid before the write.
- Brush-entity geometry is inserted but the offset is not applied inside it, and point
  entities without an origin cannot move; the tool returns a warning instead of pretending
  the whole fragment moved. The Hammer coverage table no longer has a `Prefabs` gap.

## 0.0.64-alpha — 2026-11-17

- **Split-screen was researched and tested.** The PC build has an unsupported
  `ss_enable 1` / `ss_splitmode 2` mode, usually driven by a community `split-screen.txt`,
  a controller and menu add-ons. Launching the map with `+ss_enable 1 +ss_splitmode 2` did
  not split the viewport here; the frame stayed single-player.
- `testing/multi-client.md` now separates the three paths: split-screen (one account, one
  client, unverified for two teams), a dedicated server with survivor bots and one client on
  Infected, and a second Steam account. Split-screen bypasses `No Steam logon` but does not
  by itself prove a Versus/Scavenge two-team round.

## 0.0.63-alpha — 2026-11-17

- **Multi-client testing was attempted and its limit documented.** Two clients start with
  `-multirun -windowed` (the second fails D3D in fullscreen), connect to the local listen
  server and load the map, but Steam drops the second with `No Steam logon` / failure code
  8: one account cannot authenticate twice. `-insecure` is not a workaround.
- New `testing/multi-client.md` lists the solo options: a dedicated server plus one client
  (survivor bots, client on Infected), a second Steam account, or split-screen; and says a
  single client only proves mode load/HUD, not a two-team round.

## 0.0.62-alpha — 2026-11-17

- **Survival's setup phase is documented.** Loading the map in `survival` gives the HUD but
  leaves the timer at `00:00.00`; the round needs a `trigger_finale` / `ForcePanicEvent`.
  Waiting 45 s without one produced no wave and no timer movement. `mechanics/survival.md`
  now says this explicitly, so a later test does not mistake the setup phase for a broken
  map or a finished wave.
- No functional changes.

## 0.0.61-alpha — 2026-11-17

- **Versus is verified to load.** The mission lists `hsmcp_test_m1` under `versus`, and
  `run_map_test` with `extraArgs: ["+mp_gamemode", "versus"]` loaded it in 33 s and ran
  `VSCRIPT: Running anv_versus.nut`. The map is playable with the same nav as coop. A
  single-player listen server does not populate both teams, so the full Versus HUD/round was
  not observed.
- New reference `mechanics/versus.md`: mission block, launch argument, the mode-script
  evidence, and the pitfall that Scavenge gas cans are map entities and show in Versus too.

## 0.0.60-alpha — 2026-11-17

- **Scavenge is verified.** The mission lists `hsmcp_test_m1` under `scavenge`, and the map
  has 16 `weapon_scavenge_item_spawn` points. `run_map_test` with
  `extraArgs: ["+mp_gamemode", "scavenge"]` loaded it in 32 s: the HUD showed
  `SCORE 0 / 16`, the `01:30.00` round timer, `SECONDS UNTIL ROUND BEGINS`, and a gas can in
  the frame. A full two-team round was not played.
- New reference `mechanics/scavenge.md`: mission block, the 16 gas-can points, the launch
  argument, HUD evidence, and the leak pitfall when a spawn sits outside the hull.

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
