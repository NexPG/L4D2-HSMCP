# Cubemaps do not build

`buildcubemaps` is an engine command, not a compiler stage. It captures the six faces of
every cubemap sample in the loaded map and writes `.vtf` files under
`left4dead2/materials/maps/<map>/`. The map must be loose, writable, and already contain
cubemap samples.

## What a cubemap sample is

`env_cubemap` is an **internal entity**. vbsp turns it into an entry in the BSP's CUBEMAPS
lump and removes it from the entity lump, so:

- a compiled map can have cubemaps with **zero `env_cubemap` entities** in its entity lump.
  Verified on `c1m1_hotel.bsp`, `c2m1_highway.bsp` and `c5m1_waterfront.bsp`: no cubemap
  classname in the entity lump, non-empty CUBEMAPS lump (1344, 1008 and a few hundred bytes);
- adding `env_cubemap` to a compiled `.bsp` at runtime gives
  `Attempted to create unknown entity type env_cubemap!` — the entity is created at compile
  time, not spawned by the engine. Put it in the `.vmf` and recompile.

A map with no CUBEMAPS lump can run `buildcubemaps` all day and produce nothing.

## Checklist before running the command

1. The map is loose in `left4dead2/maps/<map>.bsp`. A map inside an add-on VPK cannot be
   written back.
2. The `.bsp` file itself is writable. Steam-installed files can carry the read-only
   attribute: `maps/<map>.bsp is not writable!!!` means exactly that. Clear it.
3. `left4dead2/materials/maps/<map>/` exists and is writable. The engine writes the
   `cubemap_*.vtf` and `*_hdr.vtf` files there.
4. **Use the map's own name.** Renaming the `.bsp` to a test name can make the engine derive
   a different materials path from the internal map name, and the symptom is an empty path
   in the error line: ` is not writable!!!  Check it out before running buildcubemaps.`
   Build the map under the name it was compiled with, then rename the finished file with
   `run_bsp_rename` if needed.
5. Launch with `-insecure` (and `-allowdebug` if injecting entities); `sv_cheats 1` is
   needed for some console paths.
6. The map must have `env_cubemap` in the source and must have been compiled after adding it.
7. **A mounted add-on can shadow the loose map.** If `left4dead2/addons/*.vpk` contains the
   same map, the engine may load the packed one even though `left4dead2/maps/<map>.bsp`
   exists. Move the add-on aside (`run_nav_generate` does this with `addonsToHide`) before
   concluding that the injected entities did nothing. A run with no `buildcubemaps` line at
   all is often this, not a failed injection.

## What the log lines mean

| Line | Meaning |
|---|---|
| `Failed, using default cubemap 'engine/defaultcubemap'` | Expected before building: no `materials/maps/<map>/<sample>.vtf` exists yet |
| `Texture 'maps/<map>/cubemapdefault' not found` | Same; the engine falls back to its default until the build writes the files |
| `maps/<map>.bsp is not writable!!!` | The BSP is read-only or inaccessible; clear the attribute |
| ` is not writable!!! Check it out before running buildcubemaps.` | No path was derived. Check the map name, the `materials/maps/<map>/` directory, and whether the `.bsp` is loose |
| `Attempted to create unknown entity type env_cubemap!` | You injected the internal entity into a compiled lump. Add it to the VMF and recompile |
| `Building cubemaps: <n>` / no such line | The command did or did not start; the files are the proof |

## What is verified and what is not

- Verified from files and engine logs: `env_cubemap` is absent from Valve L4D2 entity lumps
  while the CUBEMAPS lump is non-empty; the engine writes into `materials/maps/<map>/`.
- Verified in a live run: `buildcubemaps` started and logged the default-cubemap fallback;
  no files were produced in the test because the map was renamed and the materials directory
  did not match the derived path.
- Verified in a live run: a loose map injected with `point_servercommand` + `logic_auto` can
  still be shadowed by a mounted add-on; no `buildcubemaps` line appears. Hide the add-on and
  repeat before debugging the injection.
- **Not yet verified:** a complete build that writes `.vtf` files. The tool
  `run_build_cubemaps` does not exist yet. Until it does, this is a manual checklist, not a
  supported operation.

## Clean up

Every test map, `materials/maps/<test>/`, `.nav`, backup and temporary VPK this experiment
created is removed afterwards; the checklist is
[`../references/testing/game-environment-cleanup.md`](../references/testing/game-environment-cleanup.md). The
`hsmcp_cubetest.bsp` and its empty materials directory from the first run were removed, and
`c1m1_hotel.bsp` was restored from its backup; `readEntityLump` confirms no test entities
remain.
