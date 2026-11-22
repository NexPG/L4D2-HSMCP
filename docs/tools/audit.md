# Map audit and rules

4 tools: reviewing a source map, map rules, missing assets and dependencies.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Audit and rules

| Tool | What it does |
|---|---|
| `check_vmf_rules` | Checks a .vmf against ITS OWN rules file -- `<map>.rules.json`, a sibling of the .vmf. |
| `read_map_dependencies` | Every asset a compiled map references, and where each will come from at runtime: packed inside the map, found in the game's own content, or missing. |
| `read_map_report` | Judges a compiled map against a budget profile and returns a verdict per criterion, not just numbers. |
| `review_map` | Audits a map in one call: FGD lint, its own rules file, organisation, and -- when a compiled .bsp sits beside it -- the budget report, lightmap and visleaf statistics and the asset dependency walk. |
