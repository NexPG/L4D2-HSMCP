# Official entity-class coverage

The skill describes entities one at a time. This page answers the other question: of the
classes the stock game actually uses, which have a tool **and** a page, which have only one,
and which are documented but not tooled.

## How the inventory is made

`read_entity_coverage` reads the entity lump of every `left4dead2*/maps/*.bsp` beside the
configured game and groups each classname by an ordered family rule. It is a read of compiled
maps, not a typed list.

```text
read_entity_coverage()                 # all official BSPs
read_entity_coverage(maps: ["my.bsp"]) # one map
```

Measured on a full install: **60 maps, 219 distinct classes, 0 unclassified.** The task
inventory says 223; the four-class difference is not rounded away, because a class no rule
matches is returned in `unclassified`. If a game update adds a class, that list is the
prompt, not a silent gap.

## Families

| Family | Status | Classes | Occurrences | Tools | Page |
|---|---|---:|---:|---|---|
| Weapons and item spawners | covered | 32 | 10,800 | `write_item_spawns`, `read_item_density`, `write_map_parameters` | `weapons-and-items.md` |
| Health cabinets and rescue stock | covered | 1 | 33 | `write_saferoom_stock`, `place_entity_group` | `weapons-and-items.md` |
| Breakable brushes and props | covered | 7 | 1,875 | `write_breakable`, `write_point_entity` | `coverage.md` |
| Ladders | covered | 1 | 3,038 | `read_nav_ladders`, `write_nav_ladders` | `ai-and-nav-content.md` |
| Doors, buttons and movement | partial | 18 | 1,505 | `place_door`, `write_safe_room`, `write_changelevel` | `campaign-wiring.md` |
| Brush and clip volumes | covered | 22 | 7,379 | `write_vmf_solid`, `clip_solids`, `check_ai_contract` | `ai-and-nav-content.md` |
| Props and physics | covered | 9 | 14,714 | `write_prop`, `read_static_props`, `read_model_info` | `../mapping/model-facing.md` |
| Lighting and decals | covered | 13 | 7,880 | `write_light`, `write_postprocess`, `read_vmf_lint` | `../mapping/world-dressing.md` |
| Atmosphere, weather and sound | partial | 37 | 5,447 | `write_weather`, `edit_vmf`, `write_postprocess`, `read_soundscape` | `../mapping/atmosphere.md` |
| Particles | covered | 2 | 2,614 | `read_particle`, `write_particle`, `write_point_entity` | `coverage.md` |
| Logic, math and filters | covered | 26 | 3,617 | `write_logic`, `write_random_case`, `write_template_spawner`, `validate_io` | `../mapping/variability.md` |
| Triggers | partial | 9 | 836 | `write_trigger`, `read_vmf_lint` | `crescendo-and-panic.md` |
| Campaign, nav and mode entities | covered | 19 | 2,161 | `write_spawn_points`, `write_rescue_closet`, `write_map_parameters`, `check_gamemode_contract`, `check_ai_contract` | `ai-and-nav-content.md` |
| Cameras and view control | documented | 4 | 171 | — | `../mapping/entity-families.md` |
| Ropes and physics constraints | documented | 8 | 4,689 | `write_prop` (the prop only) | `../mapping/entity-families.md` |
| Scripts, commands and overlays | partial | 10 | 502 | `write_vscript`, `read_vscript`, `check_vscript_contract` | `../scripting/vscript.md` |
| Use targets | covered | 1 | 19 | `place_entity_group`, `read_official_prefab` | `../mapping/prefabs-and-instances.md` |

Totals: 11 covered, 4 partial, 2 documented, 0 with no family. "Occurrences" is class
instances across all scanned maps, so `prop_physics` alone dominates the props row and
`weapon_item_spawn` the weapons row.

## What the statuses mean

- **covered** — a tool writes or checks the family, a page explains it, and the static half
  has a test. A live half (a played mode, a picked-up item, a heard line) can still be open;
  that is noted in the family's page, not hidden here.
- **partial** — a tool exists but a sub-family is read-only, or the page is a section rather
  than a full recipe. The note in the tool result names the gap.
- **documented** — the classes and keys are explained, but no dedicated writer/checker. Use
  generic VMF edits and read the result back.
- **none** — no family rule matched; the class is new or rare. Add a rule and a page rather
  than treating it as covered.

## Keeping it honest

The family rules live in `src/maps/typescript/tools/entitycoverage.ts` beside the tool, in one
ordered table. Adding a class is a one-line regex edit plus the family's evidence; the test
asserts that every class in the official inventory is assigned and that representative
classes land in the expected family. An unclassified class is a finding, not a rounding
error.
