# Particle files (`.pcf`)

A `.pcf` is a DMX (`format=pcf`, usually version 2) that holds particle-system
definitions. A map points `info_particle_system` at one of those names; a missing or renamed
system shows nothing and no compiler complains. `read_particle` lists what is inside;
`write_particle` builds or rewrites the file.

## Reading

`read_particle` takes either a loose `path` or a `gameDir` + `filePattern`. It returns every
system's:

- `children` — other systems in the same file (the map drives them with `cpoint1`..`cpoint8`);
- `materials` — the VMT names in option values containing `material`;
- `renderers`, `initializers`, `emitters`, `forces`, `constraints`, `operators` — each with
  its `function` and scalar options;
- `optionKeys` and `options`.

`includeOperators: false` gives a compact name/material list when that is all the check
needs.

## Writing

`write_particle` takes a list of systems:

```json
{
  "path": "particles/my_fx.pcf",
  "systems": [
    {
      "name": "my_smoke",
      "options": { "material": "particle/my_smoke", "max_particles": 64 },
      "renderers": [
        { "name": "render", "function": "render_animated_sprites",
          "options": { "texture": "particle/my_smoke" } }
      ],
      "initializers": [
        { "name": "life", "function": "init_life_time",
          "options": { "min_life_time": 1.0, "max_life_time": 2.0 } }
      ],
      "children": ["my_smoke_child"]
    },
    { "name": "my_smoke_child", "options": { "material": "particle/my_smoke" } }
  ]
}
```

Options are plain JSON strings, numbers, booleans or numeric vectors. For a type JSON cannot
express, use `{ "type": "int|float|bool|string|vector2|vector3|vector4|color|time",
"value": ... }`.

Child names must be systems in the same file. The writer points at the same elements, not
copies, and refuses a duplicate or missing name.

### Rewriting a stock file

```json
{ "path": "particles/my_fire.pcf", "source": "particles/fire_01l4d.pcf" }
```

`source` may be a loose path or a game-relative `particles/*.pcf` resolved through the game
profile. This is the safest way to start from a working Valve system: rewrite it, then change
one option. A stock file can contain a child reference to a system that is not in it; such a
dangling child cannot be represented, so it is dropped and named in `warnings`. Use
`read_particle` on both files to compare.

## What the writer guarantees

- The file is binary PCF version 1 or 2 (`formatVersion`, default 2) and is parsed back with
  the PCF reader before the call returns; `verified` says the system set survived.
- `systemCount`, per-system child lists and operator counts are returned.
- The child graph is by element reference, not by name at load time after the write.

## Pitfalls

- **A material is an option, not a file.** `material` names a VMT; the `.vmt` and `.vtf` are
  separate files. `preview_asset` checks the texture.
- **Children are same-file.** A child in another `.pcf` is not a cross-file reference in this
  format; include the system in the same file.
- **No in-game visual proof yet.** The writer is tested by round-tripping a stock
  `fire_01l4d.pcf` and by parsing the result, not by watching the particles render. Treat a
  new effect as visually unverified until `run_map_test` shows it.
- **The engine caches particles.** A changed `.pcf` may need a map reload (or a game
  restart) before a `info_particle_system` shows the new version.
