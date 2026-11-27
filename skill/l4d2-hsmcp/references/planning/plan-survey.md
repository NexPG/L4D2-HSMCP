# Surveying an existing map

`plan_from_map` is the inverse of pass 1: it measures a compiled map instead of designing one.
It takes a `.bsp` and the `.nav` beside it, and writes a survey plan (`origin: "imported"`):
the nav mesh's own path from `PLAYER_START` to the far `CHECKPOINT`, the player start, safe
room, checkpoints and item spawns as areas, districts by height band, and a `source.nav`
reference that the drawings render as the real walkable layout. An imported plan keeps every
structural check and skips the authoring prescriptions, because a survey is measured, not
designed.

Use it to understand a stock chapter, to seed a remake, or to test the checker against real
geometry. Do not edit an imported plan as if it were authored: the checker will hold it to
rules the map never claimed to follow.

Covered today, all read from the compiled map rather than guessed: route and side branches from
the nav graph; start, safe room, checkpoints and item spawns; rooms as nav components, and
buildings as rooms joined **through door areas**; floors, sections and a basement level;
doors from entities; stairs as the route's own flights plus nav ladders; static props with a
role (cover, landmark, item cluster, prop); water polygons and `func_nav_blocker` volumes;
the terrain heightfield from collision plus the BSP displacements; districts by height band;
the palette (sky, materials, models); and the `finale` block from `trigger_finale`.

Still holes, and why they are not tool bugs: the stock nav `places[]` table is empty, so rooms
are "Room 1" and "Middle level", not "Stairwell"; terrain cells with no collision (roofs, sky,
void) stay 0, which is 38% of the grid on a median chapter; the per-map caps (48 roof
buildings, 48 water contours, 80 props, 32 stairs) truncate the densest chapters; and beats are
a design decision, so a survey does not invent them.

The drawing set and the schema those drawings render are
[`five-drawings.md`](five-drawings.md).
