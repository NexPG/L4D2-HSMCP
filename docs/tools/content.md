# Game content

6 tools: searching the game's VPKs, localization and asset previews.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Content catalogue and previews

| Tool | What it does |
|---|---|
| `preview_asset` | Returns a real image of one stock material or model, so the agent can look at the asset instead of guessing from its name. |
| `read_asset_catalog` | The stock model categories Hammer++'s model browser shows, in one call: escalators, stairs and steps, doors, vehicles, foliage, street furniture, interiors, lights and signs, each with its real count and a bounded sample. |
| `read_game_content` | Searches the game's installed content for materials and models, by name, or browses a whole kind when the pattern is empty. |
| `read_localization` | Reads a `lang`/`Tokens` file: detected encoding (UTF-16LE/BOM or UTF-8), language, every token and duplicate count. |
| `read_model_info` | Bounds, skins, sequences and materials of one .mdl -- what Hammer's model viewer shows before you place a prop, plus what the viewer does not: per-sequence events and activities, per-skin material tables, hitbox geometry, body-part model names, $cdmaterials, surfaceprop, mass, flex descriptor/controller/rule counts,... |
| `write_localization` | Writes or updates a Valve localization file (`"lang" { "Language" ... |
