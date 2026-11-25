# The five plan drawings

Pass 1 is not prose. It is a **plan**: a JSON source plus five drawings. The drawings are
views of the JSON, not the source, so a disagreement is a bug in the renderer, not a design
decision to guess at. The research behind the authoring order — mission graph, space graph,
floor-plan graph — is in [`pipeline-research.md`](pipeline-research.md); the first layer, and the
proven practices it encodes, is in [`route-skeleton.md`](route-skeleton.md).

## What real projects draw

A building or neighbourhood drawing set is project-specific; there is no universal five-sheet
law. The common layers that match a game level are:

| Drawing | Real-world job | Game translation |
|---|---|---|
| **Site / master plan** | building footprints, property lines, distances, access, orientation, setbacks | every building's X/Y, size, rotation, spacing, site bounds, no-build zones |
| **Grading / vertical plan** | existing and proposed contours, spot elevations, drainage, cut and fill | terrain heightfield, water, building base and entrance Z, roof heights |
| **Circulation / flow plan** | streets, paths, widths, accessibility, transit stops, parking, flows | critical path and branches, clear width, stops/beats, entrances, forbidden zones, **spawn/cover/holdout/crescendo/finale areas** |
| **Building and height schedule** | table of uses, floors, heights, areas, occupancy | building id, floors, base/roof Z, footprint area, enterable, entrances |
| **Floor plans and sections** | room layout at a cut ~1.2 m above floor; sections show levels | enterable buildings: rooms, doors, stairs, vertical section |

A real set also carries a landscape plan, utility plan, detail sheets, a legend and a sheet
index. For a level, the landscape/utility layer folds into the site plan; the legend and the
sheet index are generated with the drawings.

## Why five architectural sheets are not enough for L4D2

L4D2 is a Director-driven co-op game, not a static neighbourhood. The five layers answer
"where is it and how tall"; they do not answer "why does the player fight here". The plan
therefore adds a **gameplay overlay** to the circulation sheet and a **Director table** beside
it:

- `areas[]` in the JSON: `spawn`, `cover`, `holdout`, `crescendo`, `tank`, `witch`, `one-way`,
  `no-mob`, `checkpoint`, `safe-room`, `finale`, `battlefield`, `item-cluster`. Each is a
  rectangle with a label and a note; the circulation drawing shows it dashed in its colour.
- `beats[]`: chapter, type, space, what changes, proof.
- `budget`, `finale`, `variability`, `acceptance`: the item layer, the finale stages, the
  per-load variation and the evidence.

This follows the official/community level-design lessons: checkpoints run
`PLAYER_START → CHECKPOINT → … → FINALE`; the Director needs a goal and nav flow; side rooms
carry items/spawns; panic and crescendo events are planned, not accidental; the finale must
trap the player and give preparation time; multiple or Director-chosen paths make a map
replayable; infected spawn from places the player cannot see. World of Level Design's 61-point
L4D2 guide is the compact source for those rules, and the VDC checkpoint/nav-flow pages are the
engine-side contract.

A 30-house plan with 30 floor plans is the wrong shape for a chapter. Most houses are
**facade** (no interior); only safe rooms, through-houses and set pieces get a floor plan. The
`enterable` flag and the schedule's `facade`/`enterable` distinction are there to stop the
build pass from detailing scenery.

Sources: World of Level Design, [L4D2/1 Visual Reference Guide to Level Design](https://www.worldofleveldesign.com/categories/left4dead2_mapping/l4d2-visual-gameplay-reference-guide-campaign-design.php)
(side rooms, panic, safe rooms, finale prep, multiple paths, spawns, landmarks, light);
VDC *Checkpoints* and *Nav Flow* (five-level flow, Director goal); the project's own
`docs/reference/l4d2-campaign-authoring.md` synthesis.

## The JSON is the contract

`plan/plan.json` (schema `MapPlanSchema` in `src/plan/typescript/mapplan.ts`) holds:

- `site` — bounds, north, grid, water, no-build rectangles.
- `terrain` — a grid: cell size, origin, cols, rows, heights.
- `buildings` — id, centre X/Y, width/depth, rotation, floors, floor height, base/roof Z,
  enterable, entrances, per-floor rooms and stairs.
- `stage` — `brief`, `skeleton`, `site`, `vertical`, `schedule`, `floors`, `flow`, `approved`;
  the authoring gate the JSON is at.
- `experience`, `pillars` — the one-sentence promise and the three decision rules.
- `districts` — `id`, `name`, `mood`, `motif`, `landmark`; the mental-map chunks of the chapter.
- `routes` — kind, typology, clear width, points (X/Y/Z), **nodes** with `floor`/`buildingId`/
  `space`/`district`/kind/`enclosure`/`intensity`/`landmark`/`gate`/`beat`, branch anchors
  (`from`/`to`), and stops with a kind (`start`, `checkpoint`, `safe-room`, `crescendo`, `tank`,
  `witch`, `finale`, `escape`, `branch`).
- `areas` — gameplay/nav overlays: spawn, cover, holdout, crescendo, tank, witch, one-way,
  no-mob, checkpoint, safe-room, finale, battlefield, item-cluster.
- `beats` — chapter, type, space, what changes, proof, intensity.
- `finale`, `budget`, `palette`, `variability`, `acceptance` — the rest of the design.

The drawings are rendered from that file; a plan that exists only as a picture is not a
handoff.

## The two tools

```text
check_map_plan(path: "workspaces/santa-monica/plan/plan.json")
render_map_plan(path: "workspaces/santa-monica/plan/plan.json", confirm: true)
```

`check_map_plan` fails when a footprint leaves the site, two footprints overlap (warning), a
route is narrower than 64 units, a route crosses a building away from an entrance, an
enterable building has no entrance or floor plan, a route misses every entrance, an entrance
height disagrees with the terrain, ids repeat, or beats/acceptance are empty. Warnings cover
overlaps, a missing floor plan, an entrance Z mismatch, a route over water and a campaign with
no finale block.

At `stage: "brief"` it fails until the experience, three pillars, three beats and acceptance
exist. At `stage: "skeleton"` it adds the route-quality gate: two districts with landmarks and
motifs, named spaces and districts on every node, a beat mapped to a node, three distinct
spaces, two turns, a vertical node, a peak and two rests, no three high nodes in a row, no four
identical enclosures, a vista, a landmark every four nodes, a gate, a drop that goes down, and
a branch anchored to the critical route. The errors are structural; the warnings are design
prompts, not noise.

`render_map_plan` writes, under `plan/drawings/` by default:

1. `01-site-plan.svg` — footprints, ids, sizes, rotation, coordinates, grid, north, scale.
2. `02-vertical-plan.svg` — terrain cells, heights, water, base/roof labels.
3. `03-circulation-plan.svg` — critical path (red), branches (blue), width band, stops,
   entrances, districts, route nodes coloured by intensity, landmarks and gates, and the
   Director rhythm strip.
4. `04-building-schedule.svg` — table of floors, base/roof/height, area, enterable, doors.
5. `05-floor-<id>-f<level>.svg` and `06-section-<id>.svg` for every enterable building.
6. `plan.md` — the index, links, districts, route rhythm, findings.

## Architectural sources

Wikipedia, [Architectural drawing](https://en.wikipedia.org/wiki/Architectural_drawing)
(floor plan, site plan, elevation, section, working drawings), [Site plan](https://en.wikipedia.org/wiki/Site_plan)
(footprints, roads, circulation, topography, setbacks, utilities) and [Site analysis](https://en.wikipedia.org/wiki/Site_analysis)
(location, context, zoning, natural and human-made features, circulation, climate). The
[Floor plan](https://en.wikipedia.org/wiki/Floor_plan) article documents the 1.2 m cut and the
plan/section relationship.

## Why SVG, not a CAD library

The researched options are real: `ezdxf` for DXF, `shapely` for polygon topology,
`matplotlib`/`svgwrite` for plots and SVG, `dxf-writer` and `d3-shape` on the JavaScript side.
For this project the source is already JSON and the consumer is an agent and a human looking
at a drawing, so plain SVG has three advantages: no dependency, deterministic text that
diffs, and a browser view without an install. `shapely` becomes useful only when the plan
needs true polygon buffering/boolean operations; the current rectangles and 32-unit route
samples do not. A DXF export can be added later as a second view of the same JSON, not as a
second source.

## Authoring order (do not draw them all at once)

The five sheets are dependency-ordered views, not five independent tasks:

1. **Brief** (`stage: "brief"`) — experience, three pillars, beats with intensity, acceptance,
   no geometry.
2. **Skeleton** (`stage: "skeleton"`) — districts (motif + landmark), the critical route as
   **nodes**: X/Y/Z, floor, building id, named space, kind (`street`, `door`, `room`, `stair`,
   `drop`, `finale`, …), enclosure, intensity, landmark, gate and beat. Decide the turns, the
   vertical beats, the side rooms, the Director curve and the reveal here; this is the route,
   not the site. The route through a large multi-storey interior belongs here too.
3. **Site** (`stage: "site"`) — footprints around the skeleton, entrances, no-build/water.
4. **Vertical** (`stage: "vertical"`) — terrain, base/roof Z, entrance Z, stairs/ladders/drops.
5. **Schedule** (`stage: "schedule"`) — role (`facade`/`enterable`/`safe-room`), floors, height.
6. **Floors** (`stage: "floors"`) — one floor plan per level; sections; route nodes in rooms.
7. **Flow** (`stage: "flow"`) — the detailed splines, branches, cover/spawn/holdout/crescendo/
   finale areas and item budget. The flow **decision** was already made in the skeleton; this
   stage draws it at real coordinates.
8. **Approved** — frozen JSON + all drawings.

A site plan drawn before the route is buildings looking for a reason; a route drawn after the
buildings is a corridor forced through them. The skeleton is where "interesting" is decided.
If a later stage needs an earlier layer changed, change the JSON, re-run the earlier stage
check, then regenerate the later drawings. Do not patch around it.

## Multi-level

A floor change is a **route node**, not a hidden Z value: `stair`, `ladder`, `elevator`, `ramp`
or `drop`, with `floor` and `buildingId`. The building has a `floorsPlan` entry per level, and
that floor's plan marks the stair and the route node. `check_map_plan`:

- fails a route node on an enterable building that has no floor plan for that level (from the
  `floors` stage);
- warns when a `stair`/`drop` node's neighbours stay on the same floor;
- warns when a critical route has no vertical node, fewer than three named spaces or fewer than
  two turns (a corridor), no peak/rest, no landmark/vista or no gate;
- fails when a route node names a district that does not exist, and when a branch has no
  critical-route anchor;
- renders `05-floor-<building>-f<level>.svg` for every level, not one plan with all rooms
  stacked.

Only `enterable` buildings get floor plans. A row of 30 houses is massing; the safe room, the
through-house and the set piece are interiors.

## Pass 1, exactly

1. Write the experience, pillars, beats and acceptance in `plan/DESIGN.md`; write the districts
   and the route skeleton in `plan.json` (`stage: "brief"`, then `"skeleton"`). Use
   [`route-skeleton.md`](route-skeleton.md) as the procedure.
2. `check_map_plan` at each stage; fix errors before the next. Do not leave a flat intensity
   curve, a missing landmark or an unanchored branch for the build pass to discover.
3. `render_map_plan` after site/vertical/schedule/floors/flow; look at every sheet and every
   per-floor plan, including the district boundaries and the rhythm strip.
4. Set `Status: approved` only after the user has seen the JSON and drawings.
5. Report the JSON, drawing directory and findings; stop. Pass 2 reads them.
