# Cubemaps and skyboxes

6 tools: building and converting cubemaps, six-face skyboxes and the sky_camera.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Cubemaps and skyboxes

| Tool | What it does |
|---|---|
| `build_skybox` | Builds a complete 3D skybox from a selection: copies the brushes at 1/scale around the map origin, moves the copy to a free area outside the playable map, encloses it in a sealed room textured TOOLS/TOOLSSKYBOX, and places the single sky_camera at the scaled origin. |
| `run_build_cubemaps` | Builds a map's cubemaps with the engine's `-buildcubemaps` launch mode: the game loads the map, captures every cubemap sample, writes .vtf files and quits. |
| `run_cubemap2hdr` | Converts an LDR cubemap .vtf into the HDR one Source loads in HDR mode, writing <name>.hdr.vtf beside it. |
| `run_tga2skybox` | Builds a cubemap .vtf from six TGA faces -- <base>rt.tga, lf, bk, ft, up, dn -- and writes both the LDR and the HDR set. |
| `write_sky_camera` | Places the single `sky_camera` a 3D skybox needs, with its origin, angles and scale. |
| `write_skybox_copy` | Copies selected brushes into a 3D skybox: scales the copy by 1/scale (16 by default) around the map origin and moves it so that origin lands at targetOrigin, which is where sky_camera should sit. |
