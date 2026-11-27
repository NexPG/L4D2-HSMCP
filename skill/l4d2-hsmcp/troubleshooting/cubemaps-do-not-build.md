# Cubemaps do not build

`buildcubemaps` is an engine command, not a compiler stage. It captures the six faces of
every cubemap sample in the loaded map and writes `.vtf` files under
`left4dead2/materials/maps/<map>/`. The supported automation is the engine's own
`-buildcubemaps` launch mode: load the map, build, quit. `run_build_cubemaps` wraps it,
copies the files out and restores the game install.

The map must be loose, writable, and already contain cubemap samples.

## Contents

- What a cubemap sample is
- Checklist before running the command
- Automated: `run_build_cubemaps`
- Packing the result
- What the log lines mean
- What is verified and what is not
- Clean up

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
5. Launch with `-insecure` and `-buildcubemaps`; the engine builds when the map is fully
   loaded and quits. `-allowdebug` is useful while diagnosing. `sv_cheats 1` is needed for
   some console paths, but not for the launch mode.
6. The map must have `env_cubemap` in the source and must have been compiled after adding it.
7. **A mounted add-on can shadow the loose map.** If `left4dead2/addons/*.vpk` contains the
   same map, the engine may load the packed one even though `left4dead2/maps/<map>.bsp`
   exists. Move the add-on aside (`run_nav_generate` does this with `addonsToHide`) before
   concluding that the injected entities did nothing. A run with no `buildcubemaps` line at
   all is often this, not a failed injection.

## Automated: `run_build_cubemaps`

```
run_build_cubemaps(
  map: "my_map",
  bsp: "path/to/my_map.bsp",       // optional if the map is already installed
  mode: "hdr" | "ldr" | "both",
  addonsToHide: [".../hsmcp_campaign.vpk"],
  outDir: "...",
  timeoutSeconds: 240
)
```

The tool copies the BSP into `left4dead2/maps`, backs up the materials directory and any
matching add-on, launches Steam with `-buildcubemaps`, waits for `.vtf` files, copies them
out, then restores the map and add-on and removes the test materials directory. `HDR` uses
`+mat_hdr_level 2`; `LDR` uses `0`; `both` runs the engine twice.

## Packing the result

`run_build_cubemaps` does not pack by default: it copies the `.vtf` files out. Pass
`pack: true` and `outBsp: "finished_map.bsp"` to write a copy of the map with the new
cubemaps inside; the pakfile count and the number added are returned. The copy is the
result, and the game install is still restored.

The source map must already have the `.vtf` names it will use; packing the new file under
`materials/maps/<map>/` is what `buildcubemaps` and `vbspzip` expect.

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
- Verified in a live run: `run_build_cubemaps` with `-buildcubemaps` built an HDR cubemap on
  the test campaign in **29 seconds**: one `c0_0_64_hdr.pwl.vtf`, 76,536 bytes. The map,
  materials directory and hidden add-on were restored afterwards.
- Verified in a live run: injecting `point_servercommand` or `point_clientcommand` plus
  `logic_auto` and calling `buildcubemaps` from the map did **not** work; it logged
  ` is not writable!!!` with an empty path even with the original map name and a writable
  materials directory. The launch mode is the supported path.
- Verified in a live run: a loose map can be shadowed by a mounted add-on; hide it with
  `addonsToHide` or the packed copy loads instead.
- Verified in live runs: HDR in 29 s, LDR in 24 s and both modes in one call; the game
  install was left clean. A map with more than one cubemap sample is implemented and has not
  been measured separately.

## Clean up

Every test map, `materials/maps/<test>/`, `.nav`, backup and temporary VPK this experiment
created is removed afterwards; the checklist is
[`../references/testing/game-environment-cleanup.md`](../references/testing/game-environment-cleanup.md). The
`hsmcp_cubetest.bsp` and its empty materials directory from the first run were removed, and
`c1m1_hotel.bsp` was restored from its backup; `readEntityLump` confirms no test entities
remain.
