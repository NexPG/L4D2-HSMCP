# L4D2 entity facts

What the game actually provides, read from `bin/left4dead2.fgd` and `bin/base.fgd`. These are
the facts that differ from other Source games and cause silent failures when assumed.

## Player start

- `info_player_start` is the only player spawn. L4D2 has no `info_player_terroist`/teamspawn
  pair for survivors.
- A single `info_player_start` is enough: the Director spawns the team around it.
- On the first map of a campaign its area is PLAYER_START **and** CHECKPOINT.

## Director

- `info_director` is required for a campaign map. Without it there is no Director behaviour.
- It has inputs and outputs for panic events, specials and finale state; `read_fgd_class`
  with `classname: "info_director"` lists them exactly.
- `info_zombie_spawn` gives infected a place to come from. Optional, but a map without any
  spawn point is a quiet map.

## Level change

- `info_changelevel` is a **brush** entity, despite the `info_` prefix. It needs `map` and
  `landmark`, and it does not spawn without a `prop_door_rotating_checkpoint` in the safe
  room.
- `trigger_changelevel` exists in `base.fgd` but no stock L4D2 chapter uses it. It is not the
  campaign transition.
- `info_landmark` is a point entity with a `targetname`; the same name must exist in both
  maps.
- `prop_door_rotating_checkpoint` is the special saferoom door. A plain
  `prop_door_rotating` does not satisfy the engine.

## Finale

- `trigger_finale` is a **point** entity with a world model (radio, generator, sound board).
  It is started by **+use** (or by inputs), not by walking into it.
- Its `type` values: 0 Standard, 1 Gauntlet, 2 Custom, 4 Scavenge. No stock campaign uses 0.
- `ScriptFile` exists as a keyvalue; the engine also looks for a map-specific finale script.
  Neither is documented as working here.
- `info_survivor_rescue` marks where a rescue stands. It is not required for the victory input.

## Nav

- `func_nav_attribute_region` marks nav attributes (see `references/nav/attributes-and-flow.md`).
- `func_nav_blocker` blocks nav areas touching its AABB; `affectsFlow` decides whether it
  forces flow recomputation.
- `func_nav_avoidance_obstacle` tells bots to avoid areas touching it.

## Checking an entity before using it

```
read_fgd_class(classname: "trigger_finale")
```

Returns every keyvalue, input and output with types and defaults, from the FGD that the
installed game ships. This is the first stop for any "does this entity have X?" question; do
not rely on memory of another Source game.
