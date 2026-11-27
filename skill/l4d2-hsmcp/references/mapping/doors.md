# Doors

A door is a rotating model whose **origin is the hinge**, placed into an opening that fits it.
It is not a prop with a facing, and it does not cut its own hole in a wall.

## Models and openings

Measured on the installed game, 2026.

| Model | Hull (units) | Opening | Use |
|---|---|---|---|
| `models/props_doors/checkpoint_door_02.mdl` | 58.3 x 105.8 | 64 x 112 | safe-room / checkpoint door |
| `models/props_doors/checkpoint_door_01.mdl` | 68.4 x 105 | 72 x 112 | wider safe room |
| `models/props_doors/checkpoint_door_-02.mdl` | 58.3 | 64 x 112 | mirrored leaf |

A 128- or 256-unit opening around a 58-unit door is a hole beside the door, not a doorway.
`read_vmf_lint` reports `l4d2-door-opening-too-wide` / `-too-narrow`.

## Place the hinge, not the centre

The leaf runs along the model's local **+Y**. For `checkpoint_door_02` the hull is
`-2.6..+55.7` on local Y, so the origin sits at one jamb and the leaf extends one way.

- Put the entity origin about **2 units inside the jamb**, not in the middle of the opening.
- With `angles "0 90 0"` the leaf's local +Y turns to world **-X**, so the hinge belongs on the
  **+X** jamb (`x = opening.max - 2`). Yaw 270 puts it on the -X jamb.
- `placeDoor` in `src/maps/typescript/vmf/door.ts` derives this from `read_model_info` bounds
  and the opening; the `place_door` tool uses it. Do not hand-place a rotating door.
- Keep the leaf's width + 16 units clear of props; `read_vmf_lint` reports
  `l4d2-door-swing-blocked` for a bench or crate inside the arc.
- `read_vmf_lint` reports `l4d2-door-hinge-at-center` when the origin is more than 8 units from
  both jambs.

## Checkpoint doors are resolved by class

The engine picks the checkpoint door by **class near the transition's `info_landmark`**, not by
name. `checkpoint_exit`/`checkpoint_entrance` are canonical advice; 20 of the 57 stock chapters
leave the door unnamed and still transition. The transition contract — `info_changelevel`,
landmark pair, nav CHECKPOINT — is in
[`../campaign/safe-room-and-transition.md`](../campaign/safe-room-and-transition.md).

## Related

- Why a door is not a prop for `write_prop` facing: [`model-facing.md`](model-facing.md).
- Door models and other stock assets: [`../assets/models.md`](../assets/models.md).
- Every prop a ghost because `solid` was omitted: [`../../troubleshooting/props-no-collision.md`](../../troubleshooting/props-no-collision.md).
