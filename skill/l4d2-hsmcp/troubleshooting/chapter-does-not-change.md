# Chapter does not change

The map plays, the safe room is reachable, and walking into it does nothing.

## The four requirements

An `info_changelevel` transition needs all of these. Missing any one is enough to fail
silently.

1. **`prop_door_rotating_checkpoint`** exists in the safe room. Without it `info_changelevel`
   does not even spawn. A plain `prop_door_rotating` is not a substitute.
2. **CHECKPOINT nav attribute** on the safe room areas. `func_nav_attribute_region` with
   `spawnflags 2048`, applied during `nav_generate`. A nav generated before the region existed
   does not have it.
3. **All survivors inside the brush.** The engine waits for the team. If bots are somewhere
   else, it will not fire. This is the most common "it does nothing" cause after building a
   new map.
4. **A matching `info_landmark` pair** with the same `targetname` in both maps, and the
   `landmark` keyvalue on the changelevel.

## Check the compiled map, not the source

```
read_bsp_entities(path: "<map>.bsp", classname: "info_changelevel")
read_bsp_entities(path: "<map>.bsp", classname: "prop_door_rotating_checkpoint")
read_bsp_entities(path: "<map>.bsp", classname: "info_landmark")
```

The changelevel must have a `model` (`*N`): that is what proves VBSP made a brush volume for
it. An entity without a model has no volume and cannot be entered.

## Look at the nav

`read_nav` says whether the mesh belongs to this `.bsp`. Then read `<map>_nav.txt`: the safe
room areas must show `0x800` under "Terror Spawn Attribute Flags", and there must be an escape
route (`0x20000000`) reaching them.

## If it still fails

- Is the doorway actually open geometry? A door model on a solid wall is a wall.
- Does the brush cover the floor where survivors stand, not only the doorway?
- Check the console: `info_changelevel ... doesn't have a landmark` names a missing pair.
- Try it alone: if one survivor walking in does nothing but the whole team does, it was rule 3
  all along — not a bug.
