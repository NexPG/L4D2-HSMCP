# Game assets

11 tools: what the game's VPKs contain, surface properties, particles and previews.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Content catalogue and game data

| Tool | What it does |
|---|---|
| `check_surfaceprop` | Checks a surface property against the game's own table. |
| `read_asset_catalog` | The stock model categories Hammer++'s model browser shows, in one call: escalators, stairs and steps, doors, vehicles, foliage, street furniture, interiors, lights and signs, each with its real count and a bounded sample. |
| `read_game_content` | Searches the game's installed content for materials and models, by name, or browses a whole kind when the pattern is empty. |
| `read_localization` | Reads a `lang`/`Tokens` file: detected encoding (UTF-16LE/BOM or UTF-8), language, every token and duplicate count. |
| `read_model_info` | Bounds, skins, sequences and materials of one .mdl -- what Hammer's model viewer shows before you place a prop, plus what the viewer does not: per-sequence events and activities, per-skin material tables, hitbox geometry, body-part model names, $cdmaterials, surfaceprop, mass, flex descriptor/controller/rule counts,... |
| `read_surfaceprops` | Reads the game's `scripts/surfaceproperties_*` table: the manifest, every property block, its `base` inheritance chain and the physics/sound fields the engine uses (`gamematerial`, density, friction, elasticity, thickness, impact sounds). |
| `write_localization` | Writes or updates a Valve localization file (`"lang" { "Language" ... |

## Particles

| Tool | What it does |
|---|---|
| `check_particle` | Checks a loose `.pcf`: systems read, child references resolve to systems in the same file, and every renderer material exists as a `.vmt` under one of `materialsDirs` when given. |
| `read_particle` | Reads a .pcf particle file, or searches the game's particles/*.pcf, and lists every system: child references, renderer/initializer/emitter/force/constraint operators and the materials it draws. |
| `write_particle` | Builds a binary .pcf particle file from JSON and reads it back. |

## Model preview

| Tool | What it does |
|---|---|
| `preview_asset` | Returns a real image of one stock material or model, so the agent can look at the asset instead of guessing from its name. |
