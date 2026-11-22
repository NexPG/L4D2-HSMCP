# Workflow: the editor's own Run Map sequence

`run_compile` chooses this project's flags. A mapper's F9 uses the editor's sequence, which
may carry `-StaticPropLighting`, a different `-game`, a Copy File step, or a step that is
disabled. `run_compile_sequence` is the faithful counterpart.

## 1. Read what the editor would run

```
read_compile_sequences({ exeDir: "<game>/bin" })
```

It understands the binary `CmdSeq.wc` and the KeyValues files Hammer++ and Strata write. Each
step has `enabled`, `stage`, `run`, `parameters`, `ensureCheck`, `ensureFile`, `noWait` and
the named `kind` for a special step (`copy-file`, `delete-file`, `rename-file`,
`change-directory`, `copy-file-if-exists`).

If a step is disabled, it is still listed; "the Copy File step is unchecked" is exactly the
kind of thing that makes a build produce nothing while reporting success.

## 2. Dry run against the map

```
run_compile_sequence({
  vmf: "<map>.vmf",
  sequence: "Fast",
  dryRun: true
})
```

The dry run resolves Hammer's variables and checks every step without touching the disk:

| Variable | Meaning |
|---|---|
| `$path` | the map's directory |
| `$file` | the map name without `.vmf` |
| `$gamedir` | the game's `-game` directory |
| `$bspdir` | `<gameDir>/maps` |
| `$bsp_exe`, `$vis_exe`, `$light_exe` | the chosen toolchain's compilers |
| `$game_exe` | the game executable; the step is skipped, not launched |

`$bspdir` is the engine's map directory. Hammer++ keeps its own `BSPDir` in
`hammerplusplus_gameconfig.txt`; if a Copy File step uses a different directory, the result
says so.

## 3. Run it

```
run_compile_sequence({
  vmf: "<map>.vmf",
  sequence: "Fast",
  confirm: true
})
```

It runs the compilers and the file steps, checks `ensure_check`, and stops at the first
failure. The game is never launched: `$game_exe` is reported skipped. An executable that is
not one of the three compiler aliases is refused, because a config file does not get to name
an arbitrary binary.

## 4. Choose the right builder

- `run_compile_sequence` for "reproduce what the mapper sees".
- `run_compile` for `func_instance` maps (the sequence runner refuses them because vbsp
  crashes on an unexpanded instance), for a cordon-filtered compile, and for a clean chain
  that does not depend on one person's editor settings.
- `read_compile_log` for a log either one produced.

## Gotchas

- The sequence runs against the source map; an active cordon is not applied. `run_compile`
  applies it the way Hammer does.
- `ensure_check` fails a step whose file is absent afterwards; that is a real failed build,
  not a warning.
- A disabled Copy File step leaves the `.bsp` beside the map and not in `maps/`; that is why
  the installed map is missing.
