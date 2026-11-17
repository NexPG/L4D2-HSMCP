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
| Texture alignment | `align_faces`, `copy_face_alignment` | tool |
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
| 3D skybox | `write_sky_camera` + `clone_solids` + `transform_solids`; sealing and layout manual | partial (camera and copy tools, layout gap) |
| Instances | `write_instance` places a `func_instance`; `read_vmf` with `collapseInstances` reads the result | tool (fixture-tested); nested instances are reported |
| Prefabs | — | **gap** |
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

## What is genuinely missing

Ordered by how often a mapper needs it:

1. **3D skybox layout** - `clone_solids` makes the copy and `transform_solids` scales it; choosing what to copy, sealing the skybox area and matching the camera remain manual.
2. **HLMV preview** - model source and `studiomdl` compile are covered; launching HLMV to look at the result is not.

Each of these is a row that keeps the project short of "everything Hammer++ can do".
