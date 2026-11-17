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
| Backups | `backup: true` on writers | verified |

## World geometry

| Feature | Tool | Status |
|---|---|---|
| Brush create: box, wedge, cylinder, convex | `write_vmf_solid` | verified |
| Clip | `clip_solids` | tool |
| Hollow | `hollow_solids` | tool |
| Vertex edit | `move_vertices` | tool |
| Move/rotate/scale/mirror | `transform_solids` | tool |
| Delete | `delete_solids` | verified |
| Carve | several clips | tool |
| Arch / torus | — | **gap** |
| Fitting (door casing, counter, skirting) | `write_vmf_fitting` | tool |

## Displacements

| Feature | Tool | Status |
|---|---|---|
| Create / subdivide | `write_displacement` | tool |
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
| Texture alignment | `align_faces` | tool |
| Smoothing groups | `set_smoothing_groups` | tool |
| Lightmap scale | `set_lightmap_scale` | tool |
| Light entities | `edit_vmf` | verified |
| Map properties (sky, detail, fade) | `set_map_properties` | verified |
| Cubemap placement | `edit_vmf` (`env_cubemap`) | tool |
| Build cubemaps in engine | — | **gap** (engine `buildcubemaps` is a manual step) |

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
| 3D skybox | — | **gap** (2D sky is `skyname`) |
| Instances | `read_vmf` `collapseInstances` only | **gap** (no writer) |
| Prefabs | — | **gap** |
| Model authoring (HLMV, studiomdl) | `run_model_info` read-only | **gap** |

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

1. **Instances and prefabs** — writing them, not just reading.
2. **3D skybox** — `sky_camera` and the scaled copy of the geometry.
3. **Cubemap building** — the engine step, not just the HDR conversion.
4. **Arch/torus geometry** — the two primitive tools `write_vmf_solid` lacks.
5. **Model authoring** — HLMV/studiomdl, a separate pipeline.

Each of these is a row that keeps the project short of "everything Hammer++ can do".
