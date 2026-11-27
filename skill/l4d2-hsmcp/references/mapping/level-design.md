# Level design for a wish

The tools can make any shape. This page is the part that decides whether the shape is a
place someone can fight through. Numbers marked **measured** come from the test campaign or
the engine's own hull; the rest are starting points to adjust, not rules.

## Player metrics

| Thing | Value |
|---|---|
| Standing hull | **32 × 32 × 72** (half-extents 16,16,36) |
| Crouching hull | **32 × 32 × 36** |
| Eye height | about **64** above the floor |
| Safe-room doorway | fits the door model: 64×112 or 72×112 (see [`doors.md`](doors.md)) |
| Corridor for one survivor | at least **64** clear; **96–192** for a fight |
| Step height | **16** usual, **18** is the walk limit (see [`terrain-water-boundaries.md`](terrain-water-boundaries.md)) |
| Test arena | **768 × 512** interior, 192 tall |

Check the real clearance with `measure_vmf_clearance` and `measure_vmf_approach`; a doorway
that fits a line can still reject a 32-unit-wide body.

## One room, one decision

A room should ask the player to do one thing: push through, hold, flank, drop, or choose a
route. If a room asks nothing, cut it or merge it with its neighbour.

Per room, decide before drawing:

- **Entrances**: where the Director can spawn behind the team, and where the team enters.
- **Cover**: waist-high ~48 for shooting over; chest/head-high ~96 for blocking sight.
- **Exit**: visible from the entrance or deliberately hidden; never a maze of identical doors.
- **Ceiling**: 128–192 for a street or room, higher for a church/arena.
- **Light**: one `light` per room plus a `light_environment`; the test campaign uses
  `_light` `255 255 255 500`–`600`.

## Flow and sightlines

1. Draw the critical path first, then attach side rooms and dead ends.
2. Put the next landmark in view from the previous room: a lit doorway, a tower, a fire.
3. Long straight sightlines are for the finale or a tank; a normal corridor should bend.
4. Break sightlines with pillars, cars, fences and height changes; the test arena's four
   pillars exist so the Director has spawn areas out of sight.
5. Ensure the escape route is walkable and marked before adding the finale.

Check with `read_vmf_rooms` (rooms connect, no orphan), `read_vmf_sightlines` (what sees
what), `render_vmf_tour` (one look at the whole place), and finally the game.

Nav is the map's second geometry: the Director spawns and hides only where the mesh allows.
`read_nav_places` groups areas the way the Director does, `read_nav_hiding_spots` lists the
generated cover positions with their flags, and `read_nav_visibility` shows which areas see
which (including inherited deltas). Hiding spots are created by `nav_analyze`; do not treat
them as hand-placed entities. When a generated detail is wrong, `write_nav_hiding_spots` and
`write_nav_ladders` patch the record in place, and `write_nav_places` adds or renames a place
without renumbering the area references.

## Verticality

- Stairs or a ramp must be covered by nav; a drop taller than the hull's step height needs a
  one-way route or a ladder entity, not a brute-force ledge.
- A balcony is a combat position only if it has cover and a way down.
- Roofs and skyboxes are seen, so seal them; a visible void is a leak or a missing sky.

## A first chapter that proves the pipeline

Start with two short chapters, not a city. A workable first build:

- spawn room 256 × 256, one exit;
- one street/room 512–768 long, two cover pieces, one crescendo trigger;
- safe room 256 × 256 with a 64–128 doorway and the checkpoint door;
- arena 768 × 512 for a tank or the finale, with four pillars and a lit exit corridor.

This is close to the test campaign that already passed compile, nav, transition and finale.
Once it works end to end, add rooms and detail rather than debugging the pipeline and the
layout at the same time.

## Theme without inventing content

Query, then build:

- materials: `read_game_content(kind: "material", pattern: "<theme>")`;
- props and their real sizes: `read_game_content(kind: "model", pattern: "...", details: true)`;
- particles: `read_game_content(kind: "particle", pattern: "*")`;
- sounds: `read_game_content(kind: "sound", pattern: "...")`;
- sky: `read_game_content(kind: "material", pattern: "skybox")`, then `set_worldspawn` `skyname`.

A theme is a palette plus three repeated motifs. A swamp town is wet wood, corrugated metal,
and reeds; a hospital is tile, gurneys, and green light. Repeating three things reads as a
place; scattering twenty reads as an asset dump.

## Lighting and weather

- Indoor: `light` entities, warm or cold, one per room; no pitch-black route unless the wish
  asks for it.
- Outdoor: `light_environment` with a sun angle and colour; the sky name follows the palette.
- Fog and rain: `env_fog_controller` and `func_precipitation`; see
  `references/mechanics/weather.md`. Static checks prove the entity; only a game screenshot
  proves the look.
- Cubemaps after the final compile: `run_build_cubemaps`, then fix the reflections.

## Before you call a room done

- [ ] Sealed (`read_vmf_leak`), lint 0 (`read_vmf_lint`), rooms connect (`read_vmf_rooms`).
- [ ] Player fits through every intended route (`measure_vmf_clearance`).
- [ ] The next landmark is visible from the previous room (`read_vmf_sightlines`).
- [ ] Cover and spawn areas exist; no long empty sightline without a reason.
- [ ] Lights and sky are set, not default.
- [ ] The room has one decision, and the critical path continues through it.

The tools answer the measurements; the wish answers the decision.
