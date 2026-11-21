# Tool catalogue

230 tools. This page groups them by the job you are doing; each tool's own description is the
authority on its arguments. Every tool states its realm (`map` for files, `local` for a host
binary) and whether it is guarded. Writing and local tools need `confirm: true` or an entry in
`toolAllowlist`.

## Start here

| Tool | Use |
|---|---|
| `health` | game profile, compilers, FGD, sidecar, tool count, whether the build is stale |
| `review_map` | one-call audit: lint, rules, organisation, budgets, deps; `deep` adds rooms/sightlines |
| `compare_renders` | render the same camera against two VMFs and diff the frames |
| `read_hammerpp` | Hammer++ settings by section, game config/build programs, keybindings, warnings |
| `open_in_hammer` | open the VMF in Hammer++ and capture the editor window; closes by default |
| `hammer_status` | running editor, shell channel, main window and open map |
| `hammer_live_edit` | create/set/delete/rotate entities in the open editor through the shell channel |
| `hammer_menu` | save, undo, redo, Run Map, Check for Problems through the editor's menu |
| `read_source_games` | how the install was discovered, if `health` looks wrong |
| `read_autosaves` | Hammer autosaves of a map, and which is newer than the saved `.vmf` |
| `restore_autosave` | write one autosave out as a normal `.vmf` without touching the original |

## Campaign files

| Tool | Use |
|---|---|
| `read_campaign` | parse a mission file or an entry inside a VPK |
| `write_campaign` | write a mission file; refuses invalid structure |
| `check_modes` | per-mode contract: scavenge cans, survival trigger, campaign ending, duplicate maps, unknown mode names |
| `check_campaign` | verify chapters, maps, images against real files or VPKs |
| `run_campaign_gate` | one gate: mission, lint, compile, nav, collision, finale, trouble report, map test |
| `check_finale` | finale contract: type, script, stage list, FINALE nav, escape outputs |

| `write_addoninfo` | write `addoninfo.txt` with the AI provenance line before packing |
| `write_addon_scaffold` | addoninfo + `scripts/vscripts/mapspawn_addon.nut` starting layout |
| `read_addoninfo` | title, author, version, credit and every key in an addoninfo |
| `read_localization` | encoding, language, tokens and duplicates |
| `read_workshop_vdf` | the fields a workshop_build_item.vdf will send |
| `install_addon` | copy a VPK or staging folder into `left4dead2/addons` |
| `write_loading_screen` | PNG → VTF + `UnlitGeneric` VMT for a campaign poster or map thumbnail |
| `write_mission_poster` | set the mission `poster` block and its widescreen variant |
| `read_mission_poster` | read the poster block and its extra keys |
| `write_detail_sprites` | add a `detail.vbsp` sprite type |
| `read_detail_sprites` | list detail types, density and groups |
| `check_particle` | validate a PCF, its child systems and renderer materials |
| `write_cubemap_grid` | place `env_cubemap` samples on a regular grid inside a bounds box |
| `check_vmt` | validate shader, base texture, compile flags and texture files |
| `check_sound` | validate a WAV's format or a soundscript's waves |
## Entity families

| Tool | Use |
|---|---|
| `write_brush_entity` | any brush entity by class, volume and outputs — the universal escape hatch |
| `write_point_entity` | any point entity by class, origin and outputs |
| `write_entity_probe` | runtime presence check: makes a targetname echo a line when `run_map_test` fires it |
| `write_trigger` | a trigger as a brush volume: multiple, once, hurt, push, teleport, look, gravity |
| `write_mover` | `func_movelinear`, `func_rotating` or `func_tracktrain` with the volume and origin |
| `write_logic` | `logic_auto`, relay, timer, branch, compare, case, `math_counter`, `math_remap` with connections |
| `write_prop` | `prop_static`/`prop_dynamic`/`prop_physics` with model, angles, skin and solid |
| `write_physics_constraint` | hinge, length, ballsocket, slide or ragdoll constraint between two names |
| `write_ladder` | `func_ladder` brush and the `func_useableladder` AI point |
| `write_scene` | `logic_choreographed_scene` with a `.vcd` and targets |
| `write_ambient_generic` | sound emitter with its soundscript name, volume and radius |
## Shipping an addon

| Tool | Use |
|---|---|
| `validate_addon` | check addoninfo, every `.nut`, the three content manifests and closecaption encoding before packing |
| `write_content_manifest` | add or remove a `.pcf`, soundscript or soundscape in the manifest the engine reads |
| `write_localization` | write or update a `lang`/`Tokens` file, keeping UTF-16LE for closecaption |
| `write_workshop_vdf` | prepare `workshop_build_item.vdf` for `steamcmd +workshop_build_item` |
## Campaign wiring

| Tool | Use |
|---|---|
| `write_safe_room` | checkpoint door, player start, four survivor positions and a director in one call |
| `write_changelevel` | an `info_changelevel` brush volume plus its `info_landmark`; departure or arrival |
| `write_finale_setup` | `trigger_finale` with the right type, script, start state and escape positions |
| `write_spawn_points` | player, survivor, zombie and rescue spawns as one family |
| `write_map_parameters` | the 18 item-density keys of `info_map_parameters` (or versus) |
| `write_item_spawns` | L4D2 `weapon_*_spawn` item/weapon spawners at points |
| `write_saferoom_stock` | a row of medkit/pills/ammo/pistol stock |
| `write_intro_camera` | `point_viewcontrol` + `logic_auto`, optional disable timer |
| `write_rescue_closet` | `info_survivor_rescue` and ordered survivor positions |
| `write_nav_attribute_region` | `func_nav_attribute_region` with CHECKPOINT/FINALE/RESCUE_CLOSET bits; the nav half of a closet |
| `write_zombie_border` | the infected spawn border marker |
| `check_campaign_wiring` | follow transitions across chapters: map, landmark pair, doors, finale |
## Compiled map

| Tool | Use |
|---|---|
| `read_bsp_info` | header, version, all 64 lumps with offsets and sizes |
| `read_bsp_entities` | entity lump: histogram and filtered entity list |
| `read_bsp_faces` | compiled faces: material, smoothing mask, lightmap footprint, texture vectors |
| `read_bsp_lightmaps` | baked luxels: per-face average/min/max and one face's lightmap as PNG |
| `read_bsp_vis` | PVS: cluster table, vector sizes, and one cluster's visible set |
| `read_bsp_overlays` | compiled overlay records: faces, material, UV basis, origin and normal |
| `check_bsp` | header/lump integrity, and whether the compiled map still matches its VMF |
| `edit_bsp_entities` | add/update/remove entities in a compiled map, append-only |
| `read_map_extents` | real map size from the world model |
| `read_map_geometry` | what each lump holds and how close it is to the compiler ceiling |
| `read_map_report` | verdict per budget criterion, not just numbers |
| `read_nav_dump` | engine's `<map>_nav.txt`: areas, attributes, flow verdict |
| `read_nav_areas` | every `.nav` area: attributes, L4D2 spawn attributes, place, connections |
| `write_nav_areas` | set/clear area and spawn attributes in place, with a `.bak` and a read-back |
| `edit_nav_connections` | add/remove/replace directional links, mirrored by default |
| `nav_trouble_report` | the engine's own nav checks, as findings with the selected areas' coordinates |
| `read_map_dependencies` | every asset the map references and where it will come from |
| `read_prop_survey` | props by model and class, including unnamed `prop_dynamic` |
| `edit_static_props` | change or remove a baked prop's skin, solidity, tint, fade, flags |
| `read_static_props` | static-prop collision audit: missing `.phy`, models the player walks through |
| `read_model_collision` | what a `.phy` contains: solids, convex pieces, triangles, `$concave` requirement and `prop_data` |
| `read_pakfile` | files embedded in the map (lump 40 is a ZIP) |
| `read_materials` | material table and reuse |
| `read_lightmap_budget` | where lightmap resolution went |
| `read_visleaf_stats` | visibility quality and leaf counts |
| `read_sightlines` | longest unobstructed lines in a compiled map |
| `read_brush_volumes` | footprint and volume of every brush entity, by class |

## Source map

| Tool | Use |
|---|---|
| `read_vmf` | entities, outputs and brush counts, without judgement |
| `read_vmf_solids` | rebuild brushes from planes and check they are closed |
| `read_vmf_lint` | check against the installed FGD and compiler rules |
| `normalize_vmf_io` | rewrite Hammer++ ESC I/O values to L4D2 commas |
| `read_vmf_leak` | sealed or not, without compiling |
| `read_vmf_rooms` | rooms, openings and how they connect |
| `read_vmf_surfaces` | faces sorted into floor, wall, ceiling, slope |
| `read_vmf_visibility` | can two points see each other, and what blocks |
| `read_vmf_trace` | ray or swept player box through the map |
| `read_vmf_sightlines` | longest clear lines from standable places |
| `read_vmf_nearest_surface` | exact distance to the nearest solid |
| `measure_vmf_clearance` | free width and headroom at a point |
| `measure_vmf_approach` | clear room in front of doors, buttons, props |
| `check_vmf_rules` | the map's own `rules.json` |
| `read_map_organisation` | visgroups, groups, cordon |
| `read_entity_report` | Hammer's Entity Report, filterable |
| `validate_io` | entity wiring against the FGD |
| `read_fgd_class` | keyvalues, inputs, outputs of one entity class from the game's FGD |
| `read_particle` | systems, children, operators, materials and typed options inside a `.pcf`; `effectName` resolves a map's `effect_name` |
| `write_particle` | build a binary `.pcf` from JSON systems, or rewrite/rename a stock file |
| `read_game_content` | find installed materials and models by name; an empty pattern browses a kind, paged with `offset` |
| `read_asset_catalog` | stock models grouped by kind (escalators, stairs, doors, buildings, roofs, windows, vehicles, foliage, street, interiors, props, fences, lights, signs, terrain) and materials by kind (brick, concrete, plaster, wood, metal, roof, tile, ground, grass, asphalt, water, glass, fabric, sign), plus every sky's LDR/HDR completeness |
| `preview_asset` | **look at** one material's base texture or one model in HLMV; returns a real image block |
| `preview_model` | **look at** a model when HLMV's canvas is blank: renders it in a sealed engine room and captures the game window |
| `read_model_info` | bounds, skins, sequences, materials, attachments, body parts and hitbox sets of one `.mdl` |

## Build and edit

| Tool | Use |
|---|---|
| `write_vmf` | empty `.vmf`, Hammer's File > New |
| `edit_vmf` | add/update/remove entities and outputs by splicing |
| `write_vmf_solid` | brushes from box, wedge, cylinder, convex; also into a brush entity by id |
| `write_vmf_terrain` | floor grid + displacement + noise + sew in one call |
| `write_vmf_water` | `func_water_analog` + `water_lod_control`, Water shader checked |
| `place_door` | rotating door with the origin on the hinge; checkpoint names checked |
| `write_vmf_fitting` | door casing, counter, skirting, cornice |
| `transform_solids` | move, turn, scale, mirror brushes |
| `merge_solids` | merge convex brushes into the one brush around them |
| `move_to_surface` | drop or raise brushes to a traced floor or ceiling, optionally aligned |
| `delete_solids` | remove brushes |
| `clip_solids` | cut with a plane, keep front, back or both |
| `move_vertices` | Hammer's vertex manipulation |
| `hollow_solids` | turn blocks into room walls |
| `set_face_material` | material on selected faces |
| `align_faces` | texture alignment |
| `set_face_uv` | write a face's U/V vectors, offsets, scales and `rotation` directly |
| `copy_face_alignment` | copy one face's exact uaxis/vaxis (and optionally material/lightmap) onto others |
| `set_smoothing_groups` | smoothing groups |
| `set_visgroup` / `auto_visgroups` / `group_solids` / `set_cordon` | organisation, with one pass that groups every entity class and material |
| `write_hint_brush` | hint brush for vvis |
| `set_solid_class` | move brushes into or out of `func_detail` |
| `set_lightmap_scale` | lightmapscale on faces |
| `write_portal` | areaportal, areaportal window, occluder |
| `set_map_properties` | worldspawn keys: sky, detail sprites, prop fade |
| `set_worldspawn` | any worldspawn key, set or remove, without a fixed menu |
| `read_vscript` | check a `.nut` as Squirrel: Lua habits, delimiters, includes, DirectorOptions stage list |
| `write_vscript` | write a `.nut`, catch Lua habits, attach it with `logic_script` |
| `write_overlay` | put a decal on a brush face by side id, origin and size |
| `write_instance` | place a `func_instance` from an instance VMF, with origin, angles and fixup |
| `create_instance_from_selection` | write selected brushes as an instance and leave a `func_instance` |
| `write_sky_camera` | place the single `sky_camera` a 3D skybox needs |
| `diff_vmf` | semantic diff of two VMFs: solids, entities, worldspawn |
| `read_rect` | Hammer++ `.rect` hotspot rectangles |
| `write_rect` | write a `.rect` hotspot file; refuses a degenerate rectangle |
| `build_skybox` | copy, seal the room and place `sky_camera` in one call |
| `write_skybox_copy` | copy brushes at 1/16 scale and move them to the skybox origin |
| `insert_prefab` | paste a saved `.vmf` fragment with fresh ids, a move and a yaw rotation |
| `write_weather` | add rain/snow/ash as `func_precipitation` and distance fog as `env_fog_controller` |
| `clone_solids` | copy selected brushes with fresh ids, optionally move/rotate/scale/mirror the copy |

## World dressing

| Tool | Use |
|---|---|
| `write_light` | `light`, `light_environment`, `light_dynamic`, `env_sun`, `shadow_control` with the keys each needs |
| `write_postprocess` | `env_tonemap_controller` wired through a `logic_auto`, `env_fade`, `env_shake`, `color_correction` |
| `write_decal` | `infodecal` at one or more points on a surface |
| `write_rope` | a linked `move_rope` + `keyframe_rope` pair |
| `write_sprite` | `env_sprite`, or an `env_beam`/`env_laser` with the targets it needs |

## Displacements

`read_displacements`, `write_displacement`, `subdivide_displacements`, `sew_displacements`,
`sculpt_displacement`, `paint_displacement`.

## Look at it

`render_vmf_view` (one camera), `render_vmf_tour` (contact sheet per room), `render_vmf_plan`
(dimensioned floor plan), `render_bsp_view` (compiled faces with baked lightmap colours).

## Runtime probes

These answer "what exists in the running map", which a BSP or screenshot cannot.

| Tool | Use |
|---|---|
| `write_entity_probe` | make a targetname echo on `OnMapSpawn` or a natural output; returns `run_map_test` markers |
| `write_class_probe` | VScript counts of live entities by classname at chosen seconds, optional origins |
| `write_nav_probe` | VScript samples the live nav mesh and tests `HasSpawnAttributes` |
| `run_input` | focus a window and send a short key sequence (`E` pickup, a menu key); reports `focused`/`foreground` |

## Source text and models

| Tool | Use |
|---|---|
| `read_text_file` | read UTF-8 source text (QC, SMD, VMT, mission) with a byte cap and line window |
| `read_vmt` | material shader, parameters, `Proxies`/`patch` blocks, `%compile*` flags, textures |
| `write_vmt` | create a `.vmt` from a shader and a parameter tree |
| `read_qc` | parse a `.qc` with its `$include` tree, variables/macros, sequences, materials, structural faults and a command catalogue that checks argument shapes |
| `check_model` | QC or MDL: geometry, bodygroups, LODs, hitboxes, sequences, materials |
| `decompile_model` | compiled `.mdl` -> QC + reference SMD + animation SMDs + collision SMD, with the original bone weights, attachments, custom hitboxes and skin families |
| `write_qc` | build a `.qc` from `$modelname`, `$body`, `$cdmaterials`, sequences and attachments |
| `read_smd` | skeleton, frames, materials, triangles and structural faults of an SMD model source |
| `write_smd` | build an SMD from JSON (nodes, frames, triangles) and read it back |
| `read_dmx` | a DMX datamodel as a JSON element tree, with types and values |
| `write_dmx` | build a binary v4 or KeyValues2 DMX from a JSON tree, then read it back |
| `dmx_to_smd` | convert a static DMX mesh export to SMD (transform + UV flip; one root bone) |
| `read_gltf` | inspect a glTF/GLB: nodes, meshes, primitives, materials, skins, animations, buffers |
| `gltf_to_smd` | convert glTF/GLB geometry, skeleton, animations and a box or convex-hull collision model to SMD; optionally write the QC |
| `gltf_to_dmx` | convert glTF/GLB shape keys to a DMX model source with Source flexes; writes the QC optionally
| `read_fbx` | inspect a binary 7.x or ASCII FBX: axes, units, models, geometries, materials, bones, skins, animations |
| `fbx_to_dmx` | convert FBX shape keys to a DMX model source with Source flexes; the QC needs no `$flex` |
| `fbx_to_smd` | convert FBX geometry, skeleton, skin weights, animation stacks and a box/hull collision model to SMD, with the bind pose from the clusters; optionally write the QC with one `$sequence` per animation |
| `brush_to_model` | convert VMF brush solids to SMD + QC, with VMF UVs and a brush or box collision model |
| `write_text_file` | write arbitrary source text; no template, existing files need overwrite |
| `run_studiomdl` | compile a QC with the game's `studiomdl.exe` and prove the `.mdl` exists |
| `run_hlmv` | launch HLMV on one model, optionally return a screenshot as a real image; closes by default and verifies the process is gone (`closed`, `closedProcesses`) |
| `close_windows` | close HLMV, Hammer or the game; dry-run lists them first. Leftovers from a server restart are swept from the window ledger at startup |
| `capture_window` | capture any window as a PNG image block, by process id or name |
| `export_vmf_map` | write a `.vmf` as Valve `.map` 220, with planes, materials and texture axes |

## Compile and ship

| Tool | Use |
|---|---|
| `open_in_hammer` | launch Hammer++ on a VMF and capture the editor window (the visual viewport); closes by default and verifies `closed` |
| `run_compile` | vbsp/vvis/vrad natively, per-stage findings |
| `read_compile_sequences` | what the editor's own Run Map steps do: enabled flags, executables, parameters |
| `read_compile_log` | structured findings from a compiler log |
| `read_leak` | turn a leak into a location |
| `run_pack` | bspzip assets into a compiled map |
| `run_vpk_pack` | pack a staging directory into an addon VPK with the game's `vpk.exe`, then verify the entry list |
| `run_vpk_build` | pack a staging directory into an addon VPK with this server's own writer: no `vpk.exe`, no game install |
| `read_bsp_lump` | any BSP lump by name/index, LZMA-decoded |
| `write_bsp_lump` | replace a lump, optionally compressed, verified by read-back |
| `read_vpk` | list a `.vpk` (directory or numbered archive), optionally verifying every CRC |
| `run_vpk_extract` | extract a `.vpk` into a directory, refusing names that escape it |
| `run_nav_generate` | launch the game and generate `.nav` + `<map>_nav.txt` for loose maps, with the add-on archives moved aside |
| `run_map_test` | launch an installed map (directly or through Steam), wait for one pattern or an ordered list of `markers`, install a bsp/nav/scripts, run `schedule` commands at fixed seconds and capture the window |
| `run_build_cubemaps` | build a map's cubemaps with the engine's `-buildcubemaps` mode, and optionally pack them into a copy |
| `read_nav` | nav header and freshness against the `.bsp` |
| `run_bsp_rename` | rename a `.bsp` and the content packed inside it |
| `run_pakfile_extract` | extract a map's embedded pakfile |
| `run_pakfile_add` | add/replace files in a map's pakfile with the native ZIP writer, no bspzip |
| `run_tga2skybox` | six TGAs into LDR and HDR cubemaps |
| `run_cubemap2hdr` | LDR cubemap to HDR `.vtf` |
| `run_vtf_convert` | an image to `.vtf` with VTFCmd; reads the header back to say which format came out |
| `write_vtf` | PNG to `.vtf` natively, with mipmaps and a pixel round-trip; no VTFCmd needed |
| `convert_vtf` | reformat/resize an existing `.vtf` (DXT included) and verify the result |
| `write_cubemap_vtf` | six named PNG faces into a cubemap VTF, every face verified |
| `extract_vtf` | decode any `.vtf` to a PNG the agent can look at |
| `read_soundscript` | named sounds, channels and resolved wave paths from one file or the game |
| `read_soundscape` | ambient bed, random one-shots, children, DSP; checks every wave |
| `write_soundscape` | append one soundscape for an `env_soundscape` |
| `write_soundscript` | add one sound block, appending to the file |
| `read_wav` | WAV format, duration, loop and whether it is L4D2-game-ready |
| `convert_wav` | resample and mix a WAV to 16-bit PCM mono/stereo at 22050/44100 |
| `read_vtf` | a `.vtf` header: version, size, flags, frames, format, cubemap |
