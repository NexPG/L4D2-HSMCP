# Workflow: one workspace per addon

Every new addon or campaign gets **one directory named after it**:

```
workspaces/<addon-name>/
```

The name is a lowercase slug (`santa-monica`, `hud-rework`, `swamp-town`). It is created before
the design is written; it is the agent's whole desk for that addon, and every artefact has
one folder. `workspaces/` is local and ignored, like `campaigns/`.

Create it with the tool, not by hand:

```text
write_addon_workspace(name: "santa-monica", title: "Santa Monica", kind: "campaign")
```

`kind` is `campaign`, `map`, `mutation`, `hud`, `model`, `vscript` or `other`. The tool refuses
to populate a non-empty directory unless `overwrite: true`, and it writes no map and no game
file. The author is `args.author`, then the stored `addonAuthor`, then `(ask the user)`.

**A map plan is conditional.** `kind: "campaign"` and `kind: "map"` get `plan/DESIGN.md`,
`plan/ASSETS.md`, `plan/plan.example.json` and the five-drawing workflow. Every other kind gets
a single root `DESIGN.md` with what it changes, its settings, conflicts and compatibility; no
`plan/`, no `plan.example.json` and no map drawings. A pure `vscript` add-on also gets
`addonContent_Script 1` in the template rather than the campaign flag.

## Layout

| Folder | What belongs here | Created as |
|---|---|---|
| `plan/` | **campaign/map only:** `plan.json` (the five-drawing source), `DESIGN.md` (pass 1 prose), `ASSETS.md`, `drawings/` | `DESIGN.md`, `ASSETS.md` |
| `templates/` | `addoninfo.txt`, `mission.txt` (campaign/map), `README.md`; copy, do not edit in place | templates |
| `reference/` | read-only upstream baseline: the unmodified download/extract, its URL, date, author and licence; never build from it in place | `README.md` |
| `logs/` | `errors.md` (symptom → cause → fix), `gate.json` (last `run_campaign_gate`), build logs | `errors.md`, `README.md` |
| `src/` | source `.vmf`, `.qc`, `.nut`, `.txt`; the files that are compiled | `README.md` |
| `addon/` | staging tree: `addoninfo.txt`, `missions/`, `maps/`, `materials/`, `models/`, `scripts/` | `README.md` |
| `dist/` | the packed `.vpk` | `README.md` |
| `evidence/` | screenshots, nav dumps, console logs, gate output | `README.md` |
| `DESIGN.md` | **non-map kinds only:** the short design note; no map plan | `DESIGN.md` |

The root `README.md` records the addon's name, kind, status, author and date.

## What goes in the log

- `logs/errors.md` is not a chat transcript. One row per failure: date, the exact symptom
  (console line or tool message), the cause, the fix, and the test that now prevents it.
- `logs/gate.json` is the last full gate result. When an attempt is kept, rename it
  `gate-<date>.json`; the newest is the one the next pass reads.
- A build log or console tail goes in `logs/` or `evidence/`, not in the plan.
- The log is for **skill, MCP, tool and pipeline defects**. Content facts — source photos,
  pose, resolution, nudity, missing reference views — belong in `plan/DESIGN.md` or its
  assumptions, not in `errors.md`.

## The passes

1. **Pass 1 — design.** Create the workspace, write `plan/plan.json`, run `check_map_plan`
   and `render_map_plan`, fill `plan/DESIGN.md` from `workflows/design-a-map.md`, record every
   asset query in `plan/ASSETS.md`, set `Status: draft`, report the path and stop for approval.
   **No `.vmf`.**
2. **Pass 2 - build.** Read `plan/plan.json` and `plan/drawings/build-sheet.md`; open the
   SVGs for the visual check. Copy `templates/addoninfo.txt` and `templates/mission.txt` into
   `addon/`, build into `src/`, stage into `addon/`, compile, nav, gate, pack into `dist/`.
   The plan's JSON and build sheet are fixed; `## 15. Amendments` is the only place a route/beat
   change is allowed.

For `hud`, `model`, `vscript`, `mutation` or `other`, pass 1 is the root `DESIGN.md` note; there
is no `plan.json`, no drawings and no map check. Go from the note to the build.

## Rules

- **One addon, one workspace.** Do not put a second campaign in another's folder.
- **The directory is the addon name.** A mission `Name` is alphanumeric and the VPK base name
  is the mission base name; the workspace slug may use hyphens, so record the mapping in the
  README (`santa-monica` → mission `SantaMonica`, VPK `santa_monica.vpk`).
- **Templates are read-only.** Copy them into `addon/` and replace the placeholders there; the
  next addon reuses the template.
- **Evidence beats memory.** A claim in the report points to a file in `logs/` or `evidence/`.
- **Nothing in `workspaces/` is committed.** The tool, the skill and the convention are; the
  addon's source and history stay local.
