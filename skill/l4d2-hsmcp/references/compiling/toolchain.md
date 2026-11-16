# Compiling

Compilation is the slowest step in the pipeline, so everything cheap runs first: rules,
sealing, lint, entities.

## Order

1. `check_vmf_rules` — the map's own `rules.json`, if it has one.
2. `read_vmf_leak` — sealed or not, in seconds, without a compiler.
3. `read_vmf_lint` — against the installed `left4dead2.fgd`.
4. `run_compile` — vbsp, vvis, vrad.

A leak or a lint error found after a compile wastes minutes; found before, it costs seconds.

## Toolchains

- **Stock** — `vbsp.exe`, `vvis.exe`, `vrad.exe` from the game's `bin/`.
- **Tools++** — `vbsp++.exe`, `vvis++.exe`, `vrad++.exe`, accepted as either `vbsp++` or
  `vbspplusplus`. `run_compile` uses it when asked and falls back to stock, naming the chain
  that ran.

The two chains can produce different geometry from the same source. That is not automatically
a bug; record which chain built the map.

## Reading results

`run_compile` returns per-stage exit codes and findings, not raw output. A non-zero exit is a
stop. `read_compile_log` turns a log into structured findings if a stage was run elsewhere.

Limits are per stage and per chain: `read_map_geometry` reports what a compiled map holds and
how close it is to the ceiling. Trust the table in that result, not remembered numbers.

## What success looks like

```
sealed: true
lint:   0
compile: plusplus true vbsp:0 vvis:0 vrad:0
```

Both maps in a campaign must reach that state. A map that compiles with warnings can still be
unplayable — nav and entities are separate checks.
