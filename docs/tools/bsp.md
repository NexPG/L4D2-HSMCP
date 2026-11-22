# Compiled maps (BSP)

12 tools: BSP lumps, entity lumps, pakfile, static props, map rename and compiled-map reports.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## BSP readers and writers

| Tool | What it does |
|---|---|
| `check_bsp` | Checks a compiled .bsp as a file and against its source. |
| `edit_bsp_entities` | Adds, updates or removes entities in a COMPILED .bsp -- the primitive needed for things a source map cannot express, such as point_servercommand plus logic_auto for buildcubemaps. |
| `read_bsp_entities` | Entities of a compiled .bsp, read from lump 0. |
| `read_bsp_faces` | Reads a compiled map's faces: the material, smoothing-group bitmask, lightmap footprint and texture vectors vbsp actually produced. |
| `read_bsp_info` | Header of a compiled .bsp: ident, version, mapRevision and all 64 lumps with their offset and size. |
| `read_bsp_lump` | Reads any of a .bsp's 64 lumps by name (ENTITIES, PLANES, TEXDATA, …) or index, decoding an individually LZMA-compressed lump instead of refusing it. |
| `read_nav_dump` | Reads the `<map>_nav.txt` dump the engine writes beside a generated nav mesh: every area's centre, its connections, and its attribute flags decoded — CHECKPOINT, PLAYER_START, FINALE and the computed escape route. |
| `write_bsp_lump` | Replaces one lump of a .bsp: reads bytes from `source`, `text` or `base64`, optionally LZMA-compresses them in Source's framing, appends them to the file and moves only that lump's descriptor. |

## Static props, pakfile and assets

| Tool | What it does |
|---|---|
| `check_assets` | Checks a source .vmf's references against the game's mounted content before compiling: solid materials (following `patch`/`include` and their textures), `prop_*` models (with `.vvd`/`.dx90.vtx` and the model's own materials), decals and overlays, sounds with an audio extension, `info_particle_system` effects, `logic... |
| `edit_static_props` | Adds, changes or removes props in a compiled .bsp's static-prop game lump. |
| `run_bsp_rename` | Renames a compiled .bsp AND the content packed inside it -- the nodegraph, cubemap patches, soundscripts, anything under maps/<name>/. |
| `run_pakfile_add` | Adds files to a compiled .bsp's pakfile with this server's own ZIP writer: no bspzip, no game install. |
