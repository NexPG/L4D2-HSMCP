# Tanks and witches

Both are spawned by the Director, not by a brush entity. For a deterministic test, `z_spawn`
with cheats is the reliable instrument.

## Spawning

```
sv_cheats 1
z_spawn tank
z_spawn witch
```

On a test map the commands can be issued from a `point_servercommand`:

```
logic_timer OnTimer -> z_spawn_cmd,Command,sv_cheats 1; z_spawn tank
logic_timer OnTimer -> tank_timer,Disable,,0.5,-1
```

The timer must be gated behind the self-test flag; a normal campaign must not spawn a tank
on every load. The test campaign does this with `HSMCP_SELFTEST`.

## What proves it worked

| Entity | Evidence in `console.log` |
|---|---|
| Tank | `Damage Taken from "Tank"`; the tank attacks a survivor |
| Witch | `NOT FIRING because I am very close to a calm witch` |
| Tank death | `Tank killed <player>` if the tank is killed |

`Tank Count = 0` is not proof that no tank exists; it is the Director's counter, not the
entity list. Use the damage line or a screenshot.

## Test result

On `hsmcp_test_m1`, timers at 12 s and 22 s spawned a tank and a witch. `run_map_test`
matched `Damage Taken from "Tank"` in **59 s**; the log also contains the calm-witch line,
and the screenshot shows the death screen with the tank. The test player died, which is
expected with a tank in a small arena.

## Rules

- `z_spawn` needs `sv_cheats 1`; without it the command is refused.
- Do not leave the spawn timers enabled in a shipping campaign.
- A witch is passive until disturbed; the `NOT FIRING ... calm witch` line is evidence that
  the AI sees her, not that she attacked.
- A tank in a small arena will kill the player; for a survival test use cover or a larger map.
