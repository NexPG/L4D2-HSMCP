# Model facing

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

## Doors are not props

A `prop_door_rotating*` origin is the **hinge**, and the leaf runs along the model's local
**+Y** (checkpoint doors: hull `y` -2.6..55.7). `facing` is the wrong question: a door is
placed into an opening by `write_door`/`placeDoor`, which derives the hinge jamb and the yaw
from the opening and the model's hull. Use `write_prop` facing for the furniture and the
vehicles, `write_door` for the door.

## Campaign audit rule

A map built before this table can carry 90/180-degree props. Audit by **model family**, not by
entity: list every instance of the family, compare its yaw with where the front should point,
and correct the model (or the yaw) once. `write_prop` refuses nothing here; the check is a look
and the table.

Measured in Santa Monica 003 and corrected in `build.mjs`:

- `bench001` (`y+`): the three west-side benches at `-1160, y` were `yaw 90` (facing the
  houses, west); `yaw 270` faces the street (east). The safe-room bench at `-820, 2500` and
  the shop benches at `x = -460/+460` were the same 90-degree error; `270/90` faces the room
  and the path. The pier benches at `x = ±420` face outward to the water and are correct as
  placed (`90` west side, `270` east side).
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
