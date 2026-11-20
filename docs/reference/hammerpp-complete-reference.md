# Hammer++ for Left 4 Dead 2 — the complete reference

**Purpose.** This is the research pass behind the skill and the MCP, not a tutorial for one
map. It inventories Hammer++ build **8873 (27 October 2026)**, the stock Hammer it replaces,
and every editor feature that has a file-level consequence. The last section maps each
feature to a tool or names the reason it is view-only.

**Primary sources**

- Hammer++ official site: <https://ficool2.github.io/HammerPlusPlus-Website/>,
  `features.html`, `tools.html`, `updates.html`, `download.html`.
- Valve Developer Community, *Hammer++* and its compatibility template:
  <https://developer.valvesoftware.com/wiki/Hammer%2B%2B>.
- Ceno, *Setting up Hammer++ for the original game*:
  <https://steamcommunity.com/sharedfiles/filedetails/?id=3320444257>.
- The installed `left4dead2.fgd` + `base.fgd` on this machine (446 classes) — the authority
  on keys, inputs and outputs.
- The installed `hammerplusplus_settings.ini`, `hammerplusplus_gameconfig.txt` and
  `toolsplusplus.fgd`.

---

## 1. What it is, and which build L4D2 needs

Hammer++ is a closed-source rebuild of Valve's Hammer editor for Source 1. It is not a new
map format: it reads and writes the same `.vmf` and drives the same `vbsp`/`vvis`/`vrad`
pipeline. What it adds is editor accuracy, previews, modelling tools, better browsers,
crash recovery and the Tools++ compilers.

- Current builds are x64. **Plain L4D2 is 32-bit**; use the last **x86** Hammer++ build, or
  run L4D2 on the `x86-64` beta branch. A 64-bit editor can open and save a VMF, but its
  bundled tools are not the 32-bit game's tools.
- L4D2 is installed from **Left 4 Dead 2 Authoring Tools**, not Source SDK. The editor lives
  at `.../Left 4 Dead 2/bin/hammerplusplus.exe`; its private files are in
  `bin/hammerplusplus/`.
- The editor's game configuration must point at `left4dead2`, `left4dead2.exe`, and either
  the stock `bin/vbsp.exe`/`vvis.exe`/`vrad.exe` or the Tools++ `vbsp++.exe`/`vvis++.exe`/
  `vrad++.exe`.
- Build 8871 removed `-steam` from the default L4D2 launch options. Do not put it back: a
  direct launch outside Steam already reaches `No Steam logon`; the normal-client path is
  `steam.exe -applaunch 550 ...`.
- `hammerplusplus_settings.ini` is the file behind the Options dialog. The one setting that
  silently breaks a map is `IOParamNewDelimiter` (see §3).

## 2. Every Hammer++ feature, grouped by what it changes

The official feature list is organised as a list of highlights. The grouping below is by
**effect on the file or the compiled map**, which is what an agent needs.

### 2.1 Map and file lifecycle

| Feature | What it does | File-level result |
|---|---|---|
| New / Open / Save / Save As | Ordinary `.vmf` editing | The VMF, plus Hammer++ blocks (§4) |
| Autosave and crash recovery | Saves open VMFs after a crash; `vmf_autosave` files | Extra files beside the map; not part of a compile |
| Drag-and-drop a VMF | Opens it in the editor | None |
| Background images | `View > Set Background Images`, common image formats | Saved in the VMF |
| Map properties | worldspawn keys | `skyname`, `detailvbsp`, `detailmaterial`, fade keys |
| Check for Problems (Alt+P) | Invalid solids, missing materials/models, unused keys, overlays | No file change; the same failures `read_vmf_lint` and `read_vmf_solids` report |
| Entity Report | Filter by class/name/key; extra info for `func_instance`, props, overlays | No file change |
| Pointfile | Loads a `.lin`, centres on the leak end, selects the responsible entity | Read-only |

### 2.2 Brush and world geometry

| Feature | Notes | File-level result |
|---|---|---|
| Block tool (box, wedge, cylinder, arch, sphere, torus, cone, stairs, prism/polygon) | Hammer++ adds a real-time arch and a polygon tool | Brushes and sides |
| Polygon tool | Draw a convex polygon in the 2D view from points | One convex brush |
| Clip tool | 2-point and **3-point** clipping; entities included; red highlight | Cut brushes; overlays on cut faces are preserved |
| Vertex tool | Real-time; invalid faces show red | Vertex positions, planes |
| UV lock | Texture stays put while vertices move | Texture axes/offsets |
| Merge tool | Merges selected brushes into one convex brush | One brush |
| Move Objects to Floor/Ceiling | Right-click in 2D or the toolbar; optional align by normal | Origins/vertex positions |
| Make Hollow | Mitred in Hammer; Hammer++ keeps the result valid | Several brushes |
| Carve | Still present, still dangerous | Many brushes; prefer clips |
| Precise brush data | `vertices_plus` written beside the planes; old imprecise data still written for compilers | A Hammer++ block inside each side (§4) |
| Microgrid / custom grid | 0.125, 0.25, 0.5, or a custom size such as 80 | Coordinates only |
| Convexity + hole checker | Catches brushes Hammer used to call valid and vbsp then died on | No file change |

### 2.3 Selection, transform, gizmo and pivot

| Feature | Notes |
|---|---|
| Gizmo | 3D translate/rotate/scale, global or local, axis locks; `Ctrl+J` |
| Pivot | Adjustable rotation centre; `Ctrl+P`; Paste Special can use it |
| Drag select | `Ctrl+left drag` selects what the crosshair passes over |
| Fancy selection glow | Models outlined in yellow |
| Hide/show editor objects | Tool textures (`Ctrl+Shift+F2`) and editor models/sprites (`Alt+O`) |
| Visgroups, groups, cordon | Multiple cordons are supported; **cordon changes what compiles** |
| Selection sets | Editor state; no file-level equivalent |

### 2.4 Displacements

| Feature | Notes |
|---|---|
| Create / destroy | Power 2, 3, 4 |
| Sculpt: raise/lower, flatten, slope, noise | Real-time; continuous painting and line-of-sight toggles |
| Paint alpha | Blend by height/slope; 4-way blends are an option (`Enable4WayBlends`) but need engine shader support |
| Subdivide | Raise power; resamples the grid |
| Sew | Joins two displacement edges |
| Create sealing brush | `seal_displacements` duplicates each displaced world brush without its `dispinfo` and tool-textures the copy; `write_displacement` takes `seal: true` to do both in one call. Verified by vbsp: the bare room leaks, the sealed one compiles |
| Invert alpha | SDK2013 option |
| Detail sprites | `detail.vbsp` + `detailmaterial` on worldspawn; only displacement faces scatter them |
| Displacement vertex explosion | Fixed in build 8871 |

### 2.5 Faces, textures and lighting data

| Feature | Notes |
|---|---|
| Face Edit Sheet / Material tool | Apply, align world/face, fit, shift, scale, rotate, justify, lightmap scale, smoothing groups |
| Direct U/V vector editing | Enables skew and exact alignments |
| Nodraw button, random X/Y shift | Quality-of-life |
| Texture browser | Alpha display, WorldVertexTransition blends, missing-material checkerboard, thumbnails, `Open Source` reads VMTs inside VPKs |
| Hotspot texturing | `$rectanglemap` in a VMT; `Fit` maps to the nearest rectangle from a `.rect` file |
| Overlay tool | Decals on faces; Hammer++ preserves overlay faces after a clip |
| Smoothing groups | 1–32; bit-shifted into the face |
| Lightmap scale | Per face; decimals accepted |
| Occlusion view / Occluder tag | For a TF2 mod's software occlusion; does nothing in official L4D2 |
| Propper++ | Brushes/displacements → a model; see §2.8 |

### 2.6 Entities and I/O

| Feature | Notes |
|---|---|
| Entity tool | Point entities; brush entities via tying a brush |
| Object Properties | Keyvalues, flags, inputs/outputs, model browser, color picker |
| Right-click a keyvalue | Reset to the FGD default |
| Color picker | RGB/HSV, palette saved per VMF; `C` with a light/prop selected |
| Entity Report | Class/name/key filters; `func_instance`, props, overlays get extra columns |
| `editor_text` | Hammer++-only 3D text; no in-game effect |
| Spawnflags with numbers | Build 8871 shows the flag number |
| `func_instance_io_proxy` | Tools++/VBSP++ support for instance I/O |
| Targetname recognition | `!nick`, `!rochelle`, `!ellis`, `!coach`, `!bill`, `!zoey`, `!louis`, `!francis` are valid |

### 2.7 Instances, prefabs and modelling

| Feature | Notes |
|---|---|
| `func_instance` | A separate VMF expanded at compile time |
| Instance Preview | Main map shown while editing an instance; middle-click or the properties button |
| Create Instance from Selection | Writes the file, recentres it, leaves one `func_instance` |
| Recursive collapse | Nested instances expand fully |
| Prefab | A saved VMF fragment pasted with fresh ids, move and yaw |
| Propper++ | Converts selected brushes/displacements to a model; Build → edit QC → Compile |
| Propper++ atlas | UV island generation, AO baking, lightmap atlas, model merging, non-uniform scale, `$casttextureshadows`, name suffixing; auto-splits >65k triangles |
| Model browser | Multi-panel, attachments tab, wildcard filtering, `!` negation, skins/bodygroups |
| Model hotload | External model/material changes refresh in the editor |

### 2.8 Browsers and previews

| Preview | What it shows | Limitation |
|---|---|---|
| Lighting Preview | HDR by default; sun/ambient/visibility samples, AO, bounced light, light bleed, cubemap toggle, tonemap/bloom/colour correction/vignette | Instances are fullbright and cast no shadows; texture shadows are not simulated |
| 2D Skybox Preview | The worldspawn sky in the 3D view | HDR sky in L4D2 is handled since build 8866 |
| 3D Skybox Preview | A `sky_camera` inside an instance, at real scale | The 3D skybox section must be an instance |
| Fog Preview | `env_fog_controller`, real-time; View > Set Fog Preview | Editor only |
| Particle Preview | `info_particle_system` particles; draw all or selected | Particle definitions must load |
| Rope Preview | Rope materials and simulated physics | Editor only |
| Render Effects | Colour, translucency, scale, bodygroups | Editor only |
| Material Proxies | Animated/scrolling textures | Editor only |
| `env_sun`, `point_spotlight`, `env_beam`, `env_laser`, sprites | Directional helpers and beams | Preview only |
| Physics Tool | Drag/explode/shoot ragdolls, props, brushes; time scale | Posing is not saved as a brush shape |
| Lightmap View | Brush and static-prop luxels, tinted by intensity | Editor only |
| 3D Grid / 3D Editor Text | Grid and `editor_text` | `editor_text` is Hammer++ only |
| Toggle tool textures / editor objects | Clean view | Editor only |

### 2.9 Browsers and asset discovery

| Browser | Features |
|---|---|
| Model | Multi-panel, attachments, grid/wireframe/collision, wildcard and `!` filters, skins |
| Particle | Preview and select a particle system |
| Texture | Alpha, blends, HDR-only skies, missing-material checkerboard, VMT source inside VPK |
| Sound | MP3/OGG playback, volume, browse a file on disk |
| Keybind Editor | Tools > Keybind Editor; modifiers and mouse bindings are limited |

### 2.10 Compile and run

| Feature | Notes |
|---|---|
| Run Map | Normal and Expert; parameters up to 8192 characters |
| Compile Window | A separate CMD window; failure detection; total time |
| Expert Compile | Import commands from a `.cfg` |
| Pointfile on leak | Rainbow path, camera at the end, selects the leaking entity |
| Cordon compile | Compiles only the cordoned region; multiple cordons |
| `map_edit` command | Engine → Hammer communication; Hammer++ ignores version checks |

### 2.11 Application features

Crash recovery, autosave, DPI scaling, background images, Discord RPC, MP3/OGG playback,
model hotload, keybind editor, colour picker palette, `-nomessagewnd`, `-noaddons` (GMod),
`-jolt` (Jolt physics), `-nomsgbox`. These do not change a map. The file-level equivalents
are backups, `dryRun`, and the compile/test tools.

## 3. Settings that change whether the map works

### 3.1 I/O delimiter — the silent killer

Hammer++ writes entity outputs either as comma-separated fields or with the ESC byte
(`\x1b`) between them. The setting is `IOParamNewDelimiter` in
`bin/hammerplusplus/hammerplusplus_settings.ini`, exposed as **Use special I/O delimiter
(ESC)**.

- **L4D2 needs the comma form.** `IOParamNewDelimiter=0`.
- Garry's Mod uses ESC by default; L4D2 does not. A map saved with ESC on compiles and every
  output silently does nothing — doors, triggers, finales, changelevels.
- The project's writer uses commas. `read_vmf_lint` reports `io-esc-delimiter`;
  `normalize_vmf_io` rewrites an affected VMF and explains that the next Hammer++ save will
  put the ESC bytes back unless the setting is turned off.
- This install was found with `IOParamNewDelimiter=1` and was changed to `0`; a backup is at
  `hammerplusplus_settings.ini.hsmcp-bak`.

### 3.2 Brush precision (`vertices_plus`)

Hammer++ saves the exact face loop in a `vertices_plus` block inside a side, in addition to
the planes and texture axes the compilers read. The block prevents vertex drift between
sessions. A stale block is worse than none: Hammer++ draws the brush where it used to be.
The writers here update `vertices_plus` when they move geometry and drop it when a clip
changes the loop; Hammer++ regenerates it on save.

### 3.3 Other settings that matter

| Setting | Why |
|---|---|
| Game directory / executable | Wrong path → `Unable to find gameinfo.txt` |
| Build programs | Stock or Tools++; an x64 tool on a 32-bit game can fail at the second stage |
| FGD | `left4dead2.fgd` + `toolsplusplus.fgd`; a wrong FGD reports real classes as unknown |
| `Enable4WayBlends` | Only useful if the engine/shaders support it; L4D2 support must be verified per material |
| Instance collapse hidden | `InstanceCollapseHidden=1` restores old behaviour; hidden instance objects otherwise do not compile |
| 3D sky preview | Requires the skybox section to be an instance with a `sky_camera` |
| HDR lighting preview | On by default; L4D2 uses up to x8 tonemap scaling, which is why LDR preview looked wrong in dark areas |
| `-steam` in launch options | Removed from L4D2 defaults; keep it out |

## 4. Hammer++ data in a VMF

The writers splice, so unknown root blocks survive. These blocks are Hammer++'s:

| Block / key | Meaning | What the toolkit does |
|---|---|---|
| `vertices_plus` inside a side | Exact face loop | Moved with geometry; dropped when the loop changes |
| `palette_plus` | Colour-picker palette | Kept byte-for-byte |
| `colorcorrection_plus` | Colour-correction preview | Kept |
| lighting-preview blocks | Preview settings | Kept |
| background-image blocks | 2D background images | Kept |
| `cordon` blocks | One or more cordons | `set_cordon` writes the compile-relevant half |
| `editor_text` entity | Hammer++-only 3D text | `edit_vmf` can write it; no in-game effect |
| `spawnflags`/`flags`/`contents` on faces | Surface/contents flags saved since 8870 | Keep them when editing faces |

A VMF written by this project uses planes and texture axes only; Hammer++ derives
`vertices_plus` when it saves. That is valid, but a VMF that has been through Hammer++ and
then through a writer is a mixed file: the writer must preserve the blocks it does not
understand.

## 5. Tools++ — the compilers

Tools++ is a separate download (`tools++_windows.zip`). Since October 2026 the tools are
standalone; point Hammer's Build Programs at them. The project's `run_compile` uses the
`plusplus` chain by default and falls back to stock, naming the chain that ran.

### 5.1 VBSP++

- L4D2: `-l4d2` (or appid detection from `gameinfo.txt`).
- Static-prop format: `-staticpropformat 9` for L4D2 (v9); v7/v8 are L4D1, v10 TF2.
- `-simpleladders` for L4D2's `func_simpleladder` format.
- `-leaktest` is on by default; `-noleaktest` disables it.
- Limit relief: brushes/brushsides/verts reduced 10–30% once over the limit; planes up to
  40%; no t-junction limit; no detail-prop limit; overlays 8192; internal entity limit
  65536; switchable lights 96.
- `-blocksize` (default 1024) trades vis speed against vertex count; `-cullverts`,
  `-cullplanes`, `-cullbrushes`, `-cullbrushsides` prune even below the limit.
- `-nobevel` and `func_nobevel` skip bevel brushsides for angled geometry; `func_nobevel`
  is the safe per-area form.
- New entities: `func_detail_illusionary`, `func_detail_blocker`, `func_instance_io_proxy`,
  `parallax_obb`.
- Material parameters: `%compileNoShadows`, `%compileTeam`, `%compileNormal`,
  `%inheritbumpmap`, `%alphatexture`.
- Diagnostics: `-missingmaterial`, `-forcematerial`, `-propdebug`, `-entfirst`,
  `-report_search_paths`, `-warnMissingInstances`.
- Cubemaps: `-nohdrcubemap`, `-noldrcubemap`, `-nodefaultcubemap`.
- `-maxluxelscale`, `-maxlightmapdim`, `-defaultluxelsize`, `-maxdisplightmapdim`.
- `-allowdynamicpropsasstatic`, `-blocksize 0`, `-singleplayer`, `-csgo`, `-portal2`,
  `-asw`.

### 5.2 VVIS++

50%–2700% faster, same output. AVX2/AVX512 paths, up to 64 threads. It fixes radial-vis
FarZ handling for `env_fog_controller`. This is the reason a full compile can be minutes
instead of hours.

### 5.3 VRAD++

- GPU raytracing (RTX 2000+/RX 6000+/Arc), CPU fallback; `-cpu`, `-gpusoftwarert`.
- `-both` shares LDR/HDR data; `-ldr`/`-hdr` compile one mode; LDR is the default.
- Ambient occlusion: `-ambientocclusion`/`-ao`, `-aoradius`, `-aoscale`, `-aopropsamples`,
  `-aofacesamples`, `-aodebug`.
- QMC sampler; `-final` is `-extrasky 8` by default.
- Soft lights with `_light_radius`, `-extrasoft`.
- `light_projected` and `light_directional` (renamed to `light_spot` after compile).
- Texture shadows: `-textureshadows`, `-worldtextureshadows`, `-translucentshadows`,
  `-forcetextureshadows`, `%alphatexture`.
- Light culling, unlimited lights, `-StaticPropSampleScale`, `-dispsamplefactor`,
  `-disppatchsamplefactor`, `-indirectonly`, `-LargeDispSampleRadius`.
- L4D2/Portal 2/HL2 BSP formats; static-prop formats v7–v14.

### 5.4 BSPZIP++ and StudioMDL++

- BSPZIP++: multi-threaded LZMA, `-threads`, no compression for `.mp3`, `.wav`, `.ogg`,
  `.ani`, `.vcs`; supports maps over soft limits; shared LDR/HDR data.
- StudioMDL++: macros, `if/else`, `$endmacro`, `$retarget`, 32 MB output, unlimited
  vertices/materials, `$bbox`, `-cullanims`, better error locations.

## 6. L4D2-specific Hammer++ notes

- L4D2's stock `left4dead2.fgd` is small (105 declarations) and includes `base.fgd`; the
  loaded FGD has **446 classes**. `read_fgd_class` is the authority; a class missing from
  the FGD may still exist in the engine (`logic_script` is the famous example).
- `trigger_finale` keys: `type` (0 standard, 1 gauntlet, 2 custom, 4 scavenge),
  `ScriptFile`, `StartDisabled`, `FirstUseDelay`, `UseDelay`, `IsSacrificeFinale`,
  `VersusTravelCompletion`, `model` (default `models/props_misc/german_radio.mdl`).
  Inputs include `ForceFinaleStart`, `AdvanceFinaleState`, `FinaleEscapeFinished`,
  `GauntletStopPanic`; outputs include `FinaleStart`, `FinaleEscapeStarted`,
  `EscapeVehicleLeaving`, `FinaleWon`, `FinaleLost`.
- `func_nav_attribute_region` keys: `spawnFlags` with the L4D2 flags (2 Empty, 32
  Battlestation, 64 Finale, 128 Mission Start, 256 Battlefield, 1024 Not Clearable,
  2048 Checkpoint, 4096 Obscured, 8192 No Mobs, 32768 Rescue Vehicle, 65536 Rescue Closet,
  524288 No Threat, 1048576 Lying Down), plus `mob_only`, `precise`, `remove_attributes`,
  `crouch`, `stairs`, `tank_only`.
- `info_map_parameters` is the map's item-density table: Adrenaline, Ammo, Chainsaw,
  ConfigurableWeaponClusterRange/Density, Defibrillator, FinaleItemClusterCount, GasCan,
  ItemClusterRange, Magnum, MeleeWeapon, Molotov, OxygenTank, PainPill, PipeBomb, Pistol,
  PropaneTank, Upgradepack, VomitJar. Values are items per 100×100 yards; 6.48 is the
  common default.
- `prop_door_rotating_checkpoint` is the safe-room door class; the engine looks up the
  names `checkpoint_exit` and `checkpoint_entrance`.
- `info_survivor_position` is not only a rescue point: a below-ground start needs four of
  them or the Director cannot place the survivors.
- `info_zombie_border` stops spawns behind it; `info_zombie_spawn` names a population.
- `trigger_escape` is the volume that tells the finale whether survivors can escape;
  `trigger_standoff` is the L4D2 holdout trigger.
- `logic_director_query` fires outputs based on the Director's anger.

## 7. What the agent can and cannot do with the editor itself

There is no headless Hammer++ CLI and no supported automation API. `map_edit` is engine →
editor, not a control channel. The agent therefore works at the file level and verifies
with the real compilers and the real game:

| Need | How the agent does it |
|---|---|
| Create/edit geometry, entities, I/O, instances, visgroups, cordons | Writers and splices in `src/maps/typescript/vmf/` |
| See the map without the game | `render_vmf_view`, `render_vmf_plan`, `render_vmf_tour` |
| See the map in the editor | `open_in_hammer` launches Hammer++ and captures its window |
| Read the editor's settings | `read_hammerpp` parses the INI, game config, build programs and keybindings |
| Create/edit entities in the open editor | `hammer_live_edit` uses the shell channel (`WM_COPYDATA`), entity-level and undoable |
| Save/undo/redo/Run Map from the editor | `hammer_menu` posts the editor's own `WM_COMMAND` ids |
| See the map in the game | `run_map_test` screenshot, `run_campaign_gate` screenshots |
| See a texture | `preview_asset` (VTF → PNG) |
| See a model | `read_model_info` bounds, `preview_asset` HLMV capture; **HLMV's 3D canvas is blank on some desktops**, so bounds + materials are the reliable half until a preview-map fallback exists |
| Judge lighting/fog/sky | Lighting Preview is editor-only; `run_map_test` is the real oracle |
| Physics posing, gizmo, pivot, drag-select, constraints | These are mouse operations; the file result is position/angles, which `edit_vmf`/`transform_solids` write |
| Keybinds, Discord RPC, MP3, autosave | Application state; not map data |

**The honest boundary:** every *map* feature is reachable. The editor's viewport, its mouse
interactions and its aesthetic judgement are not tools; they are a person at a screen. When
the agent needs to see, it renders the file or screenshots the game.

### 7.1 The live shell channel

Hammer and Hammer++ have a hidden window named `Worldcraft_ShellMessageWnd`. A
`WM_COPYDATA` message carries an ANSI text command; a `WM_COMMAND` on the main window runs a
menu id. This is the editor's public shell interface, documented by Valve in
`editor_sendcommand.cpp` and used by Hammer-MCP.

| Command | Effect |
|---|---|
| `session_begin <map> <mapversion>` | Open an edit session on the saved VMF |
| `session_end` | Close it |
| `entity_create <class> x y z` | Create a point entity |
| `entity_delete <class> x y z` | Delete it |
| `entity_set_keyvalue <class> x y z "key" "value"` | Set a keyvalue |
| `entity_rotate_incremental <class> x y z pitch yaw roll` | Rotate it |
| `node_create` / `node_delete` / `nodelink_create` / `nodelink_delete` | Node graph |

The channel is **write-only and entity-level**: entities are addressed by class + origin,
there is no move, no brush creation and no read-back. The answer is accepted/rejected, not a
value. The VMF readers and writers remain the geometry path; the shell channel is the live
"put this in the open editor, in its undo history" path.

Real commands in this project: `hammer_status`, `hammer_live_edit`, `hammer_menu`.

## 8. Feature → tool matrix

`docs/reference/hammer-parity.md` is the command-by-command table. This is the same
question asked of the Hammer++-specific layer.

| Hammer++ feature | Tool / answer | Status |
|---|---|---|
| File new/open/save/export | `write_vmf`, `read_vmf`, writers, `export_vmf_map` | verified |
| Brush primitives, polygon, arch | `write_vmf_solid` (box/wedge/cylinder/convex/cone/stairs/arch/sphere/torus) | verified for primitives; compound shapes checked by `read_vmf_solids` |
| 3-point clip, entity clip | `clip_solids` (plane clips, repeated) | verified: two cuts, four pieces, vbsp clean |
| Vertex edit / UV lock | `move_vertices`, `transform_solids` | verified: a moved edge, a rotation with texture lock and a non-uniform scale all compiled |
| Merge / hollow / move to floor | `merge_solids`, `hollow_solids`, `move_to_surface` | verified |
| Cordon / visgroups / groups | `set_cordon`, `set_visgroup`, `group_solids` | verified for the cordon: `run_compile` filters the copy, and the outside leak disappears from the BSP |
| Instances, create from selection, prefab | `write_instance`, `create_instance_from_selection`, `insert_prefab` | verified |
| Propper++ (brush → model) | `brush_to_model`: VMF planes → SMD + QC, VMF UVs, brush or box collision; `run_studiomdl` compiles it | verified with the real compiler (`.phy`, `read_model_info`) |
| Hotspot texturing | `read_rect` / `write_rect` for the `.rect` file; `align_faces(fitRect)` maps a face onto one rectangle | verified: the UV range matches the rectangle exactly; L4D2 ships no `.rect`, so the grammar round-trip is the file oracle |
| Texture browser/face sheet | `read_game_content`, `set_face_material`, `align_faces`, `set_face_uv` | verified |
| Smoothing groups / lightmap scale | `set_smoothing_groups`, `set_lightmap_scale` | verified: mask 4096 and scale 32 read back from FACES |
| Overlays | `write_overlay` | verified: vbsp accepted an overlay in the sealed-room compile test |
| Entity tool / properties / I/O | `edit_vmf`, `read_entity_report`, `validate_io` | verified |
| `editor_text` | `edit_vmf` | tool (no in-game effect) |
| Color picker | `edit_vmf` `rendercolor` | verified |
| Lighting/fog/sky/particle/rope/render preview | No editor viewport; `render_vmf_*`, `run_map_test`, `read_lightmap_budget` | partial (view-only) |
| 3D skybox | `build_skybox` copies, seals the room and places `sky_camera`; `write_sky_camera`/`write_skybox_copy` are the halves | verified by vbsp; the view is still the eye's |
| Model/particle/sound browsers | `read_game_content`, `read_model_info`, `read_asset_catalog` | verified |
| Model hotload | `preview_asset` re-reads; no live editor | view-only |
| Physics tool | Entity origin/angles via `edit_vmf`; brush posing is not saved | view-only |
| Compile window / expert compile | `run_compile`, `read_compile_log` | verified |
| Pointfile | `read_leak` | verified |
| Tools++ flags/limits | `run_compile` (`toolchain: "plusplus"`), `read_map_geometry`, `read_map_report` | verified |
| Crash recovery/autosave, keybinds, Discord, MP3 | Application state | not applicable |
| Propper++ atlas/merge | `brush_to_model` covers several solids, per-material SMD groups and `$concave`; a texture atlas is a Propper++ convenience, not something a map needs | optional |
| 4-way displacement blends | `paint_displacement`/`sculpt_displacement` can write alpha; engine support unverified | **gap (verification)** |

## 9. Priority backlog from this pass

1. **Hotspot / `.rect` lookup.** The result is U/V; a small reader could map a face to a
   rectangle from `$rectanglemap`. The last Hammer++ data format with no path here.
2. **4-way blends.** Verify whether L4D2 shaders support them before offering a writer.
3. **Editor launch/capture.** Done: `open_in_hammer` launches Hammer++ on a VMF and returns
   a real capture of the editor viewport. It is a look, not a control channel; the UI is
   still a person at a mouse.
4. **Settings reader.** Done as `read_hammerpp`: the INI by section, the game configuration
   and build programs, the FGD mount and the keybinding count.
5. **Propper++ and the model preview.** Done: `brush_to_model` writes the SMD/QC the compiler
   reads, and `preview_model` builds a sealed room when HLMV's canvas is blank.

The rest of Hammer++ is either already reachable at the file level or is a mouse
interaction whose result the writers already express.
