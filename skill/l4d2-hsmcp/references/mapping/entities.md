# Checking an entity

The installed FGD is the authority, not another Source game and not memory:

```
read_fgd_class(classname: "trigger_finale")
```

It returns every keyvalue, input and output with types and defaults. `read_fgd_class` with no
classname lists classes by prefix, and `read_entity_report` shows what a map already contains.

## Where the L4D2-specific families are documented

| Family | Page |
|---|---|
| Player start, Director, zombie/rescue spawns, item densities, mode switch | [`../mechanics/campaign-wiring.md`](../mechanics/campaign-wiring.md) |
| `info_changelevel`, landmark pair, checkpoint door | [`../campaign/safe-room-and-transition.md`](../campaign/safe-room-and-transition.md) |
| `trigger_finale`, types, escape | [`../campaign/finale.md`](../campaign/finale.md) and [`../campaign/custom-finale.md`](../campaign/custom-finale.md) |
| Nav attributes, blockers, avoidance | [`../nav/attributes-and-flow.md`](../nav/attributes-and-flow.md) and [`../mechanics/ai-and-nav-content.md`](../mechanics/ai-and-nav-content.md) |
| Triggers, movers, logic, props, constraints, ladders, scenes | [`entity-families.md`](entity-families.md) |
| Class-by-class coverage of the stock maps | [`../mechanics/entity-coverage.md`](../mechanics/entity-coverage.md) |

The one rule that covers all of them: an entity that exists is not an entity that works. The
compiled map, the lint and a live probe answer different questions; use the page above for the
one you are asking.
