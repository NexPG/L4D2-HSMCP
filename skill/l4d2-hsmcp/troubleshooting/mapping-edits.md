# Mapping edits: symptom, cause, check, fix

For the file-level operations. Campaign problems have their own pages.

## A pasted prefab is not where it should be

| Step | What to do |
|---|---|
| Symptom | The prefab is inserted, but its brushes or entities sit somewhere unexpected |
| Cause | `move` is added after `rotate`, and rotation is about Z through `pivot`; a point entity without an `origin` cannot move, and a nested `func_instance` is not expanded |
| Check | `read_vmf_solids` on the ids returned in `newSolidIds`; `read_entity_report` with `targetname`/`classname` for the entities; read the `warnings` array |
| Fix | Re-run `insert_prefab` with the intended `pivot`/`move`, or `transform_solids` the new ids. Restore the backup if the paste landed in the wrong file |

A prefab is a one-time paste. If the source changes later, the map does not; use
`write_instance` for a live link.

## A pasted prefab is invisible

| Step | What to do |
|---|---|
| Cause | The brush is inside a wall, has a missing material, is a hidden solid inserted visibly, or is a `func_instance` whose file does not exist |
| Check | `read_vmf_solids` (volume and owner), `read_map_dependencies` after compile, `read_vmf` with `collapseInstances` |
| Fix | Move it into open space; query the material with `read_game_content`; pack the instance file; compile and look |

A missing material is a purple checkerboard, not an absent brush. The vbsp warning names it.

## Texture looks skewed the wrong way

| Step | What to do |
|---|---|
| Cause | `uaxis`/`vaxis` are world-space vectors, not angles. The offset is in texels and the scale is texels per unit. An axis parallel to the face normal is refused |
| Check | `read_vmf_solids` reports `texture-axis-along-normal`, `zero-texture-scale` and `degenerate-texture-axis`; `changed[].uaxis`/`vaxis` echo what was written |
| Fix | Set both vectors explicitly, or fall back to `align_faces` with `world`, `face` or `fit`; copy a known-good pair with `copy_face_alignment` |

`set_face_uv` keeps an omitted vector, so changing only `uShift` is safe. Rotating a face's
texture does not rotate the brush.

## Hammer++ draws a moved brush where it used to be

| Step | What to do |
|---|---|
| Cause | A stale `vertices_plus` block: Hammer++ reads the exact face loop before the plane |
| Check | Search the side for `vertices_plus`; the current tools move or drop it on geometry edits |
| Fix | Update the toolkit; re-run the edit, or remove the stale block by re-saving in Hammer++. A new brush has no block and Hammer++ derives one |

If a transform is done by an external script, it must update `vertices_plus` too.

## An overlay disappeared after a clip

| Step | What to do |
|---|---|
| Cause | `clip_solids` changes the face loop and the side ids; an overlay names the face it was on |
| Check | `read_entity_report` with `classname: "info_overlay"` and its `sides` value; compare with `read_vmf_surfaces` |
| Fix | Re-create it with `write_overlay` on the surviving side; `copy_face_alignment` does not carry overlays |

Hammer++ preserves overlay faces itself; the file-level clip documents the loss rather than
silently leaving the entity pointing at a face that no longer exists.

## A brush entity did not move with the prefab

| Step | What to do |
|---|---|
| Cause | Older `insert_prefab` moved only world solids |
| Check | `version` in `health` or the changelog; current versions move every inserted solid |
| Fix | Update, restore the backup, paste again. If the geometry is already wrong, `transform_solids` the returned ids |

## Related

- `references/tools/primitives.md` — which call is the general operation.
- `references/mapping/hammer-coverage.md` — every Hammer++ feature and its tool.
- `references/testing/game-environment-cleanup.md` — remove test maps and screenshots.
