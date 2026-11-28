# World dressing: light, postprocess, decals, ropes, sprites

Geometry makes a room; dressing makes it read. These five builders exist because `edit_vmf`
will happily write a `light_environment` with no angles, an `env_tonemap_controller` with
settings it cannot read, or a `move_rope` whose partner does not exist -- and vbsp accepts
all three. Each builder encodes the rule the compiler does not enforce, checks the keys
against the game's own FGD, and reads the entity back after the write.

All five are guarded: pass `confirm: true`. They write through `edit_vmf`, so ids, backups,
outputs and the rest of the file behave as they do there.

## Contents

- Light
- Postprocess
- Spotlights
- Decals
- Ropes
- Sprites, beams and lasers
- Checking the result
- Verified

## Light

```
write_light(path, kind: "point", origin: [0, 0, 96], color: [255, 200, 120], brightness: 300)
write_light(path, kind: "environment", origin: [0, 0, 128],
            angles: [-45, 30, 0], color: [255, 240, 220], brightness: 400,
            ambient: [100, 120, 150], ambientBrightness: 30)
```

- Source packs a light's colour and brightness into **one** key: `_light` is
  `"r g b brightness"`, colour 0-255. There is no separate brightness keyvalue on `light`.
- `light_environment` needs `angles` (and `pitch`, which Hammer writes) or the sun points at
  the floor. Its ambient is `_ambient`, same four-number shape. `SunSpreadAngle` softens the
  shadow edge and is worth setting for an overcast sky.
- `kind: "dynamic"` writes `light_dynamic`, whose `brightness` is a separate key from
  `_light` and whose radius is `distance` + `spotlight_radius`. They are expensive; a room of
  them is a frame-rate decision, not a lighting decision.
- `kind: "sun"` writes `env_sun`: `angles`, `use_angles 1`, `rendercolor`, `size`. The sprite
  is `material` (default `sprites/light_glow02_add_noz`); `overlaycolor`/`overlaysize` control
  the glow it draws over the sky. A sun with no `light_environment` lights nothing -- it is
  only the disc.
- `kind: "shadow"` writes `shadow_control`: `angles` is the shadow direction, `color` the
  shadow tint (grey, 0-255), `distance` the projection distance. One per map is the norm;
  two fight.
- HDR is not a separate entity. `_lightHDR`, `_ambientHDR` and `*ScaleHDR` live on the same
  entities; pass them through `keyvalues` when you are tuning for both.

`style` selects a stock flicker (0 normal, 10 fluorescent, 2 slow pulse, ...). The full list
is in `read_fgd_class(classname: "light")`.

Other lighting classes: `light_directional` is a directional light; `env_lightglow` is the
glow card around a light; `info_projecteddecal` projects a decal; `sky_camera` is the 3D
skybox anchor, documented in [`3d-skybox.md`](3d-skybox.md). `write_light` has no kind for
these; use `write_point_entity`/`edit_vmf` and read the keys from the FGD.

## Postprocess

```
write_postprocess(path, kind: "tonemap", exposureMin: 0.5, exposureMax: 2, bloomScale: 1.1)
write_postprocess(path, kind: "fade", duration: 2, amount: 255, color: [0, 0, 0])
write_postprocess(path, kind: "colorcorrection",
                  correctionFile: "materials/color_correction/dawn.raw",
                  minFalloff: 200, maxFalloff: 1200, maxWeight: 0.8)
```

- `env_tonemap_controller` has **no keyvalues for its settings**. Exposure, bloom and rate are
  inputs. The builder places a `logic_auto` and wires `OnMapSpawn` outputs to
  `SetAutoExposureMin`, `SetAutoExposureMax`, `SetBloomScale` and `SetTonemapRate`. Writing
  those as keyvalues produces a controller that does nothing.
- `spawnflags: 1` marks the controller as master. With two controllers and no master the
  result depends on entity order.
- `env_fade` and `env_shake` do nothing on their own. They are fired by an output
  (`Fade`, `StartShake`) from a trigger or `logic_auto`; the builder writes the entity, not
  the trigger.
- L4D2's colour-correction class is **`color_correction`**, not `colorcorrection` as in some
  other Source games. Its file is a `.raw` under `materials/color_correction`; `minfalloff`
  and `maxfalloff` are the radius where it fades in and out, `maxweight` how strongly it
  applies. The builder warns if the file is missing from the call or lacks `.raw`.
- A `color_correction_volume` (a brush entity) is the other way to scope correction; this
  builder writes the point entity.

## Spotlights

`write_light` covers point/environment/dynamic/sun/shadow; `light_spot` and the two spotlight
effects are written through `edit_vmf` or `write_point_entity`:

```text
edit_vmf(path, ops: [{ op: "add", keyvalues: {
  classname: "light_spot", origin: "0 0 300", angles: "-90 0 0", pitch: "-90",
  _light: "255 240 220 500", _cone: "45", _inner_cone: "20", _exponent: "1" } }])
```

- `_light` is the same four-number colour+brightness as `light`; `_cone`/`_inner_cone` are
  the outer/inner cone in degrees and `_exponent` is the falloff.
- `write_spotlight` writes `beam_spotlight` and `point_spotlight` with their FGD length,
  width, colour, rotation and spawnflags. They are effects, not light sources; pair them
  with a real `light_spot`.
- `write_projectedtexture` writes `env_projectedtexture`; it is a dynamic projected light, so
  it shares the flashlight/muzzle-flash budget. `write_env_zoom` is the player FOV effect,
  not a light.
- Measured fixture: one `light_spot`, one `infodecal` and one `env_beam` compile in a sealed
  room with no leak; the live frame is still a check.

## Decals

```
write_decal(path, material: "decals/blood1", positions: [[0, 0, 1], [64, 0, 1]])
```

- `infodecal` projects onto the surface **under its origin**. The point must be on the face,
  not in the air; a decal in the air is invisible.
- The material is a decal texture (`decals/...`), not an overlay material and not a VMT
  path with `materials/`. The builder warns when the path is outside `decals/`.
- For a decal with a chosen width, height and orientation across a face, use `write_overlay`.
  An overlay is geometry; an infodecal is a projection.
- `LowPriority` lets the engine drop the decal under pressure; `ApplyEntity` attaches it to
  a moving entity.

## Ropes

The constraint classes are a separate family: `phys_hinge`, `phys_ballsocket`,
`phys_ragdollconstraint`, `phys_ragdollmagnet`, `phys_constraintsystem` and `phys_convert` are
documented in [`entity-families.md`](entity-families.md); `write_physics_constraint` covers the
hinge, ballsocket, slide and ragdoll forms.

```
write_rope(path, start: [0, 0, 128], end: [128, 0, 128],
           material: "cable/cable.vmt", width: 2, slack: 25)
```

- A rope is always **two** entities: `move_rope` at the start and `keyframe_rope` at the end,
  linked by `NextKey` on the start. One alone renders nothing.
- Both carry the visual keys (`RopeMaterial`, `Width`, `Slack`, `Subdiv`, `Type`, `Barbed`,
  `Collide`, `Dangling`, `Breakable`). Different values on the two ends is a rope that
  renders differently than it simulates.
- `Type` is 0 rope, 1 semi-rigid, 2 rigid. `Slack` is in world units; 0 is taut.
- More `keyframe_rope` entities can follow, each named by the previous `NextKey`. This builder
  writes the two-point case; add keyframes with `edit_vmf` for a curved rope.
- `move_rope` is the one that moves. Naming the rope lets a `SetParent` or an output move it.

## Sprites, beams and lasers

```
write_sprite(path, kind: "sprite", origin: [0, 0, 64], model: "sprites/glow01.spr", scale: 1)
write_sprite(path, kind: "beam", start: [0, 0, 64], end: [128, 0, 64])
write_sprite(path, kind: "laser", origin: [0, 0, 64], end: [128, 0, 64], width: 3)
```

- An `env_sprite` is a camera-facing card. It needs a `.spr` **model**, not a material; the
  builder defaults to `sprites/glow01.spr` and writes `rendermode 5` (additive), which is what
  makes a glow read as light rather than a square.
- An `env_beam` needs `LightningStart` and `LightningEnd` pointing at **named entities**. The
  builder creates the two `info_target`s when you give it `start` and `end`, so the common
  "beam to nothing" failure cannot happen. `life 0` is permanent; otherwise the beam strikes
  and fades.
- An `env_laser` uses `LaserTarget` and `width` (not `BoltWidth`). The builder creates the end
  target when none is named. `damage 0` is a decorative laser; above zero it hurts whatever
  it touches.
- All three take `rendercolor` + `renderamt`; a beam at alpha 0 is a line nobody sees, which
  is a common "it does not render" report.
- The texture is a `.spr` under `sprites/`. A VMT path here compiles and shows nothing.

## Checking the result

1. `read_fgd_class(classname: "...")` -- the installed game's own keyvalues, inputs and
   outputs. Every builder already does this and reports unknown keys as warnings.
2. `run_compile` with lighting (`run_compile(path, lighting: true)`) -- malformed entity text
   and unknown classes fail here, and a light's actual effect is visible only after vvis.
3. `review_map` -- the one-call audit reports entity problems alongside geometry, budgets and
   organisation.

vbsp accepting an entity does not mean the entity does anything. The rules above are the
difference between a map that compiles and a map that looks lit.

## Verified

`test/tools/dressing.test.ts` writes each entity and reads it back: the `_light` four-number
form, the environment ambient and angles, three separate `OnMapSpawn` outputs in a
`connections` block, the L4D2 `color_correction` class, the `move_rope`/`keyframe_rope` link,
the two `info_target`s a beam needs, and the laser's `width`. The compile case in
`test/vmf/tools-compile.test.ts` puts all of them in the sealed room and requires vbsp to
emit each class in the entity lump.
