# Entity probes: presence and behaviour

A compiled entity is not proof that it exists when the map runs. This page is the runtime
half of the entity reference: the probe builders, the marker rules and the measured limits.

`write_entity_probe` adds a runtime oracle: for each targetname it writes an `OnUser1`
output that echoes a unique
line through a `point_servercommand`, and a `logic_auto` whose `OnMapSpawn` fires each probe.
The result includes `markers` for `run_map_test`; no schedule is needed.

```text
write_entity_probe(path, targets: ["probe_item", "probe_camera", "probe_border"])
run_map_test(map, bsp, nav, markers, markerOrder: "any")
```

- `markerOrder: "any"` matters: `OnMapSpawn` outputs land in one burst, and the default ordered
  matcher would lose all but the first line. `any` searches each marker independently.
- Marker patterns end with `(?![A-Za-z0-9_])`; without it `HSMCP_FOUND_probe_camera` matches
  `HSMCP_FOUND_probe_camera_timer` and a missing camera looks present.
- What it proves: the entity was created and its output system ran in the live map. What it
  does not prove: the Director's later behaviour. In the scratch room a `weapon_pistol_spawn`
  echoed on a previous run but was gone by the time the next probe fired, because survivors
  already carry pistols. Probe a spawner early (OnMapSpawn) or accept that its removal is the
  finding.
- Verified end to end on `hsmcp_gameplay`: vbsp++ compiled a sealed room with a rifle spawner,
  safe-room medkit/pills/ammo, an intro camera with its `logic_auto` and timer, a rescue point
  and an infected border; all nine probes matched at 11.2 s.

## Behaviour, not just presence

| Question | Tool | Verified result |
|---|---|---|
| Did the intro camera actually take the view and release it? | `write_entity_probe(..., event: "OnEndFollow")` | `HSMCP_EVENT_probe_camera` fired at 21.0 s, after `holdSeconds: 8` |
| Did a spawner create an item? | `write_class_probe(classes: ["weapon_rifle"])` | `HSMCP_CLASS 2 weapon_rifle 1` with `spawnflags 2` (Must Exist) |
| Is the rescue closet nav marked? | `write_nav_attribute_region` + `write_nav_probe` | `HSMCP_NAV rescue HAS` at 23.5 s; the region applies on spawn, after the nav file was written |
| Does a border exist and does the Director run? | presence probe + class probe | no border: 30 infected at x<-96; border at x=-100: 1 at x=-39; border at x=120: 0, because the whole nav area was behind it |

Limits found in the same runs:

- The safe-room medkit/pills/ammo spawners were present, but their classes counted 0. The test
  map has no flow and survivors start with a medkit and pills, so the Director did not
  populate them. Density is a probability, not a count.
- `info_map_parameters` density was isolated on a stock `c1m1_hotel` copy:
  `ConfigurableWeaponDensity 0` left 0 `weapon_spawn` at 30 s, `100` left 6. Specific
  `weapon_ammo_spawn` (1) and `weapon_first_aid_kit_spawn` (9) were unchanged, which matches
  the wiki: density controls `weapon_spawn`, not the specific `weapon_*_spawn` points.
- Pickup and rescue interaction are still not automated. A `weapon_first_aid_kit` and a
  `weapon_rifle` item, each with an `OnPlayerPickup` echo, a VScript teleport in front of the
  item, and `run_input` (10 synthetic `E` presses, `focused: true`) produced no pickup event;
  the rifle class count stayed 1. Focus is not the blocker: Source's raw-input path ignored
  the synthetic `keybd_event`. The medkit's base also lacks `OnPlayerPickup`; the rifle has it
  and still needs a real `E`. A real rescue needs a dead survivor and a living one opening the
  closet.
- `director_force_panic_event` needs the Director running; `director_start` first. In the
  two-room map the no-border control spawned 30 infected (all x<-96); a border at x=-100
  spawned 1 at x=-39; a border at x=120 spawned 0. The count drop is the smaller allowed area,
  not a failure, and the plane's orientation decides which side is "behind".

`write_class_probe` and `write_nav_probe` write VScript; install the `.nut` with
`run_map_test(scriptsDir: ...)`. Their markers assert a nonzero final count or an attribute
bit, while the raw `HSMCP_CLASS_POS` lines are in `console.log` for a position check.
