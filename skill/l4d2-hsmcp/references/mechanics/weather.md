# Weather, fog and sky

Left 4 Dead 2 has no `env_rain` or `env_snow`: both are absent from the stock
`bin/left4dead2.fgd` (checked with `read_fgd_class`, 17/11/2026). Weather is one brush entity,
`func_precipitation`, plus `env_fog_controller` for distance fog.

## `func_precipitation`

FGD type: **BRUSH** — it needs a volume, not a point. The brush itself is never drawn; it
marks where precipitation falls.

| Key | Values | Meaning |
|---|---|---|
| `preciptype` | 0 Rain, 1 Snow, 2 Ash, 3 Snowfall, 4 Particle Rain, 5 Particle Ash, 6 Particle Rain Storm, 7 Particle Bugs, 8 Particle Smoke | what falls |
| `renderamt` | 0..100, default 100 | density |
| `rendercolor` | `R G B`, default `100 100 100` | colour |
| `minSpeed`, `maxSpeed` | float, defaults 25 and 35 | snowfall only |

The particle variants (4–8) use the map's particle system; the plain variants are the
engine's own weather.

## `env_fog_controller`

One per map. The fields that matter:

| Key | Default | Meaning |
|---|---|---|
| `fogenable` | 0 | fog on or off |
| `fogcolor` | `255 255 255` | fog colour |
| `fogcolor2` | `255 255 255` | second colour when blended |
| `fogstart`, `fogend` | 500, 2000 | where fog begins and becomes opaque |
| `fogmaxdensity` | 1 | cap on density |
| `fogblend` | 0 | blend between the two colours |
| `foglerptime` | 0 | seconds to lerp to a new setting |

`fogend` must be past `fogstart`; an inverted range hides the map instead of fogging it.

## The tool

```
write_weather(
  path: "my_map.vmf",
  precipitation: {
    kind: "rain",
    mins: [-512, -512, 0],
    maxs: [512, 512, 512],
    density: 80,
    color: [120, 130, 140]
  },
  fog: { color: [90, 100, 110], start: 400, end: 2400, maxDensity: 0.8 }
)
```

It adds the `func_precipitation` entity and its brush, checks the brush with the independent
solid reader, and adds one `env_fog_controller`. It refuses a second fog controller (two
fight each other) and an inverted fog range. It warns when the map has no `skyname`, because
outdoors would not be drawn.

## What is checked and what is not

- **Checked:** both entities are present with the expected keys; the weather brush is a
  valid convex volume owned by `func_precipitation`; the fog range is ordered.
- **Not checked:** whether the rain looks right, whether the density is pleasant, and
  whether the fog hides something it should not. Those are eye questions; compile, load and
  look.
- `read_bsp_entities` proves the entities survived the compile. A visual pass is still
  manual.
