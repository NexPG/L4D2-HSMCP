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

## What to verify

- `read_nav` returns `fresh`: `savedBspSize` equals the `.bsp` size. Any geometry change makes
  it stale.
- `read_nav_dump` parses the `<map>_nav.txt` dump and returns a verdict: `playable`,
  `no-goal`, `no-flow` or `empty`. See `references/nav/attributes-and-flow.md` for what the
  flags mean.
- The console log has no `GetGoalArea`, `Flow Warning`, `Checkpoint failed` or `NAV ERRORS`
  lines.

A mesh that exists but has no goal area is not a playable mesh, even though the file is
valid.

## Cleanup the engine leaves behind

`nav_generate` writes `*.nav02`, `*.nav03`, … and `<map>_nav.txt` next to the map. They
accumulate; remove them after collecting the mesh. The `_nav.txt` is evidence, so copy it
before deleting.
