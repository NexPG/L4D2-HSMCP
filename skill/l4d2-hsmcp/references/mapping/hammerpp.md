# Hammer++ for L4D2: the working notes

The full inventory is `docs/reference/hammerpp-complete-reference.md`. This is the page to
read before touching the editor's settings or trusting a VMF that came out of Hammer++.

## The three settings that decide whether the map works

1. **I/O delimiter.** L4D2 needs commas. In
   `bin/hammerplusplus/hammerplusplus_settings.ini`, `IOParamNewDelimiter=0` (Options →
   `Use special I/O delimiter (ESC)` off). ESC-separated outputs compile and silently do
   nothing. `health` reports the setting; `read_vmf_lint` reports `io-esc-delimiter`;
   `normalize_vmf_io` repairs a file.
2. **The right build.** Plain L4D2 is 32-bit; current Hammer++ builds are x64. Use the last
   **x86** build or the `x86-64` beta. A 64-bit editor can save the VMF, but its bundled
   tools may not match the game.
3. **The right FGD.** `left4dead2.fgd` + `toolsplusplus.fgd` (or `L4D2-FGD-Edits`). The
   loaded FGD has 446 classes. `logic_script` is missing from the stock FGD but the engine
   runs it; `read_fgd_class` is the authority, not a class list from memory.

## Tools++ in one table

| Tool | L4D2-relevant switches |
|---|---|
| VBSP++ | `-l4d2`, `-staticpropformat 9`, `-simpleladders`, `-leaktest` (on), `-blocksize`, `-cullverts`, `-cullplanes`, `-cullbrushes`, `-cullbrushsides`, `-nobevel`, `func_nobevel`, `func_detail_illusionary`, `func_detail_blocker`, `-missingmaterial`, `-forcematerial`, `-maxluxelscale` |
| VVIS++ | 50–2700% faster, same output, AVX2/AVX512, 64 threads |
| VRAD++ | GPU raytracing (`-cpu` fallback), `-both` shared LDR/HDR, `-ambientocclusion`, `-textureshadows`, `-worldtextureshadows`, `-translucentshadows`, `light_projected`, `light_directional`, `-StaticPropSampleScale`, `-dispsamplefactor` |
| BSPZIP++ | Multi-threaded LZMA; does not compress `.mp3`/`.wav`/`.ogg`/`.ani`/`.vcs`; handles maps over soft limits |
| StudioMDL++ | Macros, `if/else`, `$endmacro`, `$retarget`, 32 MB output, unlimited vertices/materials |

`run_compile` uses the `plusplus` chain by default and names the chain that actually ran.
`read_map_geometry`/`read_map_report` are the budget oracles.

## What Hammer++ adds to the VMF

- `vertices_plus` inside a side — the exact face loop. The writers move it with geometry and
  drop it when a clip changes the loop; Hammer++ regenerates it on save.
- `palette_plus`, `colorcorrection_plus`, background-image blocks, lighting-preview blocks
  — editor state; kept byte-for-byte.
- `editor_text` — a Hammer++-only entity with no in-game effect.
- `func_instance_io_proxy` — Tools++/VBSP++ support for I/O crossing an instance.
- Multiple cordons — `set_cordon` writes the compile-relevant half.

## The editor-only layer

Lighting, fog, 2D/3D sky, particles, ropes, render effects, material proxies, `env_sun`,
beams, `point_spotlight`, lightmap view, gizmo, pivot, drag-select, physics posing and
hotspot texturing are **views or mouse operations**. They do not change what a compiled map
contains. The agent's substitutes are:

- `render_vmf_view` / `render_vmf_plan` / `render_vmf_tour` — the file, without the game.
- `run_map_test` with `method: "screen"` — the real game, with a screenshot.
- `preview_asset` — a texture as PNG; a model through HLMV (the 3D canvas may be blank).
- `read_lightmap_budget`, `read_visleaf_stats`, `read_sightlines` — the numbers behind the
  previews.

**Not a gap in map content**, but a real gap in the agent's eyes: HLMV's blank canvas and
Propper++-style brush → model authoring. See the priority list in the full reference.

## What to do when a Hammer++-saved map misbehaves

1. `health` — editor present, settings present, `ioEsc`.
2. `read_vmf_lint` — `io-esc-delimiter`, FGD classes, invalid solids, door/prop/finale rules.
3. `read_vmf_leak` — sealed before a compile.
4. `run_compile` — `plusplus`, and read the per-stage findings.
5. `run_nav_generate` — `fresh: true` and `stringtableDictionary: true`.
6. `nav_trouble_report` — the engine's own checks, with the selected areas' coordinates.
7. `check_finale` — type, script, stage count, FINALE area, escape outputs.
8. `run_campaign_gate` — all of the above plus a map test with the exact pair.
