# Workflow: design a map or campaign (pass 1)

This is the **design pass**. It ends with one file — `workspaces/<addon-name>/plan/DESIGN.md` — and
**no `.vmf`**. The next pass builds from that file. The point of the split is that the creative
decisions are made once, in one place, while the build pass spends its attention on geometry,
assets and evidence.

**Stop at the end of this page.** Do not "just start a box" to see whether the idea works.
A box built before the design is a decision made by accident.

Create the workspace first if it does not exist:

```text
write_addon_workspace(name: "<addon-name>", title: "<title>", kind: "campaign")
```

It creates `workspaces/<addon-name>/` with the plan, templates, logs, src, addon, dist and
evidence folders. See [`addon-workspace.md`](addon-workspace.md).

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

1. Read it once as the builder: can you build chapter 1 without asking a creative question?
2. Check every asset name with `read_game_content`; check every class with `read_fgd_class`.
3. Set `Status: approved` only after the user has seen it (or explicitly delegated approval).
4. Report the path and stop. The next message is pass 2: `workflows/new-campaign.md`.

A design with a missing route, an empty beat sheet, unnamed assets or no acceptance list is a
draft, not a handoff. The build pass will refuse it.
