# Survival mode

Survival is a mission mode, not a separate map format. The map needs a playable nav, a
spawn, and a mission file that lists it under `survival`.

## Mission entry

```
"modes"
{
    "survival"
    {
        "1"
        {
            "Map"         "my_map"
            "DisplayName" "Survival"
        }
    }
}
```

`write_campaign` writes this with `modes: [{ name: "survival", chapters: [...] }]`.

## Running it

```
run_map_test({
  map: "my_map",
  waitFor: "Loading: [0-9]",
  extraArgs: ["+mp_gamemode", "survival"]
})
```

The `+mp_gamemode` must come before `+map`; `run_map_test` puts `extraArgs` there.

## What proves it

- the game loads the map, not the main menu;
- the Survival HUD is visible: a timer starting at `00:00.00` and the survival-icon panel;
- `console.log` reaches `Loading: <n> seconds`;
- the HUD and the mode marker are stronger evidence than a map name alone.

The test campaign's `hsmcp_test_m1` was run this way and the captured frame shows the
Survival timer. That proves the mission mode and map load; it does not yet time a full
survival wave.

## What is still required for a shipping Survival map

- a nav mesh that is fresh against the final BSP;
- a spawn area the Director can use;
- a mission file whose base name matches the VPK;
- no `trigger_finale` requirement in this test: the mode started from the map alone. A map
  that only finales can start may need a `trigger_finale`; verify per map.

## Pitfalls

- `Unknown command: survival_record` is a harmless client-side console line in this setup.
- If the map name is in a mission without a `survival` mode, the game may fall back to the
  menu; check the mission file and `mp_gamemode`.
- No `.nav` means `NAV ERRORS — Map is unplayable!`, even in Survival.
