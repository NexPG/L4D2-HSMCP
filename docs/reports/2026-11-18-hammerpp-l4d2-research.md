# Hammer++ / L4D2 — deep research report (2026-11-18)

**Version:** 0.0.84-alpha
**Scope:** Hammer++ build 8873, stock Hammer, Tools++, L4D2 campaign/mechanics/limits.
**Deliverables:** `docs/reference/hammerpp-complete-reference.md`,
`docs/reference/l4d2-complete-reference.md`, plus three tools that close gaps the research
found.

## 1. What was read

- Hammer++ official site: features, tools, updates, download (build 8873, 27 Oct 2026).
- Valve Developer Community *Hammer++* and compatibility template; Ceno's L4D2 setup
  guide; `L4D2-FGD-Edits` / `toolsplusplus.fgd`.
- The installed `left4dead2.fgd` + `base.fgd` (446 classes) through `read_fgd_class`.
- The installed `hammerplusplus_settings.ini`, `hammerplusplus_gameconfig.txt`,
  `hammerplusplus_keybindings.cfg`.
- The game's own `pak01_dir.vpk`: `missions/*.txt`, `scripts/population.txt`,
  `scripts/weapon_*.txt`, `scripts/melee/*.txt`, `scripts/surfaceproperties_left4dead.txt`.
- The decompiled stock VScripts (`director_base.nut`, `director_gauntlet.nut`,
  `c1m4_atrium_finale.nut`, `c2m5_concert_finale.nut`,
  `c4m5_milltown_escape_finale.nut`).
- Live `find <prefix>` output from the running game for `director_*`, `z_*`, `nav_*`,
  `versus_*`, `sb_*`, `ammo_*`, `upgrade_*`.

The numbers in `l4d2-complete-reference.md` are therefore from this install, not from
memory: `z_health` 50, `z_tank_health` 4000, `z_witch_health` 1000, `director_*` defaults,
`nav_slope_limit` 0.7, etc.

## 2. The findings that matter most

### 2.1 Hammer++ settings that silently break a map

- `IOParamNewDelimiter` is the ESC/comma I/O switch. L4D2 needs **0**. This install was on
  `1`; the setting is now `0`. `health`, `read_vmf_lint` and `normalize_vmf_io` cover it.
- `vertices_plus` is precise brush data. The writers move it with geometry and drop it when
  a clip changes the loop; Hammer++ regenerates it on save. A stale block draws the brush
  where it used to be.
- L4D2 is 32-bit; current Hammer++ is x64. Use the x86 build or the x86-64 beta.
- Tools++ is fully standalone now. `run_compile` defaults to the ++ chain and names what
  ran.

### 2.2 The full Hammer++ feature list, not just the parity table

The official features page lists lighting preview (HDR, AO, bounced light, light bleed),
2D/3D sky preview, fog/particle/rope/render-effect/material-proxy previews, model hotload,
crash recovery, precise brush data, gizmo/pivot/drag-select, polygon and sprinkle tools,
3-point clipping, UV lock, multiple cordons, merge/move-to-floor, microgrid, model/particle/
texture/sound browsers, keybind editor, Discord RPC, MP3/OGG and Propper++ (brush → model,
atlas, AO, merging, lightmap atlas). The new reference maps each to a file-level result, a
tool, or an explicit view-only boundary.

### 2.3 L4D2 mechanics are mostly entity + Director defaults

- Mission modes: coop, versus, survival, scavenge, holdout; `meleeweapons`, `survivor_set`,
  posters, `VersusCompletionScore`, per-mode chapters.
- Map flow: start/checkpoint/finale, `info_changelevel` + `info_landmark`, exact
  `checkpoint_exit`/`checkpoint_entrance` names, below-ground `info_survivor_position`.
- Nav: the 13 L4D2 flags (including `No Threat` 524288 and `Lying Down` 1048576), the 18
  engine checks, `nav_save_selected`, and the defaults (`nav_slope_limit` 0.7,
  `nav_area_max_size` 50, `nav_corner_adjust_adjacent` 18, climb 66 / drop 240).
- Director: `director_*` defaults (intensity 0.9, relax 30/45 s, special respawn 45 s, tank
  350–500 s, panic waves 2, stage delay 5), `DirectorOptions` keys, gauntlet/onslaught
  patterns.
- Custom finale: PANIC 0, TANK 1, DELAY 2, ONSLAUGHT/SCRIPTED 3; `A_CustomFinale_StageCount`
  and `A_CustomFinaleN`; `OnBeginCustomFinaleStage`; `MapScript.DirectorOptions` scoping;
  `FinaleEscapeStarted`/`FinaleEscapeFinished`.
- Infected: exact `z_*` defaults (common 50, boomer 50, hunter/smoker 250, spitter 100,
  jockey 325, charger 600, tank 4000, witch 1000; limits 1 each; common limit 30).
- Items: `info_map_parameters` densities are **items per 100×100 yards**; 6.48 is the
  common default, pistols 4, magnum/configurable -1, finale clusters 3.
- Weapons: the installed scripts give exact damage/pellets/cycle/clip/range; the table is in
  the reference.
- Console: `find <prefix>` is the cvar browser; `run_map_test(commands:)` captures it. This
  is how the defaults above were read.

## 3. Tools added from the research

| Tool | Why |
|---|---|
| `write_vmf_water` | A water volume is `func_water_analog` + `water_lod_control`; the material must use the Water shader or it is a solid box. The writer checks both and rolls back on failure. |
| `place_door` | The door origin is the hinge. The tool reads the model hull, computes the hinge, writes the entity, and warns on a wrong checkpoint name. |
| `open_in_hammer` | The editor viewport is the one visual layer a file writer cannot reproduce. It launches Hammer++ on the VMF, captures the window, and closes it. Verified on `night_moscow_m1`: the capture shows the swamp, trees and sky. |
| `read_hammerpp` | Hammer++ settings by section, game configuration/build programs, FGD mount, keybindings and warnings. |

Nav dump flags now include `no-threat` and `lying-down`.

## 4. What is still open (new list)

1. **Propper++ / brush → model.** The largest genuine Hammer++ feature with no agent path.
   It needs an SMD/QC writer, not a map writer.
2. **Preview-map fallback for models.** HLMV's 3D canvas is blank on this desktop. A sealed
   room + `prop_dynamic` + `mat_fullbright` + `run_map_test` screenshot would make model
   shape visible on any desktop.
3. **Hotspot texturing (`$rectanglemap`/`.rect`).** The result is U/V; the rectangle lookup
   is editor-side and not implemented.
4. **4-way displacement blends.** The writer can paint alpha; whether L4D2 shaders render
   the extra blend data is unverified.
5. **Full settings reader.** `health` reports the editor and the I/O delimiter; the rest of
   `hammerplusplus_settings.ini`, the game config and the FGD mount are not yet structured.
6. **Type-2 finale start from the campaign menu.** The `+map` harness has no player +use;
   this is the remaining P1 acceptance test.
7. **Full Versus/Scavenge rounds and a full Survival wave** need a server or a second
   account; the mode load/HUD is verified.

## 5. Verification

- `pnpm typecheck`, `pnpm build`, `pnpm test`: **1211 passed, 33 skipped, 0 failed**, 113
  files.
- `open_in_hammer` capture: `night_moscow_m1.vmf` loaded in Hammer++ 8873, 1920×1023, 3D
  view visible.
- `write_vmf_water`: fixture VMF, Water shader accepted, `water_lod_control` added, lint 0;
  a non-Water material is refused.
- `place_door`: night-moscow m2 opening gives origin `30 208 -107.334`, hinge `max`, width
  58.331; lint reports only the expected duplicate targetname in the copy.
