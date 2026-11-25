# The route skeleton — pass 1, layer 1

The skeleton is the first layer the agent builds and the one that decides whether the chapter is
interesting. It is **not** a floor plan and not a `.vmf`. It is the mission graph and the space
graph at the same time:

- **what happens** — the beats, in order, with the Director's pressure;
- **where it happens** — named spaces, districts, buildings and floors;
- **how the player is pulled forward** — turns, thresholds, landmarks, gates and drops;
- **how the player gets up and down** — every floor change is a node.

Everything later (site, terrain, floors, detailed flow) serves this layer. A footprint drawn
before the route is a building looking for a reason. A route drawn after the buildings is a
corridor forced through them.

## Flow: the decision is first, the drawing is last

This is the part that is easy to get backwards. "Flow" means two different things:

1. **The flow decision** — where the route goes, what the player sees, when the pressure rises
   and falls, where the route turns, climbs, drops or branches. This is made in the **skeleton**.
2. **The flow drawing** — splines, exact cover, spawn/cover/holdout/crescendo/finale areas,
   item clusters, per-load variation. This is drawn **after** the geometry exists, because it
   needs real coordinates and real rooms.

So the correct order is:

```text
brief -> skeleton (flow decision) -> site -> vertical -> schedule -> floors
      -> flow sheet (flow detail) -> approved
```

A multi-storey building is not an exception. The route through its rooms and stairs is part of
the skeleton: the nodes carry `buildingId`, `floor`, `space` and a vertical `kind`. The floor
plans later have to contain those nodes, not invent a different route. The detailed flow sheet
is last because it decorates a route that already exists.

## What the research says, and what we take

The rule is: take a practice only if it becomes a **field or a check**. Otherwise it is
decoration that the next agent will ignore.

| Proven practice | Source | What we take | Where it lives |
|---|---|---|---|
| Mental maps are built from **paths, edges, districts, nodes and landmarks** | Kevin Lynch, *The Image of the City* (1960); Level Design Book, *Wayfinding* | The chapter is split into 2–5 districts; each has a motif and a landmark; every route node names its district | `districts[]`, `node.district`, `node.landmark` |
| **Mission graph first, space graph second** | Joris Dormans, *Adventures in level design* (PCG 2010); Smith et al., graph-based dungeon generation (PCG 2018) | Beats are authored first and mapped to route nodes; a node that serves no beat is decoration | `beats[]`, `node.beat` |
| **Parti → bubble diagram → floor plan**, not detail first | Level Design Book, *Layout*; Francis Ching, *Architectural Graphics* | One named parti and 3–5 district bubbles before coordinates; the skeleton is the bubble diagram with numbers | `experience`, `pillars`, `districts`, `route.typology` |
| **Critical path plus optional branches** | Level Design Book, *Critical path*, *Circulation* | One critical route; branches leave and rejoin it, or dead-end with a reward; a required branch is a second critical path | `route.kind`, `route.from`, `route.to` |
| **Circulation hierarchy**: primary is wider and clearer than secondary | Architecture; Level Design Book, *Circulation* | Critical route ≥96 u (64 is the hull, not a design width); branches may be narrower; every gate is explicit | `route.width`, `node.gate` |
| **Floor planes**, max three per space | Level Design Book, *Verticality* | Every floor change is a node; a space with more than three floor planes is a warning | `node.floor`, `node.kind`, `node.space` |
| **One-way drops and gates** | Level Design Book, *Gates*; L4D2 | A drop must go down and must not be climbable back; gates are hard, soft, one-way or lock-and-key | `node.kind: "drop"`, `node.gate` |
| **Typologies** (corridor, switchback, loop, hub, arena, pass-through, string of pearls) | Level Design Book, *Typology* | Every route declares its pattern; a long chapter that is only a corridor is a warning | `route.typology` |
| **Landmarks, vistas, sightlines, composition hierarchy** | Lynch; Level Design Book, *Composition*; Disneyland "weenies" (Scott Rogers, GDC 2009) | A landmark or vista at least every four nodes; at least one vista; landmarks are useful, not skybox decoration | `node.landmark`, `node.enclosure: "vista"` |
| **Pacing is a curve of peaks and rests** | Level Design Book, *Pacing*; L4D2 AI Director | Node intensity 0–5; at least one peak and two rests; no three high nodes in a row; the curve is rendered | `node.intensity`, `beats[].intensity` |
| **Metrics, not magic** | Level Design Book, *Metrics*; Source dimensions | 64 u hull, 96 u comfortable route, 56×112 door, 8×12 step, 256 u safe drop; numbers are targets until playtested | route width, space table, later `spaces` |
| **Prospect/refuge is weak theory; sightline/cover is useful** | Level Design Book, *Prospect-refuge* | Do not encode "refuge"; encode `open`/`covered`/`tight`/`vista` and the gameplay areas | `node.enclosure`, `areas[]` |
| **Disneyland's branches are inconsequential; the path always returns** | Level Design Book, *Disneyland* | A branch is optional and returns to the critical path, or is a dead end with a reward; it never becomes the only way forward | `route.from`, `route.to` |

What we deliberately do **not** take:

- **Exact real-world dimensions.** A video game is not a building; Source scale is exaggerated
  and internally consistent. Use the measured Source metrics, then playtest.
- **Prospect-refuge as psychology.** Use sightline, cover, enclosure and vista.
- **Leading lines / shot composition as a navigation theory.** Players navigate by landmarks,
  light, contrast and prior patterns, not by lines drawn on a screenshot.
- **ML floor-plan generation.** A hand-authored chapter needs a controlled graph, not a model.
- **Full graph grammars.** Useful for hundreds of dungeons; not for one campaign chapter.

## The model

Three graphs, one JSON, five views:

1. **Mission graph** — beats and their intensity: start, quiet, fight, crescendo, tank/witch,
   one-way drop, safe room, finale, escape. Authored at `stage: "brief"`.
2. **Space graph** — route nodes with X/Y/Z, `floor`, `buildingId`, `space`, `district`, `kind`,
   `enclosure`, `intensity`, `landmark`, `gate`. Authored at `stage: "skeleton"`. Edges are the
   node order plus branch anchors (`from`/`to`).
3. **Floor graph** — per enterable building, rooms, doors, stairs, route nodes on each level.
   Authored at `stage: "floors"`.

The five drawings are views of the same JSON. The skeleton is the layer that makes the later
drawings possible; it is not a separate sketch that gets thrown away.

## Authoring procedure

### 1. Write the promise (brief)

One sentence of experience, three pillars, three beats minimum, acceptance evidence. A pillar
is a decision rule, not an adjective:

- good: "the sea is always visible on the left";
- good: "every fight has a way around, never only through";
- bad: "atmospheric and tense".

`stage: "brief"` passes when the experience, three pillars, three beats and acceptance exist.
The beats carry an intensity 0–5, so the Director curve is planned before geometry.

### 2. Draw 3–5 partis, pick one

Thirty seconds each: the overall shape of the chapter. Name it ("the pier that turns inland",
"the courtyard that climbs"). Write the chosen parti and the rejected ones in `DESIGN.md`. The
JSON records the result as `route.typology`; the sketches stay in the workspace.

### 3. Draw the district bubbles

2–5 districts, each with:

- a **motif** — the material/model family that repeats there;
- a **mood** — what the player should feel;
- a **landmark** — the thing a player can point at and say "that is the market".

Districts are not buildings. A district can contain several buildings and a street; a building
can contain two districts (a shop below, apartments above). What matters is that the player can
tell one chunk from the next.

### 4. Lay the critical route as nodes

Start at the safe room / player start and finish at the safe room, checkpoint or finale. Add
nodes in order. Every node carries:

- `space` — the named space ("boardwalk", "pier shed", "upstairs hall"); consecutive nodes in
  one space share it;
- `district`;
- `floor` and, when inside, `buildingId`;
- `kind` — `start`, `street`, `door`, `room`, `stair`, `ladder`, `elevator`, `ramp`, `drop`,
  `roof`, `checkpoint`, `finale`, `escape`;
- `enclosure` — `open`, `covered`, `tight`, `vista`;
- `intensity` — 0 (rest) to 5 (crescendo/finale);
- `landmark` — what the player sees from here, or empty;
- `gate` — `none`, `hard`, `soft`, `one-way`, `lock`;
- `beat` — the beat id this node serves.

Do not add a node for every 128 units. A node is a **decision**, a **threshold**, a **floor
change**, a **landmark** or a **beat**. A straight walk with nothing to decide is one node.

### 5. Add the vertical nodes

Every floor change is a node: `stair`, `ladder`, `elevator`, `ramp` or `drop`. A drop must lower
`z` and must not be climbable back. A stair/ladder/ramp/elevator must have neighbours on
different floors. A building with three enterable levels needs at least two vertical nodes on
the route, and a floor plan per level.

If a space has more than three floor planes, split it or cut a level. Three is the readable
maximum for a combat space; a fourth plane adds a middle layer without a new decision.

### 6. Add 1–2 branches

A branch is optional. It either:

- leaves the critical route at `from` and rejoins at `to` (a loop or shortcut), or
- leaves at `from` and dead-ends with a reward (ammo, health, a story room).

It never becomes the only way forward. If it does, it is a second critical route; label it
`kind: "critical"` and give it its own start and goal.

### 7. Check the rhythm

Read the nodes in order and say the route aloud. Then check:

- at least three distinct spaces and two turns;
- at least one vertical node;
- at least one peak (intensity ≥4) and two rests (≤2);
- no three high nodes in a row;
- no four consecutive nodes with the same enclosure;
- a landmark or vista at least every four nodes;
- at least one gate;
- a drop goes down;
- a long chapter is not `typology: "corridor"`.

### 8. Run the gate

```text
check_map_plan(path: "workspaces/<addon-name>/plan/plan.json")
```

Fix every error. Warnings are design prompts, not noise: a flat intensity curve, a missing
landmark, a corridor typology and a branch with no anchor are exactly the defects that make a
chapter feel like a hallway.

### 9. Freeze and move to site

Only after the skeleton passes. The site stage places footprints around the route; it may move a
building, but it may not move the route. If the site needs a route change, go back to the
skeleton, amend the JSON, re-run the gate, then regenerate the site.

## Fields

### Plan

| Field | Type | Meaning |
|---|---|---|
| `experience` | string | One sentence: what the player should feel or do. |
| `pillars` | string[] | Three decision rules for the build pass. |
| `districts` | object[] | `id`, `name`, `mood`, `motif`, `landmark`. |
| `beats` | object[] | `id`, `chapter`, `type`, `space`, `what`, `proof`, `intensity`. |
| `routes` | object[] | See below. |

### Route

| Field | Type | Meaning |
|---|---|---|
| `kind` | `critical` \| `branch` \| `escape` | The critical path, an optional branch, or the escape. |
| `typology` | enum | `corridor`, `switchback`, `loop`, `hub`, `arena`, `pass-through`, `gauntlet`, `string-of-pearls`. |
| `width` | number | Clear width in Hammer units; 64 is the hull, 96 is comfortable. |
| `points` | [x,y,z][] | The spline; the nodes are the semantics. |
| `from`, `to` | string? | Branch anchors: node ids on the critical route. Omit `to` for a dead end. |
| `nodes` | object[] | Ordered decisions, thresholds and floor changes. |
| `stops` | object[] | Start, checkpoint, safe-room, crescendo, tank, witch, finale, escape, branch. |

### Node

| Field | Type | Meaning |
|---|---|---|
| `id`, `label` | string | Stable id and a human label. |
| `x`, `y`, `z` | number | Position in Hammer units. |
| `floor` | integer ≥1 | The floor plane. |
| `buildingId` | string? | The building, when inside. |
| `space` | string | The named space; consecutive nodes share it. |
| `district` | string? | The district id. |
| `kind` | enum | `start`, `street`, `door`, `room`, `stair`, `ladder`, `elevator`, `ramp`, `drop`, `roof`, `checkpoint`, `finale`, `escape`. |
| `enclosure` | enum | `open`, `covered`, `tight`, `vista`. |
| `intensity` | 0–5 | Director pressure. |
| `landmark` | string | What the player sees from here, or empty. |
| `gate` | enum | `none`, `hard`, `soft`, `one-way`, `lock`. |
| `beat` | string? | The beat id this node serves. |

## The checks

At `stage: "skeleton"`:

| Rule | Severity | Why |
|---|---|---|
| `brief-no-experience`, `brief-few-pillars` | error | The brief is the decision rule; without it the route has no thesis. |
| `brief-few-beats`, `brief-flat-pacing` | error / warning | Fewer than three beats is a corridor; no peak/rest is a flat chapter. |
| `skeleton-no-route`, `skeleton-route-too-short` | error | There is no route, or no decision in it. |
| `route-too-narrow` | error | The route is narrower than the 64 u hull. |
| `district-few` | error | A chapter needs at least two distinguishable districts. |
| `district-no-landmark`, `district-no-motif` | error | A district without a landmark or a motif is not a district. |
| `district-unknown`, `district-unused` | error / warning | A node names a district that does not exist, or a district nobody visits. |
| `node-no-space`, `node-no-district` | error | The skeleton must name the space and the district. |
| `node-unknown-beat` | error | A node points at a beat that does not exist. |
| `beat-not-on-route` | warning | A beat has no node; the mission graph and the space graph disagree. |
| `route-few-spaces` | warning | Fewer than three named spaces reads as one corridor. |
| `route-narrow-critical` | warning | The critical route is narrower than 96 u; 64 is the hull, not a design width. |
| `route-straight` | warning | Fewer than two turns. |
| `route-no-verticality` | warning | A multi-level map with no floor change. |
| `route-flat-intensity` | warning | Every node is the same pressure. |
| `route-no-peak`, `route-no-rest` | warning | No crescendo, or no breathing room. |
| `route-high-run` | warning | Three high nodes in a row exhausts the Director and the team. |
| `route-monotone-enclosure` | warning | Four identical enclosures in a row. |
| `route-no-vista`, `route-no-landmark`, `route-landmark-gap` | warning | No long view, no landmark at all, or more than four nodes without one. |
| `route-no-gate` | warning | Nothing gates the player; the chapter has no shape. |
| `route-corridor` | warning | More than six nodes and the typology is still `corridor`. |
| `route-drop-up` | warning | A drop that does not go down. |
| `route-too-many-floor-planes` | warning | More than three floor planes in one space. |
| `branch-no-anchor`, `branch-unknown-anchor` | error | A branch that does not attach to the critical route. |
| `node-off-spline` | warning | The node is more than 160 u from the drawn route. |

At later stages the same fields are still checked for references, branch anchors, drop
direction and floor planes. The skeleton-only quality checks do not repeat, because the route
is frozen and the later stages must not silently re-litigate it.

## Numbers

These are starting targets, not laws. Playtest decides.

| Thing | Value | Source |
|---|---|---|
| Player hull | 32×32×72 | Source |
| Minimum route width | 64 u | Source hull |
| Comfortable critical width | 96 u | Level Design Book, *Metrics* |
| Door | 56×112 u | Source |
| Step | 8×12 u | Source |
| Safe drop without fall damage | 256 u | TF2/Source community metrics |
| Floor height | 128 u (96 minimum) | Source / L4D2 |
| Floor planes per space | 3 maximum | Level Design Book, *Verticality* |
| Chapter route length | 6,000–14,000 u | L4D2 official maps, approximate |
| Critical nodes | 5–9 typical | One node per decision, not per 128 u |
| Districts | 2–5 | Lynch; one landmark each |

## A worked skeleton

This is the shape, not a full chapter. It shows the fields and the rhythm.

```json
{
  "stage": "skeleton",
  "experience": "The survivors leave the beach, cross the pier and climb into the market before the horde cuts the boardwalk.",
  "pillars": [
    "the sea is always visible on the left",
    "every fight has a way around, never only through",
    "the route always climbs before it drops"
  ],
  "districts": [
    { "id": "beach", "name": "Beach", "mood": "exposed", "motif": "sand and bleached wood", "landmark": "the lifeguard tower" },
    { "id": "pier", "name": "Pier", "mood": "tight and creaking", "motif": "tarred timber and rope", "landmark": "the ferris wheel" },
    { "id": "market", "name": "Market", "mood": "crowded", "motif": "stucco and canvas", "landmark": "the clock tower" }
  ],
  "beats": [
    { "id": "b1", "chapter": 1, "type": "quiet", "space": "beach", "what": "the sea and the tower", "proof": "screenshot", "intensity": 1 },
    { "id": "b2", "chapter": 1, "type": "fight", "space": "boardwalk", "what": "first commons", "proof": "spawn count", "intensity": 3 },
    { "id": "b3", "chapter": 1, "type": "crescendo", "space": "pier shed", "what": "hold the door", "proof": "STAGE_DONE", "intensity": 5 },
    { "id": "b4", "chapter": 1, "type": "quiet", "space": "market", "what": "breathe and restock", "proof": "screenshot", "intensity": 2 }
  ],
  "routes": [
    {
      "id": "critical",
      "kind": "critical",
      "typology": "string-of-pearls",
      "width": 96,
      "points": [[200, 300, 0], [900, 300, 0], [900, 900, 0], [1400, 900, 0], [1400, 1400, 0]],
      "from": null,
      "to": null,
      "nodes": [
        { "id": "n_start", "label": "start", "x": 200, "y": 300, "z": 0, "floor": 1, "space": "beach", "district": "beach", "kind": "start", "enclosure": "open", "intensity": 1, "landmark": "lifeguard tower", "gate": "none", "beat": "b1" },
        { "id": "n_boardwalk", "label": "boardwalk", "x": 900, "y": 300, "z": 0, "floor": 1, "space": "boardwalk", "district": "beach", "kind": "street", "enclosure": "open", "intensity": 3, "landmark": "ferris wheel", "gate": "none", "beat": "b2" },
        { "id": "n_pier_door", "label": "pier door", "x": 900, "y": 900, "z": 0, "floor": 1, "space": "pier shed", "district": "pier", "kind": "door", "enclosure": "covered", "intensity": 3, "landmark": "", "gate": "hard", "beat": "b3" },
        { "id": "n_shed", "label": "shed hold", "x": 900, "y": 900, "z": 0, "floor": 1, "space": "pier shed", "district": "pier", "kind": "room", "enclosure": "tight", "intensity": 5, "landmark": "", "gate": "none", "beat": "b3" },
        { "id": "n_stair", "label": "stair up", "x": 900, "y": 900, "z": 0, "floor": 1, "space": "pier shed", "district": "pier", "kind": "stair", "enclosure": "tight", "intensity": 4, "landmark": "", "gate": "none", "beat": "b3" },
        { "id": "n_roof", "label": "shed roof", "x": 900, "y": 900, "z": 128, "floor": 2, "space": "pier shed", "district": "pier", "kind": "roof", "enclosure": "vista", "intensity": 2, "landmark": "clock tower", "gate": "none", "beat": "b4" },
        { "id": "n_drop", "label": "drop to market", "x": 1400, "y": 900, "z": 128, "floor": 2, "space": "market roof", "district": "market", "kind": "drop", "enclosure": "vista", "intensity": 2, "landmark": "clock tower", "gate": "one-way", "beat": "b4" },
        { "id": "n_market", "label": "market", "x": 1400, "y": 1400, "z": 0, "floor": 1, "space": "market", "district": "market", "kind": "room", "enclosure": "covered", "intensity": 2, "landmark": "", "gate": "none", "beat": "b4" }
      ]
    }
  ]
}
```

The rhythm is `1, 3, 3, 5, 4, 2, 2, 2`: a peak at the shed, a rest on the roof, a vista, a
one-way drop, a rest in the market. There are two districts with landmarks, a gate at the pier
door, a vertical node, a drop that goes down, and no three high nodes in a row.

## What "good" reads like

- You can say the route as a list of spaces, not coordinates: `beach -> boardwalk -> pier shed
  -> shed roof -> market roof -> market`.
- Every turn has a reason: a landmark, a gate, a fight, a floor change or a rest.
- Every floor change is a node, and the floor plans later contain those nodes.
- The player can see the next landmark before they have to choose a direction.
- There is a rest after every peak, and a branch that is worth taking but not required.
- The chapter has a thesis (the pillars) and a shape (the typology), not just a list of rooms.

## What comes next

The skeleton is frozen when `check_map_plan` passes. The site stage then places footprints
around it; the vertical stage sets terrain and base/roof Z; the schedule assigns roles and
floors; the floors stage draws one plan per level and puts the route nodes in rooms, with doors
that name both sides and stairs that name their target floor; the flow sheet adds cover, spawns,
holdouts, crescendos, the finale and the item budget. `render_map_plan` also writes
`build-sheet.md`, the ordered handoff pass 2 reads with the JSON. If a later stage needs a route
change, it goes back to the skeleton, amends the JSON, re-runs the gate and regenerates the later
drawings. The earlier layer wins.
