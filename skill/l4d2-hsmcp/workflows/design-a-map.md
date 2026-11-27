# Workflow: design a map or campaign (pass 1)

This is the **design pass**. It ends with one file — `workspaces/<addon-name>/plan/DESIGN.md` — and
**no `.vmf`**. The next pass builds from that file. The point of the split is that the creative
decisions are made once, in one place, while the build pass spends its attention on geometry,
assets and evidence.

**Stop at the end of this page.** Do not "just start a box" to see whether the idea works.
A box built before the design is a decision made by accident.

## Two passes, two tool sets

Keep the passes apart in your head and in your hands; mixing them is how a plan starts
describing geometry that does not exist yet.

|  | Pass 1 — plan | Pass 2 — build |
|---|---|---|
| Question | what is this level, and why? | where is every wall? |
| Input | a wish, photos, or an existing map | the approved `plan.json` |
| Output | `plan.json` + the drawings | `.vmf` → `.bsp` → `.nav` → `.vpk` |
| Tools | `plan_from_map`, `check_map_plan`, `render_map_plan` | `write_vmf_*`, `compile_*`, `nav_*`, `run_vpk_pack` |
| Must not | write, compile or open a `.vmf`/`.bsp` | edit `plan.json` |

If pass 2 discovers that the plan is wrong, stop and return to pass 1. Editing the plan from
inside the build is how two sources of truth appear. `plan_from_map` is the only tool that
starts from a map, and it produces a *survey* (`origin: "imported"`): useful to seed a plan or
to compare with a built one, never a substitute for the design.

Create the workspace first if it does not exist:

```text
write_addon_workspace(name: "<addon-name>", title: "<title>", kind: "campaign")
```

It creates the workspace described in [`addon-workspace.md`](addon-workspace.md): the plan,
templates, logs, source, addon, dist and evidence folders.

## The authoring order: flow skeleton first, sheets later

The five drawings are views of one JSON, not a sequence to fill in at once. The order below is
the dependency order; each stage freezes the layer above it.

| Stage | `stage` | The agent writes | Gate before the next stage |
|---|---|---|---|
| 0. Brief | `brief` | experience, three pillars, beats, acceptance; no geometry | experience, three pillars, ≥3 beats, acceptance |
| 1. Skeleton | `skeleton` | districts (motif + landmark), the critical route as **nodes** (X/Y/Z, floor, building, named space, kind, enclosure, intensity, landmark, gate, beat), branches, start/goal | every critical route has ≥3 nodes, ≥3 named spaces, ≥2 turns, ≥1 vertical node; ≥2 districts with landmarks; a peak and two rests; a gate; no branch without an anchor |
| 2. Site | `site` | **every visible building/structure** around the skeleton, including context/facade/landmark massing; entrances; no-build/water | route stays in the site, does not cross a building except at an entrance; at least three context buildings |
| 3. Vertical | `vertical` | terrain grid, base/roof Z, entrance Z, stairs/ladders/drops | every floor change is a node; entrance Z matches the terrain |
| 4. Schedule | `schedule` | roles (`facade`/`enterable`/`safe-room`), floors, heights, areas | every enterable building has an entrance on the route |
| 5. Floors | `floors` | per-floor rooms, **doors with two sides**, stairs/ladders with `kind` and target floor; sections; route nodes in rooms | every route door sits on a real door; every vertical node matches a connection; every stair target floor exists |
| 6. Flow | `flow` | splines, branches, cover/spawn/holdout/crescendo/finale areas, item budget, variability | route width, crossings, area proximity and beats pass |
| 7. Approved | `approved` | the frozen plan + five drawings | full `check_map_plan` pass, then approval |

Why the skeleton comes first: a site plan drawn before the route is a set of buildings looking
for a reason. A route designed after the buildings is a corridor forced through them. The
skeleton is the one place where "interesting" is decided: a turn, a floor, a side room, a
one-way drop, a holdout, a reveal. The site, terrain and floors then have to serve it.

### Flow is decided in the skeleton, drawn last

"Flow" means the route decision (skeleton) and the flow sheet (stage 6). The distinction, why
the sheet is last and the exact order are in
[`../references/planning/route-skeleton.md`](../references/planning/route-skeleton.md#flow-the-decision-is-first-the-drawing-is-last).
A building's interior route is still a skeleton node, not something postponed to the sheet.

Why not all at once: a footprint change after floor plans invalidates every room; a route
change after the schedule invalidates the entrances. The stages are a dependency chain, not a
checklist. If stage 4 needs a footprint moved, go back to stage 2, amend the JSON, re-run the
stage checks and re-render; do not patch the floors around a broken footprint.

**Multi-level rule.** A floor change is a route node (`stair`, `ladder`, `elevator`, `ramp`,
`drop`), not a Z value hidden in a spline. The field-level rule and the checks (floor plan per
level, the stair on it, the route node in a room) are in
[`../references/planning/five-drawings.md`](../references/planning/five-drawings.md).

**Facade rule.** Only `enterable` buildings get floor plans. A row of 30 houses is massing;
the safe room, the through-house and the set piece are interiors. The schedule records the
role; the build pass must not invent a floor plan for scenery.

**Anti-contradiction rules.**

1. One source: `plan.json`. The SVGs are rendered, never edited back.
2. Upstream freeze: an approved layer changes only by an amendment and a re-run of the later
   stages.
3. A route node carries the semantics (floor, building, kind); the polyline is only its spline.
4. Every enterable route floor has a plan; every plan has a stair/connection to the next
   floor on the route.
5. A stage check must pass before the next stage starts.
6. If two layers disagree, the earlier one wins and the later one is regenerated.
7. The checks are cumulative: `stage: "approved"` does not skip the brief or route gate. A
   warning found at `skeleton` is still a warning at `approved`; fix it in the JSON.

## The plan is a JSON source and five drawings

Do not write the design as prose first and derive the geometry later. Write
`plan/plan.json`, then render and check it:

```text
check_map_plan(path: "workspaces/<addon-name>/plan/plan.json")
render_map_plan(path: "workspaces/<addon-name>/plan/plan.json", confirm: true)
```

The five drawings are the site plan, vertical/terrain plan, circulation plan,
building/height schedule, and floor plans/sections. The schema and the exact checks are in
[`../references/planning/five-drawings.md`](../references/planning/five-drawings.md). The
JSON is the contract; the SVGs are its views. A plan that exists only as prose is not a
handoff.

## Rules for pass 1

- **Read-only tools only.** `health`, `read_game_content`, `read_asset_catalog`,
  `read_fgd_class`, `read_official_prefab`, `read_model_info`, `read_item_density` on an
  official peer, `read_nav_*` on an official map. No `write_*`, no `run_compile`, no VMF.
- **Every asset name is queried.** A material, model, particle or sound in the design comes
  from `read_game_content`/`read_asset_catalog`, not memory.
- **Every number is measured or marked as a target.** Player hull, door sizes, nav areas,
  item counts and compile budgets have sources; a first draft may say "target ~1,200 nav
  areas" and the build pass measures it.
- **The design must survive a handoff.** A builder who has never seen the user's message must
  be able to build the route, rooms and events from this file alone. If a sentence needs the
  chat to make sense, it is not in the design yet.
- **Ask only identity questions.** Chapter count, campaign vs single map, and mode are worth
  asking. Which crate sits in a corner is the design's job, not the user's.

## The file

Path: `workspaces/<addon-name>/plan/DESIGN.md` (local; `workspaces/` is never committed).
The machine-readable source is `plan/plan.json`; `plan/drawings/` holds the rendered five
drawings and `plan.md`.

```markdown
# <Campaign or map name> — design

Status: draft            <!-- draft | approved -->
Version: 1
Date: 2026-11-25
Built from: (nothing yet) <!-- pass 2 fills the commit or build id -->

## 1. Pitch and pillars

One paragraph: place, time, why the survivors are here, what the player should feel.
Three pillars, one line each. A pillar is a decision rule for the build pass, e.g.
"the sea is always visible on the left" or "every fight has a way around, never only through".

## 2. Campaign map

| # | Map | Working title | Time | Weather | Goal | Target length |
|---|---|---|---|---|---|---|
| 1 | `sm01_beach` | Beach | dusk | clear | CHECKPOINT | ~1,200 nav areas |

State the chapter count and whether it is a campaign or a single map. Name every map exactly
as the `.bsp` will be named.

## 3. Route, chapter by chapter

For each chapter, in order:

### Chapter N — <title>

- **Start:** where the survivors stand, what they see first, what the safe room behind them
  contains.
- **Route:** an ordered list of spaces, e.g. `spawn -> boardwalk -> pier shed -> under-pier
  -> market -> safe room`. This is the critical path; side rooms come after it.
- **End:** safe room + checkpoint door, or the finale arena + escape.
- **Pacing:** the quiet / fight / set-piece rhythm, and where the team can breathe.

The route is a promise to the build pass. Do not write "some streets"; write the order.

## 4. Beat sheet

| # | Chapter | Beat | Type | Space | What changes | Proof |
|---|---|---|---|---|---|---|
| 1 | 1 | first contact | fight | boardwalk | 8-12 commons | `STAGE_DONE`/spawn count + screenshot |

Types: `quiet`, `fight`, `crescendo`, `panic`, `tank`, `witch`, `one-way drop`, `dark room`,
`set piece`, `finale stage`. Every chapter needs at least one reason to exist; every requested
mechanic needs a row. "Proof" is the log line, entity probe or screenshot the build pass will
produce.

## 5. Spaces and rooms

| Space | Size L×W×H | Floors | Entrances | Exits | Cover | Light | Purpose | Palette / props | Nav notes |
|---|---|---|---|---|---|---|---|---|---|

- Sizes in Hammer units; use the measured player metrics
  (`references/mapping/level-design.md`).
- **Floors** is the vertical story: `1`, `1 + mezzanine`, `2`, `roof`. State where stairs,
  ladders, drops and one-way routes are.
- **Entrances/Exits** decide the Director's spawn options and the sightlines.
- **Palette/props** names the family and, when it matters, the exact model. The build pass may
  choose within the family; it may not invent a new theme.
- **Nav notes** say what must be walkable, blocked, CHECKPOINT/FINALE/Battlefield, and where a
  one-way drop or ladder needs special handling.

## 6. Verticality and one-way routes

Every floor change: stairs/ramp/ladder/drop, which direction it is one-way, and what stops the
player walking back. A balcony is a combat position only if it has cover and a way down.

## 7. Events and logic

| Event | Trigger | Entities | Outputs / inputs | Duration | Failure mode |
|---|---|---|---|---|---|

Examples: a `trigger_once` that fires `ForcePanicEvent`; a `logic_case` that picks one of
three car colours; a `point_template` + `env_entity_maker` gascan drop; a safe-room door that
enables the next chapter. Name the class from the FGD, not from memory. If an event needs a
script, name the file and the hook.

## 8. Finale

- Type (0 test / 1 gauntlet / 2 custom / 4 scavenge) and why.
- Arena shape, holdout, ammo/health placement, one-way entry.
- Stage list (`PANIC`, `TANK`, `DELAY`, `SCRIPTED`) or the gauntlet route.
- Escape: vehicle, trigger, `FinaleEscapeStarted`, `FinaleEscapeFinished`, outtro.
- Script name: `scripts/vscripts/<map>_finale.nut`.

## 9. Item and health budget

| Chapter | Weapon spawners | Random layer | Health | Throwables | Ammo | Special |
|---|---:|---:|---:|---:|---:|---|

Use the measured official range (`references/mechanics/weapons-and-items.md`) and the
chapter's nav-area ratio. State where the saferoom stock is forced and where the Director owns
the density. "Five spawners in a full chapter" is a defect, not a style.

## 10. Asset palette and motifs

- Sky and sun: the exact sky name and time of day.
- Three repeated motifs (material/model families) that make the place read as one place.
- Named materials, model families and any exact models that carry a beat.
- Particles, soundscapes and music by name.
- What is explicitly **not** used (a palette without exclusions drifts).

## 11. Variability

What changes per load and what must not: `logic_case`/`PickRandom` for a colour or a prop set;
`point_template`/`env_entity_maker` for a spawn set; which item spawners are random. State the
seed-independent rules (the route never changes) and the cosmetic ones.

## 12. Modes

Coop only, or which of versus/survival/scavenge. If more than coop: the `info_gamemode` switch,
the mode-specific entities, `info_map_parameters`, and what is deliberately absent. A mode
that is not designed is not tested.

## 13. Acceptance criteria

A numbered list the build pass can check with a tool or a log:

1. Every chapter sealed, lint 0, compile exit 0.
2. Nav fresh, `nav_trouble_report` pass, CHECKPOINT/FINALE on the right areas.
3. Item density within the design's budget.
4. Every beat has its proof line or screenshot.
5. Finale stages logged and the escape reaches the credits/next map.
6. No prop without an explicit `solid` where it should block.

## 14. Build order and deferred work

The order the build pass will use, and what is intentionally deferred (a second pass on
detail, a mode, a screenshot). The first compile checkpoint belongs here.

## 15. Amendments

Build-pass deviations only. Each row: date, what changed, why, and the design line it
replaces. An amendment is a decision; it is not a silent edit.

| Date | Change | Why | Replaces |
|---|---|---|---|

## 16. Assumptions and open questions

Anything the design assumes and has not measured, and what would settle it. The build pass
must not quietly resolve an open question by picking the easiest geometry.
```

## When the design is done

1. Run `check_map_plan` at `skeleton` first; fix every error before the site exists. Then run it
   at `approved`.
2. Run `render_map_plan`; look at all five drawings, every district boundary, the rhythm strip
   and every enterable floor/section.
3. Read it once as the builder: can you build chapter 1 without asking a creative question?
4. Check every asset name with `read_game_content`; check every class with `read_fgd_class`.
5. Set `Status: approved` only after the user has seen it (or explicitly delegated approval).
6. Report the JSON, the drawing directory, `build-sheet.md` and the findings, and stop. The next
   message is pass 2: `workflows/new-campaign.md`. Pass 2 reads `plan.json` and
   `build-sheet.md`; the SVGs are the visual check, not the data source.

A design with a missing route, a flat intensity curve, unnamed districts, an unanchored branch,
an empty beat sheet, unnamed assets or no acceptance list is a draft, not a handoff. The build
pass will refuse it.
