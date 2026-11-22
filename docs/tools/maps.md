# Maps, VMF and BSP

121 tools: creating and editing .vmf, brushes, entities, faces, displacements, compile, audit and offline views.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Map files and entities

| Tool | What it does |
|---|---|
| `check_assets` | Checks a source .vmf's references against the game's mounted content before compiling: solid materials (following `patch`/`include` and their textures), `prop_*` models (with `.vvd`/`.dx90.vtx` and the model's own materials), decals and overlays, sounds with an audio extension, `info_particle_system` effects, `logic... |
| `diff_vmf` | Compares two .vmf files by what a mapper means by changed, not by bytes: brushes added, removed or changed (volume, bounds, materials, displacement count), entities added, removed or changed (keyvalues and outputs), and worldspawn keys. |
| `edit_vmf` | Edits a .vmf in place by splicing byte ranges of the original file: everything not touched stays byte-identical, so a one-entity change is a one-entity diff. |
| `export_vmf_map` | Exports a .vmf to Valve's .map format 220: every brush face keeps its three points, material, uaxis/vaxis and scale; every entity keeps its keyvalues and outputs. |
| `normalize_vmf_io` | Rewrites the entity-output separators inside `connections` blocks to one style. |
| `place_door` | Places a rotating door in an opening, with the entity origin on the hinge rather than in the middle of the leaf. |
| `read_autosaves` | Finds Hammer's autosaves for one map and says which are newer than the saved .vmf. |
| `read_compile_sequences` | Reads the editor's Run Map sequences: which steps are enabled, what each runs and with which parameters. |
| `read_detail_sprites` | Reads a `detail.vbsp`: every detail type, its density, and the groups/models inside it (sprite or model, amount, alpha). |
| `read_entity_report` | Hammer's Entity Report: every entity with its keyvalues, filterable by classname, targetname or the presence of a key. |
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

## Faces, materials and lighting

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

## Compile, pack and audit

| Tool | What it does |
|---|---|
| `check_bsp` | Checks a compiled .bsp as a file and against its source. |
| `check_vmf_rules` | Checks a .vmf against ITS OWN rules file -- `<map>.rules.json`, a sibling of the .vmf. |
| `edit_bsp_entities` | Adds, updates or removes entities in a COMPILED .bsp -- the primitive needed for things a source map cannot express, such as point_servercommand plus logic_auto for buildcubemaps. |
| `edit_static_props` | Adds, changes or removes props in a compiled .bsp's static-prop game lump. |
| `read_bsp_entities` | Entities of a compiled .bsp, read from lump 0. |
| `read_bsp_faces` | Reads a compiled map's faces: the material, smoothing-group bitmask, lightmap footprint and texture vectors vbsp actually produced. |
| `read_bsp_info` | Header of a compiled .bsp: ident, version, mapRevision and all 64 lumps with their offset and size. |
| `read_bsp_lump` | Reads any of a .bsp's 64 lumps by name (ENTITIES, PLANES, TEXDATA, …) or index, decoding an individually LZMA-compressed lump instead of refusing it. |
| `read_compile_log` | Turns compiler output into structured findings, each with what the message actually means. |
| `read_leak` | Turns a leak into a location. vbsp says only 'leaked!' and writes a .lin pointfile beside the map: this reads it and names the entities nearest to where the path starts, which is the entity that can see the void. Pass the .lin, or the .vmf or .bsp beside it. Both ends of the path are correlated, because vbsp does no... |
| `read_map_dependencies` | Every asset a compiled map references, and where each will come from at runtime: packed inside the map, found in the game's own content, or missing. |
| `read_map_report` | Judges a compiled map against a budget profile and returns a verdict per criterion, not just numbers. |
| `read_nav` | Reads a .nav mesh header and says whether it still matches its map. |
| `read_nav_dump` | Reads the `<map>_nav.txt` dump the engine writes beside a generated nav mesh: every area's centre, its connections, and its attribute flags decoded — CHECKPOINT, PLAYER_START, FINALE and the computed escape route. |
| `review_map` | Audits a map in one call: FGD lint, its own rules file, organisation, and -- when a compiled .bsp sits beside it -- the budget report, lightmap and visleaf statistics and the asset dependency walk. |
| `run_bsp_rename` | Renames a compiled .bsp AND the content packed inside it -- the nodegraph, cubemap patches, soundscripts, anything under maps/<name>/. |
| `run_compile` | Compiles a .vmf with vbsp, vvis and vrad natively, and returns each stage's findings rather than its raw output. |
| `run_pack` | Packs files into a compiled .bsp with this server's own ZIP writer: no bspzip, no Steam install, no VConfig. |
| `run_pakfile_add` | Adds files to a compiled .bsp's pakfile with this server's own ZIP writer: no bspzip, no game install. |
| `write_bsp_lump` | Replaces one lump of a .bsp: reads bytes from `source`, `text` or `base64`, optionally LZMA-compresses them in Source's framing, appends them to the file and moves only that lump's descriptor. |

## Rendering and space

| Tool | What it does |
|---|---|
| `compare_renders` | Renders the same camera against two .vmf files and reports what changed in the picture: changed pixel count, fraction, mean and maximum channel delta, and the bounding box. |
| `measure_vmf_approach` | How much clear room a person has in front of the entities of a .vmf -- doors, buttons, vending machines, anything with an origin and a yaw. |
| `measure_vmf_clearance` | How much room there actually is at a point in a .vmf: the free width across, the headroom, and what stops each measurement. |
| `read_brush_volumes` | Footprint and volume of every brush entity in a compiled map, grouped by classname. |
| `read_bsp_vis` | Reads a vis'd .bsp's PVS: cluster count, the compressed byte-vector size of every cluster, the leaves with no cluster, and — for a selected `cluster` — the clusters it can see. |
| `read_map_extents` | Real size of a compiled map, from the world model in lump 14. |
| `read_map_geometry` | What each lump of a compiled map holds, and how close that is to the compiler's ceiling. |
| `read_pakfile` | What a compiled map actually ships inside it: lump 40 is a plain ZIP, and this lists its contents by extension and by size. |
| `read_prop_survey` | Inventory of a compiled map's prop entities, by model and by class, plus the prop_dynamic entities that carry no name, no parent, no animation and no output. |
| `read_sightlines` | Longest unobstructed lines of sight across a compiled map, traced against the same world tree the engine walks for a TraceLine. |
| `read_static_props` | Collision audit of a compiled map's static props. |
| `read_visleaf_stats` | Quality of a compiled map's visibility split: LEAFS for the bounding volume and cluster of every leaf, VISIBILITY for the map's real cluster count from its own header. |
| `read_vmf_nearest_surface` | The nearest solid surface to a point in a .vmf, exactly -- distance, the point on the surface, and which brush and face it belongs to. |
| `read_vmf_sightlines` | The longest clear lines of sight in an UNCOMPILED .vmf, sampled from the places a person can actually stand. |
| `read_vmf_trace` | Trace a ray, or a swept player-sized box, through a .vmf -- with no compilation. |
| `read_vmf_visibility` | Whether each of several named pairs of points can see each other in an uncompiled .vmf, and what blocks the ones that cannot -- by brush id, face and material. |
| `render_bsp_view` | Renders a COMPILED .bsp from a camera and returns the picture. |
| `render_vmf_plan` | A dimensioned floor plan of a .vmf: a horizontal cut taken above the floor, with room outlines, floor areas, the width written on every doorway, a grid, a scale bar and a north arrow. |
| `render_vmf_tour` | Walks a .vmf and returns one picture of the whole place: a contact sheet of eye-height views, one per room and one from each side of every doorway, worked out from the map rather than from cameras you supply. |
| `render_vmf_view` | Renders a .vmf from a camera and returns the picture, so the shape of a place can be LOOKED at rather than inferred from coordinates. |

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

## Navigation in maps

| Tool | What it does |
|---|---|
| `write_nav_attribute_region` | Writes a `func_nav_attribute_region` brush with the L4D2 spawnflags (CHECKPOINT 2048, FINALE 64, RESCUE_CLOSET 65536, ...). |
