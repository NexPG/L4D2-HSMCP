# `vendor/` — upstream source kept for reference and future builds

This directory holds third-party source trees that this project either ports from or
would call as an external tool. They are **not** part of the MCP server's build, are not
published in the npm package (`package.json` ships `dist/` only), and nothing here is
compiled by `pnpm build`.

They are kept in the repository for one reason: `.3d-projects/` was a temporary local
folder and will be deleted. If the source disappears, every future port becomes guesswork.
`LICENSE` files are included verbatim with each tree.

> **Licence compliance is mandatory.** Each tree keeps its own `LICENSE`. Nothing here is
> relicensed by this project's GPL-3.0-only. Read `../THIRD-PARTY-NOTICES.md` before you
> copy anything out of these directories.

## What is here

| Directory | Upstream | Licence | Copyright | Why |
|---|---|---|---|---|
| `sourcepp/` | [craftablescience/sourcepp](https://github.com/craftablescience/sourcepp) | MIT | © 2023 Laura Lewis | Source format libraries: `vpkpp` (VPK read/write), `bsppp` (BSP), `vtfpp` (VTF), `mdlpp` (MDL), `kvpp`, `dmxpp`, `fspp`, `gamepp` |

Removed on import: `.git/`, `.github/` (their CI is not ours to run). Everything else is
byte-for-byte upstream as of 2026-11-18.

## Build status: not built here

This machine has no `cmake`, `cl`, `msbuild` or `ninja`, so none of these
trees has been compiled in this repository. That is a deliberate, recorded limitation:

- the TypeScript/Python side never imports them;
- any adapter that would call them refuses with "not installed" instead of failing obscurely.

If you install the toolchains, these are the commands that produce the binaries the
adapters look for. Do not commit build output.

### `sourcepp/`

```bash
cmake -S sourcepp -B build/sourcepp -DSOURCEPP_BUILD_TESTS=OFF -DSOURCEPP_BUILD_WITH_TBB=OFF
cmake --build build/sourcepp --config Release
```

Interest is in `vpkpp`, `bsppp`, `vtfpp`, `mdlpp`. Turn the rest off with
`-DSOURCEPP_USE_<LIB>=OFF` if the build is slow. Optional Python bindings exist
(`-DSOURCEPP_BUILD_PYTHON_WRAPPERS=ON`) but our sidecar does not use them.



something this project ships.

```bash
```

`src/cli/_cli.cmake` links `argparse`, `indicators`, `sourcepp::bsppp` and


Submodules are **not** vendored; CMake fetches them at configure time:

| Submodule | Licence |
|---|---|
| `craftablescience/cmake-helpers` | MIT |
| `p-ranav/argparse` | MIT |
| `p-ranav/indicators` | MIT |
| `craftablescience/discord-rpc-clean` | MIT (GUI only) |
| `craftablescience/sourcepp` | MIT |

`sourcepp/ext/` does ship in-tree: `half` (MIT), `stb` (MIT / public domain), `ice`
(see `sourcepp/THIRDPARTY_LEGAL_NOTICES.txt`).


```bash
```

The build manifest declares a licence compatible with this
repository. Its dependencies are pinned in
the lock file and fetched at build time; they are not vendored.

## Rules for this directory

1. **Do not edit upstream files.** A fix belongs in our own source, or in a patch file with
   a comment saying which upstream commit it applies to. Editing in place makes the next
   upstream comparison impossible and hides our changes from the licence record.
2. **Never import from a tree without a `LICENSE`.** If a directory here ever lacks one,
   it is reference-only and the rule in `../THIRD-PARTY-NOTICES.md` applies.
3. **Porting is a port, not a copy.** Files that move from here into `src/` or `sidecar/`
   start with a header naming the upstream project, the licence and the change.
