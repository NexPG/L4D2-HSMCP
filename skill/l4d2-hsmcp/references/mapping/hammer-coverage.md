# Hammer++ feature coverage

The goal is that an agent can do everything Hammer++ can, and more. This is the scorecard.
`verified` means a tool exists **and** the result was checked in game or against a real file;
`tool` means the tool exists but has not been exercised on L4D2 content; `gap` means there is
no way to do it yet.

The full inventory, including Tools++ flags and the settings that change output, is
`docs/reference/hammerpp-complete-reference.md`. Read it before assuming a feature is
covered: this table is the summary.

## Contents

- Map and file
- World geometry
- Displacements
- Entities and I/O
- Faces, textures, lighting
- Detail, hints, portals
- Campaign wiring
- Assets
- Compile, run, nav, campaign
- Hammer++ editor-only features
- Hammer++ files
- What is genuinely missing

## Map and file

| Feature | Tool | Status |
|---|---|---|
| New map | `write_vmf` | verified |
| Open/inspect VMF | `read_vmf`, `read_entity_report` | verified |
| Open/inspect BSP | `read_bsp_info`, `read_bsp_entities`, `read_map_report` | verified |
| Save / rename map | `edit_vmf`, `run_bsp_rename` | verified |
| Export to `.map` | `export_vmf_map` | tool: format 220, reported warnings for VMF-only data |
| Backups | `backup: true` on writers | verified |

## World geometry

| Feature | Tool | Status |
|---|---|---|
| Brush create: box, wedge, cylinder, convex, cone, stairs, arch, sphere, torus | `write_vmf_solid` | verified for box/wedge/cylinder/convex; the compound shapes are checked by `read_vmf_solids` and each reports its brush count |
| Clip | `clip_solids` | verified: both halves of a cut brush compiled with vbsp in a sealed room (`tools-compile.test.ts`) |
| Hollow | `hollow_solids` | verified: six mitred walls from one block compiled with vbsp in a sealed room (`tools-compile.test.ts`) |
| Vertex edit | `move_vertices` | verified: a broadened top edge compiled with vbsp in the same room as hollow and an overlay |
| Move/rotate/scale/mirror | `transform_solids` | verified: a brush rotated 30 degrees and scaled non-uniformly compiled with vbsp |
| Merge convex brushes | `merge_solids` | verified: merged platform passed vbsp; refuses a non-convex or overlapping union |
| Move objects to floor/ceiling | `move_to_surface` | verified: dropped brush passed vbsp; optional align to the surface |
| Delete | `delete_solids` | verified |
| Carve | several clips | verified through the same two-plane cut: four convex pieces compiled with vbsp. No dedicated tool, by design |
| Fitting (door casing, counter, skirting) | `write_vmf_fitting` | verified: a counter assembled from several brushes compiled with vbsp |
| Rotating door | `place_door` | verified: hinge origin and checkpoint door on the night-moscow door |
| Water volume | `write_vmf_water` | verified on a fixture: Water shader checked, brush valid, `water_lod_control` added |

## Displacements

| Feature | Tool | Status |
|---|---|---|
| Create | `write_displacement` | verified: a displaced floor is compiled twice, leaking without a seal and sealing with one |
| Subdivide (raise power) | `subdivide_displacements` | verified: a 16-cell patch subdivided to power 3, sculpted, painted and sewn, then compiled with vbsp |
| Sew | `sew_displacements` | verified: the same patch reports no seam after sewing |
| Sculpt (flatten, raise, slope, noise) | `sculpt_displacement` | verified: noise applied to the sealed patch, which compiled |
| Paint blend | `paint_displacement` | verified: alpha 200 read back on every vertex, and the patch compiled |
| Read | `read_displacements` | verified: srctools agrees on the fixture and on written grids; the compile tests read the chain back |
| Four-way blend | - | not an L4D2 feature: its shader set has `WorldTwoTextureBlend` only, and vbsp has an `alphas` block and no second channel |
| Seal a displaced brush | `seal_displacements` | verified: the duplicate is what stops the leak; a second run is a no-op |

## Entities and I/O

| Feature | Tool | Status |
|---|---|---|
| Add entity | `edit_vmf` `add` | verified |
| Edit keyvalues | `edit_vmf` `update` | verified |
| Outputs | `edit_vmf` `addOutput` / `removeOutput` | verified |
| Entity report | `read_entity_report` | verified |
| Live entity create/edit in the open editor | `hammer_live_edit` | verified on Hammer++ 8873 x86: created a `light`, saved, read it back from the VMF. The channel has no entity ids, so the saved VMF is checked first: a create must land on an empty class+origin and an edit on exactly one. Create/delete/rotate are undoable, a keyvalue change is not |
| Live Save/Undo/Redo/Run Map/Check for Problems | `hammer_menu` | verified: Save wrote the live edit to the VMF |
| Editor discovery | `hammer_status` | verified: pid, shell window, main window, open map |
| FGD browser (classes, keys, I/O) | `read_fgd_class` (with prefix) | verified |
| I/O validation | `validate_io` | verified |
| Check for problems (Alt+P) | `read_vmf_lint`, `check_vmf_rules` | verified |

## Faces, textures, lighting

| Feature | Tool | Status |
|---|---|---|
| Texture browser | `read_game_content(kind: "material")` | verified |
| Material assign | `set_face_material` | verified |
| Texture alignment | `align_faces`, `copy_face_alignment`, `set_face_uv` | verified: fit reads the real VTF size (a 64x64 tool texture is no longer fitted as 512) |
| Manual U/V vectors (skew) | `set_face_uv` | verified: skewed axes accepted by vbsp and the map loaded |
| Smoothing groups | `set_smoothing_groups` | verified: group 13 reached the BSP as the mask 4096 on all six faces |
| Lightmap scale | `set_lightmap_scale` | verified: scale 32 produced the expected FACES luxel dimensions |
| Baked lightmap samples | `read_bsp_lightmaps` | **verified on `c1m1_hotel`**: the HDR lump is 8,770,812 bytes; face 0 averages 122/154/175 and its 21x5 lightmap writes as a PNG |
| Baked lightmap editing | `write_bsp_lightmap` | **verified on an installed map with an LDR lump**: scaling one face by 0.5 changed only that face, the file length stayed identical, and the reader reported the new average |
| PVS | `read_bsp_vis` | **verified on `c1m1_hotel`**: 1,812 clusters, 227-byte vectors, cluster 0's visible set decoded |
| Compiled overlays | `read_bsp_overlays` | **verified**: `c1m1_hotel` has 156 records; the decoded one is `decals/blood7` over faces 3182/4046. A one-overlay test map decodes as `decals/blood1`, 4 faces, normal +Z |
| Compiled overlay editing | `write_bsp_overlay` | **verified**: a record's origin was shifted in place, the file length stayed the same, the backup existed, and the reader returned the new origin; `out` left the source alone |
| Light entities | `write_light` for point/environment/dynamic/sun/shadow, `edit_vmf` for the rest | verified: the five kinds compile into the entity lump; `_light` is the four-number form and `light_environment` gets angles/ambient (`tools-compile.test.ts`) |
| Postprocess | `write_postprocess` | verified: a tonemap controller wired to `logic_auto` with three `OnMapSpawn` outputs compiles; `color_correction` is the L4D2 class name, not `colorcorrection` |
| Decals | `write_decal` for `infodecal`, `write_overlay` for a sized overlay | verified: decals written at surface points reach the entity lump |
| Ladders | `write_ladder` | **verified with the real compiler:** Tools++ vbsp emits `func_simpleladder` from a `func_ladder` brush; stock vbsp has no `-simpleladders` and leaves only the touch volume. The useable points are offset 33 outside the climbing face and carry `angles`, because centre-line points are logged as blocked. A ladder at the world origin or over a solid platform makes nav report `Invalid ground position`/`No valid walkable seed positions` |
| Ropes | `write_rope` | verified: the `move_rope`/`keyframe_rope` pair links by `NextKey` and compiles |
| Sprites, beams, lasers | `write_sprite` | verified: a sprite and a beam with its two `info_target`s compile; a laser without a target gets one |
| Map properties (sky, detail, fade) | `set_map_properties` | verified |
| Cubemap placement | `write_cubemap_grid`, `edit_vmf` (`env_cubemap`) | verified by unit: a 3x3 grid at 512 spacing; the entity is internal and must be in the VMF before compile |
| Build cubemaps in engine | `run_build_cubemaps` | verified HDR/LDR/both; `pack` copies them into an `outBsp` |
| Loading screen / poster / map thumbnail | `write_loading_screen` | verified by unit: PNG to VTF + UnlitGeneric VMT, material path derived from `materials/` |
| HUD screens (`.res`) | `read_hud`, `write_hud` | condition-preserving control tree, value edit and batch coordinate offset; the stock `resource/ui/l4d360ui/audio.res` (39 controls) reads from the VPK and an offset copy was written |
| Material and sound validation | `check_vmt`, `check_sound` | verified by unit: bad shader/base texture and a non-game-ready WAV are named; a patch's include resolves under `materialsDirs` or is reported missing |
| Material editing | `read_vmt`, `write_vmt`, `edit_vmt` | verified by unit: a value and a nested Proxies value change in place, comments and untouched bytes survive |

## Detail, hints, portals

| Feature | Tool | Status |
|---|---|---|
| func_detail | `set_solid_class` | tool |
| Hint/skip | `write_hint_brush` | verified: vbsp and vvis accepted a hint slab in the two-room test |
| Areaportal / occluder | `write_portal` | verified: a `func_areaportal` filling a sealed doorway compiled with vbsp and vvis |
| Visgroups / groups / cordon | `set_visgroup`, `auto_visgroups`, `group_solids`, `set_cordon` | verified for the cordon: an active box filters the compile copy, and the leaky structure outside it is absent from the BSP (`tools-compile.test.ts`). Auto visgroups build one group per class and one per dominant material |

The class decision table, the seal trap and the runtime cost of each: `detail-and-vis.md`.

## Campaign wiring

| Feature | Tool | Status |
|---|---|---|
| Safe room | `write_safe_room` | verified by vbsp: checkpoint door on its hinge, player start, four ordered survivor positions and a director; the door is the checkpoint class near the landmark, the name is advice |
| Chapter change | `write_changelevel` | verified by vbsp: an `info_changelevel` brush volume with map and landmark, plus the matching `info_landmark`; departure and arrival (`spawnflags 2`) |
| Finale | `write_finale_setup` | verified by vbsp: type 0/1/2/4, custom refuses no script and starts disabled, four escape positions |
| Spawn areas | `write_spawn_points` | verified by vbsp: one `info_player_start`, ordered survivor positions, zombie spawns with population/offer_tank, rescue |
| Item density | `write_map_parameters` | verified by unit: only the 18 FGD keys given are written, defaults left absent |
| Cross-chapter wiring | `check_campaign_wiring`, `check_transition` | verified against the test campaign and stock `c1m1_hotel`→`c1m2_streets`: follows the changelevel, compares the landmark pair, resolves the checkpoint door by class near the landmark (an unnamed stock door passes), checks the arrival volume; no errors on a working chain |

## Assets

| Feature | Tool | Status |
|---|---|---|
| Model browser + sizes | `read_game_content(kind: "model", details: true)` | verified |
| Model details (skins, sequences, materials) | `read_model_info` | verified |
| Model collision shape | `read_model_collision` | verified: `cara_84sedan` 16 convex pieces / 634 triangles, `hospital_bed` 5 / 200, `shelves_metal1` 1 / 12; checksums match; `$concave` required when a solid has more than one piece |
| Decompile a compiled model | `decompile_model` | verified on `cara_84sedan`: QC + reference SMD + collision SMD, recompiled by the game's studiomdl with the hull within 8 units; LOD 0/model 0 only, gaps reported in `warnings` |
| Particle browser | `read_game_content(kind: "particle")` + `read_particle` for system contents | verified |
| Particle validation | `check_particle` | checks systems, child references and renderer materials; a PCF is read through the same reader |
| Detail sprites | `write_detail_sprites` + `detailmaterial` on worldspawn | verified by unit: a named type with a sprite rect and groups parses back; only displacement faces scatter them |
| Sound browser | `read_game_content(kind: "sound")` | verified |
| VTF conversion | `run_vtf_convert`, `run_tga2skybox`, `run_cubemap2hdr` | tool |
| Overlays / decals | `write_overlay` | verified: format from Valve's styleguide VMF, and vbsp accepted an overlay on the room floor in `tools-compile.test.ts` |
| 3D skybox | `build_skybox`; `write_sky_camera` + `write_skybox_copy` for the halves | verified by vbsp: the copy, the sealed room and the camera compile with no leak (`skyboxbuild.test.ts`); the choice of scenery is still the mapper's |
| Instances | `write_instance` places a `func_instance`; `run_compile` expands them before vbsp | verified: the expanded entity is in the BSP, and vbsp crashes on the unexpanded one |
| Instance from selection | `create_instance_from_selection` | verified: the extracted instance and `func_instance` passed vbsp; a brush entity is taken whole |
| Prefabs | `insert_prefab` | verified: paste a saved `.vmf` fragment; ids remapped, move and yaw about a pivot; brush entities and entity angles turn with it |
| Model authoring (HLMV, studiomdl) | `read_text_file`, `write_text_file`, `run_studiomdl`, `run_hlmv`, `capture_window` | tool: sample compiled and HLMV launched; screenshot returns an image block, 3D canvas depends on the desktop |
| Visual capture | `capture_window`, `run_map_test` screenshot, `run_hlmv` screenshot | tool: real MCP image; `screen` captures a 3D game canvas, `window` captures occluded UI/dialogs |
| Compiled BSP view | `render_bsp_view` | **verified on `c1m1_hotel`**: 10,840 faces, 9,116 textured from VMT/VTF, 8,828 with per-pixel HDR lightmap sampling; 1,748 static props read from the `sprp` lump, 188/188 models loaded from MDL/VVD/VTX, 54 drawn from a lobby camera with 57,626 triangles; 24,541-sample HDR ambient cube grid; **water** blended on `c2m1_highway` and `c3m2_swamp`; **fog** from `env_fog_controller` via the camera's `fog_volume`; VTF alpha cutouts for foliage; PNG from any camera |

## Compile, run, nav, campaign

| Feature | Tool | Status |
|---|---|---|
| Compile (stock or Tools++) | `run_compile` | verified |
| Open the editor's viewport | `open_in_hammer` | verified: Hammer++ loaded the night-moscow VMF and the capture shows the 3D view |
| Leak check | `read_vmf_leak`, `read_leak` | verified |
| Compile log findings | `read_compile_log` | verified |
| Pack assets into BSP | `run_pack` | verified: native ZIP writer, entry read back byte for byte on `c1m1_hotel`; no bspzip |
| Nav generation | `run_nav_generate` | verified |
| Nav attributes / dump | `read_nav_dump`, `func_nav_attribute_region` | verified |
| Launch and test | `run_map_test` | verified |
| Mission files | `read_campaign`, `write_campaign`, `check_campaign` | verified |
| Addon VPK | `run_vpk_pack` | verified |
| VScript | `write_vscript` | verified |

## Hammer++ editor-only features

Hammer++ adds a second layer on top of Hammer: viewport previews, gizmos and app-level
comforts. They change what the editor shows or how a mouse drag is interpreted, not what a
compiled map contains. There is no editor session here, so each one is either translated to
its file-level result or named as view-only.

| Hammer++ feature | What the toolkit does |
|---|---|
| Lighting, fog, 2D/3D skybox, particle, rope, material-proxy, render-effect previews | No editor viewport. `render_vmf_view` / `render_vmf_plan` / `render_vmf_tour` render the file offline, `read_lightmap_budget` reports luxels, and `run_map_test` with `method: "screen"` shows the real game |
| Selection glow, toggle editor objects, 3D grid, gizmo, pivot, drag select | View and mouse UI. Selectors name solids/faces/entities exactly; `transform_solids` and `move_vertices` take numbers |
| Microgrid / custom grid size | Coordinates are already arbitrary; `transform_solids` accepts any `grid`, including 0.125 |
| Polygon tool | `write_vmf_solid` shape `convex`, from explicit faces |
| Sprinkle tool | No preset menu by design (D64). Place each object with an explicit `write_vmf_solid` / `edit_vmf` call |
| Merge tool | The result is one convex brush: `merge_solids` checks the union is convex and keeps the original face data |
| Move objects to floor / ceiling | `move_to_surface`, with optional alignment to the surface normal |
| Face sheet U/V vectors | `set_face_uv` writes the vectors, offsets, scales and `rotation`; `align_faces` is the mode-based path |
| Physics tool | Posing is editor simulation; what a map stores is an entity's `origin` and `angles`, set with `edit_vmf` or `transform_solids`. Brushes have no saved pose |
| Overlay face preservation after clip | `clip_solids` edits geometry; re-check or re-create overlays with `write_overlay` after a clip |
| Create Instance from Selection | `create_instance_from_selection`: writes the fragment, recentres it and replaces the selection with one `func_instance` |
| `editor_text` | `edit_vmf` can write the entity. It is Hammer++-only and has no in-game effect |
| Compile window | `run_compile` plus `read_compile_log`; no CMD window, but the log is parsed |
| Color picker | `edit_vmf` sets `rendercolor`; the palette is editor state |
| Keybind editor, Discord RPC, MP3 playback, model hotload, crash recovery, autosave | Application features with no file-level operation. `read_hammerpp` reports the settings and keybinding count; guarded writers take backups and support `dryRun` |
| `vertices_plus` precise brush data | Kept, moved with geometry, dropped when a clip changes the loop; Hammer++ regenerates it |
| Multiple cordons | `set_cordon` writes the compile-relevant half; the editor's cordon list is not map content |
| 3-point clip | `clip_solids` with two plane cuts; verified: the four resulting pieces compiled with vbsp |
| Polygon tool | `write_vmf_solid` shape `convex` |
| UV lock | `move_vertices`/`transform_solids` move geometry; `set_face_uv` writes the resulting axes |
| Propper++ (brush → model) | `brush_to_model`: VMF planes → SMD + QC, VMF UVs, brush or box collision; verified with the real compiler |
| Hotspot texturing (`$rectanglemap`/`.rect`) | `read_rect`, `write_rect`, `align_faces(fitRect)` | verified: a 256x128 face maps exactly onto a 32..96 / 64..128 hotspot; the `.rect` reader/writer round-trips. L4D2 ships no `.rect`, so the format is checked against its own grammar |
| Particle/rope/fog/render-effect previews | Editor-only; `render_vmf_view`, `run_map_test`, `read_lightmap_budget` are the substitutes |

These are not gaps in what a map can contain. They are the editor application's own surface,
and the table above says which primitive stands in for each one. Propper++ used to be the
one row that was a real gap; `brush_to_model` closes it, so the remaining rows are editor
presentation rather than map content.

## Hammer++ files

Hammer++ writes data vanilla Hammer does not. The writers splice rather than reserialise, so
unknown root blocks and keyvalues survive an edit. Two pieces need more than that:

| Data | What happens |
|---|---|
| `palette_plus`, `colorcorrection_plus`, lighting-preview and background blocks | Kept byte-for-byte at the root; a write adds or edits one block and touches nothing else |
| `vertices_plus` inside a side | The exact face loop. `transform_solids` and `move_vertices` move it through the same matrix as the plane. A clip drops it from cut and surviving faces, because their loop changed; the plane is still valid and Hammer++ regenerates the block on save |
| New brushes from `write_vmf_solid` and friends | Written with planes and axes only, as vanilla Hammer does. Hammer++ derives `vertices_plus` when it saves |

A stale `vertices_plus` is worse than none: Hammer++ would draw the brush where it used to
be. That is why geometry edits update or drop it rather than leave it behind.

## What is genuinely missing

Ordered by how often a mapper needs it:

1. **HLMV 3D viewport on a headless desktop** - `run_hlmv` launches the editor and `capture_window` returns its UI as an image; the 3D canvas itself stays black in a sandboxed session and needs an interactive desktop. `preview_model` closes the gap by compiling a sealed room with the model and capturing the engine's view; the HLMV canvas remains the environment's limit, not the toolkit's.

The rest is editor presentation: selection glow, gizmos, previews and drag interactions. Their
results are already file-level operations, and the coverage table says which one stands in.
