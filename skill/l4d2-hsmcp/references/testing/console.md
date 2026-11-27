# Console commands for building and testing

The engine is the last oracle. These commands are the ones this project actually uses, with
the traps that make them look broken.

## Reading the log

```
left4dead2.exe -novid -console -allowdebug -insecure -condebug +map <map>
```

`-condebug` writes `left4dead2/console.log`. This is how a script banner, a nav flow warning
or a transition is proved without a human watching the screen.

Usual companions:

| Flag | Why |
|---|---|
| `-insecure` | allows cheats and add-on VScript in a listen server |
| `-allowdebug` | lets the game print why a mission or map was rejected |
| `-dev` | some L4D2 commands only exist in developer mode |

## Nav

Nav is its own workflow, not a console recipe: generation is
[`../nav/generation.md`](../nav/generation.md), and repair plus the full command set
(selection, geometry, attributes) is [`../nav/editing.md`](../nav/editing.md). The launch flags
`-navanalyze` and `-navforceanalyze` analyse the loaded map at startup; neither generates a
mesh from nothing.

## Entities and players

| Command | Notes |
|---|---|
| `ent_fire <target> <input> [param] [delay]` | fires an input; in multiplayer only the server or the listen-server host may use it |
| `ent_info <classname>` | lists the inputs and outputs the engine knows for a class |
| `ent_dump <name>` | prints an entity's keyvalues |
| `setpos <x> <y> <z>` | moves the **local player**; needs `sv_cheats 1` |
| `setpos_player <player> <x> <y> <z>` | moves a specific player |
| `getpos` | prints the current position as a ready-to-paste `setpos` line |
| `director_start` / `director_stop` | restores or stops wanderers, mobs, specials and bosses |

`setpos` is the command that looks broken in an automated run: a `listenserver.cfg` executes
at map load **before the player entity exists**, so the command has no player to move and
does nothing, with no error. For automation, warp through an entity or VScript after the map
is live — `Director.WarpAllSurvivorsToCheckpoint()` is the verified one.

## Campaign

| Command | Notes |
|---|---|
| `developer 2` | verbose mission loading |
| `mission_reload` | re-reads mission files; prints what was accepted and rejected |
| `map <name>` | load a map directly (bypasses the campaign flow) |
| `changelevel <name>` | request a level change |

## Rule

A command is a hypothesis until it runs on this install. Source and L4D2 documentation is
the first place to look — Valve's L4D2 command list, the nav mesh command page, `ent_fire`,
`setpos` — but the console log decides. Commands that need a player, `sv_cheats` or a listen
host fail silently when the condition is missing; "nothing happened" is usually a condition,
not a broken command.
