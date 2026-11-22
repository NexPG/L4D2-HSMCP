# Textures (VTF)

8 tools: reading, writing, converting and extracting VTF textures.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## VTF

| Tool | What it does |
|---|---|
| `convert_vtf` | Rebuilds an existing 2D .vtf in another format or size: decode, optional resize (power-of-two), re-encode as BGRA8888/RGBA8888/BGRX8888/DXT1/DXT5, regenerate the mip chain, save and read back. |
| `extract_vtf` | Decodes a .vtf's first mip to a PNG the agent can look at, optionally downscaled and written to `out`. |
| `read_vtf` | Reads a `.vtf` header: version, dimensions, flags, frames, format name and whether it is a cubemap. |
| `run_vtf_convert` | Converts an image (.tga, .png, .bmp, .jpg ...) into a .vtf the engine can load, written beside the source. |
| `write_cubemap_vtf` | Builds a six-face cubemap .vtf from six PNGs, with the VTF CubeSide order stated explicitly (right, left, back, front, up, down). |
| `write_vtf` | Turns one PNG, or an ordered set of PNG frames, into a .vtf the engine can load, without VTFCmd or vtex. |
| `write_vtf_hotspot` | Writes the Strata Source hotspot resource into a .vtf: rectangles in pixels that Strata uses to retexture a brush face from a texture atlas. |
| `write_vtf_particle_sheet` | Writes the particle-spritesheet resource into a .vtf: named sequences of frame rectangles that the particle system samples instead of a whole texture. |
