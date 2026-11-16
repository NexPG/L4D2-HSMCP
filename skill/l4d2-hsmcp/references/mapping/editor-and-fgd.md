# Editor, Hammer++ and FGD edits

The toolkit writes files; a person still opens the result in an editor. Two community tools
change what that editor shows, and one of them can quietly make a map unshippable if its
entities are used.

## Hammer++ for L4D2

Hammer++ is the editor this project is built around. It is a modified Hammer with working
lighting preview, a model browser, instances, and a stable viewport.

Install for L4D2:

- copy the L4D2 build into `<game>/bin/` (next to `hammer.exe`);
- **delete `bin/hammerplusplus/steam_appid.txt`**. Leaving it in produces
  `C_CL4DGameStats: failed to download stats from Steam` spam and a frozen menu after
  compiling;
- L4D2 lighting preview is HDR by default, which matters because the game uses up to ×8
  tonemap scaling — an LDR preview looks far darker than the game;
- a known L4D2 glitch: displacement textures break at distance in the viewport. Workaround is
  to hide the Displacements visgroup while editing.

## Tools++ and L4D2

`vbsp++`/`vvis++`/`vrad++` compile L4D2 BSP format when given `-l4d2`, or when they recognise
the `SteamAppId` in the game's `gameinfo.txt`. Useful flags for this game:

- `-staticpropformat v9` — the L4D2 static prop format, when a prop was built for another
  branch;
- `-simpleladders` — L4D2's `func_simpleladder` format;
- `-maxbrushes` and friends only work on engines that support raised limits; do not assume
  L4D2 does.

VVIS++ in this chain deliberately keeps `blocklight`/`blockLOS` tool textures from cutting
faces out of `func_detail`, because L4D2 maps rely on that behaviour. Do not "fix" a map that
depends on it.

## L4D2-FGD-Edits

A community FGD collection (Mrfunreal/L4D2-FGD-Edits) that makes Hammer friendlier:

- helper models for weapon spawns, cubemaps, survivor positions, player scale;
- nav attributes listed in the `NavAttributeRegion` dropdown;
- damage types documented and completed;
- areaportal distance pickers, spheres for fade distances and radii;
- more visgroups and tool textures;
- improved `prop_door_rotating` / `prop_door_rotating_checkpoint` defaults;
- `trigger_finale` defaults to the hamradio model.

Install it into `<game>/bin/L4D2-FGD-Edits/`, add `hammer_vpk` to `gameinfo.txt`, and select
**only** `left4dead2_ADDON.fgd` as the game data file in Hammer.

### The rule that matters

**Never lint or ship against the helper FGD.** Its `hlp_*` entities, helper models and
dropdown-only classes exist in Hammer, not in the engine. A map that uses them compiles into
entities the game does not have, and a lint that accepts them approves a broken map.

- `read_fgd_class` and `read_vmf_lint` are pointed at the game's own
  `bin/left4dead2.fgd`. That is the shipping authority.
- Use the FGD edits for comfort in the editor, then check the result with the tools here.
- Change Hammer's default new entity from `info_survivor_position` to `info_player_start` if
  the FGD edits change it — the edits' own readme warns that swapping a model entity for one
  that newly gained a helper model can crash Hammer.

## Practical workflow

1. Edit in Hammer++ with the FGD edits installed.
2. Save the `.vmf`.
3. Run `read_vmf_lint` and `read_vmf_leak` here — against the stock FGD.
4. Compile with the chain `run_compile` reports, then generate nav and test.

The editor's convenience and the engine's truth are different things; this project checks the
second one.
