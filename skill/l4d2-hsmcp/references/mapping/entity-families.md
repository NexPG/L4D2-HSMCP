# Entity families: triggers, movers, logic

`edit_vmf` can add any class. It cannot know that `trigger_teleport` needs a `target`, that a
mover is a brush with an origin at its centre, or that a `logic_relay`'s behaviour is in its
`connections` block. These three builders encode those rules and check the keys against the
installed FGD. They are shortcuts: `write_brush_entity` and `write_point_entity` accept any
classname, so a class with no named builder is still one call away.

## Contents

- Triggers
- Movers
- Logic
- Props, constraints, ladders, scenes and sounds
- Runtime presence
- Verification

## Triggers

```
write_trigger(path, kind: "multiple", bounds: {mins: [-64,-64,0], maxs: [64,64,64]})
write_trigger(path, kind: "teleport", target: "teleport_destination", bounds: ...)
write_trigger(path, kind: "hurt", damage: 25, damageType: 8, bounds: ...)
write_trigger(path, kind: "push", speed: 300, pushdir: [0,0,1], bounds: ...)
```

A trigger is a **brush entity**. The builder adds the entity, then ties a box to it and reads
the solid count back; an entity with no volume compiles to nothing.

| Kind | Class | Keys the builder supplies |
|---|---|---|
| `multiple` | `trigger_multiple` | `wait` (default 1) |
| `once` | `trigger_once` | none |
| `hurt` | `trigger_hurt` | `damage` (10), `damagetype` (0) |
| `push` | `trigger_push` | `speed` (40), `pushdir` (0 0 1) |
| `teleport` | `trigger_teleport` | requires `target`; no default |
| `look` | `trigger_look` | requires `target`; no default |
| `gravity` | `trigger_gravity` | `gravity` (1) |

`spawnflags` are **not** guessed. The FGD gives every trigger a different filter set
(`trigger_push` has "Once Only", `trigger_multiple` has Clients/NPCs/Physics). Pass the flag
you mean; `read_fgd_class` lists the names and bit values.

Outputs go into the `connections` block via `addOutput`, not flat `OnStartTouch` keys. A
trigger with no output is a volume that does nothing until something else targets it.

## Movers

```
write_mover(path, kind: "movelinear", bounds: ..., movedir: [0,1,0], speed: 150)
write_mover(path, kind: "rotating", bounds: ..., maxSpeed: 90, angles: [0,90,0])
write_mover(path, kind: "tracktrain", bounds: ..., target: "path_start")
```

- All three are **brush entities**. The builder writes the box and sets `origin` to its centre,
  which is what rotation and a track train use.
- `func_movelinear`: `movedir` is direction and distance sign; `speed` is units/second;
  `startposition` is 0..1.
- `func_rotating`: `maxspeed` is degrees/second; `angles` sets the axis; `spawnflags` bit 1 is
  Start ON, bit 4 X axis, bit 8 Y axis, bit 16 acceleration.
- `func_tracktrain`: requires the first `path_track` as `target`; the chain is built from the
  path tracks' own `target` keys. The builder refuses a tracktrain without one.
- L4D2's FGD has no `func_pendulum`; do not invent it from another Source game.

## Logic

```
write_logic(path, kind: "relay", origin: [0,0,96], targetname: "relay",
            outputs: [{output:"OnTrigger", target:"door", input:"Open"}])
write_logic(path, kind: "timer", origin: [0,0,96], refireTime: 0.5)
write_logic(path, kind: "counter", origin: [0,0,96], startValue: 2, maxValue: 10)
```

- All are **point entities** with an origin. `logic_auto` is the map-spawn one; its outputs are
  `OnMapSpawn`. A `logic_auto` with no outputs is harmless and useless.
- `logic_timer` gets `RefireTime` in seconds; `logic_branch` and `logic_compare` get
  `InitialValue`; `math_counter` gets `startvalue` and optional `max`.
- Outputs are written to `connections`, so repeated outputs with the same name are legal.
- `logic_case`, `logic_compare` and `math_remap` need their value keys (`Case01`, `Min`, `Max`,
  ...) through `keyvalues`; `read_fgd_class` is the authority.

## Props, constraints, ladders, scenes and sounds

| Tool | What it writes |
|---|---|
| `write_prop` | `prop_static`, `prop_dynamic`, `prop_physics` (+ overrides); checks `staticProp`/`hasPhysics`, adds a clip hull on request |
| `write_physics_constraint` | hinge, length, ballsocket, slide or ragdoll; `attach1`/`attach2` are required |
| `write_ladder` | a `func_ladder` brush plus the `func_useableladder` point L4D2's AI uses |
| `write_scene` | `logic_choreographed_scene` with `SceneFile` and up to eight targets |
| `write_ambient_generic` | an ambient sound with its soundscript name, volume and radius |

These are shortcuts over `write_point_entity`/`write_brush_entity`, not a closed list:
`func_useableladder` is itself a point entity, and a constraint class with no enum entry can
be written through the primitive.

### Ladders

`write_ladder` writes a `func_ladder` brush and a `func_useableladder` point. Two facts are
not in the entity's own keys:

- **L4D2's `func_simpleladder` is compiler output, not an authored class.** It is absent
  from the FGD; Tools++ vbsp creates it from the ladder with `-simpleladders`, which is why
  `run_compile` now passes that flag only on the Tools++ L4D2 chain. Stock vbsp rejects the
  flag outright. Without it the player can still touch the ladder, but the AI has no ladder
  nav data.
- **The useable points must be outside the climbing face.** `write_ladder` offsets them 33
  units along `facing` (the player hull is 32 wide) and sets `angles` so the generated
  ladder's `normal` points away from the wall. Points on the brush centre line are logged as
  `funcladder with blocked bottom point` at map load.

The brush spans the lower floor to the **top of the upper floor** and sits flush against its
edge. A ladder brush at the world origin, or one that overlaps a solid platform, makes nav
print `Invalid ground position` / `No valid walkable seed positions`; the compiler's ladder
points are the brush centres, so the bottom/top must be over open floor. After nav,
`read_nav_ladders` is the check; a climb link appears only when both ends connect.

Generate nav with `via: "steam"` when the origin is not open floor. A direct launch's cfg
runs before a player exists, so `nav_mark_walkable` lands on the world origin; a ladder there
is reported as `Invalid ground position`. Steam keeps a host: the tool retries `setpos` to
`info_player_start`, `nav_mark_walkable` and `nav_generate` through the client console after
the host spawns. Measured on the two-level test map: 17 nav areas, `read_nav_ladders` returns
one ladder (top area 1, bottom area 2), and `nav_path` from the floor to the platform returns
a route with one `ladder-up` step. That is the AI path a bot walks; it is not a manually
`nav_mark_walkable`-seeded floor only.

### Clip families

| Class | Blocks | Does not block | Use |
|---|---|---|---|
| `TOOLS/TOOLSCLIP` world brush | players, infected, physics | nothing | the default invisible wall; it is solid geometry and can seal a hull |
| `func_playerinfected_clip` | players and infected | physics props | keep survivors and AI out of a volume without stopping a barrel; 746 in the stock maps |
| `func_clip_vphysics` | VPhysics objects | players and infected | a rail that stops a rolling car but not a survivor |
| `func_block_charge` | Charger charges | other movement | L4D2-specific charger blocker |
| `func_nav_blocker` | nav paths at load | all physics | keep bots off a visible-but-unwalkable roof, water or scenery; it does not remove areas from the generated file |
| `func_brush` `Solidity 1` | nothing (default) | everything | a toggleable visual; `Solidity 2` makes it always solid |
| `func_illusionary` | nothing | everything | legacy non-solid; prefer `func_brush` |

`func_playerinfected_clip` is a brush entity with no special keys: `write_brush_entity`
writes it, and `TOOLS/TOOLSCLIP` is the material unless the class needs the trigger texture.
Do not use a world clip where the player should pass and only a prop should stop; the
difference is the whole point.

### Choose the prop class from the official pattern

The official maps use **`prop_physics`** for almost every movable thing — 11,667 instances
against 12,147 static-prop instances that are architecture/detail (doors, windows, fences, AC
units, shelves). A `prop_static` is not "the default prop"; it is for a model compiled with
`$staticprop` and it is visual architecture.

`write_prop` checks this when the game is present:

- `read_model_info.staticProp` — an MDL without the flag is **deleted by vbsp** as a
  `prop_static` (`Error! ... Deleted.`), even though vbsp exits 0;
- `read_model_info.hasPhysics` — without a `.phy` the prop has no collision; `collision:
  "auto"` or `"clip"` adds a `TOOLS/TOOLSCLIP` world box from the model bounds and yaw;
- `kind` also covers `prop_dynamic_override` and `prop_physics_override`, which official
  prefabs use;
- `collision: "none"` is for a decoration you deliberately want walk-through.

Check the class, not only the model name: a model with a `.phy` can still be a ghost as
`prop_static`, and a chair that should be physics is a wall if it is static.

### Breakables and physics patterns

`write_breakable` writes the brush versions; the stock breakable **props** are written with
`write_point_entity` (or `edit_vmf`) because their classnames are outside `write_prop`'s
enum. A `prop_wall_breakable` model that is placed through `write_prop` as `prop_static` is
not breakable; the class is the behaviour.

| What | Class | How to write it | Official count |
|---|---|---|---|
| wall/door that takes damage | `func_breakable` | `write_breakable(kind: "breakable")`; `material` 0-8, `health`, `BreakableType` 0/1/2 | 1,542 |
| glass/tile window that fractures | `func_breakable_surf` | `write_breakable(kind: "surface")`; visible face four-sided, other faces `TOOLS/TOOLSNODRAW` | 34 |
| physically simulated brush | `func_physbox` | `write_breakable(kind: "physbox")`; `massScale` | 18 |
| breakable wall prop | `prop_wall_breakable` | `write_point_entity` with the model and `health` | 108 |
| car window | `prop_car_glass` | `write_point_entity`; models `police_car_glass.mdl`/`racecar_glass.mdl` | 117 |
| alarmed car | `prop_car_alarm` | `write_point_entity`; a `prop_physics` car body with the alarm class | 58 |
| fuel barrel | `prop_fuel_barrel` | `write_point_entity`; `models/props_industrial/barrel_fuel.mdl` | 39 |

A physics car is `write_prop(kind: "physics")` with a model that has a `.phy`; nav ignores
dynamic props, so a parked car does not leave an orphan nav island (a solid `prop_static` car
does). `prop_wall_breakable` and `prop_car_glass` are **dynamic** prop classes, not static:
they need their own animation/health handling and must not be compressed into
`prop_static`.

`prop_physics` colours: the class has a `Color` input from `RenderFields` and a
`rendercolor` key. Set `keyvalues: { rendercolor: "200 30 30" }` at spawn, or fire `Color`
from a `logic_case` for random car colours. `skin` is a different model texture set, not a
colour; using it for "red car" picks whatever the model's skin 1 is.

### Face the model, do not guess a yaw

The MDL has no forward axis. `write_prop` takes `facing` (the world yaw the front should point
at), `modelForward` (`x+`/`x-`/`y+`/`y-`) and `yawOffset`; it writes the yaw. The measured
table is `references/mapping/model-facing.md`: a sedan is `x+`, `bench001` is `y+`, a food
cart and the rescue helicopter are `x-`, and `arcadegame01` is `x+`. Doors are not props: use
`place_door`, because the leaf is on local Y and the origin is the hinge.

## Runtime presence

A compiled entity is not proof that the entity exists when the map runs. `write_entity_probe`
adds a runtime oracle: for each targetname it writes an `OnUser1` output that echoes a unique
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
  saferoom medkit/pills/ammo, an intro camera with its `logic_auto` and timer, a rescue point
  and an infected border; all nine probes matched at 11.2 s.

### Behaviour, not just presence

| Question | Tool | Verified result |
|---|---|---|
| Did the intro camera actually take the view and release it? | `write_entity_probe(..., event: "OnEndFollow")` | `HSMCP_EVENT_probe_camera` fired at 21.0 s, after `holdSeconds: 8` |
| Did a spawner create an item? | `write_class_probe(classes: ["weapon_rifle"])` | `HSMCP_CLASS 2 weapon_rifle 1` with `spawnflags 2` (Must Exist) |
| Is the rescue closet nav marked? | `write_nav_attribute_region` + `write_nav_probe` | `HSMCP_NAV rescue HAS` at 23.5 s; the region applies on spawn, after the nav file was written |
| Does a border exist and does the Director run? | presence probe + class probe | no border: 30 infected at x<-96; border at x=-100: 1 at x=-39; border at x=120: 0, because the whole nav area was behind it |

Limits found in the same runs:

- The saferoom medkit/pills/ammo spawners were present, but their classes counted 0. The test
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

## Verification

`test/tools/entityfamilies.test.ts` writes each family and reads it back: the brush volume and
solid count, `wait`, `damage`, `pushdir`, `movedir`, `startposition`, `maxspeed`, the
`RefireTime`/`InitialValue`/`startvalue` keys and an output in the `connections` block. The
compile case in `test/vmf/tools-compile.test.ts` places a `trigger_multiple`, a
`func_movelinear` and a `logic_relay` in the sealed room; vbsp emits all three in the entity
lump with no leak.
