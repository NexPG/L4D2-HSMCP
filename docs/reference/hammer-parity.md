# Hammer, command by command

The question this answers is "can an agent do everything a mapper can do in Hammer", and
the reason it exists as a table rather than as a sentence is that the sentence is not
checkable. A README can claim parity. A row per command can be argued with.

Four things are true of every row below, and worth saying once rather than in each of them:

- **Coverage means the *result* is reachable**, not that the command was reimplemented.
  Hammer's Carve is not here and never will be; what it produces comes out of `clip_solids`
  used more than once, without the shattered brushes it is famous for.
- **Everything writes by splicing.** A tool changes the bytes it names and no others, so a
  diff of a machine edit reads like a diff of a human one.
- **Four reasons are admitted for never covering something**, and no others: the mouse, the
  3D view, aesthetic judgement, and the running engine. Where one of those is the reason, it
  is named.
- **Reached is not proven.** The [README's own table](../README.md#proven-and-not-proven)
  says which of these have been through a compiler, an engine, or an outside implementation.
  This one is about reach.

Last checked against the tool list on 18/11/2026: **117 tools**.

## The file itself

This section exists because the table did not have it, and a table cannot notice a command
it never listed. `File > New` was missing from every row below, and nothing here created a
`.vmf` — which was found by trying to build a map with these tools and nothing else, and
getting `ENOENT` on the first call.

| Hammer | Here | Notes |
|---|---|---|
| File > New | `write_vmf` | worldspawn with a `skyname`, and the five blocks Hammer writes. Refuses to overwrite |
| File > Open | `read_vmf` | |
| File > Save | *every writer* | Each tool writes its own change by splicing. There is no document held open to save |
| File > Export to .map | `export_vmf_map` | Valve 220 text: planes, materials, uaxis/vaxis; VMF-only constructs are reported, not silently lost |

## Blocks and geometry

| Hammer | Here | Notes |
|---|---|---|
| Block tool - box | `write_vmf_solid` | |
| Terrain patch | `write_vmf_terrain` | Grid -> displacement -> noise -> sew in one call |
| Block tool — wedge | `write_vmf_solid` | Five faces, not a box with a collapsed edge |
| Block tool — cylinder | `write_vmf_solid` | Half-step offset, so an even prism faces an axis |
| Block tool — arch | `write_vmf_solid` | Refuses a segment past a quarter turn: beyond it, four corners describe the complement of the sector |
| Block tool — sphere | `write_vmf_solid` | A stack of frusta. One brush per stack, and the tool says how many |
| Block tool — torus | `write_vmf_solid` | One brush per segment |
| Block tool — cone | `write_vmf_solid` | |
| Block tool — stairs | `write_vmf_solid` | Says when the rise exceeds the 18 units a player climbs |
| Arbitrary convex solid | `write_vmf_solid` (`convex`) | Face by face, for what the primitives do not reach |
| Selection: move / rotate / scale | `transform_solids` | Texture lock on by default, refused where it cannot be exact |
| Copy / paste | `clone_solids` | Fresh solid and side ids; materials and alignment copied byte for byte |
| Flip / mirror | `transform_solids` | |
| Delete | `delete_solids` | |
| **Clip tool** | `clip_solids` | Front, back or both. Both must sum to the original volume or the write is refused |
| **Vertex manipulation** | `move_vertices` | Refuses what Hammer refuses: a move that leaves a face non-planar |
| Make Hollow | `hollow_solids` | Mitred. Hammer's own version overlaps at the corners |
| **Carve** | *not implemented, on purpose* | Its result comes from `clip_solids` repeated. An operation whose correct use is "don't" is not a gap |
| Snap to grid | `transform_solids` (`grid`) | Optional and measured: snapping is what makes a face stop being flat |
| Nudge | `transform_solids` (`move`) | |
| Merge brushes | `merge_solids` | One convex brush; refuses a non-convex or overlapping selection |
| Move objects to floor/ceiling | `move_to_surface` | Traces the .vmf; optional alignment to the surface |

## Faces and textures

| Hammer | Here | Notes |
|---|---|---|
| Apply current texture | `set_face_material` | Selects by solid, material, facing or area |
| Browse textures | `read_game_content` | Searches the game's own VPKs. Returns names in the form a `.vmf` stores |
| Browse models by kind | `read_asset_catalog` | What Hammer's model browser shows grouped: escalators, stairs, doors, vehicles, foliage, street, interiors, lights, signs, plus every sky's LDR/HDR completeness |
| Align to World | `align_faces` (`world`) | vbsp's own base-axis table |
| Align to Face | `align_faces` (`face`) | Axes kept perpendicular by orthogonalisation, not by a cross product — vbsp's table is not consistently handed |
| Fit | `align_faces` (`fit`) | Assumes a 512-texel texture and says so |
| Scale / shift / rotate U,V | `align_faces` | |
| U/V vectors by hand (skew) | `set_face_uv` | Writes the axis vectors, offsets, scales and `rotation`; refuses illegal axes |
| Justify (top/left/…) | `align_faces` (`shift`) | Expressed as a shift rather than as nine buttons |
| Lightmap scale | `set_lightmap_scale` | Projects the luxel bill before writing |
| Smoothing groups | `set_smoothing_groups` | Takes Hammer's 1–32 and does the bit shifting |
| Alt+click (copy alignment) | `copy_face_alignment` | Exact uaxis/vaxis from a named face; optional material and lightmap scale |

## Displacements

| Hammer | Here | Notes |
|---|---|---|
| Create | `write_displacement` | Power 2, 3 or 4 |
| Destroy | `edit_vmf` | The `dispinfo` block is removed like any other |
| Sew | `sew_displacements` | Averages, so a ridge is not dragged to one side |
| Paint Alpha | `paint_displacement` | Uniform, by height, or by slope of the resulting surface |
| Paint Geometry — raise/lower | `sculpt_displacement` (`raise`) | |
| Paint Geometry — flatten | `sculpt_displacement` (`flatten`) | |
| Noise | `sculpt_displacement` (`noise`) | Takes a seed. A terrain that cannot be regenerated cannot be reviewed |
| Subdivide | `subdivide_displacements` | Resamples the old grid bilinearly, carries alpha and triangle tags, and reads the result back |
| Free-hand sculpting | *the mouse* | Declarative shapes are here; dragging a brush over a hillside is not something a tool call is |
| Displacement seams | `read_displacements` | Reports them, which Hammer does not |

## Terrain and water

| Hammer | Here | Notes |
|---|---|---|
| Water brush | `write_vmf_water` | `func_water_analog` + `water_lod_control`; the material is checked for the Water shader before writing |

## Entities

| Hammer | Here | Notes |
|---|---|---|
| Place a point entity | `edit_vmf` | Including `prop_static`: it is an ordinary entity in a `.vmf` |
| Place a point entity in the open editor | `hammer_live_edit` | Live shell channel; lands in Hammer's undo history, entity-level only |
| Edit/delete/rotate an open-editor entity | `hammer_live_edit` | Addressed by class + origin, the shell channel's own limit |
| Save / undo / redo / Run Map / Check for Problems | `hammer_menu` | The editor's own menu ids, not a reimplementation |
| See which editor is attached | `hammer_status` | Process, shell window, main window, open map |
| Tie to entity / move to world | `set_solid_class` | |
| Edit keyvalues | `edit_vmf` | |
| Entity Report | `read_entity_report` | Filterable by classname, targetname or a key's presence. Takes a `.vmf` **or a compiled `.bsp`** |
| Outputs and inputs | `edit_vmf` | |
| **Check the wiring** | `validate_io` | Hammer does not do this. An output into a name nothing has is silent everywhere else. Takes a `.vmf` **or a compiled `.bsp`** — Hammer cannot open one at all |
| Compile a model | `run_studiomdl` | The game's `studiomdl.exe`; reads `$modelname` and proves the `.mdl` and its companions exist |
| Preview a model | `run_hlmv` | Launches HLMV, optionally captures the window; the screenshot comes back as a real image block |
| See a GUI | `capture_window` | Captures any window by process id or name; PrintWindow works while occluded, screen mode is the 3D fallback |
| Model browser | `read_model_info` | Bounds, skins, sequences, materials |
| Look at a model or texture | `preview_asset` | Material: base VTF decoded to a PNG. Model: HLMV viewport captured |
| Paste a prefab | `insert_prefab` | A saved `.vmf` fragment; fresh ids, move, yaw about a pivot; brush-entity geometry and entity angles turn with it |
| `func_instance` | `edit_vmf` | Created as an entity; `read_vmf` expands them with `collapseInstances` |
| Rotating door | `place_door` | Origin is the hinge; model hull read with `read_model_info`; checkpoint names checked |
| Create instance from selection | `create_instance_from_selection` | Writes the instance file, recentres it and leaves one `func_instance`; a brush entity is taken whole |
| Areaportals | `write_portal` | |
| Occluders | `write_portal` | |
| Map Properties | `set_map_properties` | worldspawn only. Says when `detailvbsp` and `detailmaterial` are set apart |
| Any map property | `set_worldspawn` | Any worldspawn key, including mod keys; `id` and `classname` protected |
| Fog | `edit_vmf` | Source reads it from an `env_fog_controller`, not from worldspawn — `set_map_properties` offered fog keys for one commit and produced none in game |

## Organisation

| Hammer | Here | Notes |
|---|---|---|
| Visgroups | `set_visgroup`, `read_map_organisation` | Writes both halves: a membership with no declaration is dropped by Hammer without a word |
| Groups | `group_solids` | |
| Cordon | `set_cordon` | The one setting that changes what compiles |
| Hide / show | *the 3D view* | A visgroup's visibility flag is written; what an editor draws is not this toolkit's business |
| Selection sets | *not applicable* | Selectors are per call by design. State living in the server is state the tests would have to simulate |

## Compiling and shipping

| Hammer | Here | Notes |
|---|---|---|
| Run map | `run_compile` | vbsp, vvis, vrad, stock or the Hammer++/Tools++ chain; the compilers are Windows-native here |
| Open the map in the editor | `open_in_hammer` | Launches Hammer++ on the VMF and captures its window; the editor viewport is the one visual layer a writer cannot reproduce |
| See the running map | `run_map_test` | waits for a marker, can install a bsp and nav, and can capture the game window as a real image; `screen` method |
| Read the compile log | `read_compile_log` | Turns each message into what it actually means |
| Find the leak | `read_leak` | A position and the entity that caused it, from a compile that already ran |
| Find the leak **before** compiling | `read_vmf_leak` | Hammer cannot. vbsp is the only thing that answers this today, and it costs a toolchain and minutes |
| Pack content | `run_pack` | `auto:true` derives the list from the map |
| Check what is missing | `read_map_dependencies` | The end of "purple checkerboard for the player, fine for me" |
| Budgets | `read_map_report` | A verdict per criterion rather than another number |
| Walking the map to check it | `read_vmf_trace`, `read_vmf_visibility` | Hammer has no answer at all: you compile and go and look. These trace the `.vmf` itself |
| Rename a finished map | `run_bsp_rename` | Hammer cannot: the map is compiled by then. Renaming the file alone orphans everything packed under `maps/<name>/`, silently. Drives ficool2's `bsp_rename`, a separate download |
| Build cubemaps | `run_build_cubemaps` | The engine's `-buildcubemaps` launch mode: loads the map, captures every sample, writes the `.vtf` files and quits. HDR verified on the test campaign; LDR and both-mode are runnable but not yet measured |
| Generate a nav mesh | *the running engine* | Same. `read_nav` says whether one still matches its map |

## What is not here, and will not be

| | Why |
|---|---|
| The 2D and 3D views | The mouse. Placing something by eye is not a thing a tool call is. **Looking** is now covered from both sides: `render_vmf_view` draws the map from any camera and `render_vmf_plan` draws it as a dimensioned plan, both without the game and without a compile. What neither can be is a viewport you drag things in |
| Judging whether a map looks right | Aesthetic judgement does not have a number. A tool that produced one would be producing a false one |
| Carve | Covered by `clip_solids`; see above |
| VIS/RAD preview in the editor | The running engine |
| Driving the game console interactively | `run_map_test` waits for a log pattern; it does not type commands into a live session |

## The honest summary

Everything a mapper *builds* is reachable. Everything a mapper *checks* is reachable, and a
few things Hammer never checked are too — the wiring, the seams, the packing list.

No row says "not covered" any more. The remaining limitations are tracked in the skill
coverage: HLMV's 3D canvas without an interactive desktop, 3D-skybox layout, and the
visual checks that need a person at the screen. Hammer++'s editor-only layer (previews,
gizmos, app settings) is translated to file-level operations in
`references/mapping/hammer-coverage.md`; it is not a gap in what a map can contain.

It is worth saying what this document got wrong, because it bears on how much the rest of it
is worth. Until 13/08/2026 there was no `File` section at all, so the table claimed near-total
parity while nothing here could **create a map**. No test caught it: `parity.test.ts` checks
that every tool named is real and that the count has not moved, which is exactly the wrong
direction for a missing row. A table of commands can only be as complete as the list of
commands somebody thought to write down, and the thing that found this one was building a map
with these tools and nothing else.

## Beyond Hammer

Dozens of the tools here answer questions Hammer never asked. They are not parity and
they are not gaps: they are the half of a mapper's work that used to happen by loading the
map and looking, or by not happening at all.

| Tool | What Hammer has instead |
|---|---|
| `health` | nothing |
| `read_hammerpp` | nothing: the editor's settings file is not a map command, but it decides I/O and brush precision |
| `open_in_hammer` | launching the editor is the one visual layer a writer cannot reproduce |
| `read_source_games` | a dialog you fill in yourself |
| `read_bsp_info` | nothing: a compiled map is opaque to the editor |
| `read_bsp_entities` | nothing |
| `edit_bsp_entities` | nothing: Hammer edits the VMF, and the compiled entity lump is opaque |
| `read_text_file` | nothing: Hammer does not open QC, SMD or VMT as text |
| `write_text_file` | nothing: source formats are edited in a text editor |
| `read_nav_dump` | nothing: the engine's own nav dump is not readable from Hammer |
| `nav_trouble_report` | `nav_trouble_report` in the console, read by eye; this selects the same areas and returns their coordinates |
| `run_nav_generate` | the engine's nav generator, driven without a person at the console |
| `check_finale` | nothing: no editor checks the finale contract — type, script, stage list, nav area, escape outputs |
| `run_campaign_gate` | nothing: lint, compile, nav, collision, finale, trouble report and map test are separate manual acts |
| `run_map_test` | nothing: loading a map and watching the console is a manual act |
| `write_vscript` | nothing: Hammer cannot author or attach a Squirrel script |
| `write_overlay` | the overlay tool, driven by a side id and a point instead of a drag |
| `write_instance` | the instance tool, without the GUI or the file dialog |
| `write_sky_camera` | the sky_camera entity, with the one-per-map and skyname checks |
| `write_skybox_copy` | the copy/scale/move half of a 3D skybox; sealing and design stay with the mapper |
| `write_weather` | `func_precipitation` and `env_fog_controller` with FGD-checked choices and a checked brush |
| `read_map_extents` | nothing |
| `read_map_geometry` | nothing — how full each lump is against vbsp's ceiling |
| `read_prop_survey` | nothing |
| `read_static_props` | nothing: Hammer shows a static prop as solid even when its model has no `.phy` |
| `read_pakfile` | nothing |
| `run_pakfile_extract` | nothing: a compiled map's packed content could be listed and never opened |
| `run_cubemap2hdr` | nothing offline. The engine builds cubemaps in whichever mode it is running |
| `run_tga2skybox` | nothing offline: six TGAs into LDR and HDR cubemap `.vtf` files |
| `run_vtf_convert` | nothing: Hammer browses textures, it does not make them |
| `read_sightlines` | the eye, standing in the map |
| `read_vmf_rooms` | nothing: Hammer has no idea what a room is |
| `read_vmf_surfaces` | nothing: no readout says which faces are buried between brushes |
| `render_vmf_view` | the 3D viewport, which needs a person at a mouse |
| `render_vmf_plan` | the 2D view, which has no dimensions on it and no idea what a room is |
| `render_vmf_tour` | walking the map yourself, after a compile. Nothing offline shows a whole place in one look |
| `measure_vmf_clearance` | the tape measure tool, which measures between two points you pick — not the free width at a place |
| `measure_vmf_approach` | nothing: no editor asks whether a person fits in front of a door |
| `read_vmf_sightlines` | the eye again, and only after a compile |
| `check_vmf_rules` | nothing at all: a design brief has never had a checkable form |
| `read_vmf_nearest_surface` | nothing: how near a wall a point is has no readout at all |
| `read_brush_volumes` | nothing |
| `read_materials` | nothing, for a compiled map |
| `read_lightmap_budget` | nothing: where a map's luxels went |
| `read_visleaf_stats` | `mat_leafvis` in the running game |
| `read_fgd_class` | the entity dialog, one class at a time |
| `read_vmf_solids` | the red "invalid solid" outline, and no reason |
| `read_vmf_lint` | nothing |
| `normalize_vmf_io` | turns Hammer++'s ESC-separated outputs into the comma form L4D2 reads |
| `write_vmf_fitting` | prefabs, which are a saved lump of geometry at whatever size somebody once drew it. Nothing in Hammer knows how tall a counter is |
| `write_hint_brush` | a brush you texture yourself and hope |
| `read_campaign` | nothing: the game reads mission files, the editor never shows them |
| `write_campaign` | nothing: a mission file is written by hand |
| `check_campaign` | nothing: no editor checks that a campaign's maps and images exist |
| `run_vpk_pack` | nothing: Hammer has no addon packaging |

The row that matters most is `read_vmf_solids`. Hammer draws an invalid solid in red and
tells you nothing else; this says which face, which corner, and why — and it is the oracle
every writer in this repository is checked against.
