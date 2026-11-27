# Game events: proxy and VScript

L4D2 has two event lists that look interchangeable and are not. A name that exists in one is
not automatically accepted by the other, and a wrong name fails silently in both directions.

## `info_game_event_proxy`

The FGD lists **109 game events** (107 unique names; `exaplin_scavenge_leave_area` is a typo
in the list, and many more events are commented out). Read the installed list with
`read_fgd_class { classname: "info_game_event_proxy" }` instead of copying a value from a
tutorial: a proxy that names an event the game does not fire is silent.

## VScript hooks

The 338 events VScript can hook are a different list — `resource/modevents.res`, exposed by
`read_vscript_api` and checked by `check_vscript_contract`. The hook contract itself is
[`vscript.md`](vscript.md).

A name in one list is not automatically in the other.
