# Tests

The suite mirrors `src/`. A test lives in the directory of the module it drives, so the layout
answers "where is the test for this file" without a search.

| Directory | Covers |
|---|---|
| [`audio/`](audio/) | sound: WAV format reading/conversion and soundscripts |
| [`bsp/`](bsp/) | compiled-map readers: header, lumps (including LZMA), geometry, entities, nav, limits, materials, pakfile |
| [`vmf/`](vmf/) | source maps: create, edit, splice, brushes, faces, displacements, fittings, wiring, lint |
| [`space/`](space/) | offline measurement: traces, rooms, clearance, visibility, dimensions |
| [`render/`](render/) | offline views, plans, tours |
| [`compile/`](compile/) | compilers, logs, leaks, toolchains, rename |
| [`nav/`](nav/) | navigation mesh: area attributes, L4D2 spawn attributes, in-place patching, directional connections |
| [`formats/`](formats/) | shared formats: DMX datamodels read/write |
| [`textures/`](textures/) | textures: PNG decode, VTF write/convert/extract, DXT |
| [`hammer/`](hammer/) | editor data: build registry and hash lookup, window cleanup |
| [`campaign/`](campaign/) | mission files, convars, addons, finale contract |
| [`game/`](game/) | game-directory staging: hide/restore archives, install a BSP/nav pair |
| [`kv/`](kv/) | KeyValues parse/serialise |
| [`tools/`](tools/) | tool contracts and their own suites: output schemas, parity, overlays, instances, skybox, VScript, game runtime |
| [`support/`](support/) | shared env, `global-setup`, helpers, and the layout checks that enforce these rules |
| [`fixtures/`](fixtures/) | real files the suite reads: probe BSP/VMF, logs |

Rules:

1. **Match `src/`.** A new test goes into the directory named after the module it exercises;
   a tool-level contract test goes in `tools/`.
2. **Fixtures are shared.** Never copy a fixture into a test directory; read it through
   `FIXTURES` from `support/env.ts`.
3. **A skipped test says why.** `has.*` predicates and the global setup print what the run
   could not test; a silent skip is a lie.
4. **No flat dumping.** A new `.test.ts` at the `test/` root is a structural defect.

Run everything with `pnpm test`; run one file with
`pnpm exec vitest run test/bsp/bsp.test.ts`.
