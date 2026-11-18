# Open problems — 2026-11-18 (post-gate list)

**Version:** 0.0.83-alpha
**Campaign:** `campaigns/002-night-moscow/` (local, gitignored)
**Meaning:** only problems that are still open. The fixes already landed are listed at the
end; they are not repeated as open work.

## Verified state

`run_campaign_gate` with `campaign`, `lint`, `props`, `finale`, `trouble` and `test` returns
`ok: true` for both maps. `nav_trouble_report` passes every engine check on m1 and m2;
`check_finale` passes m2; the mission check is clean; each map loads with its exact nav
pair and no `NAV ERRORS`.

## P1 — blocks a "finished" campaign

### 1. Type-2 finale start is still a manual test

**When:** last map `night_moscow_m2`, `trigger_finale` with `type 2`; tested with `+map`
and a forced start (`ent_fire finale ForceFinaleStart`, with `Enable`, `director_start`,
and `wait`), with the campaign scripts installed loose.
**Symptom:** the script loads (`[night_moscow] no-mob script loaded`), but no
`[night_moscow] finale stage` and no `HSMCP_FINALE_STARTED` echo. The BTR escape trigger
still ends the map.
**Ruled out:** missing model, missing FINALE nav (88 areas), script absent (installed
loose and packed), wrong `type` key, missing arrival `info_changelevel`, missing toolbar
`+use` object (the `finale_start` trigger exists).
**Likely cause:** the `+map` harness never gives the map a spawned player (the log shows
`[INTROS] Team is frozen` and `New player ... joining team 2 as character Unknown` only
after the config ran). `ForceFinaleStart` with no player activator is not the player-facing
path. The real start is a player walking into `finale_start` or +using the trigger.
**Next fix:** test from the campaign menu, not `+map`; add a player-driven test harness (a
real `+use` button the survivor can reach) and compare outputs with `c2m5_concert`. Do not
call it fixed until the stage logs and `FinaleEscapeStarted` are present.

### 2. Downloadable string-table dictionary is incomplete

**When:** a map baked with `-stringtables`; normal client.
**Symptom:** `String Table dictionary for downloadables should be rebuilt, only found 45 of
89 strings in dictionary` (the count moves with the map). The map loads, but the client may
spend time rebuilding it.
**Likely cause:** the bake runs with the shadowing campaign VPK hidden, so strings that only
the archive contributes are missing.
**Next fix:** bake on a copy with the archive mounted and the loose map winning, or merge the
archive dictionary; add `dictionaryComplete` to `run_nav_generate` instead of only
`stringtableDictionary`.

### 3. Model shape preview is not trustworthy on this desktop

**When:** `preview_asset(kind: "model")` / HLMV.
**Symptom:** HLMV loads a stock model and its UI is captured, but the OpenGL 3D viewport is
black. The material preview works. The tool now accepts VPK models, but the picture of the
shape is not usable here.
**Next fix:** a generated preview map (sealed room, `prop_dynamic`, `mat_fullbright`) via
`run_map_test`, used when the HLMV canvas is blank; or a software/model renderer. Until then,
`preview_asset` on the model's materials plus `read_model_info` bounds is the reliable half.

### 4. The campaign forest is still a flat floor

**When:** terrain is wanted, and the map uses a large flat brush.
**Symptom:** no hills, pits or banks; grass and trees sit on z = 0.
**Cause:** the campaign floor was built flat; the capability now exists as
`write_vmf_terrain` (grid -> displacement -> noise -> sew), but moving props onto a
displaced surface needs height sampling.
**Next fix:** call `write_vmf_terrain` for the forest sides, keep the cabin/boardwalk/stairs
flat, and move foliage onto the surface. The tool is in place; the campaign has not used it.

## P2 — visible or structural, not campaign-stopping

### 5. Map boundaries are covered, not authored

**When:** the playable ground meets the skybox shell.
**Symptom:** the forest now has a tree line and a cliff band inside the skybox shell; the
street has facades and a far tree line. There is still no 3D skybox; it reads as a boundary,
not as a distant place.
**Next fix:** a 3D skybox ring (`write_sky_camera` + scaled copy) beyond the cliff/facades.

### 6. Water is a basin, not a shoreline

**When:** the swamp.
**Symptom:** the water is a `func_water_analog` box in a deepened basin, with a boardwalk
across it. There is no painted shoreline and no shore terrain.
**Next fix:** `paint_displacement(byHeight)` around the water line; a bank that slopes into
the water; keep the boardwalk joined to nav on both banks.

### 7. Stock "houses" are mostly fragments

**When:** choosing a ready-made building.
**Symptom:** `read_asset_catalog` has 54 building models, but many are destroyed chunks,
warehouse beams, storefront pieces or facade sections, not a complete house shell. The
campaign places `building_brick_destroyed01` as a facade in front of a collision block.
**Next fix:** prefer complete building models where they exist; preview each candidate
(`preview_asset`) and use a composed facade only when the interior is not playable.

### 8. The escalator is still a model over a ramp

**When:** the metro shaft.
**Symptom:** `mall_escalator` is placed on the 23-degree wedge with collision off; the
walking surface is the wedge, the model is decoration. The angle was changed from `-23` to
`+23` (Source roll; negative tilted it against the climb), but it has not been playtested at
the shaft since.
**Next fix:** look at it in game. If it clips, align the model to the wedge's two end heights
or add flat landings. Do not make it solid: its steps are not a nav surface.

### 9. Detail density is still low

**When:** forest and street.
**Symptom:** there are now 120 grass props, facades, storefronts, dumpsters, trash cans and
lamps, but no **detail sprites** (the small grass blades Source draws on a displacement) and
the maps are still sparse compared with a shipped L4D2 chapter.
**Next fix:** use `write_vmf_terrain` so the ground is a displacement, then paint/detail it;
add more prop clusters. `detail.vbsp`/`detailmaterial` are already on worldspawn, but a flat
brush has no surface for vbsp to scatter sprites on.

### 10. Prop placement is a manual lift table

**When:** `prop_static` is placed with the model origin on the floor.
**Symptom:** `prop-below-floor` until `MODEL_LIFT` is right; the table is in the campaign
build, not in the writer.
**Next fix:** a writer option `onFloor: true` that reads `mins.z` from `read_model_info`, or
a placement helper; the lint already catches the mistake.

### 11. `read_vmf_view` cannot frame an interior

**When:** a camera origin inside the cabin.
**Symptom:** `insideSolid: true`, `facesDrawn: 0`, `voidFraction: 1`; `render_vmf_tour` is
black for both maps.
**Next fix:** fix the point-in-solid/voxel pass on the probe fixture; until then `run_map_test`
is the visual oracle.

### 12. Bulk asset inspection is one call per asset

**When:** choosing among dozens of houses or facades.
**Symptom:** `read_asset_catalog` gives names and bounds; each picture is a separate
`preview_asset` call.
**Next fix:** an opt-in contact-sheet mode for the first N previews of a category. Each
material is a VTF decode, so it must stay opt-in.

### 13. `read_map_dependencies` reports an optional `.phy` absent

**When:** `cedar_large01.phy` is not installed.
**Symptom:** `optionalAbsent`; the map loads and the prop is static. It is not a missing
material, but a reader can mistake it for one.
**Next fix:** label it `optionalPhysics` in the result and keep it out of the missing list.

### 14. VScript/`logic_script` is outside the stock FGD

**When:** a map uses `logic_script` for `DirectorOptions` or another script.
**Symptom:** the stock FGD does not declare the class; the lint now tolerates it, but other
tools that trust the FGD may not.
**Next fix:** a small known-entity supplement for `logic_script` (`vscripts`,
`RunScriptCode`, `RunScriptFile`) shared by every FGD consumer.

## P3 — environment and verification limits

- **Versus / Scavenge:** no dedicated server and no second Steam account; two-team rounds
  are unverified. Single-team coop is verified.
- **Full Survival wave:** depends on the map's panic/finale entities; not run.
- **Normal client:** verified through `steam.exe -applaunch 550`; a direct `left4dead2.exe`
  launch outside Steam reaches `No Steam logon` and is not a normal-client test.
- **HLMV:** the 3D canvas needs a working interactive OpenGL desktop; it is blank on this
  host, as P1 #3 says.
- **Bulk performance:** the asset catalog reads hull bounds for many models; it is not timed
  on a cold VPK mount.
- **`preview_asset` material decoder:** it reads `srctools.vtf.Frame._data`, a private field.
  A future srctools release can break it; the failure is reported, not silently empty.

## Fixed in this pass (for context, not open work)

- Nav/BSP dictionary order; `run_nav_generate` bakes before nav and returns `fresh`.
- Bare add-on names resolve in `<game>/left4dead2/addons/`; shadowing VPKs auto-hide;
  `vpk_list` path-prefix filter fixed.
- Skyname must carry `_hdr`/`_ldr`; checker groups full names, `write_vmf` stores
  `suggested`, `run_compile` refuses a sky without faces for the mode; default
  `sky_l4d_rural02_hdr`.
- Door origin is the hinge; `placeDoor` computes it from `read_model_info`; lint
  `l4d2-door-hinge-at-center`; both campaign doors at x = 30.
- `l4d2-door-opening-too-wide` / `-too-narrow`; `l4d2-landmark-in-solid` ignores trigger
  volumes; the solid probe uses `Vec`, not a list.
- `director_stop` is cheat-only; both maps attach a `logic_script` that sets
  `DirectorOptions.CommonLimit/MaxSpecials/TankLimit/WitchLimit/MobSpawnSize` to zero.
- >45-degree wedge and >18-unit stair refused unless `steep: true`.
- FINALE nav (64) instead of a second CHECKPOINT; m2 no longer says "Map is unplayable".
- Canonical addoninfo keys; `read_nav_dump` CRLF; `read_bsp_entities` handler defaults;
  `FinaleType` -> `type`; `trigger_finale` model is a real stock asset.
- `preview_asset` (VTF -> PNG and HLMV capture); `read_asset_catalog` building/roof/window/
  prop/fence/terrain and material categories; terrain/water/boundary recipe.
- Checkpoint doors renamed `checkpoint_exit`/`checkpoint_entrance`; `l4d2-checkpoint-door-name`
  and `l4d2-door-swing-blocked`.
- `read_static_props`, `read_model_info.hasPhysics`, `prop-static-no-physics`/
  `prop-static-not-solid`; trees/grass marked `spawnflags 2` decoration.
- `write_vmf_terrain` (grid + displacement + noise + sew); ten-guide authoring reference.
- Campaign details: stock facades, storefronts, dumpsters, trash, lamps, 120 grass props,
  deeper swamp, tree lines, cliff band, `mall_escalator` with positive roll.
- `run_campaign_gate` (one gate across mission, lint, compile, nav, props, finale, trouble
  and map test) and `check_finale` (type, script, stage list, FINALE area, arrival marker,
  escape outputs, start path).
- `nav_trouble_report`: the engine's own checks are structured findings; L4D2's
  `nav_save_selected` gives the selected areas' four corners, attributes and connections
  because `nav_dump_selected_set_positions` does not exist in this game. `nav_save_selected`
  files are removed after reading.
- `run_map_test` can install a `scripts/vscripts` directory and run post-load console
  commands, restoring both. This is what let the loose-map test load the no-mob script
  instead of reporting `Entity nomobs encountered an error in RunScript()`.
- m2 `Missing Finale` (3 areas): the FINALE region stopped at y=3300 while the nav's last
  row was at y=3225; extended to y=3200. m2 non-walkable connections: the hall floor was a
  32-unit step above the corridor; lowered to -160.
- m1 non-walkable connections (40 areas): the swamp bed was 32 units below the forest,
  which produced a ring of 52-degree nav areas; the bed is now 16 below (inside StepHeight)
  and the pool is 12 deep. The engine's check passes.
- `read_static_props(vmf:)` marks a model `decorative` when every instance carries
  `spawnflags 2`; `missingPhysicsSolidCount` is the number the gate fails on.
- `src/game/stage.ts` owns hide/restore and BSP/nav installation for the map test, nav
  generation and the nav trouble report.
