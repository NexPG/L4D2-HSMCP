# Model facing and tilt

A `.mdl` does not store which way is "front". The hull is often symmetric, and
`read_model_info` returns bounds, not an orientation. A model placed at yaw 0 can face any of
four directions; the only authority is a look at the model.

`write_prop` makes the decision explicit:

```jsonc
{
  "model": "models/props_urban/bench001.mdl",
  "facing": 270,          // world yaw the front should point at; 0 = +X, 90 = +Y
  "modelForward": "y+",   // the model's own front axis, from the table below
  "yawOffset": 0          // per-model correction
}
```

The written yaw is `facing - modelForwardYaw + yawOffset`, where `x+`/`y+`/`x-`/`y-` are
0/90/180/270. `modelYaw()` is the same function the tool uses, and it is unit-tested. Leave
`facing` out to write `angles` literally; `yawOffset` is added in both modes.

## The measured table

Each row was measured by rendering the model in the engine's preview room with the camera on
world **-X**, looking toward **+X**, and reading which face is toward the camera: a front means
the model's forward is `x-`, a back means `x+`, and a side means `y+` or `y-`.

| Model | Family | Front axis | Yaw offset | Evidence |
|---|---|---|---|---|
| `models/props_vehicles/cara_95sedan.mdl` | car | `x+` | 0 | preview: the rear (trunk, plate, tail lights) faces the -X camera; the nose points +X |
| `models/props_urban/bench001.mdl` | bench / chair | `y+` | 0 | preview: side view; backrest at -Y (screen right), seat front at +Y |
| `models/props_fairgrounds/foodcart.mdl` | food cart | `x-` | 0 | preview: the serving counter and windows face the -X camera; the long sides are ±X |
| `models/props_vehicles/helicopter_rescue.mdl` | helicopter | `x-` | 0 | preview: cockpit windshield, red/green navigation lights and rotor face the -X camera |
| `models/props_fairgrounds/arcadegame01.mdl` | arcade cabinet | `x+` | 0 | preview: the plain rear panel faces the -X camera, so the screen side is +X |
| `models/props_fairgrounds/ferris_wheel_01.mdl` | Ferris wheel | — | 0 | structural: the wheel plane is the orientation, not a nose; yaw turns the plane |
| `models/props_fairgrounds/concession_sign_01.mdl` | sign | — | 0 | a flat sign: its width is local Y, so keep the plane parallel to the wall (yaw 0/180) |

A family row is not a promise about every model in it. Cars in particular mix forward axes;
measure the exact `.mdl` you place. `read_model_info` names the model, and `preview_model` is
the look. If one view is ambiguous, use `preview_model` `view: "back"|"left"|"right"`; the
table was measured from `view: "front"` (the camera on world -X, looking +X).

**A full catalogue is future work** (workstream G in the diary): bounds, `.phy`,
`$staticprop`, forward axis and confidence for every model. Until it exists, an unlisted model
is measured on the spot with the four views and its row is appended here; never default to
`x+` without looking.

## Props on a slope: roll, not pitch

Source `angles` are **pitch yaw roll**. A model whose long axis is local **Y** (an escalator,
a handrail, a ramp prop) is tilted along that axis by **roll** (the third number), not pitch.
For a ramp climbing +Y, positive roll raises the +Y end: `angles "0 0 23"`. Negative roll
sinks it into the floor. A model long on **X** uses pitch instead. Verify the sign in game:
the old escalator used `-23`, which tilted it against the 23-degree ramp.

## Doors are not props

A rotating door's origin is the **hinge**, its leaf runs along local **+Y**, and it is placed
into an opening by `place_door`/`placeDoor`. Do not use `write_prop` facing for a door; the
sizes, hinge math and swing clearance are in [`doors.md`](doors.md).

## Campaign audit rule

A map built before this table can carry 90/180-degree props. Audit by **model family**, not by
entity: list every instance of the family, compare its yaw with where the front should point,
and correct the model (or the yaw) once. `write_prop` refuses nothing here; the check is a look
and the table.

Measured in Santa Monica 003 and corrected in `build.mjs`:

- `bench001` (`y+`): the three west-side benches at `-1160, y` were `yaw 90` (facing the
  houses, west); `yaw 270` faces the street (east). The safe-room bench at `-820, 2500` and
  the shop benches at `x = -460/+460` were the same 90-degree error; `270/90` faces the room
  and the path. The four pairs at `x = ±420, y = 4800..5700` were removed from the finale
  approach: on that narrow strip a solid bench left 15 nav areas that could not reach the
  finale. They keep collision at the midway, where the walkway is wide enough.
- `foodcart` (`x-`): the shop carts at `x = -380/+380` and the two at `±380, 5200` were
  `0/180` (serving sides outward); `180/0` turns the counters toward the centre path.
- `helicopter_rescue` (`x-`): the finale helicopter was `yaw 270` (nose north, away from the
  team); `yaw 90` points it south, toward the approach.
- Shop wall props: `concession_sign` and `arcadegame01` have flat fronts on local X, and
  `door_urban_double01` has its leaf on local Y. The build gave all three the bay window's
  `90/270`; the correct wall-plane yaw is `0/180` (west row) and `180/0` (east row). The bay
  window itself keeps `90/270`, because its width is local X.

The car rows were not changed: `cara_95sedan` is `x+`, so the `90/270` yaws put the parked
cars along the north-south street, which is correct. The hatchbacks share the road but were
not measured individually; the family note applies.
