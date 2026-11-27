# Particle files (`.pcf`)

A `.pcf` is a DMX (`format=pcf`, usually version 2) that holds particle-system
definitions. A map points `info_particle_system` at one of those names; a missing or renamed
system shows nothing and no compiler complains. `read_particle` lists what is inside;
`write_particle` builds or rewrites the file.

## Contents

- Reading
- Children are `DmeParticleChild` wrappers
- Naming a system in the map
- Shipping a custom `.pcf`
- Writing
- What the writer guarantees
- Pitfalls

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

Typed options are kept, not flattened: a vector comes back as
`{ "type": "vector3", "value": [..] }`, a colour as `{ "type": "color", "value": [r,g,b,a] }`,
a time as `{ "type": "time", "value": seconds }`. That is exactly the shape `write_particle`
accepts, so `options` can be read from one system and written into another without losing
colour or vector values.

### Resolving a map's `effect_name`

`read_particle` with `effectName` answers the question that a map actually asks: does a system
have this name? It is exact and case-insensitive, and it flags the path form:

```json
{ "path": "particles/fire_01L4D.pcf", "effectName": "fire_barrel_big", "includeOperators": false }
```

returns `effectName.resolved: true`, while `"fire_01l4d/fire_barrel_big"` returns
`pathStyle: true, resolved: false` with the rule in `hint`.

### Renaming a copied system

`renames` renames systems while copying `source`, and rewrites the child references with them:

```json
{
  "path": "particles/my_fire.pcf",
  "source": "particles/fire_01l4d.pcf",
  "renames": { "fire_barrel_big": "my_barrel" }
}
```

This is how a stock effect becomes a new effect without reusing a name: `my_barrel` appears in
the file and in `read_particle`, and its children still point at the stock child systems. A
target must be bare and must not collide with a system that is not being renamed. The rename
is verified by reading the written file back.

What is **not** proven: in one in-game run the renamed copy registered (no unknown-particle
line) but did not visibly draw, while the stock system did. Until that is explained, treat a
renamed effect as unverified and check it with `run_map_test`.

## Children are `DmeParticleChild` wrappers

The engine reads a system's `children` as an array of `DmeParticleChild` elements, each with a
`name` and a `child` element reference. `srctools`' `Particle.export` writes the system elements
themselves there instead. A file written that way **registers** — `info_particle_system` finds
the name and no `unknown particle system` line appears — but **nothing is drawn**.

`write_particle` now rebuilds every `children` array as wrappers. Verified in game: a stock
`fire_01l4d.pcf` copied through `source`, shipped in an addon with a `particles_manifest.txt`
line and with the stock file removed from that manifest, drew fire from five
`info_particle_system` entities. Before the fix the same run was empty. The writer returns
`childWrappers` so a test can assert every child was wrapped.

A loose `.pcf` dropped into `left4dead2/particles/` is still not registered at all; ship it in
an addon with the manifest line.

## Naming a system in the map

`info_particle_system.effect_name` is the **bare system name**. Valve's own entities on
`c1m1_hotel` say `emergency_light_strobe` and `window_glass`; `fire_barrel_big` renders.

A `pcf/system` path is wrong: `fire_01l4d/fire_barrel_big` is precached as unknown — the
console says `Attempted to precache unknown particle system "fire_01l4d/fire_barrel_big"` and
`Attempting to create unknown particle system ...` — and draws nothing. Both a stock map and
the test map were proven to render `fire_barrel_big` once the prefix was removed.

## Shipping a custom `.pcf`

The engine registers particle files at startup from `particles/particles_manifest.txt` (44
lines in this install, and `fire_01L4D.pcf` is one of them). Ship a new file in an addon:

1. `particles/<name>.pcf` inside `addons/<addon>.vpk`;
2. `particles/particles_manifest.txt` in the same addon: copy the stock manifest and add
   `"file"  "particles/<name>.pcf"`.

Verified in game: with the addon mounted, `info_particle_system` pointed at a system built by
`write_particle` produced no `unknown particle system` line at all; with the addon removed the
same map and entity said `Attempted to precache unknown particle system "hsmcp_fire"`. So the
file and the manifest line do register the system.

Whether a system *rebuilt from a JSON summary* looks right is a separate question: the rebuilt
copy of `fire_barrel_big` registered but did not visibly draw. Use `source` to copy a stock
system byte-for-byte instead of rebuilding it from `systems`, and verify the result with
`run_map_test`.

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
- **In-game proof: the stock systems render, a rebuilt one may not.** `fire_barrel_big` was
  watched rendering on `c1m1_hotel` and on the test map, once `effect_name` was the bare
  system name. A system rebuilt from a JSON summary registered but did not draw, so treat a
  rebuilt effect as visually unverified until `run_map_test` shows it; copy stock systems with
  `source` instead.
- **The engine caches particles.** A changed `.pcf` may need a map reload (or a game
  restart) before a `info_particle_system` shows the new version.
