# Map atmosphere: one environment set, not one fog controller

Official L4D2 maps carry **1–9 `env_fog_controller` entities (most 2–3)**, 2–5
`postprocess_controller`, colour correction volumes, global/infected/ghost tonemaps,
`env_sun`, `shadow_control` and `env_wind`. A single hand-built fog controller is the flat
version of that. The source `c1m1_environment_ents.vmf` is the measured example: 6 fog, 3
postprocess, 3 colour correction, 3 tonemap, sun/light/shadow.

## The six layers

1. **Distance fog** — one `env_fog_controller` per area/state. Only one is enabled at a time;
   the others are `fogenable 0` and are switched by `TurnOn`/`TurnOff` (or the `Set*`
   inputs) from a `trigger_multiple`/`logic_relay`. Two controllers are not two fogs at once;
   they are the same fog with different values.
2. **Interior fog** — a second controller with a shorter `fogstart`/`fogend`, enabled by the
   safe-room or interior trigger. A `fog_volume` is the brush volume that decides where the
   change happens.
3. **Postprocess** — `postprocess_controller` per exterior/interior/smoke state. They are
   volumes, not global keys; `SetLocalContrastStrength` etc. are inputs.
4. **Colour correction** — `color_correction` volumes (`filename` points at a
   `materials/color_correction/*.raw`), with `minfalloff`/`maxfalloff`/`maxweight`.
5. **Tonemaps** — one `env_tonemap_controller` each for global, infected and ghost. The
   settings are inputs; `write_postprocess` adds the `logic_auto` that applies them at map
   spawn (the key mechanics are in [`world-dressing.md`](world-dressing.md)).
6. **Sun, shadow and wind** — `light_environment` (sun colour + ambient), `env_sun` (the
   visible disc), `shadow_control` (direction/colour/distance) and `env_wind`.

## Build it

```text
# 1. sun, ambient and the visible disc
write_light(path, kind: "environment", origin: [0,0,1200], angles: [-52,245,0],
            color: [255,242,216], brightness: 850,
            ambient: [140,160,188], ambientBrightness: 190, confirm: true)
write_light(path, kind: "sun", origin: [0,0,1200], angles: [-52,245,0], confirm: true)
write_light(path, kind: "shadow", origin: [0,0,0], color: [40,48,60], brightness: 120,
            confirm: true)

# 2. fog controllers and wind: edit_vmf, because write_weather refuses a second fog
edit_vmf(path, ops: [
  { op: "add", keyvalues: { classname: "env_fog_controller", targetname: "fog_exterior",
    fogenable: "1", fogcolor: "190 202 214", fogstart: "1200", fogend: "5200",
    fogmaxdensity: "0.55" } },
  { op: "add", keyvalues: { classname: "env_fog_controller", targetname: "fog_interior",
    fogenable: "0", fogcolor: "120 110 100", fogstart: "256", fogend: "900" } },
  { op: "add", keyvalues: { classname: "env_wind", minwind: "20 20 20",
    maxwind: "40 40 40", mingust: "10", maxgust: "20", gustduration: "5" } }
])

# 3. tonemaps and a colour-correction volume
write_postprocess(path, kind: "tonemap", targetname: "tonemap_global",
                  exposureMin: 0.5, exposureMax: 1.5, bloomScale: 1, tonemapRate: 0)
write_postprocess(path, kind: "tonemap", targetname: "tonemap_infected", ...)
write_postprocess(path, kind: "tonemap", targetname: "tonemap_ghost", ...)
write_postprocess(path, kind: "colorcorrection", origin: [0,0,64],
                  correctionFile: "materials/color_correction/dawn.raw",
                  minFalloff: 200, maxFalloff: 1200, maxWeight: 0.8)
```

`write_weather` writes **one** fog controller and refuses a second: that is right for a
one-zone map and wrong for an atmosphere set. Use the recipe above for multiple zones; the
tool's precipitation and fog keys are in [`../mechanics/weather.md`](../mechanics/weather.md).

## Switch states at runtime

```text
logic_relay(OnTrigger) -> fog_interior:TurnOn
trigger_multiple(OnStartTouch) -> fog_exterior:TurnOff, fog_interior:TurnOn
```

Only the active controller's values are used. A controller left enabled together with another
is a race; disable the old one first. The stock maps do this with a trigger at the safe-room
door or a `logic_auto` on spawn.

## Check without the game

- `read_vmf_lint`: unknown class/key; the official `heightFog*`/`fadetoblackstrength`/
  `maxdxlevel` keys are tolerated on their classes.
- `run_compile` with `vbsp`: a point entity outside the sealed hull (a sun at z=1200 above a
  384-high test room) makes the map leak; keep the sun and controllers inside the hull.
- `read_bsp_entities(histogramOnly)`: expected counts for the measured fixture are
  `env_fog_controller 3`, `env_tonemap_controller 3`, `color_correction 1`, `env_sun 1`,
  `shadow_control 1`, `env_wind 1`, `light_environment 1`.
- Screenshot: deferred while the game launch is paused; use `run_map_test` when it is back.
