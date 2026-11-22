# VMF authoring

84 tools: source maps: files, entities, brushes, faces, lighting, overlays, instances, terrain and weather.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Files, entities and wiring

| Tool | What it does |
|---|---|
| `diff_vmf` | Compares two .vmf files by what a mapper means by changed, not by bytes: brushes added, removed or changed (volume, bounds, materials, displacement count), entities added, removed or changed (keyvalues and outputs), and worldspawn keys. |
| `edit_vmf` | Edits a .vmf in place by splicing byte ranges of the original file: everything not touched stays byte-identical, so a one-entity change is a one-entity diff. |
| `export_vmf_map` | Exports a .vmf to Valve's .map format 220: every brush face keeps its three points, material, uaxis/vaxis and scale; every entity keeps its keyvalues and outputs. |
| `normalize_vmf_io` | Rewrites the entity-output separators inside `connections` blocks to one style. |
| `place_door` | Places a rotating door in an opening, with the entity origin on the hinge rather than in the middle of the leaf. |
| `read_autosaves` | Finds Hammer's autosaves for one map and says which are newer than the saved .vmf. |
| `read_compile_sequences` | Reads the editor's Run Map sequences: which steps are enabled, what each runs and with which parameters. |
| `read_detail_sprites` | Reads a `detail.vbsp`: every detail type, its density, and the groups/models inside it (sprite or model, amount, alpha). |
| `read_entity_report` | Hammer's Entity Report: every entity with its keyvalues, filterable by classname, targetname or the presence of a key. |
| `read_fgd_autovisgroups` | Lists the FGD's `@AutoVisgroup` tree and the entity classes each group contains. |
| `read_fgd_class` | What the game's own FGD declares for an entity class: every keyvalue with its type and default, every input, every output. |
| `read_vmf` | Entities, outputs and brush counts of a .vmf, reported without judgement. |
| `read_vmf_lint` | Checks a .vmf against the game's FGD and against what the compilers accept, before a compile that can take forty minutes to fail. |
| `restore_autosave` | Writes one autosave out as a normal .vmf, so it can be opened in Hammer or compared with the map it came from. |
| `set_map_properties` | Sets the keyvalues that really live on worldspawn: the sky, the detail sprites, the prop fade width. |
| `set_worldspawn` | Sets or removes ANY keyvalue on worldspawn: sky, mapversion, message, detail sprites, custom keys, whatever the engine or a mod reads. |
| `validate_io` | Checks a map's entity wiring against the game's own FGD. |
| `write_ambient_generic` | Writes an `ambient_generic` sound emitter with `message` (the soundscript name), `health` volume, `radius`, `pitch` and outputs. |
| `write_brush_entity` | The universal brush-entity primitive: any classname, a box volume, arbitrary keyvalues and outputs, with the class read back and the keys checked against the FGD. |
| `write_detail_sprites` | Adds a detail-sprite type to `detail.vbsp`: density, one sprite group with a sprite rectangle (`x y w h sheetSize`), `spritesize` (x y z random), amount and alpha. |
| `write_entity_probe` | Adds a runtime presence probe to every entity with the given targetname: an `OnUser1` output that echoes a unique line through a `point_servercommand`. |
| `write_ladder` | Writes `func_ladder` as a brush volume, optionally with the `func_useableladder` point L4D2 uses for AI. |
| `write_logic` | Writes a point logic entity with its origin and outputs: `logic_auto`, `logic_relay`, `logic_timer`, `logic_branch`, `logic_compare`, `logic_case`, `math_counter` or `math_remap`. |
| `write_mover` | Writes a brush mover with the volume it needs: `func_movelinear` (movedir, speed, startposition), `func_rotating` (maxspeed, angles, axis flags) or `func_tracktrain` (a `target` path of `path_track`s). |
| `write_physics_constraint` | Writes a `phys_hinge`, `phys_lengthconstraint`, `phys_ballsocket`, `phys_slideconstraint` or `phys_ragdollconstraint` between two named entities. |
| `write_point_entity` | The universal point-entity primitive: any classname, origin, arbitrary keyvalues and outputs, with the class read back and the keys checked against the FGD. |
| `write_portal` | Places an areaportal, an areaportal window or an occluder: the two brush entities read_map_geometry has counted since the beginning and nothing has ever placed. |
| `write_prop` | Places a `prop_static`, `prop_dynamic` or `prop_physics` with its model, origin, angles, skin and solid mode, and checks the model with read_model_info when the game is available (a missing model is a warning, not a refusal). |
| `write_scene` | Writes a `logic_choreographed_scene` with a required `SceneFile`, optional targets 1-8 and outputs. |
| `write_trigger` | Writes a trigger as the brush entity it actually is: a sealed box tied to the class, with the keys that class needs (a teleport's or look trigger's `target`, a hurt trigger's damage and type, a push trigger's speed and direction, gravity's scale). |
| `write_vmf` | Creates an empty .vmf: Hammer's File > New. |

## Geometry

| Tool | What it does |
|---|---|
| `carve_solids` | Hammer's Carve: subtracts one brush (`carver`) from the brushes named by `targets`. |
| `clip_solids` | Cuts brushes with a plane, keeping the front, the back, or both. |
| `clone_solids` | Copies brushes that are already in a .vmf, giving every copy new solid and side ids and keeping its materials, texture axes and smoothing groups byte for byte. |
| `delete_solids` | Removes brushes from a .vmf. The counterpart of write_vmf_solid, and its absence is what made every mistake permanent: a brush created in the wrong place could not be taken back. Selects by id, owner, material or bounding box, refuses an empty selector rather than emptying the map, and refuses brushes inside a hidde... |
| `hollow_solids` | Turns solid blocks into the walls of a room. |
| `hull_solids` | Builds one convex brush around the vertices of selected brushes and/or an explicit point cloud. |
| `merge_solids` | Hammer's merge tool: replaces two or more selected convex brushes with the one convex brush around them. |
| `move_to_surface` | Hammer++'s Move Objects tool: drops or raises selected brushes to the first floor or ceiling under them. |
| `move_vertices` | Moves named corners of one brush: Hammer's vertex manipulation tool. |
| `read_vmf_solids` | Rebuilds every brush of a .vmf from its planes and checks that it is a closed convex volume. |
| `transform_solids` | Moves, turns, scales or mirrors brushes that are already in a .vmf. |
| `write_vmf_fitting` | Builds the things a room is finished with -- a door casing, a counter, skirting or a cornice -- as the several brushes each of them actually is. |
| `write_vmf_solid` | Creates brushes in a .vmf from a shape description: box, wedge (a ramp), cylinder (an n-sided prism), or convex for a hull given face by face. |

## Faces, lighting, overlays and terrain

| Tool | What it does |
|---|---|
| `align_faces` | Realigns the texture on selected faces: to the world axes, to the face's own plane, or stretched to fit the face. |
| `copy_face_alignment` | Copies ONE face's exact texture alignment -- uaxis, vaxis, offset and scale -- onto other faces, the operation Hammer calls copy/paste alignment. |
| `paint_displacement` | Paints the blend channel of displacements: uniform, by height, or by slope. |
| `read_bsp_lightmaps` | Reads baked lightmap RGB samples from a compiled .bsp: per-face average colour, darkest and brightest luxel, a few sample values, and the total sampled luxels. |
| `read_bsp_overlays` | Lists compiled overlays from a .bsp: id, texinfo/material, face count and indices, render order, U/V ranges, four UV points, origin and basis normal. |
| `read_displacements` | Reads the displacements of a .vmf: the grids of vertices that replace a brush face and make every piece of terrain in Source. |
| `read_lightmap_budget` | Where a compiled map's lightmap resolution went. |
| `sculpt_displacement` | Reshapes displacements: flatten, raise, slope between two heights, or add noise. |
| `seal_displacements` | Adds the solid a displacement removed: duplicates every displaced world brush, drops its dispinfo and paints the copy with a tool material. |
| `set_face_material` | Sets the material on selected faces of a .vmf. |
| `set_face_uv` | Writes a face's texture axes directly: the U and V vectors, their offsets and scales, and the `rotation` key. |
| `set_smoothing_groups` | Sets the smoothing groups on selected faces. |
| `sew_displacements` | Pulls displacements back together along the edges they share. |
| `subdivide_displacements` | Hammer's Subdivide: raises a displacement's power from 2 or 3 to 3 or 4 while keeping its shape. |
| `write_cubemap_grid` | Places `env_cubemap` entities on a regular grid inside a bounds box. |
| `write_decal` | Places `infodecal` entities at one or more points. |
| `write_displacement` | Creates displacements on selected faces: the vertex grids that make every piece of terrain in Source. |
| `write_light` | Places a light of a named kind with the keys that make it work: a point `light`, a `light_environment` with its sun angles and ambient colour, a `light_dynamic`, an `env_sun`, or a `shadow_control`. |
| `write_overlay` | Puts an `info_overlay` decal on an existing brush face: road markings, blood, signage. |
| `write_postprocess` | Places a postprocess entity: an `env_tonemap_controller` (with a `logic_auto` that sets the requested exposure, bloom and rate inputs at map spawn), an `env_fade`, an `env_shake`, or a `color_correction` volume. |
| `write_rope` | Places a rope as the pair the engine expects: a `move_rope` at the start whose `NextKey` names a `keyframe_rope` at the end. |
| `write_sprite` | Places a sprite, a beam or a laser with the targets those entities need. |
| `write_vmf_terrain` | Builds a terrain patch: a grid of floor brushes at floorZ, a power-2/3/4 displacement on every top face, then sculpt_displacement noise and sew_displacements. |
| `write_vmf_water` | Creates a water volume: a `func_water_analog` brush with a Water-shader material and a `water_lod_control` entity if the map has none. |

## Instances and prefabs

| Tool | What it does |
|---|---|
| `collapse_instances` | Expands every `func_instance` the way vbsp does and writes an ordinary VMF. |
| `create_instance_from_selection` | Hammer++'s Create Instance from Selection: writes the selected brushes as a standing instance .vmf, removes them from the map and leaves one `func_instance` at their centre. |
| `insert_prefab` | Pastes a saved Hammer prefab -- a `.vmf` fragment -- into a map. |
| `write_instance` | Places a Hammer instance: adds a `func_instance` entity pointing at an instance .vmf, with an origin, angles and a fixup style. |

## Organisation and optimisation

| Tool | What it does |
|---|---|
| `auto_visgroups` | Fills a visgroup tree from what the map already contains, the way Hammer++'s Auto Visgroups does: one visgroup per entity class and one per world-brush material, with both halves written. |
| `group_solids` | Puts brushes in one Hammer group, or takes them out of theirs. |
| `read_map_organisation` | Visgroups, groups and the cordon of a .vmf, with what belongs to each. |
| `set_cordon` | Sets the cordon box and whether it is on. |
| `set_lightmap_scale` | Sets lightmapscale on selected faces of a .vmf. |
| `set_solid_class` | Moves brushes between the world and a brush entity -- in practice, into or out of func_detail. |
| `set_visgroup` | Puts brushes in a named visgroup, creating it if it does not exist, or takes them out. |
| `write_hint_brush` | Creates a hint brush: a slab carrying TOOLS/TOOLSHINT on the plane vvis should cut along and TOOLS/TOOLSSKIP everywhere else. |

## Weather

| Tool | What it does |
|---|---|
| `write_weather` | Adds Left 4 Dead 2 weather to a map: a `func_precipitation` volume for rain, snow, ash or one of the particle variants, and an `env_fog_controller` for distance fog. |

## Map analysis and leak

| Tool | What it does |
|---|---|
| `read_vmf_leak` | Whether a .vmf is sealed, WITHOUT compiling it. |
| `read_vmf_rooms` | The rooms of a .vmf, the openings between them, and how they connect -- from the geometry alone, with no compilation and no annotation in the file. |
| `read_vmf_surfaces` | Every face of a .vmf sorted into floor, wall, ceiling and slope, with how much of each a person could actually touch -- and which brush touches which. |
