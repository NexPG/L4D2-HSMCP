# Hammer++ tabs and the tools that replace them

Hammer++ is a browser with several tabs. The agent has no window, so each tab has a tool.
This page is the map from one to the other, and the recipes for browsing a city's assets.

| Hammer++ | Use |
|---|---|
| Texture Browser | `read_game_content(kind: "material", pattern: "...")`; `read_asset_catalog` groups materials by surface kind (roots, `includeHidden` and paths: [`../assets/models.md`](../assets/models.md)) |
| Model Browser | `read_game_content(kind: "model", pattern: "...", details: true)` for names **and hull sizes**; `read_model_info` for skins, sequences and materials of one model |
| Particle Browser | `read_game_content(kind: "particle", pattern: "*")` for files; `read_particle` for the systems inside one |
| Entity Report / Entity Tool | `read_entity_report` shows what the map has; `read_fgd_class` with no classname lists classes by prefix, and with a classname returns every keyvalue, input and output |
| Face Edit Sheet | `set_face_material`, `align_faces`, `set_face_uv`, `copy_face_alignment`, `set_smoothing_groups`, `set_lightmap_scale` |
| Overlay tool (decals) | `write_overlay(sideId, origin, material, width, height)` — the target face's id from `read_vmf_surfaces` |
| Visgroups / Groups | `read_map_organisation`, `set_visgroup`, `group_solids` |
| Cordon | `set_cordon` |
| Displacements | `read_displacements`, `write_displacement`, `sew_displacements`, `sculpt_displacement`, `paint_displacement` |
| Instances | `write_instance` places a `func_instance`; `read_vmf` with `collapseInstances: true` expands it for reading |
| Prefabs | `insert_prefab` pastes a saved `.vmf` fragment with fresh ids, a move and a yaw rotation |
| Compile / Run | `run_compile`, `read_compile_log`, `run_map_test` |
| Map properties | `set_map_properties` (sky, detail sprites, prop fade); `set_worldspawn` for any other key |
| Options → Game Data Files | `health` reports the FGD the tools use |

## Browsing for a city

Query first, never name from memory. The exact strings are game content, and a wrong one is a
purple checkerboard at load.

| Want | Query |
|---|---|
| road surfaces | `read_game_content(pattern: "road", kind: "material")` |
| asphalt, concrete, pavement | the same with `"asphalt"`, `"concrete"`, `"pavement"` |
| sidewalks and kerbs | `"sidewalk"`, `"kerb"`, `"curb"` |
| building facades | `"brick"`, `"concrete"`, `"window"`, `"facade"` |
| skyboxes | `read_game_content(pattern: "skybox", kind: "material")`, then `"sky_l4d"` |
| buildings and urban props, with sizes | `read_game_content(pattern: "props_urban", kind: "model", details: true)` |
| street furniture | `"props_street"`, `"props_fairgrounds"`, `"props_mall"` |
| particle effects | `read_particle` on a `.pcf`: system names, children, materials |

`details: true` on a model returns `mins`, `maxs` and `size` in Hammer units — the same
numbers the model viewer shows. A house is placed by its size and its origin: a model whose
origin sits at its centre sinks half its height into the floor when placed at the floor's z.

## Skyboxes

A skybox is not a brush material: the `skyname` and its six faces are in
[`3d-skybox.md`](3d-skybox.md).

## Rules

1. **Names and sizes are content, not guesses.** Browse and measure with the tools in
   [`../assets/models.md`](../assets/models.md); this page only maps the tab to the tool.
2. **The FGD is the authority for entities.** `read_fgd_class` with no classname lists the
   classes (`prefix: "trigger_"` is the Entity Tool's filter); with a classname it answers
   what that class accepts. `read_entity_report` shows what the map already has.
3. **The editor's helper FGD is not the engine.** See `references/mapping/editor-and-fgd.md`.
