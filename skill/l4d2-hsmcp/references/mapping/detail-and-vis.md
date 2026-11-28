# Detail, brush entities and visibility

The compiled `.bsp` cannot tell you which brush was structural: vbsp folds `func_detail`
into the world, so a shipped map has no trace of the decision. It has to be made in the
source, and it is the biggest single lever on compile time and PVS quality.

Related classes that are not visual brushes: `func_nav_blocker`,
`func_nav_avoidance_obstacle`, `func_nav_connection_blocker`, `func_nav_attribute_region`,
`func_clip_vphysics`, `func_playerinfected_clip`, `env_player_blocker`,
`trigger_playermovement`, `trigger_auto_crouch`, `trigger_look`, `trigger_remove`,
`trigger_changelevel`, `trigger_escape`, `func_timescale` and `func_ragdoll_fader` are
documented in [`../mechanics/ai-and-nav-content.md`](../mechanics/ai-and-nav-content.md) and
the nav pages; this page owns the `func_detail`/`func_brush`/`func_lod`/areaportal choice.

## Contents

- Decide by what the brush does
- The rule that matters
- Recipes
- What each costs
- Chapter 1 of Santa Monica

## Decide by what the brush does

| Brush | Structural? | Seals? | Collision | Cost | Use for |
|---|---|---|---|---|---|
| world brush | **yes** | **yes** | yes | splits the BSP tree and creates visleaves; a slow compile and a worse PVS | hull, floors, walls, ceilings, anything the map's seal depends on |
| `func_detail` | no | **no** | yes | no visleaves; vbsp folds it into the world | trim, pillars, window frames, parapets, door frames, high-frequency facade detail |
| `func_brush` | no | no | `Solidity` 0/1/2 | an entity; default `Solidity 1` = **Never Solid** | anything that toggles, moves, fades or needs inputs; set `Solidity 2` when it must collide |
| `func_lod` | no | no | `Solid 0` = **Solid**, `1` = Nonsolid | fade in/out over `DisappearMinDist`…`MaxDist`; the entity itself is cheap | distant facades, skyline clutter, props that must vanish before they are drawn |
| `func_illusionary` | no | no | none | legacy; use `func_brush` | non-solid decals/foliage shapes, if a stock map needs the class |
| `func_areaportal` | no | no (it is a vis portal, not a hull) | none | vis only while closed; a brush that does not fill its opening fails the whole compile | a doorway between two areas; one portal per connection |
| `func_areaportalwindow` | no | no | none | fade window + target bmodel; 1,055 in the 57 stock maps | a window that culls the room behind it at distance |
| `func_occluder` | no | no | none | CPU test per frame, paid whether or not it saves anything | a large, simple occluder in a corridor or around a corner; 168 in stock |
| `func_detail_blocker` | no | no | none | stops detail sprites inside its volume | keep grass/pebbles out of a building interior; 454 in stock |

Official counts (57 maps, measured): 1,978 `func_brush`, 1,055
`func_areaportalwindow`, 985 `func_areaportal`, 454 `func_detail_blocker`, 168
`func_occluder`, 102 `func_lod`, 692 `func_illusionary`. These are not decoration; they are
how the stock maps keep 872–6,369 brushes and 2,988–18,828 faces inside the frame budget.

## The rule that matters

**Detail brushes are not structural.** A `func_detail` wall does not seal. Move the map's
outer wall, floor or ceiling into one and the next `vbsp` leaks through geometry that looks
solid. `set_solid_class` says this in its reply, but it cannot check it: sealing is a
property of the whole hull. Compile and `read_leak` after every reclass; there is no static
substitute.

The safe order:

1. Build the hull as **world** brushes and prove it seals (`read_vmf_leak`, then vbsp).
2. Add the trim, parapets, frames and facade detail as **world** brushes.
3. Move those detail brushes into `func_detail` with `set_solid_class`.
4. Compile and `read_leak` again. If it leaks, the brush you moved was on the hull; move it
   back.
5. Only then add `func_areaportal` / `func_occluder`; they cost nothing if the hull is not
   already closed.

## Recipes

```text
# A batch of visual-only brushes
read_vmf_solids(path, near: [x, y, z], radius: 256)
set_solid_class(path, solidIds: [...], to: "entity", classname: "func_detail", confirm: true)
run_compile(path, stages: ["vbsp", "vvis"], confirm: true)
read_leak(path, bsp: "<compiled>.bsp")
```

```text
# Any brush class the named builders do not cover
write_brush_entity(path, classname: "func_brush", bounds: { mins: [...], maxs: [...] },
                   keyvalues: { Solidity: "2" }, material: "<material>", confirm: true)
```

```text
# A portal filling a doorway exactly; write_portal picks the tool material
write_portal(path, classname: "func_areaportal",
             mins: [-32, -8, 0], maxs: [32, 8, 112],
             targetname: "door_portal", keyvalues: { StartOpen: "1" }, confirm: true)
```

An areaportal is the one brush that must **fill** its opening: the engine refuses the whole
map if it does not. Build the doorway first, then place the portal at the opening's exact
bounds. Link it to the door with `target` if the door should drive it; otherwise `Open` and
`Close` inputs do.

## What each costs

- **`func_detail`**: compile time and PVS only go down. There is no runtime cost and no
  downside beyond the seal trap. This is the first optimisation to try.
- **`func_brush`**: an entity and a brush model. `Solidity 1` (the default) is **never
  solid**, which is why a `func_brush` floor with the default settings drops the player
  through; set `2` for collision or `0` for an input-driven toggle.
- **`func_lod`**: the labels in the FGD are `Solid 0` = Solid and `1` = Nonsolid. Use it for
  geometry that is only seen from a distance; the fade is abrupt if the two distances are
  close, so separate them by a few hundred units.
- **`func_areaportal`**: the strongest culling tool and the fussiest. A portal that does not
  fill the opening stops the compile; a portal in a wall that does not actually separate two
  areas does nothing.
- **`func_occluder`**: paid every frame. Put it where a large surface hides a lot of geometry
  (a building corner, a train, a wall), not on every doorway.
- **`func_detail_blocker`**: no runtime cost; it only stops detail sprites, so use it where
  grass would grow through an interior floor.

## Chapter 1 of Santa Monica

The beach-house parapets are `func_detail` in `detail_parapets`; the structural house blocks,
floors and the skybox shell stay in the world. The change removes the parapet cuts from the
BSP split without changing what the player sees or collides with. Recompile and `read_leak`
after the move, as above.
