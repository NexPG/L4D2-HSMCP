# Hammer++ feature coverage

The goal is that an agent can do everything Hammer++ can, and more. This is the scorecard.
`verified` means a tool exists **and** the result was checked in game or against a real file;
`tool` means the tool exists but has not been exercised on L4D2 content; `gap` means there is
no way to do it yet.

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
| Clip | `clip_solids` | tool |
| Hollow | `hollow_solids` | tool |
| Vertex edit | `move_vertices` | tool |
| Move/rotate/scale/mirror | `transform_solids` | tool |
| Merge convex brushes | `merge_solids` | verified: merged platform passed vbsp; refuses a non-convex or overlapping union |
| Move objects to floor/ceiling | `move_to_surface` | verified: dropped brush passed vbsp; optional align to the surface |
| Delete | `delete_solids` | verified |
| Carve | several clips | tool |
| Fitting (door casing, counter, skirting) | `write_vmf_fitting` | tool |

## Displacements

| Feature | Tool | Status |
|---|---|---|
| Create | `write_displacement` | tool |
| Subdivide (raise power) | `subdivide_displacements` | tool |
| Sew | `sew_displacements` | tool |
| Sculpt (flatten, raise, slope, noise) | `sculpt_displacement` | tool |
| Paint blend | `paint_displacement` | tool |
| Read | `read_displacements` | tool |

## Entities and I/O

| Feature | Tool | Status |
|---|---|---|
| Add entity | `edit_vmf` `add` | verified |
| Edit keyvalues | `edit_vmf` `update` | verified |
| Outputs | `edit_vmf` `addOutput` / `removeOutput` | verified |
| Entity report | `read_entity_report` | verified |
| FGD browser (classes, keys, I/O) | `read_fgd_class` (with prefix) | verified |
| I/O validation | `validate_io` | verified |
| Check for problems (Alt+P) | `read_vmf_lint`, `check_vmf_rules` | verified |

## Faces, textures, lighting

| Feature | Tool | Status |
|---|---|---|
| Texture browser | `read_game_content(kind: "material")` | verified |
| Material assign | `set_face_material` | verified |
| Texture alignment | `align_faces`, `copy_face_alignment`, `set_face_uv` | tool |
| Manual U/V vectors (skew) | `set_face_uv` | verified: skewed axes accepted by vbsp and the map loaded |
| Smoothing groups | `set_smoothing_groups` | tool |
| Lightmap scale | `set_lightmap_scale` | tool |
| Light entities | `edit_vmf` | verified |
| Map properties (sky, detail, fade) | `set_map_properties` | verified |
| Cubemap placement | `edit_vmf` (`env_cubemap`) | tool: the entity is internal and must be in the VMF before compile |
| Build cubemaps in engine | `run_build_cubemaps` | verified HDR/LDR/both; `pack` copies them into an `outBsp` |

## Detail, hints, portals

| Feature | Tool | Status |
|---|---|---|
| func_detail | `set_solid_class` | tool |
| Hint/skip | `write_hint_brush` | tool |
| Areaportal / occluder | `write_portal` | tool |
| Visgroups / groups / cordon | `set_visgroup`, `group_solids`, `set_cordon` | tool |

## Assets

| Feature | Tool | Status |
|---|---|---|
| Model browser + sizes | `read_game_content(kind: "model", details: true)` | verified |
| Model details (skins, sequences, materials) | `read_model_info` | verified |
| Particle browser | `read_game_content(kind: "particle")` | verified |
| Sound browser | `read_game_content(kind: "sound")` | verified |
| VTF conversion | `run_vtf_convert`, `run_tga2skybox`, `run_cubemap2hdr` | tool |
| Overlays / decals | `write_overlay` | tool (format from Valve's styleguide VMF; play test pending) |
| 3D skybox | `write_sky_camera` + `write_skybox_copy`; sealing and design manual | partial (copy and camera tools, sealing/design gap) |
| Instances | `write_instance` places a `func_instance`; `read_vmf` with `collapseInstances` reads the result | tool (fixture-tested); nested instances are reported |
| Instance from selection | `create_instance_from_selection` | verified: the extracted instance and `func_instance` passed vbsp; a brush entity is taken whole |
| Prefabs | `insert_prefab` | verified: paste a saved `.vmf` fragment; ids remapped, move and yaw about a pivot; brush entities and entity angles turn with it |
| Model authoring (HLMV, studiomdl) | `read_text_file`, `write_text_file`, `run_studiomdl`, `run_hlmv`, `capture_window` | tool: sample compiled and HLMV launched; screenshot returns an image block, 3D canvas depends on the desktop |
| Visual capture | `capture_window`, `run_map_test` screenshot, `run_hlmv` screenshot | tool: real MCP image; `screen` captures a 3D game canvas, `window` captures occluded UI/dialogs |

## Compile, run, nav, campaign

| Feature | Tool | Status |
|---|---|---|
| Compile (stock or Tools++) | `run_compile` | verified |
| Leak check | `read_vmf_leak`, `read_leak` | verified |
| Compile log findings | `read_compile_log` | verified |
| Pack assets into BSP | `run_pack` | tool |
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
| Keybind editor, Discord RPC, MP3 playback, model hotload, crash recovery, autosave | Application features with no file-level operation. Guarded writers take backups and support `dryRun`; there is no live session to recover |

These are not gaps in what a map can contain. They are the editor application's own surface,
and the table above says which primitive stands in for each one.

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

1. **3D-skybox design** - `write_skybox_copy` makes the scaled copy and `write_sky_camera` places the camera; choosing what to copy, sealing the area and matching the view remain design work.
2. **HLMV 3D viewport on a headless desktop** - `run_hlmv` launches the editor and `capture_window` returns its UI as an image; the 3D canvas itself stays black in a sandboxed session and needs an interactive desktop. The operation is covered; rendering it is the environment's limit.

Each of these is a row that keeps the project short of "everything Hammer++ can do".
