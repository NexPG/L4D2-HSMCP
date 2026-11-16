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

| Command | What it does |
|---|---|
| `sv_cheats 1` | required for every nav command |
| `nav_edit 1` | enters nav editing; without it `nav_generate` does nothing, silently |
| `nav_mark_walkable` | seed point for generation (where the player stands/aims) |
| `nav_generate` | generates the mesh **and runs `nav_analyze` at the end**, saving the file |
| `nav_analyze` | re-analyses the loaded mesh and saves it; this is where flow is computed |
| `nav_save` | saves the mesh |
| `select_with_attribute CHECKPOINT` | highlights the areas carrying an attribute in game (needs `nav_edit 1`) |
| `mark CHECKPOINT` / `nav_clear_attribute CHECKPOINT` | manual attribute editing, an alternative to `func_nav_attribute_region` |
| `nav_gui` | visual selection for bulk marking |

Warnings from Valve's documentation:

- `nav_generate_incremental` deletes JUMP areas and some connections in L4D2. Use it only at
  the start of nav work, not to "touch up" a working mesh.
- `nav_generate` reloads the map when it runs.

Command-line alternatives: `-navanalyze` and `-navforceanalyze` analyse the loaded map at
startup. They do not generate a mesh from nothing.

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
