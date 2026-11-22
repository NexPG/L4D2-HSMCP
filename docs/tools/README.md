# Tools by area

277 tools. One area is one logical job — VMF authoring, compilation, BSP analysis,
rendering, the runtime harness, and so on — not a source directory and not a bucket for
several jobs. A new kind of tool gets a new row and a new page.

This page is generated from the registry by `pnpm docs:tools`; edit a tool's description,
not this file.

| Area | Covers | Tools | Reference |
|---|---|---:|---|
| VMF authoring | source maps: files, entities, brushes, faces, lighting, overlays, instances, terrain and weather | 85 | [vmf.md](vmf.md) |
| Map compilation | running vbsp/vvis/vrad, the Hammer++ chain, compile logs and sequences | 7 | [compilation.md](compilation.md) |
| Map audit and rules | reviewing a source map, map rules, missing assets and dependencies | 4 | [audit.md](audit.md) |
| Compiled maps (BSP) | BSP lumps, entity lumps, pakfile, static props, map rename and compiled-map reports | 12 | [bsp.md](bsp.md) |
| Rendering and measurement | offline views and plans, room/space measurement, visibility and sight lines | 20 | [rendering.md](rendering.md) |
| Navigation | nav areas, attributes, connections, hiding spots, encounters, path and sight queries | 16 | [nav.md](nav.md) |
| Models | compiled MDL/VVD/VTX/PHY, decompiling and compiling, QC/SMD, collision, animation, LODs and effects | 28 | [models.md](models.md) |
| Textures (VTF) | reading, writing, converting and extracting VTF textures | 8 | [textures.md](textures.md) |
| Materials (VMT and PBR) | VMT read/write, engine-read checks, PBR parameters and the game's surface properties | 7 | [materials.md](materials.md) |
| Cubemaps and skyboxes | building and converting cubemaps, six-face skyboxes and the sky_camera | 6 | [cubemaps.md](cubemaps.md) |
| Screens and UI | loading screens, VGUI HUD .res screens and Hammer++ .rect hotspot rectangles | 5 | [ui.md](ui.md) |
| Particles | particle systems, their materials and map effect references | 3 | [particles.md](particles.md) |
| Game content | searching the game's VPKs, localization and asset previews | 6 | [content.md](content.md) |
| Audio | soundscripts, soundscapes and WAV | 7 | [audio.md](audio.md) |
| Choreography and scenes | VCD timelines, actor channels, events and the scenes.image summary | 2 | [choreo.md](choreo.md) |
| Campaigns | mission files, modes, finales, gates, posters and campaign scaffolding | 19 | [campaigns.md](campaigns.md) |
| VScript authoring | Squirrel source: writing and checking .nut files, DirectorOptions and include paths | 2 | [vscript.md](vscript.md) |
| Runtime harness | launching and probing the game: run_map_test, nav generation, console commands and class/nav probes | 5 | [runtime.md](runtime.md) |
| Hammer editor | editor status, Hammer++ settings, launching, window capture and HLMV | 5 | [hammer.md](hammer.md) |
| Live editing | editing the open map through Hammer's shell channel, and the staged approval queue | 7 | [live.md](live.md) |
| Input automation | synthetic key presses for interactions a console command cannot express | 1 | [input.md](input.md) |
| Addons | addoninfo, scaffolding, validation, installation and Workshop metadata | 9 | [addons.md](addons.md) |
| VPK and pakfile | building, reading, extracting and verifying VPK archives, and editing a map's pakfile | 5 | [vpk.md](vpk.md) |
| Shared formats | DMX datamodels | 2 | [formats.md](formats.md) |
| Configuration and health | toolchain health and the stored add-on author | 3 | [configuration.md](configuration.md) |
| Game discovery | how Left 4 Dead 2 was found on this machine | 1 | [games.md](games.md) |
| File and text primitives | path resolution and raw UTF-8 text files | 2 | [text.md](text.md) |
| **Total** | | **277** | |

Each area page has logical tables inside it (for example, “Geometry”, “Faces, lighting,
overlays and terrain” and “Instances and prefabs” inside VMF authoring).
