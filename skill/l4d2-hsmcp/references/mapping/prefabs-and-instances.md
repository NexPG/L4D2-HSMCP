# Official prefabs and instances

L4D2 ships its reusable set pieces as `.vmf` files: houses, safe rooms, cars, fires,
environment controllers and the scripted entity groups. They are not models and not
compiled maps. Two different things can be done with one:

- **`insert_prefab`** pastes the geometry and entities once. The copy belongs to the map and
  changing the file later changes nothing.
- **`write_instance`** leaves a live `func_instance` pointing at the file. vbsp (and
  `collapse_instances`) expands it at compile time. The instance file must stay with the map
  when the map ships.
- **`create_instance_from_selection`** is Hammer++'s reverse direction: selected brushes
  become the instance file and one `func_instance` stays behind.

## Read the library before building a house by hand

```text
read_official_prefab(search: "swamphouse", details: true)
read_official_prefab(family: "entitygroups")
read_official_prefab(path: "mapsrc/instance/prop_swamphouse02.vmf")
```

The catalogue covers `sdk_content/mapsrc/instance`,
`sdk_content/scripting/maps/instance` and the DeadLine2 source. Each entry gives its family,
bytes, world solids, entity count, class histogram and nested-instance count; `details` adds
targetnames and outputs. Measured: `prop_swamphouse02` is 52 solids / 36 entities with 17
targetnames; `prop_swamphouse01` is 12 / 20 with no targetnames.

| Family | Examples | Use |
|---|---|---|
| `mapsrc` | `prop_swamphouse01/02`, `prop_car_physics_*`, `c*m*_environment_ents`, `breakwall_generic`, `fire_grow*` | a house/safe room, a physics car, the map atmosphere, a breakable wall |
| `entitygroups` | `ammo_cabinet`, `med_cabinet`, `defib_cabinet`, `ladder`, `buildable_minigun`, `gascan_helicopter`, `hintboard` | scripted set pieces whose VScript and use targets are already wired |
| `usetargets` | the matching `*_group.nuc`/use-target scripts | the behaviour half of an entity group |

## Paste one, with names that cannot collide

```text
insert_prefab(path, prefab, move: [x, y, z], rotate: 90, pivot: [x, y, z],
              namePrefix: "house_", validate: true, confirm: true)
```

- `move`/`rotate`/`pivot` transform brushes and entity origins/yaws together.
- `namePrefix` rewrites every inserted `targetname` and the prefab's **own** output targets,
  so two copies do not produce two `screen01` entities. `remap` gives an explicit
  old→new table when a prefix is the wrong shape.
- `validate` (default) reports duplicate targetnames and outputs whose target is not in the
  finished map. `!self`, `!activator`, `!caller` and `!player` are not reported.
- `insert_prefab` refuses a fragment with no world solids and no entities, and checks every
  inserted brush as a solid. A nested `func_instance` is inserted but **not expanded**; it is
  reported, and `collapse_instances` does the expansion when the sidecar is available.

Measured: `prop_swamphouse02` pasted into a sealed 2048 room with `namePrefix: "house_"`
produced 52 solids, 36 entities, 17 names prefixed, zero duplicates, zero unresolved outputs
and compiled through vbsp with no leak.

A prefab that was saved with hidden solids is inserted visibly; the result says how many.
That is a paste-time decision, not a silent change.

## Instance or prefab?

Use a **prefab** for a one-off set piece, a house you will edit in place, or a fragment whose
file will not ship. Use an **instance** for a building repeated across chapters, because a
fix to the instance file reaches every map on the next compile; ship the instance `.vmf`
beside the map or in the add-on's `maps/` tree.

```text
write_instance(path, file: "instance/house.vmf", origin: [0,0,0], angles: [0,90,0],
               fixupStyle: "prefix", confirm: true)
collapse_instances(path, out: "build/map_collapsed.vmf", confirm: true)
```

`collapse_instances` is the oracle for an instance: it expands with srctools, applies the
fixup style, checks cycles/depth and writes the ordinary VMF that vbsp will see. Run it before
a compile when the toolchain is stock or when you need to inspect the result.

## A house as a safe room

`write_safe_room_prefab` is the composition: paste a stock house, then place the same
checkpoint wiring `write_safe_room` uses.

```text
write_safe_room_prefab(
  path,
  prefab: "prop_swamphouse01", origin: [0, 0, 0], rotate: 0, namePrefix: "safe_",
  opening: { axis: "x", min: -32, max: 32, at: -288, floorZ: 0 },
  doorYaw: 90,
  playerStart: { origin: [-128, 0, 16] },
  confirm: true,
)
```

- The prefab is the **shell**; the door is still `checkpoint_exit`/`checkpoint_entrance`,
  the player start is real, and four survivor positions + the Director are added.
- Coordinates are world space, not prefab-local: the house can be rotated independently of
  the door opening. Pass the opening where the actual wall is.
- It refuses a map that already has an `info_player_start`, because a safe room adds one.
- `write_changelevel` is still a separate call; run `check_transition` after both maps exist.
- Measured: `prop_swamphouse01` + `write_safe_room_prefab` + a departure changelevel
  compiled with `prop_door_rotating_checkpoint` x1, `info_player_start` x1,
  `info_survivor_position` x4, `info_changelevel` x1 and `info_landmark` x1; the door's
  targetname read back as `checkpoint_exit`.
- The official house prefab carries no weapon/medkit spawns. Add them with
  `write_saferoom_stock` or `write_item_spawns`; a prefab is geometry, not a supply cabinet.

## The environment prefab

`c1m1_environment_ents.vmf` (and the `c*m*_environment_ents` family) is the atmosphere set:
`env_sun`, `light_environment`, `shadow_control`, 6 `env_fog_controller`, 3
`postprocess_controller`, 3 `color_correction`, and global/infected/ghost tonemaps. Paste it
with `insert_prefab` `namePrefix` and remove the hand-built singleton atmosphere, or the map
ends up with two `light_environment` entities and a fog controller the prefab cannot drive.

Measured on Santa Monica m1: 20 entities inserted, 15 names prefixed, zero duplicates; the
compiled BSP has 6 fog controllers, 3 postprocess, 3 color corrections, 1 sun/shadow/light
environment and 3 tonemaps. The prefab also uses FGD-unknown keys (`heightFog*`,
`fadetoblackstrength`, `maxdxlevel`/`mindxlevel`); lint tolerates those exact official names.

## Entity groups

The `entitygroups`/`usetargets` files are prefabs with a **behaviour contract**:
`point_script_use_target` or `point_prop_use_target` plus a VScript file. Paste the `.vmf`
with `insert_prefab` and ship the matching script from `usetargets` (or the group's own
`vscripts` key); the geometry without the script is inert. `read_official_prefab(details)`
lists the targetnames and outputs so the script and the map agree.
