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

Last checked against the tool list on 22/11/2026: **249 tools**.

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
| Selection: move / rotate / scale | `transform_solids` | Texture lock on by default, refused where it cannot be exact. A 30-degree turn and a non-uniform scale compiled with vbsp |
| Copy / paste | `clone_solids` | Fresh solid and side ids; materials and alignment copied byte for byte |
| Flip / mirror | `transform_solids` | |
| Delete | `delete_solids` | |
| **Clip tool** | `clip_solids` | Front, back or both. Both must sum to the original volume or the write is refused. Two cuts (the 3-point clip) compiled with vbsp |
| **Vertex manipulation** | `move_vertices` | Refuses what Hammer refuses: a move that leaves a face non-planar. A broadened edge compiled with vbsp |
| Make Hollow | `hollow_solids` | Mitred. Hammer's own version overlaps at the corners. Verified by vbsp |
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
| Fit | `align_faces` (`fit`) | Reads the texture's real size from the VTF through the sidecar; 512 texels only when the material cannot be read, and then it says so. `fitRect` fits a `.rect` hotspot instead of the whole texture |
| Hotspot rectangles | `read_rect`, `write_rect`, `align_faces` (`fitRect`) | Hammer++ `.rect`: KeyValues, one rectangle per panel. L4D2 ships none, so the grammar round-trip is the file oracle |
| Scale / shift / rotate U,V | `align_faces` | |
| U/V vectors by hand (skew) | `set_face_uv` | Writes the axis vectors, offsets, scales and `rotation`; refuses illegal axes |
| Justify (top/left/…) | `align_faces` (`shift`) | Expressed as a shift rather than as nine buttons |
| Lightmap scale | `set_lightmap_scale` | Projects the luxel bill before writing. Verified: scale 32 reached FACES |
| Smoothing groups | `set_smoothing_groups` | Takes Hammer's 1-32 and does the bit shifting. Verified: group 13 is the mask 4096 in the BSP |
| Alt+click (copy alignment) | `copy_face_alignment` | Exact uaxis/vaxis from a named face; optional material and lightmap scale |

## Displacements

| Hammer | Here | Notes |
|---|---|---|
| Create | `write_displacement` | Power 2, 3 or 4. A displaced brush stops sealing; `seal:true` writes the duplicate back |
| Destroy | `edit_vmf` | The `dispinfo` block is removed like any other |
| Create Sealing Brush | `seal_displacements` | Duplicates each displaced world brush, drops the `dispinfo`, tool-textures the copy. Measured: the bare room leaks, the sealed one compiles |
| Sew | `sew_displacements` | Averages, so a ridge is not dragged to one side. Verified on a sealed patch |
| Paint Alpha | `paint_displacement` | Uniform, by height, or by slope of the resulting surface. Verified through vbsp |
| Paint Geometry — raise/lower | `sculpt_displacement` (`raise`) | |
| Paint Geometry — flatten | `sculpt_displacement` (`flatten`) | |
| Noise | `sculpt_displacement` (`noise`) | Takes a seed. A terrain that cannot be regenerated cannot be reviewed |
| Subdivide | `subdivide_displacements` | Resamples the old grid bilinearly, carries alpha and triangle tags, and reads the result back. Verified through vbsp |
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
| `read_surfaceprops` | nothing: the editor does not show the surface property table or its inheritance |
| `check_surfaceprop` | nothing: Hammer lets any string into `$surfaceprop` and never checks it |
| Look at a model or texture | `preview_asset` | Material: base VTF decoded to a PNG. Model: HLMV viewport captured
| Look at a model in the engine | `preview_model` | When HLMV's 3D canvas is blank, builds a sealed room, compiles it, generates a nav and captures the real game view; the model's lowest point is placed on the pedestal |
| Paste a prefab | `insert_prefab` | A saved `.vmf` fragment; fresh ids, move, yaw about a pivot; brush-entity geometry and entity angles turn with it |
| `func_instance` | `edit_vmf` | Created as an entity; `read_vmf` expands them with `collapseInstances` |
| Rotating door | `place_door` | Origin is the hinge; model hull read with `read_model_info`; checkpoint names checked |
| Create instance from selection | `create_instance_from_selection` | Writes the instance file, recentres it and leaves one `func_instance`; a brush entity is taken whole |
| Areaportals | `write_portal` | Verified: a `func_areaportal` filling a sealed doorway compiled with vbsp and vvis |
| Occluders | `write_portal` | |
| Map Properties | `set_map_properties` | worldspawn only. Says when `detailvbsp` and `detailmaterial` are set apart |
| Any map property | `set_worldspawn` | Any worldspawn key, including mod keys; `id` and `classname` protected |
| Fog | `edit_vmf` | Source reads it from an `env_fog_controller`, not from worldspawn — `set_map_properties` offered fog keys for one commit and produced none in game |
| Lights | `write_light` | Point, `light_environment`, `light_dynamic`, `env_sun`, `shadow_control`; `_light` is the four-number colour+brightness form, and the sun gets angles. Compiles |
| Postprocess | `write_postprocess` | Tonemap controller wired through a `logic_auto` (it has no setting keyvalues), fade, shake, and L4D2's `color_correction` |
| Decals | `write_decal` | `infodecal` projected onto a face; a sized overlay is `write_overlay` |
| Ropes | `write_rope` | The `move_rope`/`keyframe_rope` pair linked by `NextKey`; one alone renders nothing |
| Sprites, beams, lasers | `write_sprite` | Creates the two `info_target`s a beam needs and the end target a laser needs; `.spr` paths |
| Safe room | `write_safe_room` | Checkpoint door on its hinge, player start, four ordered survivor positions and a director |
| Chapter change | `write_changelevel` | The `info_changelevel` brush volume and its landmark; departure or arrival (`spawnflags 2`) |
| Finale | `write_finale_setup` | `trigger_finale` with L4D2's type numbers (0, 1, 2, 4), custom script, start state and escape positions |
| Spawn areas | `write_spawn_points` | Player, survivor, zombie and rescue spawns with the keys each reads |
| Item density | `write_map_parameters` | The 18 density keys of `info_map_parameters` or its versus variant |

## Organisation

| Hammer | Here | Notes |
|---|---|---|
| Visgroups | `set_visgroup`, `read_map_organisation` | Writes both halves: a membership with no declaration is dropped by Hammer without a word |
| Auto Visgroups | `auto_visgroups` | Fills the tree from what the file contains: one group per entity class and one per material, a solid joining its dominant material by face area |
| Groups | `group_solids` | |
| Cordon | `set_cordon` | The one setting that changes what compiles. `run_compile` now filters the copy, and the outside leak is absent from the BSP |
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
| Pack content | `run_pack` | `auto:true` derives the list from the map. Native ZIP writer, no bspzip; verified byte for byte |
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
| `read_bsp_lump` | nothing: a compiled map's 64 lumps are opaque, and a compressed one could not even be opened |
| `write_bsp_lump` | nothing: Hammer cannot write a lump |
| `read_text_file` | nothing: Hammer does not open QC, SMD or VMT as text |
| `write_text_file` | nothing: source formats are edited in a text editor |
| `read_nav_dump` | nothing: the engine's own nav dump is not readable from Hammer |
| `read_nav_areas` | nothing: Hammer never shows a nav area, its attributes or its connections |
| `read_nav_places` | nothing: Hammer has no place-table view or place summary |
| `read_nav_hiding_spots` | nothing: hiding spots are generated by `nav_analyze`, and Hammer cannot list or edit them |
| `read_nav_visibility` | nothing: visibility lists and their inherited deltas are invisible in the editor |
| `read_nav_encounters` | nothing: encounter paths and the spots a bot looks at along them are generated data Hammer cannot show |
| `write_nav_areas` | the nav edit commands, typed one area at a time with no undo |
| `edit_nav_connections` | the nav connection commands, one area and one direction at a time |
| `nav_trouble_report` | `nav_trouble_report` in the console, read by eye; this selects the same areas and returns their coordinates |
| `nav_path` | nothing: the editor cannot ask whether a route exists or where it goes |
| `nav_reachable` | nothing: a mapper finds a disconnected region by playing it |
| `nav_los` | nothing: Hammer has no nav-aware sight query |
| `run_nav_generate` | the engine's nav generator, driven without a person at the console |
| `check_finale` | nothing: no editor checks the finale contract — type, script, stage list, nav area, escape outputs |
| `run_campaign_gate` | nothing: lint, compile, nav, collision, finale, trouble report and map test are separate manual acts |
| `run_map_test` | nothing: loading a map and watching the console is a manual act |
| `read_vscript` | nothing: the editor never reads a `.nut` |
| `write_vscript` | nothing: Hammer cannot author or attach a Squirrel script |
| `write_overlay` | the overlay tool, driven by a side id and a point instead of a drag |
| `write_instance` | the instance tool, without the GUI or the file dialog |
| `write_sky_camera` | the sky_camera entity, with the one-per-map and skyname checks |
| `build_skybox` | copy, sealed room and `sky_camera` in one call; `write_skybox_copy` is the copy/scale/move half |
| `write_weather` | `func_precipitation` and `env_fog_controller` with FGD-checked choices and a checked brush |
| `read_map_extents` | nothing |
| `read_map_geometry` | nothing — how full each lump is against vbsp's ceiling |
| `read_prop_survey` | nothing |
| `read_static_props` | nothing: Hammer shows a static prop as solid even when its model has no `.phy` |
| `read_model_collision` | nothing: Hammer shows a static prop as solid without saying whether its `.phy` is one hull or several, whether it needs `$concave`, or what ragdoll solids and constraints it carries |
| `read_model_skeleton` | nothing: Hammer cannot show a compiled model's bones or write their `$definebone` lines, and the rotation order is not guessable |
| `read_model_animation` | nothing: Hammer cannot show a compiled model's sequences, events, pose parameters, IK chains or `$includemodel` entries |
| `read_model_flexes` | nothing: Hammer cannot inspect a compiled model's flex descriptors, rules or vertex deltas |
| `read_model_eyes` | nothing: the editor cannot show eyeballs or lids, and L4D2's compiler has no `$eyeball` command to recreate them |
| `read_model_jiggle` | nothing: the editor cannot show a jigglebone's stiffness, constraints or boing parameters |
| `read_model_ani` | nothing: an external `.ani` block table is not exposed by the editor |
| `read_model_procedural` | nothing: Hammer cannot show quat-interp helpers or aim rules, and has no `.vrd` view |
| `read_model_lods` | nothing: a model's LOD switch distances and per-LOD materials are not in the editor |
| `read_vta` | nothing: a VTA is a compiler input the editor never shows |
| `write_vta` | nothing: flex targets are authored in a 3D package, not in Hammer |
| `edit_static_props` | Hammer edits the VMF; a compiled map's baked prop has no editor command |
| `read_particle` | Hammer lists `.pcf` files, not the systems inside them, their materials or a map's `effect_name` resolution |
| `write_particle` | Valve's separate Particle Editor, not Hammer, authors a `.pcf` |
| `read_bsp_faces` | nothing: Hammer reads the source, not the compiled faces, their masks or luxels |
| `read_bsp_lightmaps` | nothing: baked RGB luxels and one face's lightmap as a PNG |
| `read_bsp_vis` | `mat_leafvis` shows the leaf the player is in; this decodes PVS cluster vectors |
| `read_bsp_overlays` | nothing: vbsp replaces `info_overlay` with a 352-byte compiled record |
| `diff_vmf` | a textual diff of a map is unreadable; this says which brushes, entities and worldspawn keys changed |
| `review_map` | no editor runs the whole checklist in one call, and none distinguishes clean from a check that did not run |
| `check_bsp` | nothing says whether a compiled map is structurally sound or stale against its VMF |
| `compare_renders` | nothing offline diffs two versions of the same view; this reports changed pixels and where |
| `read_pakfile` | nothing |
| `run_pakfile_extract` | nothing: a compiled map's packed content could be listed and never opened |
| `run_pakfile_add` | nothing: Hammer cannot put a file into a compiled map |
| `run_cubemap2hdr` | nothing offline. The engine builds cubemaps in whichever mode it is running |
| `run_tga2skybox` | nothing offline: six TGAs into LDR and HDR cubemap `.vtf` files |
| `run_vtf_convert` | nothing: Hammer browses textures, it does not make them |
| `convert_vtf` | nothing: reformat or resize a shipped .vtf, without VTFCmd |
| `write_cubemap_vtf` | nothing offline: six named faces into one cubemap .vtf |
| `extract_vtf` | the texture browser shows the image, but not at a size or as a file the agent can keep |
| `validate_addon` | nothing: the editor never checks addoninfo, scripts, manifests or closecaption encoding before a pack |
| `write_content_manifest` | the manifests are hand-edited text; a missing line is a silently unloaded asset |
| `write_localization` | localization files are hand-edited, and closecaption's UTF-16LE is easy to get wrong |
| `write_workshop_vdf` | Workshop Manager is a GUI; this writes the same build file offline |
| `write_trigger` | the trigger tool, with the volume, the class rules and outputs in one call |
| `write_mover` | a brush mover as a volume with its origin, direction/speed or path target |
| `write_logic` | a point logic entity and its connections, which the editor does not validate |
| `write_addoninfo` | the manifest is hand-written; this writes it with the provenance line |
| `write_loading_screen` | a poster/thumbnail needs a VTF and a VMT; this makes the pair |
| `write_cubemap_grid` | Hammer places one cubemap at a time; this lays out a grid |
| `check_vmt` | no editor validates a material's shader, base texture or compile flags |
| `check_sound` | no editor says whether a WAV is L4D2's shape or a soundscript wave is missing |
| `write_brush_entity` | any brush entity by class, volume and outputs; no editor enum limits it |
| `write_point_entity` | any point entity by class, origin and outputs |
| `write_entity_probe` | no editor checks that a written entity exists in the running map |
| `write_nav_attribute_region` | no editor writes nav attribute bits; Hammer's nav editing is a runtime mode |
| `write_class_probe` | no editor counts Director-spawned entities after the map runs |
| `write_nav_probe` | no editor reads attributes a region applied to the live nav mesh |
| `run_input` | no editor sends a real `E`/menu key to a running game window |
| `check_model` | nothing: no editor validates a QC/MDL before or after the compiler |
| `decompile_model` | nothing: Hammer cannot open a compiled model at all |
| `write_prop` | the prop tool with model/skin/solid checks |
| `write_physics_constraint` | a constraint between two names, with the class keys passed through |
| `write_ladder` | func_ladder plus the func_useableladder point L4D2's AI uses |
| `write_scene` | a choreographed scene with its .vcd and targets |
| `write_ambient_generic` | an ambient sound with its soundscript name and volume |
| `write_addon_scaffold` | a script addon needs a manifest and a mapspawn; this is the starting layout |
| `install_addon` | copying a VPK/folder into the game is a manual file operation |
| `write_mission_poster` | the poster block is hand-written in the mission file |
| `write_detail_sprites` | detail.vbsp is hand-edited KeyValues |
| `check_particle` | no editor validates PCF children or renderer materials |
| `read_addoninfo` | nothing: the manifest is text, this reads it as data |
| `read_localization` | nothing: the tokens and encoding are invisible in the editor |
| `read_workshop_vdf` | nothing: the build file is a text file |
| `read_mission_poster` | nothing: the poster block is mission KeyValues |
| `read_detail_sprites` | nothing: detail.vbsp is read by vbsp, not by an editor |
| `write_item_spawns` | the item/weapon spawner tool with class, count and skin |
| `write_saferoom_stock` | a stock row as item spawners |
| `write_intro_camera` | a point_viewcontrol plus the logic_auto that enables it |
| `write_rescue_closet` | an info_survivor_rescue plus ordered positions |
| `write_zombie_border` | the infected border marker |
| `read_soundscript` | nothing: Hammer has no sound browser |
| `read_soundscape` | nothing: the ambient bed is a text file the editor never shows |
| `write_soundscape` | nothing: soundscapes are written by hand |
| `write_soundscript` | nothing: sound scripts are edited by hand |
| `read_vtf` | nothing: the texture browser shows the image and never says which format, how many frames or whether it is a cubemap |
| `close_windows` | nothing: Hammer leaves every HLMV it opens running |
| `read_autosaves` | nothing: the editor knows where it put them and will not say |
| `restore_autosave` | opening the autosave by hand and saving it under a new name |
| `read_vmt` | nothing: the material's parameters, its `%compile*` flags and its `Proxies` blocks are invisible in the editor |
| `write_vmt` | a text editor, and remembering which shader takes which parameter |
| `read_qc` | nothing: Hammer never reads a model's source |
| `read_smd` | nothing: the model source is not opened by the editor |
| `write_smd` | nothing: Hammer has no model-source writer |
| `read_dmx` | nothing: the datamodel an artist exports is invisible to Hammer |
| `write_dmx` | nothing |
| `dmx_to_smd` | nothing: no editor converts a model datamodel to a compiler source |
| `read_gltf` | nothing: the editor never opens a glTF/GLB scene |
| `gltf_to_smd` | nothing: Hammer does not compile a model, and studiomdl cannot read glTF |
| `gltf_to_dmx` | nothing: shape keys/flexes are not an editor concept
| `read_fbx` | nothing: the editor never opens an FBX, and neither does studiomdl |
| `fbx_to_dmx` | nothing: shape keys and flexes are not an editor concept |
| `fbx_to_smd` | nothing: Hammer cannot compile a model, and studiomdl cannot read FBX |
| `brush_to_model` | Propper++ turns a brush into a model; Hammer itself has no such command |
| `write_vtf` | nothing: Hammer browses textures and cannot make one without VTFCmd |
| `read_wav` | nothing: the editor never opens a sound |
| `convert_wav` | nothing: sound conversion is a separate editor |
| `read_compile_sequences` | the Run Map dialog, one sequence at a time, without saying which steps are disabled |
| `write_qc` | writing model source by hand |
| `read_sightlines` | the eye, standing in the map |
| `read_vmf_rooms` | nothing: Hammer has no idea what a room is |
| `read_vmf_surfaces` | nothing: no readout says which faces are buried between brushes |
| `render_vmf_view` | the 3D viewport, which needs a person at a mouse |
| `render_bsp_view` | the compiled-map view: face loops and baked lightmap colours, without the editor |
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
| `normalize_vmf_io` | converts legacy comma outputs to ESC (L4D2's own form) or back; only `connections` blocks |
| `write_vmf_fitting` | prefabs, which are a saved lump of geometry at whatever size somebody once drew it. Nothing in Hammer knows how tall a counter is |
| `write_hint_brush` | a brush you texture yourself and hope |
| `read_campaign` | nothing: the game reads mission files, the editor never shows them |
| `write_campaign` | nothing: a mission file is written by hand |
| `check_modes` | nothing: no editor checks that a map can actually run the mode it is listed under |
| `check_campaign` | nothing: no editor checks that a campaign's maps and images exist |
| `check_campaign_wiring` | nothing: no editor follows a chapter's changelevel into the next map and compares the landmark pair |
| `run_vpk_pack` | nothing: Hammer has no addon packaging |
| `run_vpk_build` | nothing: Hammer has no addon packaging, and this one needs neither the game nor its `vpk.exe` |
| `read_vpk` | nothing: Hammer cannot open an addon archive |
| `run_vpk_extract` | nothing |

The row that matters most is `read_vmf_solids`. Hammer draws an invalid solid in red and
tells you nothing else; this says which face, which corner, and why — and it is the oracle
every writer in this repository is checked against.
