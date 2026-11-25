# Planning research: mission graph, space graph, floor-plan graph

The five sheets are not the only way to think about pass 1. The useful published approaches
split a level into **what happens** and **where it happens**, then connect the two. This page
records what was checked and what this project adopts.

## What the research says

| Source | Idea worth taking |
|---|---|
| Joris Dormans, *Adventures in level design* (PCG 2010) | Missions and spaces are **two separate structures**, generated in two steps; a mission graph first, then a space graph. |
| Smith et al., *Graph-based generation of action-adventure dungeon levels* (PCG 2018) | The mission graph is a graph of beats, locks and keys; the space graph is expanded from it. |
| *The Level Design Book* — Flow, Pacing | Flow is designed **during initial layout**, not after the geometry; pacing is a graph of beats against a player metric. Valve sorted L4D beats into four categories. |
| Graph2Plan (2020) and later floor-plan work | A floor plan can be represented as a **layout graph**: rooms are nodes, doors/adjacency are edges; a boundary constrains the geometry. |
| Kevin Lynch, *The Image of the City* (1960) | People build mental maps from **paths, edges, districts, nodes and landmarks**. A legible place has a hierarchy of landmarks and distinguishable districts. |
| *The Level Design Book* — Layout, Circulation, Verticality, Wayfinding, Composition, Typology | Parti → bubble diagram → floor plan; primary vs secondary circulation; three floor planes per space; landmarks, vistas and sightlines; typologies such as corridor, loop, hub, arena and string of pearls. |
| Christopher Alexander, *A Pattern Language* (1977) | A pattern language of entrances, transitions, paths and centres; the value is the named pattern plus the context, not a universal rule. |
| Disneyland studies (Scott Rogers, GDC 2009; Level Design Book) | Weenies (landmarks) pull visitors; branches are inconsequential and return to the main path; pacing is a sequence of clear beats. |
| Space syntax / isovist analysis (Hillier; Batty; Turner) | Visibility and connectivity can be measured: isovist area/perimeter, integration, choice. Useful as a route-interest score, not as a replacement for play. |
| World of Level Design, L4D2 61-point guide | Side rooms, panic/crescendo, safe rooms, finale preparation, multiple paths, infected spawns, landmarks and light guidance. |
| VDC *Checkpoints* / *Nav Flow* | The campaign flow is `PLAYER_START → CHECKPOINT → … → FINALE`; the Director builds flow backwards from the goal. |

## The model this project adopts

Three graphs, one JSON, five views:

1. **Mission graph** — beats and gates: start, checkpoint, crescendo, tank, witch, safe room,
   finale, escape. It is authored first (`stage: "skeleton"`), in words and node kinds.
2. **Space graph** — route nodes with X/Y/Z, floor, building id and kind; edges are the order.
   The route skeleton is this graph; the polyline is only its spline.
3. **Floor-plan graph** — per enterable building, rooms are nodes and doors/stairs are edges.
   A route node `door`/`room`/`stair` refers to the same graph; a stair edge carries `to` floor.

The five drawings are **views of the same JSON** at different stages. The authoring order is
brief → mission/space skeleton → site → vertical → schedule → floor graphs → flow detail →
approved. The detailed flow sheet is last because it needs the space to exist; the flow
**decision** is first because otherwise the space has no reason.

## What is adopted now

- `stage` gates and route `nodes` (floor, building, named space, district, kind) — mission/space
  graph, including the route through a multi-storey interior.
- `districts[]` with a motif and a landmark; `experience` and three `pillars` — the one-sentence
  thesis and the decision rules.
- Node `enclosure`, `intensity`, `landmark`, `gate`, `beat`; branch anchors `from`/`to` — the
  Lynch / Level Design Book / Director layer.
- The skeleton quality gate: three named spaces, two turns, a vertical node, two districts, a
  peak and two rests, no three high nodes in a row, a vista, a landmark every four nodes, a
  gate, a drop that goes down, and no unanchored branch.
- Per-floor `05-floor-<id>-f<level>.svg` — one view per floor, not all floors stacked.
- `areas[]` for spawn/cover/holdout/crescendo/finale — the gameplay overlay.

The full practice → field → check mapping and the authoring procedure are in
[`route-skeleton.md`](route-skeleton.md). This page records the research; that page is the
playbook the agent follows.

## What is deliberately not adopted

- **ML floor-plan generation (Graph2Plan).** It needs a trained model and a dataset; the agent
  can author a small room graph directly. Revisit if a plan has dozens of enterable interiors.
- **Full graph grammars.** A grammar is useful for generating hundreds of dungeons; a
  hand-authored campaign chapter needs a controlled mission graph, not a generator.
- **3D isovist computation.** It is a good route-interest metric, but a 3D visibility solve is
  a separate renderer. Start with path length, turns, vertical transitions and space count;
  add isovist/visibility later if a route still reads flat.

## The next implementation step

Add `doors`/`connections` to the floor-plan graph (a door has two sides, a stair has `from` and
`to`), so a room adjacency check can prove that a route node `door` sits on a real door and that
every stair is reachable from both floors. That is the missing edge in the multi-level model;
the route/stage layer and its quality gate are already in place.
