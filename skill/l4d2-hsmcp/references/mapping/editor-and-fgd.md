# Editor, Hammer++ and FGD edits

The toolkit writes files; a person still opens the result in an editor. Two community tools
change what that editor shows, and one of them can quietly make a map unshippable if its
entities are used.

## Contents

- Hammer++ for L4D2
- Tools++ and L4D2
- Helper FGDs
- When to drive the editor
- Practical workflow

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

The flags and the chain that runs them are in [`hammerpp.md`](hammerpp.md); this project's
compiler wrapper names the chain that actually ran. One consequence matters here:

VVIS++ deliberately keeps `blocklight`/`blockLOS` tool textures from cutting faces out of
`func_detail`, because L4D2 maps rely on that behaviour. Do not "fix" a map that depends on it.

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

### Role autovisgroups

A helper FGD with `@AutoVisgroup` blocks describes roles ("Clips/Infected", "Props/Doors")
rather than one group per class. `auto_visgroups` with `by: ["role"]` reads those groups
from the `roleFgd` you pass and writes them under `Auto/Roles/`. The FGD is input data, not
something the project ships or copies; if the mapper has no role FGD, the class/material
mode is still the honest tree.

## When to drive the editor

The live channel is a second way to change a map, and it is the wrong default. The rule:

- **Write the VMF with the file tools** for brushes, geometry, materials and bulk entities.
  The channel cannot create or move a brush, and a file write is deterministic, diffable and
  testable.
- **Open Hammer++ when the question is the editor's**: does this generated VMF open, are the
  entities where the 2D views say, what does the 3D view look like, does Check for Problems
  agree. `open_in_hammer` (with a capture) and `hammer_menu` answer that; a compile is slower
  and answers a different question.
- **Use `hammer_live_edit` for a small entity change in a session a person is working in**,
  with `save: true`. Its address is `class + origin` because the channel has no ids, so the
  saved VMF is checked first: a create must land on an empty address, an edit on exactly
  one. Create/delete/rotate are undoable; a keyvalue change is not.
- **Never make the live editor a dependency of an automated run.** It needs an interactive
  desktop, a saved map open and a message loop that a modal dialog can block. CI and `run_*`
  tests must not require it.

A generated map's first check can therefore be: `open_in_hammer` and look at the capture,
`hammer_menu checkForProblems`, `read_vmf_lint`, then `run_compile`. The game remains the
only proof of runtime behaviour.

## Practical workflow

1. Edit in Hammer++ with whatever FGD you work comfortably with.
2. Save the `.vmf`.
3. Run `read_vmf_lint` and `read_vmf_leak` here — against the stock FGD.
4. Compile with the chain `run_compile` reports, then generate nav and test.

The lint checks more than names: a key declared by the class is not enough if its value is
an enumeration. `invalid-keyvalue-choice` catches values such as `trigger_finale.type 3` or
`info_survivor_position.hideweapons 2`, which the engine silently replaces with the default.
The allowed list is in the finding, taken from the FGD's own `CHOICES` block.
`obsolete-spawnflag` reports a set bit whose FGD label says `OBSOLETE`, such as
`func_door` bit 1 ("Starts Open - OBSOLETE, use Spawn Position"); the replacement is in the
label, not in a wiki.
`aabb-region-nonaxis-aligned` reports a `func_detail_blocker`,
`func_block_charge` or `func_nav_avoidance_obstacle` brush with a rotated face: those
classes affect the brush's axis-aligned bounding box, so a diagonal brush covers a much
larger region than it draws.
`dead-keyvalue` names a key the stock FGD still declares but L4D2 ignores; currently
`prop_door_rotating.health` and `.axis`, where the door has no breakable state and the hinge
comes from the model origin and angles.

The editor's convenience and the engine's truth are different things; this project checks the
second one.
