# AI and nav content: rescue closets, remarkables, blockers, hiding spots

The nav mesh is not just walkable ground. The Director and the bots read a second layer on
top of it: rescue-closet areas, hiding spots, nav blockers, and the entities that tell a
survivor to speak. Each has a half in the entity lump and a half in the `.nav`, and a map
with one half is a mechanic that silently does nothing.

## Rescue closet: a point and a nav area

A rescue closet is **two records**:

- `info_survivor_rescue`, the point where the waiting survivors stand;
- a nav area with the **RESCUE_CLOSET** spawn attribute (`65536`; the full flag table is in
  [`../nav/attributes-and-flow.md`](../nav/attributes-and-flow.md)), so the Director
  knows the closet is a rescue and not a normal room.

`write_rescue_closet` writes the point and ordered `info_survivor_position`s. It does not
write nav: mark the area with `write_nav_attribute_region` (RESCUE_CLOSET) or
`write_nav_areas` after generation.

Measured on the stock game: `c1m1_hotel` has 6 points and 4 RESCUE_CLOSET areas,
`c2m5_concert` 3 and 5, `c5m5_bridge` neither (it ends in a finale escape, not a closet).
Two or more areas for the closet is normal because the closet spans several nav areas.

## Remarkable

`info_remarkable` fires a `TLK_REMARK` when a survivor sees it. Its only key is
`contextsubject`, the text placed in the SUBJECT context of the line. Put it on the object
(the graffiti, the corpse, the sign) with `write_point_entity`, not in the floor.

No stock map measured here uses `info_remarkable`, so it is a custom-campaign device rather
than a stock pattern. A point without a subject still fires the concept; it just has no
subject line.

## Blockers and avoidance

- `func_nav_blocker` is a **brush** entity that blocks the nav areas touching its AABB when
  the map loads. It is a runtime blocker, not a generation filter: the areas stay in the
  `.nav` (measured byte-identical output, `references/nav/generation.md`). Use it to keep
  infected out of a closed door or a fence, not to keep scenery out of the mesh. Its
  `affectsFlow` key decides whether it forces flow recomputation.
- `func_nav_avoidance_obstacle` does not remove nav; it makes bots avoid the areas touching
  it. Use it for a hazard the player may cross.
- Both are compiled into the BSP as brush entities; `read_bsp_entities` or `check_ai_contract`
  counts them. Measured: `c1m1_hotel` 9 blockers, `c5m5_bridge` 38.

## Hiding spots

Hiding spots live in the `.nav`, not the VMF. `read_nav_hiding_spots` lists them;
`write_nav_hiding_spots` moves or re-flags an existing record. The flag byte is decoded as
`IN_COVER`, `GOOD_SNIPER_SPOT`, `IDEAL_SNIPER_SPOT` and `EXPOSED`.

Measured: `c1m1_hotel` 760 spots (310 IN_COVER), `c5m5_bridge` 2,037 (282 IN_COVER), and
zero GOOD_SNIPER spots on both. L4D2's stock analyser does not mark sniper spots the way
other Source games do, so a zero sniper count is not a defect.

## One check

`check_ai_contract(path, nav?)` reads the entity lump and, when a `.nav` is present, the nav
records: rescue points against RESCUE_CLOSET areas, remarkables and their subject, blockers,
and hiding spots by flag. It finds a sibling `.nav` when `nav` is not given.

```text
check_ai_contract(path: "workspaces/santa-monica/nav/sm01_beach.bsp")
```

A rescue point with no RESCUE_CLOSET area **fails**; a closet area with no point is a
warning; everything else is a count or information. This is a counting contract. Whether a
bot actually takes the hiding spot, hears the remark or walks around the blocker is a live
play-test.
