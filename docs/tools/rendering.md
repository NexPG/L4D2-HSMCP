# Rendering and measurement

20 tools: offline views and plans, room/space measurement, visibility and sight lines.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Views and plans

| Tool | What it does |
|---|---|
| `compare_renders` | Renders the same camera against two .vmf files and reports what changed in the picture: changed pixel count, fraction, mean and maximum channel delta, and the bounding box. |
| `render_bsp_view` | Renders a COMPILED .bsp from a camera and returns the picture. |
| `render_vmf_plan` | A dimensioned floor plan of a .vmf: a horizontal cut taken above the floor, with room outlines, floor areas, the width written on every doorway, a grid, a scale bar and a north arrow. |
| `render_vmf_tour` | Walks a .vmf and returns one picture of the whole place: a contact sheet of eye-height views, one per room and one from each side of every doorway, worked out from the map rather than from cameras you supply. |
| `render_vmf_view` | Renders a .vmf from a camera and returns the picture, so the shape of a place can be LOOKED at rather than inferred from coordinates. |

## Space and visibility

| Tool | What it does |
|---|---|
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
