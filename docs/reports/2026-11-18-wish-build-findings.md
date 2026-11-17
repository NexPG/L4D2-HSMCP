# Wish-to-campaign test — findings

**Date:** 2026-11-18
**Brief:** two chapters. Chapter 1: night forest, moonlight only, a swamp in the middle,
a basement descent, transition. Chapter 2: the same safe room, Moscow metro, escalator to
VDNKh, walk through the park, escape in a BTR. No zombies on either map. Stock L4D2 content
only.
**Campaign:** `campaigns/002-night-moscow/` (local; gitignored).

## What was built

- Two maps, `night_moscow_m1` (forest/basement) and `night_moscow_m2` (metro/VDNKh).
- Both sealed, lint-clean except listed warnings, compiled with Tools++ (`vbsp/vvis/vrad`
  exit 0), nav generated, mission checked, VPK packed and deployed.
- Chapter transition tested with the self-test warp: the engine loaded
  `night_moscow_m2` and logged `HSMCP_DIRECTOR_STOPPED`.
- Map 2 loads without the "Map is unplayable" panel after the nav fixes.
- Chapter 1 still loads into the "NAV ERRORS / Map is unplayable" state. It is **not done**.
- The maps call `director_stop` at spawn; the console marker is present and no zombie was
  seen in the runs. Chapter 1 still carries two `info_zombie_spawn` anchors for the
  Director/nav; they are inert while stopped.

## Findings, conditions and fixes

### P0 — nav/BSP pair mismatch

**When:** after `run_nav_generate`, when a build copies its own pre-generation `.bsp` next
to the returned `.nav`.
**Symptom:** `read_nav` says `stale`; the game shows "NAV ERRORS / Map is unplayable" even
though map and nav exist. The engine's nav `savedBspSize` is the size of the BSP **after**
it rewrote the stringtable, not the file passed in.
**Root cause:** the tool returned only the nav; the build paired it with the old BSP.
**Fixed in code:** `run_nav_generate` now returns `bsp`, and the build stages that exact
pair. The nav docs state the rule. The local build also patches the nav header's
`savedBspSize` when a build tool has already broken the pair.
**Prevention:** a campaign build must assert `read_nav(...).verdict === "fresh"` before
packing; this is now in the generated findings, not yet an automated acceptance test.

### P0 — chapter 1 is still unplayable

**When:** loading `night_moscow_m1` standalone or from the campaign.
**Symptom:** "NAV ERRORS / Map is unplayable"; the camera starts in the cabin/ground and
the HUD is blocked. `read_nav` says fresh and `read_nav_dump` says playable, but
`nav_trouble_report` reports ~99 orphan areas.
**Likely root cause:** the start checkpoint, the forest, the swamp bridge and the basement
exit are not one nav island. The start area is enclosed in a cabin; the route crosses water
and then a ramp to a below-ground checkpoint. One of those links is not generating or not
connecting.
**Tried and not sufficient:** an enclosed cabin, a wide doorway, removing the south wall, a
boardwalk across the swamp, `navSlopeLimit: 0.5`, moving the BSP/nav pair.
**Next fix:** use `nav_trouble_report` and flow numbers (`z_show_flow_distance 1`,
`z_debug 1`) from the **end checkpoint backwards**; find the first area at `-9999/-9999`.
Then either flatten the basement entrance to a nav-friendly landing or make the ramp
shorter/wider with flat landings. Do not declare the chapter done until the flow is `X/X`
and the game has no NAV panel.

### P0 — below-ground checkpoint and `Checkpoint::GetSpawnPosition: Selected NULL area`

**When:** the safe room/player start is below the main floor and the checkpoint area is
small or isolated; also when a finale map is launched standalone.
**Symptom:** repeated `Checkpoint::GetSpawnPosition: Selected NULL area`, then "Map is
unplayable".
**Root cause:** nav flow is generated backwards from the end checkpoint; if the start
checkpoint cannot be identified/reached, the Director has no spawn. A large `info_changelevel`
brush at player height, too few checkpoint nav areas, or a broken ramp all contribute.
**Tried:** 4 `info_survivor_position` entities, `PLAYER_START` + `CHECKPOINT` on the start
region, moving `info_changelevel` above the player.
**Next fix:** keep a flat, generous checkpoint floor; put `info_changelevel` above head
height; ensure 4 survivor positions; confirm flow from the end checkpoint back to start;
run `nav_trouble_report` and recompute flow after every geometry change.

### P1 — water is not nav

**When:** a swamp/pond is crossed by the only route.
**Symptom:** the nav mesh stops at the water; the area beyond becomes orphan.
**Fix applied:** a solid boardwalk across the swamp. It must be wide enough for the 32×32
survivor hull and connect to nav on both banks. Still not sufficient alone for chapter 1.

### P1 — steep stairs and escalators do not generate nav by default

**When:** `stairs` of 16 rise/16–32 run, or a 45-degree ramp.
**Symptom:** no nav areas on the slope, street/finale disconnected, "unplayable".
**Fix applied:** `navSlopeLimit: 0.5` in `run_nav_generate`, and a 23-degree ramp instead
of 45-degree steps. The metro escalator then generated 189 areas and loaded. A 51-degree
basement ramp still needs the chapter-1 investigation above.

### P1 — no real finale on chapter 2

**When:** the last map ends with `info_changelevel`/`trigger_once` to `credits` instead of
a type-2 `trigger_finale`.
**Symptom:** the map can load and end, but it is not a proper campaign finale; the nav end
was temporarily marked as a checkpoint instead of FINALE.
**Next fix:** build a type-2 finale with a stage list and an escape phase, and test the
stage markers and credits. The current BTR trigger is a test escape, not a campaign finale.

### P1 — prop origins and model bounds

**When:** placing `prop_static` with the model's origin on the floor.
**Symptom:** `prop-below-floor` warnings; trees/rocks/benches sink into the ground.
**Fix applied:** a model-lift table from `read_game_content(details: true)`; still 1–2
warnings remain. The durable fix is a placement helper/tool that takes the model's lowest
point from `read_model_info` and stands it on the floor, or a writer that refuses a prop
whose bounds penetrate the floor unless `buried: true` is passed.

### P1 — start area outside a safe room

**When:** the first map spawns in an open field with only `info_player_start`.
**Symptom:** "Map is unplayable" and the Director cannot establish a start checkpoint.
**Fix applied:** a forester's cabin with an open doorway and a checkpoint nav region.
**Remaining:** chapter 1 still fails; do not assume a cabin alone is enough.

### P1 — street lighting and materials

**When:** a night outdoor area uses `CONCRETE/BLEND_CONCRETE_01` and bright
`light_environment` values.
**Symptom:** the street is blown-out white/black, facades are unreadable, and the APC/BTR
close-up looks like a broken wall. The escalator is a giant yellow ramp with no step
readability.
**Next fix:** use matte stock facade/blacktop materials, lower `_light`/`_ambient`, add
streetlight pools and fog, add non-solid step lips and handrails over the ramp, and capture
again. Do not judge visual quality from a single frame at 4 s after load.

### P2 — `logic_auto` has no `targetname` in L4D2's FGD

**When:** adding one to hold `OnMapSpawn` outputs.
**Symptom:** lint `unknown-keyvalue`; outputs still work in the built map, but the key is
meaningless. **Fix:** match `logic_auto` by classname/id when adding outputs, or accept the
warning explicitly.

### P2 — `info_changelevel` brush height

**When:** a disabled arrival `info_changelevel` brush sits on the floor.
**Symptom:** if treated as solid/low, it fragments nav in the safe room. Keep it above the
survivor hull; a brush is not a point entity.

### P2 — test camera / teleport controls

**When:** trying to capture metro/street/BTR in one run.
**Symptom:** `point_clientcommand` `setpos` and enabling `trigger_teleport` while the
player is stationary did not move the player; `point_teleport` with `target: "!player"`
worked for the first hop. **Fix:** use `point_teleport` for test sequences, or add a
dedicated `run_map_test` camera/warp option. Never ship the test entities; they are
conditional on `HSMCP_SELFTEST`.

### P2 — tool/readout bugs found

- `read_nav_dump` returns `areaCount` and a correct summary but `returned: 0` and an empty
  `areas` list. It should page areas; currently it hides the per-area evidence.
- `read_bsp_entities` with a `classname` filter returns no entities even when the histogram
  contains the class; the histogram is correct. The filter path is broken.
- `render_vmf_tour` produced black frames for both maps; `render_vmf_view` reported
  `facesDrawn: 0` from inside the metro/street. The room/camera pass needs investigation.
- `run_nav_generate` originally returned only `nav`; fixed to return `bsp` as well.

### P2 — assets and setting fidelity

- `models/props_vehicles/apc001.mdl` is an APC, not a BTR. It is used as the closest stock
  stand-in; the model's materials/orientation need an in-game check.
- L4D2 has no Moscow/VDNKh set. The street is generic concrete blocks, bay windows, a
  pavilion, a fountain and a horse statue. It is a themed approximation, not a Moscow
  replica. The user's "only existing assets" rule is respected; the visual result is not
  yet convincing.
- The forest uses generic cedar/cypress/rock props; the moon-only look is too dark in the
  first frames. A controlled moonlight fill and fog tuning are needed.

### P3 — verification limits

- No dedicated server is installed and a second Steam account is not available, so
  two-team Versus/Scavenge rounds remain unverified. This does not block a campaign's
  single-team environment test, but it blocks claims about versus balance.
- Full Survival wave still depends on the map's own `trigger_finale`/panic trigger.
- HLMV's 3D canvas needs an interactive desktop.

## Root incident and prevention

The core incident was not "a missing brush": it was **two contracts that were implicit**.
1. The nav tool returned a mesh without the BSP the engine had just rewritten.
2. The build accepted `read_nav_dump: playable` as a map verdict without checking
   `read_nav: fresh` and without checking the nav flow from the end checkpoint.

Both are now written down and partly enforced. The next structural fix is a **campaign
acceptance gate** that, for every map:
- reads `read_nav` and fails unless `fresh`;
- reads the engine's `nav_trouble_report` and fails on orphan/missing checkpoint areas;
- runs `run_map_test` with the exact BSP/nav pair and fails on the "NAV ERRORS" panel;
- records one screenshot and one evidence line per requested mechanic.

Until that gate exists, a sealed/compiled map is not the same as a playable one.
