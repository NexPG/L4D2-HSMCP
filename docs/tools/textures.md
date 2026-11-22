# Textures and materials

19 tools: VTF encode/decode, VMT, PBR checks, cubemaps, skyboxes and loading screens.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## VTF

| Tool | What it does |
|---|---|
| `convert_vtf` | Rebuilds an existing 2D .vtf in another format or size: decode, optional resize (power-of-two), re-encode as BGRA8888/RGBA8888/BGRX8888/DXT1/DXT5, regenerate the mip chain, save and read back. |
| `extract_vtf` | Decodes a .vtf's first mip to a PNG the agent can look at, optionally downscaled and written to `out`. |
| `read_vtf` | Reads a `.vtf` header: version, dimensions, flags, frames, format name and whether it is a cubemap. |
| `run_vtf_convert` | Converts an image (.tga, .png, .bmp, .jpg ...) into a .vtf the engine can load, written beside the source. |
| `write_cubemap_vtf` | Builds a six-face cubemap .vtf from six PNGs, with the VTF CubeSide order stated explicitly (right, left, back, front, up, down). |
| `write_vtf` | Turns a PNG into a .vtf the engine can load, without VTFCmd or vtex. |

## VMT and material checks

| Tool | What it does |
|---|---|
| `check_vmt` | Checks a .vmt as the engine will read it: known shader, `$basetexture` for a non-patch material, no filesystem path or .vtf suffix in the texture name, numeric %compile flags, duplicate keys and repaired braces. |
| `read_materials` | Material table of a compiled map: every texture referenced by a TEXINFO, and how many TEXINFO entries reuse it -- the only accurate reuse count in the file. |
| `read_vmt` | Reads a .vmt material: shader, parameters, nested blocks (Proxies, patch insert/replace), the textures it names, the %compile* flags that decide brush solidity, and the include of a patch. |
| `write_vmt` | Writes a .vmt material from a shader and a tree of parameters. |

## Cubemaps and skyboxes

| Tool | What it does |
|---|---|
| `build_skybox` | Builds a complete 3D skybox from a selection: copies the brushes at 1/scale around the map origin, moves the copy to a free area outside the playable map, encloses it in a sealed room textured TOOLS/TOOLSSKYBOX, and places the single sky_camera at the scaled origin. |
| `run_build_cubemaps` | Builds a map's cubemaps with the engine's `-buildcubemaps` launch mode: the game loads the map, captures every cubemap sample, writes .vtf files and quits. |
| `run_cubemap2hdr` | Converts an LDR cubemap .vtf into the HDR one Source loads in HDR mode, writing <name>.hdr.vtf beside it. |
| `run_tga2skybox` | Builds a cubemap .vtf from six TGA faces -- <base>rt.tga, lf, bk, ft, up, dn -- and writes both the LDR and the HDR set. |
| `write_sky_camera` | Places the single `sky_camera` a 3D skybox needs, with its origin, angles and scale. |
| `write_skybox_copy` | Copies selected brushes into a 3D skybox: scales the copy by 1/scale (16 by default) around the map origin and moves it so that origin lands at targetOrigin, which is where sky_camera should sit. |

## Screens and UI

| Tool | What it does |
|---|---|
| `read_rect` | Reads a Hammer++ `.rect` hotspot file: the sub-rectangles of a trim-sheet texture that can be fitted to faces. |
| `write_loading_screen` | Turns a PNG into a UI material pair: a `.vtf` and an `UnlitGeneric` `.vmt` under the given `materials` directory. |
| `write_rect` | Writes a Hammer++ `.rect` hotspot file. |
