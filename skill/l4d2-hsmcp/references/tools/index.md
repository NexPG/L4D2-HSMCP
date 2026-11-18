# Tool catalogue

128 tools. This page groups them by the job you are doing; each tool's own description is the
authority on its arguments. Every tool states its realm (`map` for files, `local` for a host
binary) and whether it is guarded. Writing and local tools need `confirm: true` or an entry in
`toolAllowlist`.

## Start here

| Tool | Use |
|---|---|
| `health` | game profile, compilers, FGD, sidecar, tool count, whether the build is stale |
| `read_hammerpp` | Hammer++ settings by section, game config/build programs, keybindings, warnings |
| `open_in_hammer` | open the VMF in Hammer++ and capture the editor window |
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
| `check_campaign` | verify chapters, maps, images against real files or VPKs |
| `run_campaign_gate` | one gate: mission, lint, compile, nav, collision, finale, trouble report, map test |
| `check_finale` | finale contract: type, script, stage list, FINALE nav, escape outputs |

## Compiled map

| Tool | Use |
|---|---|
| `read_bsp_info` | header, version, all 64 lumps with offsets and sizes |
| `read_bsp_entities` | entity lump: histogram and filtered entity list |
| `edit_bsp_entities` | add/update/remove entities in a compiled map, append-only |
| `read_map_extents` | real map size from the world model |
| `read_map_geometry` | what each lump holds and how close it is to the compiler ceiling |
| `read_map_report` | verdict per budget criterion, not just numbers |
| `read_nav_dump` | engine's `<map>_nav.txt`: areas, attributes, flow verdict |
| `nav_trouble_report` | the engine's own nav checks, as findings with the selected areas' coordinates |
| `read_map_dependencies` | every asset the map references and where it will come from |
| `read_prop_survey` | props by model and class, including unnamed `prop_dynamic` |
| `read_static_props` | static-prop collision audit: missing `.phy`, models the player walks through |
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
| `read_game_content` | find installed materials and models by name; an empty pattern browses a kind, paged with `offset` |
| `read_asset_catalog` | stock models grouped by kind (escalators, stairs, doors, buildings, roofs, windows, vehicles, foliage, street, interiors, props, fences, lights, signs, terrain) and materials by kind (brick, concrete, plaster, wood, metal, roof, tile, ground, grass, asphalt, water, glass, fabric, sign), plus every sky's LDR/HDR completeness |
| `preview_asset` | **look at** one material's base texture or one model in HLMV; returns a real image block |
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
| `set_visgroup` / `group_solids` / `set_cordon` | organisation |
| `write_hint_brush` | hint brush for vvis |
| `set_solid_class` | move brushes into or out of `func_detail` |
| `set_lightmap_scale` | lightmapscale on faces |
| `write_portal` | areaportal, areaportal window, occluder |
| `set_map_properties` | worldspawn keys: sky, detail sprites, prop fade |
| `set_worldspawn` | any worldspawn key, set or remove, without a fixed menu |
| `write_vscript` | write a `.nut`, catch Lua habits, attach it with `logic_script` |
| `write_overlay` | put a decal on a brush face by side id, origin and size |
| `write_instance` | place a `func_instance` from an instance VMF, with origin, angles and fixup |
| `create_instance_from_selection` | write selected brushes as an instance and leave a `func_instance` |
| `write_sky_camera` | place the single `sky_camera` a 3D skybox needs |
| `write_skybox_copy` | copy brushes at 1/16 scale and move them to the skybox origin |
| `insert_prefab` | paste a saved `.vmf` fragment with fresh ids, a move and a yaw rotation |
| `write_weather` | add rain/snow/ash as `func_precipitation` and distance fog as `env_fog_controller` |
| `clone_solids` | copy selected brushes with fresh ids, optionally move/rotate/scale/mirror the copy |

## Displacements

`read_displacements`, `write_displacement`, `subdivide_displacements`, `sew_displacements`,
`sculpt_displacement`, `paint_displacement`.

## Look at it

`render_vmf_view` (one camera), `render_vmf_tour` (contact sheet per room), `render_vmf_plan`
(dimensioned floor plan).

## Source text and models

| Tool | Use |
|---|---|
| `read_text_file` | read UTF-8 source text (QC, SMD, VMT, mission) with a byte cap and line window |
| `read_vmt` | material shader, parameters, `Proxies`/`patch` blocks, `%compile*` flags, textures |
| `write_vmt` | create a `.vmt` from a shader and a parameter tree |
| `read_qc` | parse a `.qc` with its `$include` tree, sequences, materials and structural faults |
| `write_qc` | build a `.qc` from `$modelname`, `$body`, `$cdmaterials`, sequences and attachments |
| `write_text_file` | write arbitrary source text; no template, existing files need overwrite |
| `run_studiomdl` | compile a QC with the game's `studiomdl.exe` and prove the `.mdl` exists |
| `run_hlmv` | launch HLMV on one model, optionally return a screenshot as a real image |
| `capture_window` | capture any window as a PNG image block, by process id or name |
| `export_vmf_map` | write a `.vmf` as Valve `.map` 220, with planes, materials and texture axes |

## Compile and ship

| Tool | Use |
|---|---|
| `open_in_hammer` | launch Hammer++ on a VMF and capture the editor window (the visual viewport) |
| `run_compile` | vbsp/vvis/vrad natively, per-stage findings |
| `read_compile_sequences` | what the editor's own Run Map steps do: enabled flags, executables, parameters |
| `read_compile_log` | structured findings from a compiler log |
| `read_leak` | turn a leak into a location |
| `run_pack` | bspzip assets into a compiled map |
| `run_vpk_pack` | pack a staging directory into an addon VPK with the game's `vpk.exe`, then verify the entry list |
| `run_vpk_build` | pack a staging directory into an addon VPK with this server's own writer: no `vpk.exe`, no game install |
| `read_vpk` | list a `.vpk` (directory or numbered archive), optionally verifying every CRC |
| `run_vpk_extract` | extract a `.vpk` into a directory, refusing names that escape it |
| `run_nav_generate` | launch the game and generate `.nav` + `<map>_nav.txt` for loose maps, with the add-on archives moved aside |
| `run_map_test` | launch an installed map, wait for a pattern in `console.log`, optionally install a bsp/nav and capture the window |
| `run_build_cubemaps` | build a map's cubemaps with the engine's `-buildcubemaps` mode, and optionally pack them into a copy |
| `read_nav` | nav header and freshness against the `.bsp` |
| `run_bsp_rename` | rename a `.bsp` and the content packed inside it |
| `run_pakfile_extract` | extract a map's embedded pakfile |
| `run_tga2skybox` | six TGAs into LDR and HDR cubemaps |
| `run_cubemap2hdr` | LDR cubemap to HDR `.vtf` |
| `run_vtf_convert` | an image to `.vtf` with VTFCmd; reads the header back to say which format came out |
| `read_vtf` | a `.vtf` header: version, size, flags, frames, format, cubemap |
