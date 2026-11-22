# Particles

3 tools: particle systems, their materials and map effect references.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Particles

| Tool | What it does |
|---|---|
| `check_particle` | Checks a loose `.pcf`: systems read, child references resolve to systems in the same file, and every renderer material exists as a `.vmt` under one of `materialsDirs` when given. |
| `read_particle` | Reads a .pcf particle file, or searches the game's particles/*.pcf, and lists every system: child references, renderer/initializer/emitter/force/constraint operators and the materials it draws. |
| `write_particle` | Builds a binary .pcf particle file from JSON and reads it back. |
