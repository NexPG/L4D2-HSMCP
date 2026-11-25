# Map planning

2 tools: the five pass-1 drawings: site, terrain, circulation, schedule and floor plans.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Design drawings

| Tool | What it does |
|---|---|
| `check_map_plan` | Validates a five-drawing map plan (JSON) without building: the brief (experience, pillars, beats), the route skeleton (districts, named spaces, intensity, landmarks, gates, branch anchors), footprints inside the site, building overlaps, route width and route-through-building, entrances near the route and their terra... |
| `render_map_plan` | Renders a map plan JSON as the five pass-1 drawings: site plan, vertical/terrain plan, circulation plan with districts, intensity-coloured route nodes, landmarks, gates and a Director rhythm strip, building/height schedule, and floor plans/sections for every enterable building, plus plan.md. |
