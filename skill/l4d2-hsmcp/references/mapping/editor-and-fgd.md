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

## Helper FGDs

A community FGD can make Hammer friendlier: helper models for weapon spawns, cubemaps and
survivor positions, nav attributes in a dropdown, completed damage types, more visgroups and
tool textures. It is an editor convenience, and Hammer loads it as game data.

### The rule that matters

**Never lint or ship against a helper FGD.** Its `hlp_*` entities, helper models and
dropdown-only classes exist in Hammer, not in the engine. A map that uses them compiles into
entities the game does not have, and a lint that accepts them approves a broken map.

- `read_fgd_class` and `read_vmf_lint` are pointed at the game's own
  `bin/left4dead2.fgd`. That is the shipping authority.
- Use an FGD pack for comfort in the editor, then check the result with the tools here.
- If an FGD pack changes Hammer's default new entity, set it back: swapping a model entity
  for one that newly gained a helper model can crash the editor.

## Practical workflow

1. Edit in Hammer++ with whatever FGD you work comfortably with.
2. Save the `.vmf`.
3. Run `read_vmf_lint` and `read_vmf_leak` here — against the stock FGD.
4. Compile with the chain `run_compile` reports, then generate nav and test.

The editor's convenience and the engine's truth are different things; this project checks the
second one.
