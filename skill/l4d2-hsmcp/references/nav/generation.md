# Nav generation

Left 4 Dead 2 has no offline nav generator. The engine builds the mesh from a loaded map and
analyses it in the same pass. There is no MCP tool for this yet; the project uses a script,
and any agent doing this must follow the same steps.

## Requirements

- **Windows and the game client.** A dedicated `srcds` binary is not needed or installed.
- **`sv_cheats 1` and `nav_edit 1`.** Without `nav_edit` the command runs and produces
  nothing, with no error.
- **The map loose in `left4dead2/maps/`.** A `.nav` cannot be written beside a map inside a
  VPK; the engine reports `Can't recreate dictionary ... file must be writable`.
- **The add-on VPK moved aside** while generating, so the loose map is not shadowed by the
  same map in the archive.

## Procedure

Use the tool:

```
run_nav_generate(
  maps: ["<campaign>/addon/maps/map_a.bsp", "<campaign>/addon/maps/map_b.bsp"],
  addonsToHide: ["<game>/left4dead2/addons/my_campaign.vpk"],
  confirm: true
)
```

It copies each map into `left4dead2/maps`, moves the named add-on archives aside, writes the
config, launches the game, waits for the `.nav`, copies the mesh and the engine's
`<map>_nav.txt` beside the source `.bsp`, removes the loose copies and the engine's rotating
backups, restores the config and the archives, and returns the verdict from
`read_nav_dump`. `addonsToHide` is not optional when an installed VPK contains a map with the
same name — the archive would shadow the loose map.

The manual procedure, when the tool cannot run:

1. Copy the compiled `.bsp` into `left4dead2/maps/`, remove any `.nav` with that name.
2. Write a temporary `cfg/listenserver.cfg`:

   ```
   sv_cheats 1
   nav_edit 1
   nav_mark_walkable
   nav_generate
   ```

3. Launch `left4dead2.exe -novid -console -allowdebug -insecure -condebug +map <map>`.
4. Wait for `<map>.nav` to appear, then close the game.
5. Copy the `.nav` and `<map>_nav.txt` into the campaign's `nav/` directory.
6. Restore the original config, delete the loose map and nav, and remove the engine's
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
