# Primitives first, shortcuts second

The agent is the user. The toolkit gives **operations**, not a menu of prepared answers.
Every capability must be reachable through a general tool; a convenience tool may sit on top
of that path, but deleting it must not remove the capability.

## The primitive layer

| Want | Primitive | Notes |
|---|---|---|
| Any brush shape | `write_vmf_solid` with `shape: "convex"` | Arbitrary face loops; the named shapes are shortcuts |
| Move / rotate / scale / mirror | `transform_solids` | One operation per call, any pivot, optional grid |
| Copy one face's alignment | `copy_face_alignment` | Exact uaxis/vaxis, optional material and lightmap scale; `align_faces` is the computed alternative |
| Copy / paste | `clone_solids` | Fresh ids, byte-for-byte materials and alignment |
| Any entity, keyvalue or output | `edit_vmf` | `add`, `update`, `remove`, `addOutput`, `removeOutput` |
| Any brush entity with a volume | `write_brush_entity` | class is a string, not an enum; keys and outputs pass through |
| Any point entity with an origin | `write_point_entity` | class is a string, not an enum |
| Prove an entity exists in the running map | `write_entity_probe` | adds an `OnUser1` or natural-output echo; pair its `schedule`/`markers` with `run_map_test` |
| Mark nav areas | `write_nav_attribute_region` | `func_nav_attribute_region` bits; regenerate nav and test with `write_nav_probe` |
| Count live entities / read nav attributes | `write_class_probe`, `write_nav_probe` | VScript, installed through `run_map_test`'s `scriptsDir` |
| Send a real key to a window | `run_input` | focus + `keybd_event`; reports `focused` and the foreground handle |
| Any compiled-map entity | `edit_bsp_entities` | add/update/remove in lump 0; append-only, no other lump moves |
| Any worldspawn key | `set_worldspawn` | `worldspawn` is not an `entity` block, so `edit_vmf` cannot reach it |
| Any VScript | `write_vscript` | The Squirrel source is yours; `logic_script` wiring is a convenience |
| Any VMF-side check | `read_vmf`, `read_vmf_solids`, `read_vmf_lint`, `read_entity_report` | |
| Any compiled-map question | `read_bsp_info`, `read_bsp_entities`, `read_map_report` | |
| Baked lightmap, PVS or compiled overlay data | `read_bsp_lightmaps`, `read_bsp_vis`, `read_bsp_overlays` | RGB luxels and a PNG per face; cluster vectors; 352-byte overlay records |
| Compile with either chain | `run_compile` | Stock or Hammer++/Tools++ |
| Run the game | `run_map_test`, `run_nav_generate` | Watches the log; does not type into a live console |
| Assets | `read_game_content`, `read_model_info`, `run_vtf_convert`, `run_tga2skybox` | |

## Shortcuts and what they sit on

| Shortcut | Primitive path |
|---|---|
| `write_vmf_fitting` (door frame, counter, skirting, cornice) | `write_vmf_solid` with convex faces |
| `write_weather` | `edit_vmf` for the entities + `write_vmf_solid` for the volume |
| `write_sky_camera` | `edit_vmf` with `sky_camera` |
| `write_instance` | `edit_vmf` with `func_instance` |
| `create_instance_from_selection` | Read the selection, write it as a VMF, place `func_instance`, delete the originals |
| `merge_solids` | Convex hull of the selected corners, `write_vmf_solid` convex, `delete_solids` |
| `move_to_surface` | `read_vmf_trace` plus `transform_solids` (the tool batches the rays) |
| `set_map_properties` | `set_worldspawn` |
| `group_solids`, `set_visgroup`, `set_cordon` | `edit_vmf` plus the VMF `editor` blocks |
| `write_displacement`, `subdivide_displacements`, `sculpt_displacement`, `paint_displacement` | Direct `dispinfo` editing, which is its own format |
| `write_campaign` | The mission KeyValues format; `keyvalues` at mission, mode and chapter level covers anything the spec does not model |
| `write_trigger`, `write_mover`, `write_logic` | `write_brush_entity` / `write_point_entity` with the class and keys; the named builders only add defaults |

## Rules for new tools

1. Name the primitive the new tool sits on. If there is none, write the primitive first.
2. An enum is allowed only when it is the engine's complete list (for example `preciptype`).
   If the engine takes an arbitrary string or number, expose one.
3. A measured default is fine; a hardcoded only-choice is not.
4. If a capability is missing, add it to `coverage.md` and the backlog. Do not present a
   subset as the whole feature.

## Known real gaps

These are not menus; they are capabilities that do not exist yet:

- HLMV's 3D canvas on a headless desktop: `preview_model` is the substitute.
