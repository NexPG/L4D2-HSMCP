# Nav generation

Left 4 Dead 2 has no offline nav generator. The engine builds the mesh from a loaded map and
analyses it in the same pass. `run_nav_generate` drives that pass; there is no supported way
to synthesise a `.nav` without the engine.

## Requirements

- **Windows and the game client.** A dedicated `srcds` binary is not needed or installed.
- **`sv_cheats 1` and `nav_edit 1`.** Without `nav_edit` the command runs and produces
  nothing, with no error.
- **The map loose in `left4dead2/maps/`.** A `.nav` cannot be written beside a map inside a
  VPK; the engine reports `Can't recreate dictionary ... file must be writable`.
- **The add-on VPK moved aside** while generating, so the loose map is not shadowed by the
  same map in the archive.
- **A string-table dictionary in the BSP.** The engine appends it on a changelevel, which
  happens *after* nav is written. Generate nav on a dictionary-less BSP and the nav's
  `savedBspSize` describes the pre-dictionary file, so the shipped pair is stale. The tool
  bakes the dictionary first (a `changelevel` launch with `-stringtables`), then generates.

## Procedure

Use the tool:

```
run_nav_generate(
  maps: ["<campaign>/src/map_a.bsp", "<campaign>/src/map_b.bsp"],
  addonsToHide: ["<game>/left4dead2/addons/my_campaign.vpk"],
  navSlopeLimit: 0.5,
  confirm: true
)
```

`navSlopeLimit` is the engine's `nav_slope_limit`: the ground normal's Z must be **greater**
than it. The default rejects steep ramps and escalators; `navSlopeLimit: 0.5` allows a
60-degree slope. If the map has stairs or a ramp and the flow is broken, lower it before
changing geometry.

The result returns `bsp`, `nav`, `stringtableDictionary` and `fresh`. Stage the returned pair
exactly; do not copy the pre-generation BSP. `fresh` is computed from the nav header's
`savedBspSize` against the returned BSP, so a build should fail when it is false. The engine
still iterates `changelevel` internally, so the tool ends the process as soon as the mesh
appears; the baked dictionary means that mesh is already stable.

It copies each map into `left4dead2/maps`, moves the named add-on archives aside, writes the
config, launches the game, waits for the `.nav`, copies the mesh and the engine's
`<map>_nav.txt` beside the source `.bsp`, removes the loose copies and the engine's rotating
backups, restores the config and the archives, and returns the verdict from
`read_nav_dump`. `addonsToHide` is not optional when an installed VPK contains a map with the
same name — the archive would shadow the loose map.

The manual procedure, when the tool cannot run:

1. Copy the compiled `.bsp` into `left4dead2/maps/`, remove any `.nav` with that name.
2. Bake the string-table dictionary: write `changelevel <map>` as
   `cfg/listenserver.cfg`, launch with `-stringtables +map <map>`, wait until the BSP grows
   and contains `stringtable_dictionary`, then close the game.
3. Write the nav config:

   ```
   sv_cheats 1
   nav_edit 1
   nav_mark_walkable
   nav_generate
   ```

4. Launch `left4dead2.exe -novid -console -allowdebug -insecure -condebug -stringtables +map <map>`.
5. Wait for `<map>.nav` to appear, then close the game.
6. Copy the `.nav`, the BSP the engine just wrote, and `<map>_nav.txt` into the campaign.
7. Restore the original config, delete the loose map and nav, and remove the engine's
   `*.navNN` backups and `*_nav.txt` dumps from the game tree.

## Keeping a surface out of the mesh

`func_nav_blocker` is a **runtime** blocker: it stops bots using an area after the map loads,
but the generator still writes the area. Measured on a 3,000-unit-wide outdoor map: adding
blockers over the sea and every roof left the nav **byte-identical** (668 areas before and
after). Do not use it to keep a surface out of the generated file.

The generator samples collision and keeps cells a player hull fits in (72 units). Two
generation-time fixes cover almost every case:

- **No walkable slope.** A flat sea bed or a parapet top is a floor. A `wedge` steeper than
  45 degrees (pass `steep: true`; it is scenery, not a route) has no walkable cell. This is how
  a decorative sea bed under a `func_water_analog` stops producing areas: the water is not
  solid, so before the wedge the generator walked the bed.
- **No headroom.** A solid `TOOLS/TOOLSCLIP` slab just above a roof, a counter top, a shop
  awning or a decorative deck leaves less than a player's height; the area is discarded. The
  slab is invisible and does not change what the player sees.

Both fixes were needed on Santa Monica: the sea bed and the two house roofs produced orphan
areas (`nav_trouble_report` named the centres), and a waist-high kitchen counter produced two
more. After the slabs and wedges both chapters' live `nav_trouble_report` passed with no
findings.

## The spawn is the nav area, not `info_player_start`

A `func_nav_attribute_region` with PLAYER_START (2176 on the first map) is where the engine
puts survivors. Moving `info_player_start` alone does nothing: measured on a test copy, the
player still spawned at the old house (`-700 -2362 8`) while the BSP's `info_player_start` was
at `-300 1700 16`. Removing the nav region made the next run spawn at the moved entity. A
normal chapter has both in the same place, which is why the two are easy to conflate; a camera
tour, a moved start or a test spawn must move or remove both.

## What to verify

- `read_nav` returns `fresh`: `savedBspSize` equals the `.bsp` size. Any geometry change makes
  it stale.
- `read_nav_dump` parses the `<map>_nav.txt` dump and returns a verdict: `playable`,
  `goal-present`, `no-goal` or `empty` (the dump cannot prove flow). See `references/nav/attributes-and-flow.md` for what the
  flags mean.
- The console log has no `GetGoalArea`, `Flow Warning`, `Checkpoint failed` or `NAV ERRORS`
  lines.

A mesh that exists but has no goal area is not a playable mesh, even though the file is
valid.

## Cleanup the engine leaves behind

`nav_generate` writes `*.nav02`, `*.nav03`, … and `<map>_nav.txt` next to the map. They
accumulate; remove them after collecting the mesh. The `_nav.txt` is evidence, so copy it
before deleting.
