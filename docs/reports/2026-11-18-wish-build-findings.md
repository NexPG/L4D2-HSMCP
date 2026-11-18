# Wish-to-campaign test — findings after the root-cause pass

**Date:** 2026-11-18
**Campaign:** `campaigns/002-night-moscow/` (local; gitignored)
**Version:** 0.0.78-alpha

## What was verified this pass

- Both chapters compile with Tools++ (`vbsp/vvis/vrad` exit 0), lint is **0 findings**, and
  both nav meshes are `fresh` with the string-table dictionary present.
- `night_moscow_m1` loads from the **normal Steam client** (not `-insecure`) out of the
  installed VPK with no `NAV ERRORS`; the menu is responsive and the add-on does not hang.
- `night_moscow_m2` loads with no `NAV ERRORS` after its end nav region was changed from
  CHECKPOINT to FINALE. The safe-room door is open in the capture and the metro is visible.
- The chapter transition `m1 -> m2` was exercised with the self-test warp and
  `Host_Changelevel` reached `night_moscow_m2`.
- The no-mob `logic_script` loads on both maps (`[night_moscow] no-mob script loaded`) and
  no infected were seen in the captures.
- Sky: the engine no longer logs `material "skybox/..." not found`; a sky is drawn through
  the cabin doorway. It is `urbannightburning_hdr`, the closest dual-mode night stock sky.
- A normal Steam launch with the deployed VPK reaches the main menu; a direct
  `left4dead2.exe` launch does not (Steam auth), which is a test-harness fault, not an
  add-on fault.
- The checkpoint door now hangs on the jamb: the 64-unit opening is clear when it is open,
  and the leaf covers it when closed. Both doors use `placeDoor` and `read_model_info`, not
  a hard-coded centre origin.
- `director_stop` turned out to be cheat-only (`Can't use cheat command ... unless sv_cheats`),
  so the first normal-client m2 run had commons in the metro. Both maps now load a
  `logic_script` that sets `DirectorOptions.CommonLimit/MaxSpecials/TankLimit/WitchLimit`
  to zero; the normal-client m2 run shows no infected and logs
  `[night_moscow] no-mob script loaded`.

## Root fixes in the repository

| Problem | Root cause | Fix |
|---|---|---|
| `read_nav` stale; game says "Map is unplayable" | The engine appends the string-table dictionary **after** writing nav, so nav's `savedBspSize` described the pre-dictionary BSP | `run_nav_generate` bakes the dictionary with a `-stringtables` changelevel before generating; returns `bsp`, `fresh`, `stringtableDictionary`; retries once if the pair is stale |
| Nav generated for the wrong map | A mounted VPK wins over a loose map; `addonsToHide` resolved bare names against the repo root, not the game's `addons/` | Bare names resolve in `<game>/left4dead2/addons/`; every installed VPK whose index contains `maps/<map>.bsp` is moved aside and reported as `shadowingArchives`; the sidecar's `vpk_list` prefix filter was fixed (it returned nothing for a path prefix, so the first shadow search was silent) |
| No sky / flat void / "laggy sky" | worldspawn held `sky_l4d_night02`/`urbannightburning`; L4D2 asks for `skybox/<skyname><side>.vmt`, and stock maps store `..._hdr` | `checkSkybox` groups by full suffixed name, returns `suggested`; `write_vmf` stores it; `run_compile` refuses a sky without faces for the mode; default is `sky_l4d_rural02_hdr` |
| Sky-only-one-mode | HDR-only skies (`sky_l4d_night02`) draw nothing in LDR | A dual-mode sky is required for `-both`; `read_asset_catalog` lists `ldrComplete`/`hdrComplete` |
| Door opening twice the door | Walls were cut 128/256 wide around a 58-unit `checkpoint_door_02` | Openings are 64 x 112 (or 72 x 112 for the 68-unit door); lint `l4d2-door-opening-too-wide` / `-too-narrow` compares the gap to the model's horizontal width |
| Door stuck in the middle of the opening | The door model's origin is its **hinge**, not the leaf centre; both doors were at x = 0 in a 64-unit opening, so half the leaf went through the wall and half the doorway stayed open | `placeDoor` computes the hinge two units inside the jamb from `read_model_info` bounds; both campaign doors are at x = 30; lint `l4d2-door-hinge-at-center` catches the mistake |
| Zombies in a normal client | `director_stop` is a cheat command and is ignored without `sv_cheats`; the marker was an echo, not proof | Both maps attach a `logic_script` that sets `DirectorOptions` limits to 0 and re-applies them on a timer; the stock FGD's missing `logic_script` is tolerated by the lint |
| Slippery block / bots will not climb | A 51-degree `wedge` is a wall; a 20-unit stair rise is above the 18-unit step height | `write_vmf_solid` refuses a >45-degree wedge and a >18-unit step unless `steep: true`; campaign uses eight 16x16 steps |
| `landmark embedded in solid` | `info_landmark` inside a trigger/region brush was counted as solid | `l4d2-landmark-in-solid` checks world solids and solid brush entities, ignoring triggers, nav regions and `info_changelevel` |
| Escape unreachable | The end region was CHECKPOINT, not FINALE, so the Director had two checkpoints and the flow was rejected | `nav_finale` spawnflags changed from 2048 to 64; dump now shows FINALE areas |
| Map2 "does not load / crashes" | Stale nav/BSP pair and wrong end-goal type | Both fixed above; map2 loads cleanly |
| Normal-client add-on worry | Direct `left4dead2.exe` without Steam gives `No Steam logon`; canonical addoninfo keys and the dictionary were also missing | Manifest keys fixed; dictionary baked; tested via `steam.exe -applaunch 550` |
| Agent did not see the escalator / houses / grass | `read_game_content` and the old catalog needed a name; no material preview existed | `read_asset_catalog` groups building, roof, window, vehicle, foliage, street, interior, prop, fence, light, sign, terrain, escalator and stairs, plus material categories; `preview_asset` returns the actual texture or HLMV viewport |
| Flat ground everywhere | The displacement tools existed but no recipe told the agent they are the terrain path | `references/mapping/terrain-water-boundaries.md` gives the grid -> displace -> sculpt -> sew -> paint order; the campaign uses grass, a deeper water basin and a tree line |
| Water bodies unclear | `func_water_analog` was used but not documented as the water contract | The same reference covers the brush, `water_lod_control`, the no-nav rule and the boardwalk |
| Map edges visible | Ground and sky met at the shell with nothing in front | Tree line on both forest edges, stock facades along the street, fog and distant trees |
| `read_nav_dump` returned 0 areas | Split regex `NAV AREA\s*\n-+` consumed the CRLF and required a second newline | `NAV AREA[^\S\r\n]*\r?\n-+`; CRLF regression test |
| `read_bsp_entities` classname filter returned nothing | `handler` used `slice(offset, offset + limit)`; a direct call does not apply the Zod default, so `limit` was `undefined` | Defaults are applied in the handler for `limit`/`offset` |
| Unknown `FinaleType` key | The FGD key is `type`, displayed as "Finale Type" | Campaign and skill docs use `type` |

## New problem list (conditions, symptoms, next fix)

### P1 — the type-2 finale did not start in the harness

**When:** `trigger_finale` with `type 2` on the last map, loaded with `+map` (standalone) or
after a `+map` campaign transition, with or without `director_stop`, with `Enable` and
`ForceFinaleStart` fired by `ent_fire`, a timer, or entity I/O.
**Symptom:** no `Finale started`; no `<map>_finale.nut` load; no stage log. The escape
trigger is enabled independently, so the map is still completable.
**What is ruled out:** missing model (fixed), missing FINALE nav (fixed; 81 areas), missing
script in the VPK (present and loose test also failed), wrong `type` key (FGD confirms
`type`), missing arrival `info_changelevel` (present, disabled).
**Likely cause:** the campaign mission context. `+map` loads a single map; the Director may
not treat it as the campaign finale, and type 2 then starts nothing. The stock maps start a
finale through a button that `Enable`s the trigger and a player `+use`.
**Next fix:** test from the **campaign menu** or a mission launch, not `+map`; if it still
does not start, compare the entity and outputs byte-for-byte with `c2m5_concert` and start it
with a real +use button. Do not claim a working finale until the stage lines and
`FinaleEscapeStarted` are in the log.

### P1 — the downloadable string-table dictionary is incomplete

**When:** any map shipped after a `-stringtables` bake; the normal client logs
`String Table dictionary for downloadables should be rebuilt, only found 45 of 92 strings`.
**Symptom:** the map still loads, but the client may spend time rebuilding and the warning is
a real inconsistency.
**Likely cause:** the bake runs with the shadowing campaign VPK hidden; strings that only the
mounted archive contributes (scripts, particles, sounds) are not in the map's dictionary.
**Next fix:** bake on a copy while the archive is mounted and the loose map wins (or merge
the archive's dictionary); add a `dictionaryComplete` check to the nav result instead of only
`stringtableDictionary`.

### P1 — a real moonlit sky needs custom content

**When:** the brief asks for a night forest / Moscow night, and only stock assets are allowed.
**Symptom:** `urbannightburning_hdr` is a burning-city dusk; through the cabin doorway it
reads as a brown haze, not moonlight. `sky_l4d_night02_hdr` is the right night sky but has
no LDR faces, so it is black whenever the engine falls back to LDR.
**Fix:** with the current rule (stock assets only) this is the closest correct choice. A
true moonlit sky requires a custom skybox (six LDR + six HDR faces), which the brief excludes.
Document it as a content limit, not a tool bug.

### P1 — model shape preview is still HLMV-only

**When:** `preview_asset(kind: "model")` on this desktop.
**Symptom:** HLMV opens and loads the stock model, but its OpenGL viewport captures black;
the material preview works. The tool accepts VPK models now, but the picture of the shape
is not trustworthy here.
**Next fix:** a generated preview map (sealed room, `prop_dynamic`, `mat_fullbright`) run
through `run_map_test`, used when the HLMV canvas is blank. Until then, `preview_asset` on
the model's materials and `read_model_info` bounds are the reliable half.

### P1 — the campaign still uses a flat forest floor

**When:** the forest is the place for hills and the tools are displacement-based.
**Symptom:** the ground is a large flat brush; grass and trees were added, but there is no
terrain relief.
**Next fix:** replace the forest floor with a grid, `write_displacement(power: 4, facing:
"up")`, `sculpt_displacement(noise)` and sew; keep the cabin, boardwalk and stairs on flat
floor. The recipe is in `references/mapping/terrain-water-boundaries.md`.

### P2 — boundaries are covered, not authored

**When:** the forest edge is the skybox shell.
**Symptom:** a tree line and fog hide it, but there is no 3D skybox or cliff; the street ends
at the facades.
**Next fix:** a 3D skybox ring or a cliff/hill band beyond the tree line; `write_sky_camera`
and a scaled copy are the native path.

### P2 — bulk asset inspection is one call per asset

**When:** choosing among dozens of houses or facades.
**Symptom:** `read_asset_catalog` gives names and bounds, but each picture is a separate
`preview_asset` call.
**Next fix:** an optional contact-sheet mode that returns a grid of the first N previews of
a category; keep it opt-in, because each material is a VTF decode.

### P2 — `read_vmf_view` cannot frame an interior

**When:** `render_vmf_view` with an origin inside the cabin.
**Symptom:** `insideSolid: true`, `facesDrawn: 0`, `voidFraction: 1`; the camera reports the
eye inside a brush even though the game spawns there. `render_vmf_tour` is black for both
maps.
**Next fix:** the point-in-solid/voxel pass is wrong for this geometry; reproduce on the
probe fixture and fix the solid set or the eye drop. Until then use `run_map_test` for visual
evidence.

### P2 — prop placement is still a table in the campaign

**When:** `prop_static` is placed with the model origin on the floor.
**Symptom:** `prop-below-floor` until `MODEL_LIFT` is right; the 18-prop forest still needed
manual lifts.
**Next fix:** a placement helper that reads `mins.z` from `read_model_info` and writes
`origin.z = floor + lift`, or a writer option `onFloor: true`; the lint already reports the
mistake.

### P2 — visual quality of the street and forest

**When:** night outdoor lighting with `CONCRETE/BLEND_CONCRETE_01`, dark `light_environment`,
and stock foliage.
**Symptom:** the street is flat and the forest reads as black silhouettes; the BTR is an
`apc001.mdl` stand-in; the escalator side panels are visual only (collision off) and the
walking surface is the wedge.
**Next fix:** matte street materials, lower `_light`, fog/light pools, non-solid step lips or
handrails on the escalator, and a proper BTR model if one exists. This is content work, not a
pipeline fault.

### P2 — `read_map_dependencies` reports `cedar_large01.phy` absent

**When:** a static prop model has no `.phy` in the install.
**Symptom:** `optionalAbsent`; the map loads, physics for that prop is static. Worth knowing,
not a blocker. Do not treat it as a missing material.

### P2 — direct-exe launches are not normal-client tests

**When:** `left4dead2.exe` is started outside Steam with `-insecure` or by a script.
**Symptom:** `STEAMAUTH ... failure code 8`, `No Steam logon`, drop to the menu. This was the
first "infinite loading" reproduction and it was the harness.
**Fix:** use `steam.exe -applaunch 550 ...` or the Steam UI for the normal-client gate;
`run_map_test` keeps `-insecure` for cheats and loose maps and should say so in its result.

### P3 — unverified surfaces

- **Versus / Scavenge:** no dedicated server and no second Steam account; two-team rounds are
  unverified. Single-team coop is verified.
- **Finale stages / escape:** see P1.
- **HLMV 3D canvas:** needs an interactive desktop; the UI is captured, the canvas is not.
- **Full Survival wave:** depends on the map's panic/finale entities; not run.

## Engine limits

The full table is in `docs/reference/engine-limits-l4d2.md`. The numbers that decided this
build:

- Coordinates **-16384..+16384**; the BSP is **32-bit**, keep it well under 300 MB.
- Brushes **8192**, brush sides **65536**, faces **65536**, texinfo **12288**, unique
  materials **2048**, displacement surfaces **2048**, brush models **1024**.
- Map entities **8192**; runtime edicts **2048**.
- Lighting **16 MB per mode**; visibility **16 MB**.
- Walkable slope **45 degrees**; step height **18 units**.
- Dynamic lights under **32**; projected textures **1-4**.

## Acceptance gate still missing

The durable fix is a single `run_campaign_gate` that, for every map:

1. fails unless `read_nav` is `fresh` and the dictionary is present;
2. fails on `NAV ERRORS`, orphan/missing-goal output from `nav_trouble_report`;
3. runs `run_map_test` with the exact BSP/nav pair and the VPK hidden;
4. records one screenshot and one log marker per requested mechanic.

Until that exists, a sealed/compiled map is not a playable one.
