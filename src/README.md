# `src/` — the project, by module

Each directory here is a **semantic module**: one job, everything that job needs. Modules are
not divided by language and not divided by which repository a file came from. A module may
hold TypeScript, Python and C++ at once; inside it, the languages sit in their own
directories so nothing is mixed:

```
src/<module>/
  typescript/    the server's implementation of this module
  python/        the sidecar's part of it, when it has one
  cpp/           native code adopted from upstream, when the module needs it
```

The directory name says what the module **does**, the language directory says what it is
written in. That is the whole rule.

## The modules

| Module | What it does |
|---|---|
| `assets/` | What the game already ships: searching content, previewing a model or material |
| `campaigns/` | Mission files, campaign checks, finale stages |
| `core/` | The server itself: configuration, MCP transport, process and filesystem access, the sidecar client |
| `formats/` | Source file formats: VPK, VMT, QC, KeyValues — plus `cpp/sourcepp`, the library that documents them |
| `hammer/` | The open editor: shell channel, menu commands, settings, HLMV, window capture |
| `maps/` | VMF and BSP: geometry, entities, compile, validation, rendering, measuring |
| `nav/` | Navigation meshes: read, generate, diagnose |
| `scripts/` | VScript, runtime commands, scene setup, weather |
| `textures/` | VTF, VMT, materials, cubemaps, skybox |

`index.ts` is the entry point and `registry.ts` composes the tool list. Neither is a module.

## The `cpp/` half

They hold the upstream implementation of that module, kept because a claim like "the
attachment struct is 92 bytes" is worth nothing without the file that says so. They are not a
dependency of the build and are never imported by the server; the server talks TypeScript
and Python.

GPL-3.0-only, the same licence as this repository. If a module is better served by changing
that code than by porting it, change it — with a header naming the upstream project and the
change, and an entry in [`../third-party/NOTICES.md`](../third-party/NOTICES.md).

## Building the native halves (not done here)

This machine has no `cmake`, `cl`, `msbuild` or `ninja`, so none of these
trees has been built in this repository. `health` reports the binaries as missing and every
adapter refuses honestly. Do not commit build output. `tsconfig.json` excludes these
directories, so they cannot reach `dist/`.

### `formats/cpp/sourcepp`

```bash
cmake -S src/formats/cpp/sourcepp -B build/sourcepp \
  -DSOURCEPP_BUILD_TESTS=OFF -DSOURCEPP_BUILD_WITH_TBB=OFF
cmake --build build/sourcepp --config Release
```

Interest is in `vpkpp`, `bsppp`, `vtfpp`, `mdlpp`; the rest can be turned off with
`-DSOURCEPP_USE_<LIB>=OFF`. Optional Python bindings exist but the sidecar does not use them.



something this project ships.

```bash
```

`src/cli/_cli.cmake` links `argparse`, `indicators`, `sourcepp::bsppp` and `sourcepp::vpkpp`
Submodules are fetched by CMake at configure time (all MIT); they are
not vendored.


```bash
```

The build manifest declares a licence compatible with this repository.
