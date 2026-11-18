# `modules/` — the project, by function

One toolkit, not a core with add-ons bolted to the side. Each directory here is a **module**:
the thing that does one job, with everything that job needs — our code in whatever language
fits, and the borrowed implementation it was ported from in `native/`.

A module may be written in more than one language. That is deliberate: a VPK writer that is
only correct because a C++ implementation says so is still one module, and hiding the C++
somewhere else is what made the project look like two.

```
modules/
  formats/     reading and writing Source file formats
    native/    sourcepp — MIT, © 2023 Laura Lewis
  packages/    VPK, addons, packing
  models/      QC, MDL, compiling
```

## What "native" means here

`native/` holds the upstream implementation of that module, kept because a claim like "the
attachment struct is 92 bytes" is worth nothing without the file that says so. It is not a
dependency of the build and never imported by the server; the server talks TypeScript and
Python.

GPL-3.0-only, the same licence as this repository. If a module is better served by changing
that code than by porting it, change it — with a header naming the upstream project and the
change, and an entry in [`../third-party/NOTICES.md`](../third-party/NOTICES.md).

## Where each module is today

The migration is staged. The native halves are in place; our implementation still lives in
`src/` and `sidecar/`, organised by the same concerns:

| Module | Our code today | Native |
|---|---|---|
| `formats` | `src/formats/` (VPK, VMT, QC), `src/kv/`, `src/bsp/vtf.ts` | `modules/formats/native/sourcepp` |
| `maps` | `src/vmf/`, `src/bsp/`, `src/compile/`, most of `src/tools/` | — |
| `hammer` | `src/tools/{hammer,hammerlive,hammerpp}.ts`, `sidecar/hammer_live.py` | — |
| `nav` | `src/bsp/nav*.ts`, `src/tools/navtrouble.ts`, `sidecar/` | — |
| `textures` | `src/tools/{vtf,materials,vmt}.ts`, `src/bsp/materials.ts` | — |
| `scripts` | `src/tools/{vscript,runtime,scene}.ts` | — |

Moving the remaining rows is a mechanical but wide change: paths in `tsconfig.json`,
`package.json`, every relative import and every test. It happens one module at a time, with
the full suite green after each, rather than as one commit that touches everything.

## Building the native halves (not done here)

This machine has no `cmake`, `cl`, `msbuild` or `ninja`, so none of these
trees has been built in this repository. `health` reports the binaries as missing and every
adapter refuses honestly. Do not commit build output.

### `formats/native/sourcepp`

```bash
cmake -S modules/formats/native/sourcepp -B build/sourcepp \
  -DSOURCEPP_BUILD_TESTS=OFF -DSOURCEPP_BUILD_WITH_TBB=OFF
cmake --build build/sourcepp --config Release
```

Interest is in `vpkpp`, `bsppp`, `vtfpp`, `mdlpp`; the rest can be turned off with
`-DSOURCEPP_USE_<LIB>=OFF`. Optional Python bindings exist but the sidecar does not use them.



something this project ships.

```bash
```

`src/cli/_cli.cmake` links `argparse`, `indicators`, `sourcepp::bsppp` and `sourcepp::vpkpp`
Submodules are fetched by CMake at configure time (all MIT);
they are not vendored.


```bash
```

The build manifest declares a licence compatible with this repository.
