# Materials (VMT and PBR)

6 tools: VMT read/write, engine-read checks, PBR parameters and the game's surface properties.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## VMT and surface properties

| Tool | What it does |
|---|---|
| `check_surfaceprop` | Checks a surface property against the game's own table. |
| `check_vmt` | Checks a .vmt as the engine will read it: known shader, `$basetexture` for a non-patch material, no filesystem path or .vtf suffix in the texture name, numeric %compile flags, duplicate keys and repaired braces. |
| `read_materials` | Material table of a compiled map: every texture referenced by a TEXINFO, and how many TEXINFO entries reuse it -- the only accurate reuse count in the file. |
| `read_surfaceprops` | Reads the game's `scripts/surfaceproperties_*` table: the manifest, every property block, its `base` inheritance chain and the physics/sound fields the engine uses (`gamematerial`, density, friction, elasticity, thickness, impact sounds). |
| `read_vmt` | Reads a .vmt material: shader, parameters, nested blocks (Proxies, patch insert/replace), the textures it names, the %compile* flags that decide brush solidity, and the include of a patch. |
| `write_vmt` | Writes a .vmt material from a shader and a tree of parameters. |
