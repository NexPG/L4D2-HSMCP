# Cleaning up after a game run

The game directory is the user's installation, not a scratch directory. Every experiment that
writes into it must restore it, even when the experiment fails. Do the work in a `try/finally`
or a tool that has one, not by hand afterwards.

## Interrupted runs

`check_game_state` reports the leftovers (and `restore: true` restores the backups and
hidden archives). `run_map_test` and `run_nav_generate` run the same sweep before a launch.

A killed run can leave `cfg/listenserver.cfg` holding `sv_cheats 1` and a `map <test map>`
line. The next launch would execute it and auto-load the test map, so the sweep treats a file
whose **first line is the harness's `sv_cheats 1`** as its own: it restores
`listenserver.cfg.hsmcp-backup` when that exists, and otherwise rewrites the stock blank
comment. A file the user wrote (`hostname ...`) is never touched. Measured: a killed run left
53 `Host_NewGame` lines behind and `clean: false`; `restore: true` put the install back to
`clean: true` in one call.

`run_map_test` and `run_nav_generate` sweep `<file>.hsmcp-backup` in `cfg/`, `maps/` and
`scripts/vscripts/` before launching. That restores a previous `listenserver.cfg`, map or
script even when the earlier process was killed before its `finally` could run. `.vpk.off`
archives are restored at the same point. The count is returned as `stateRestored`.

A test that is killed still deserves the checklist below; the sweep is a safety net, not a
licence to interrupt runs.

## Before the run

1. List what you are about to change. A test map, a `materials/maps/<map>/` directory, a
   `.nav`, a temporary VPK, a backup suffix.
2. If a file already existed and will be modified (for example a Valve map), copy it to a
   backup with a name **you will remove**, and record its size/hash.
3. Prefer a copy with a test name over modifying a shipped map. If the map must keep its
   name for the engine to derive paths, back up and restore. A **stock** BSP is not a probe
   host: renaming it breaks its `materials/maps/<name>/` pakfile paths, and an edited copy
   has hung at the loading screen. Use a custom map.
4. Hide add-ons that can shadow a loose map (`run_nav_generate` takes `addonsToHide`).
   A mounted VPK can win over `left4dead2/maps/<map>.bsp`, and then the injected entities
   never load.

## After the run — the checklist

- [ ] Delete test `.bsp` files from `left4dead2/maps/`.
- [ ] Delete test `.nav` and `_nav.txt` files.
- [ ] Delete `left4dead2/materials/maps/<test>/` if it was created for the run.
- [ ] Delete temporary VPKs and `.off`/`.bak` copies you created.
- [ ] Restore every modified original from its backup.
- [ ] Confirm the original entity lump has no test entities (`read_bsp_entities` or
      `readEntityLump`).
- [ ] Confirm no `hsmcp_*` test names remain in `maps/`, `materials/maps/`, `models/` or
      `addons/`. `check_game_state` lists `testModels` for the `models/` case.
- [ ] Remove scratch directories outside the game (`%TEMP%` extracts, VPK dumps).

## What is normal and can stay

- `left4dead2/console.log`: the engine writes it on every run and it is the evidence a test
  cites. Keep it unless the run was a throwaway and the log is only noise.
- Valve/Steam files you never touched.

## Windows

A tool that opens an editor or the game closes it by default and **verifies** the close:
`run_hlmv` and `open_in_hammer` return `closed` and the pids in `closedProcesses`,
`run_map_test` returns `gameClosed`. `closed` is true only after the process list was
re-read and the pid is gone, not because a `taskkill` was spawned.

A game-launching tool refuses to start while `left4dead2.exe` is already running, unless
`replaceRunningGame: true` is passed. It kills the pid it launched, never the image name, so a
run cannot take down a game someone else started.

- Only pids that appeared **after** the tool's own launch snapshot are touched. A person's
  HLMV or Hammer is never a target.
- `<stateDir>/windows.json` records a window before its launch and removes it after a
  verified close. The MCP server sweeps this ledger at startup, so a server stopped
  mid-call finishes the cleanup next time instead of leaving HLMV on the desktop.
- `close_windows` is the manual path for `close:false` leftovers or an older window:
  `dryRun: true` first, Hammer is asked to close through its window and is only force-killed
  with `force: true`.

## Why this is a rule

A leftover test map can be loaded by accident, a test `materials/maps/<name>` can make a
later build pick up stale cubemaps, and an injected entity in a shipped map is a silent bug
in the user's game. The cleanup is part of the experiment, not an afterthought.
