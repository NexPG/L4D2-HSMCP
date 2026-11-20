# Entity families: triggers, movers, logic

`edit_vmf` can add any class. It cannot know that `trigger_teleport` needs a `target`, that a
mover is a brush with an origin at its centre, or that a `logic_relay`'s behaviour is in its
`connections` block. These three builders encode those rules and check the keys against the
installed FGD. They are shortcuts: `write_brush_entity` and `write_point_entity` accept any
classname, so a class with no named builder is still one call away.

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
| `write_prop` | `prop_static`, `prop_dynamic` or `prop_physics`; model checked with `read_model_info` when the game is present |
| `write_physics_constraint` | hinge, length, ballsocket, slide or ragdoll; `attach1`/`attach2` are required |
| `write_ladder` | a `func_ladder` brush plus the `func_useableladder` point L4D2's AI uses |
| `write_scene` | `logic_choreographed_scene` with `SceneFile` and up to eight targets |
| `write_ambient_generic` | an ambient sound with its soundscript name, volume and radius |

These are shortcuts over `write_point_entity`/`write_brush_entity`, not a closed list:
`func_useableladder` is itself a point entity, and a constraint class with no enum entry can
be written through the primitive.

## Verification

`test/tools/entityfamilies.test.ts` writes each family and reads it back: the brush volume and
solid count, `wait`, `damage`, `pushdir`, `movedir`, `startposition`, `maxspeed`, the
`RefireTime`/`InitialValue`/`startvalue` keys and an output in the `connections` block. The
compile case in `test/vmf/tools-compile.test.ts` places a `trigger_multiple`, a
`func_movelinear` and a `logic_relay` in the sealed room; vbsp emits all three in the entity
lump with no leak.
