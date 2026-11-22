# Map compilation

7 tools: running vbsp/vvis/vrad, the Hammer++ chain, compile logs and sequences.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Compile and run

| Tool | What it does |
|---|---|
| `read_compile_log` | Turns compiler output into structured findings, each with what the message actually means. |
| `read_leak` | Turns a leak into a location. vbsp says only 'leaked!' and writes a .lin pointfile beside the map: this reads it and names the entities nearest to where the path starts, which is the entity that can see the void. Pass the .lin, or the .vmf or .bsp beside it. Both ends of the path are correlated, because vbsp does no... |
| `read_nav` | Reads a .nav mesh header and says whether it still matches its map. |
| `run_compile` | Compiles a .vmf with vbsp, vvis and vrad natively, and returns each stage's findings rather than its raw output. |
| `run_pack` | Packs files into a compiled .bsp with this server's own ZIP writer: no bspzip, no Steam install, no VConfig. |

## Editor Run Map sequences

| Tool | What it does |
|---|---|
| `read_compile_sequences` | Reads the editor's Run Map sequences: which steps are enabled, what each runs and with which parameters. |
| `run_compile_sequence` | Runs one of the editor's Run Map sequences with the editor's own flags, resolving `$path`, `$file`, `$gamedir`, `$bspdir`, `$bsp_exe`, `$vis_exe` and `$light_exe` the way Hammer does. |
