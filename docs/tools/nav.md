# Navigation

12 tools: nav areas, attributes, connections, hiding spots, encounters, path and sight queries.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Areas, attributes and connections

| Tool | What it does |
|---|---|
| `edit_nav_connections` | Adds, removes or replaces nav-mesh connections by area id, without touching any other byte of the area record. |
| `read_nav_areas` | Lists the areas of a .nav with their attributes, L4D2 spawn attributes, place, centre, size and connection counts. |
| `read_nav_encounters` | Reads a .nav's spot encounters: paths from one area to another, each with the hiding spots a bot should look at along the way and the parametric distance (`t = byte / 255`). |
| `read_nav_hiding_spots` | Lists a .nav's hiding spots: id, world position, raw flag byte decoded as IN_COVER, GOOD_SNIPER_SPOT, IDEAL_SNIPER_SPOT and EXPOSED, and the area and place each belongs to. |
| `read_nav_places` | Summarises a .nav's place table: each place with its 1-based id (0 = no place), area count, first area ids, bounds, centre and the spawn attributes its areas carry. |
| `read_nav_visibility` | Reads nav visibility: each list entry stores the target area index, not its hash id, with NOT_VISIBLE 0, POTENTIALLY_VISIBLE 1, COMPLETELY_VISIBLE 2 or both. |
| `write_nav_areas` | Changes nav area attributes, L4D2 spawn attributes and place names in place. |
| `write_nav_attribute_region` | Writes a `func_nav_attribute_region` brush with the L4D2 spawnflags (CHECKPOINT 2048, FINALE 64, RESCUE_CLOSET 65536, ...). |

## Path and sight queries

| Tool | What it does |
|---|---|
| `nav_los` | Checks a nav-level line of sight: samples the segment and requires every sample to lie inside some nav area (with a vertical tolerance). |
| `nav_path` | Finds a walking route between two points through the nav mesh with A*, resolving connections by area id and ladders by ladder id. |
| `nav_reachable` | Answers whether a walker can get from one point to another on the nav mesh, and how many areas the connected region contains. |

## Troubleshooting

| Tool | What it does |
|---|---|
| `nav_trouble_report` | Runs Left 4 Dead 2's own `nav_trouble_report` in the engine and returns its checks as structured findings, or analyses a `<map>_nav.txt` dump offline. |
