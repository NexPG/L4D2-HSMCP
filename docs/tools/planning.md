# Map planning

2 tools: the five pass-1 drawings: site, terrain, circulation, schedule and floor plans.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Design drawings

| Tool | What it does |
|---|---|
| `check_map_plan` | Validates a five-drawing map plan (JSON) without building: footprints inside the site, building overlaps, route width and route-through-building, entrances near the route and their terrain height, floors, beats, palette and acceptance. |
| `render_map_plan` | Renders a map plan JSON as the five pass-1 drawings: site plan, vertical/terrain plan, circulation plan, building/height schedule, and floor plans/sections for every enterable building, plus plan.md. |
