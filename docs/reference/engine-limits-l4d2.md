# Left 4 Dead 2 engine limits

L4D2 is the Source 2009 branch: **32-bit**, **DirectX 9**, and it still uses the
`bspfile.h` ceilings that Source 2013 inherited. The numbers below are the compiler's
record/byte ceilings (from `src/public/bspfile.h`), the runtime entity ceiling, and the
engine's coordinate bound. A map that crosses one of these does not "look wrong": it fails
to compile, fails to load, or crashes the client.

`read_map_geometry` measures the compiled BSP against the lump ceilings after a build;
`read_vmf_lint` measures the source before it. Neither can raise a ceiling -- L4D2 ships
stock compilers, and a map built for a raised ceiling is a map other players cannot load.

## Record sizes a reader must get right

These are format facts rather than ceilings: a reader that assumes the wrong size decodes
garbage from every record after the first.

| Record | Bytes | Fields (from `bspfile.h`) |
|---|---:|---|
| `dmodel_t` (lump 14) | **48** | `Vector mins, maxs, origin; int headnode; int firstface, numfaces` |

`dmodel_t` was read as 64 bytes once and every model after the world came out as denormal
floats; brush entities then had no bounds and their volumes vanished from the survey. Treat the
header as the oracle, not a recollection.

**Nav areas are not `MAX_MAP_AREAS`.** That 256 limit counts BSP vis areas/portals. A nav mesh
is a separate file with its own area count; stock chapters routinely hold 1,000–1,700 areas
(`c8m1_apartment`: 1,690) and load fine.

## Hard ceilings

| What | Limit | Where it fails |
|---|---:|---|
| World coordinates | **-16384 .. +16384** on each axis | `vbsp`: "brush outside world" / entity removed. The range is 32768 wide, not 32768 per side. |
| Physics positions | -32768 .. +32768 | "crazy physics" entity removal; do not rely on it to extend the map. |
| Map entities (lump 0) | **8192** | `vbsp` stops adding entities; outputs and spawns disappear. |
| Runtime edicts | **2048** (`MAX_EDICTS`) | `Host_Error: Overflow` / crash when too many dynamic entities exist at once. Brush entities, doors, physics props and NPCs count; `prop_static` does not. |
| Brushes (lump 18) | **8192** | `vbsp` exits with `MAX_MAP_BRUSHES`. |
| Brush sides (lump 19) | **65536** | `MAX_MAP_BRUSHSIDES`. A cylinder or arch spends many sides per brush. |
| Faces (lump 7) | **65536** | `MAX_MAP_FACES`; usually reached before brushes on curved geometry. |
| Vertices (lump 3) | **65536** | `MAX_MAP_VERTS`. |
| Edges / surfedges | 256000 / 512000 | `MAX_MAP_EDGES`, `MAX_MAP_SURFEDGES`. |
| Planes (lump 1) | **65536** | `MAX_MAP_PLANES`; every unique face plane. |
| Nodes / leafs | 65536 each | `MAX_MAP_NODES`, `MAX_MAP_LEAFS`; a leak or a huge open room multiplies them. |
| Brush models (lump 14) | **1024** | `MAX_MAP_MODELS`; each `func_*` brush entity is one. |
| Texinfo (lump 6) | **12288** | `MAX_MAP_TEXINFO`; material + scale + axes combination, not brushes. |
| Unique materials / texdata (lump 2) | **2048** | `MAX_MAP_TEXDATA`; a map with too many distinct materials fails to compile. |
| Displacement surfaces (lump 22) | **2048** | `MAX_MAP_DISPINFO`; one per displacement, not per face. |
| Lighting (lump 8, and HDR 53) | **16 MB each** | `MAX_MAP_LIGHTING`; `-both` needs room for both sets. A large open night map with high lightmap resolution hits this first. |
| Visibility (lump 4) | **16 MB** | `MAX_MAP_VISIBILITY`; too many leaves or a failed vis. |
| Areas / areaportals | 256 / 1024 | `MAX_MAP_AREAS`, `MAX_MAP_AREAPORTALS`; `func_areaportal` counts. |
| World lights (lump 15) | **8192** | `MAX_MAP_WORLDLIGHTS`; static light sources, not `light` entities alone. |

## Practical ceilings that are not in `bspfile.h`

| What | Practical limit | Why |
|---|---:|---|
| BSP file size | keep **< 300 MB**, never above 2 GB | 32-bit address space. The engine maps the BSP and its lumps; a 1 GB map is a coin flip on a 32-bit process. |
| Addon VPK size | **< 2 GB** | Steam Workshop and the VPK index are 32-bit; also download/install time. A two-chapter campaign is normally 10-300 MB. |
| Unique textures | a few hundred | `MAX_MAP_TEXDATA` is 2048, but DX9 texture memory and load time bite earlier. |
| Texture dimensions | 2048 is safe, 4096 works on most GPUs, 8192 is not a target | DX9 `D3DUSAGE` texture limit and VRAM. |
| Dynamic lights | **< 32 at once** | Source's dynamic-light array; L4D2 flashes, muzzle flashes, fires and `env_projectedtexture` share it. Too many produce "Too many dynamic lights" and dropped lighting. |
| Projected textures | **1-4** (`env_projectedtexture`) | Each is a full scene pass; L4D2 flashlights already use one. |
| Decals | ~512 visible, `r_decals` default 2048 | Blood/bullet decals; a scripted map should not spray thousands. |
| Overlays | a few hundred | Each is a separate renderable; `write_overlay` has no hard cap, the renderer does. |
| Nav areas | ~16k | L4D2's nav mesh is compact, but a 16384-unit map fully covered is far past what the Director handles well. |
| `-both` compile memory | 2x vrad | HDR + LDR lightmaps are both in memory; 32-bit vrad can run out on a large map. Compile stages separately if it does. |

## L4D2-specific contracts

- **String-table dictionary.** A shipped BSP must contain the `stringtable_dictionary`
  lump the engine writes with `-stringtables`. Without it the engine logs
  `missing stringtable dictionary, don't ship this way` and appends it on the next
  changelevel, which changes the BSP size after nav has recorded it. `run_nav_generate`
  now bakes it before generating nav; ship the returned pair.
- **Nav and BSP are a pair.** The nav header stores the BSP size it was generated against.
  If they differ, the game shows `NAV ERRORS / Map is unplayable`. `read_nav` must say
  `fresh` before packing.
- **One sky mode is not a sky.** L4D2 renders HDR, but a player can force LDR. A sky with
  only `_hdr` or only `_ldr` faces draws nothing in the other mode. Compile with
  `hdr: true` (`-both`) and use a sky complete in both modes; `run_compile` refuses the
  mismatch now.
- **A walkable slope stops at 45 degrees.** A `wedge` steeper than that is a wall that
  looks like a ramp; nav will not cross it and bots will not stand on it. Steps must be
  <= 18 units high. `write_vmf_solid` refuses both unless `steep: true` is passed for
  scenery.
- **A door opening is the door's width.** `checkpoint_door_02` is 58.3 x 105.8 units;
  `checkpoint_door_01` is 68.4 x 105. A 128-unit opening with a 58-unit door is a hole.
  `read_vmf_lint` now reports `l4d2-door-opening-too-wide` / `-too-narrow`.
- **`info_landmark` goes in open space.** Inside a brush the engine logs
  `landmark embedded in solid` and the arrival point can be unreachable.
  `read_vmf_lint` reports `l4d2-landmark-in-solid`.
- **A finale map needs a type-2 finale.** A `trigger_finale` with `FinaleType 2` loads
  `scripts/vscripts/<map>_finale.nut`; a changelevel to `credits` is a test harness, not a
  campaign ending. The map also needs the disabled arrival `info_changelevel` (`spawnflags 2`)
  or the Director refuses to start the finale.

## How to check a map before shipping

1. `read_vmf_lint` -- source ceilings and the L4D2 contracts above.
2. `run_compile` -- it refuses a sky with no faces for the mode, then reports vbsp/vvis/vrad.
3. `read_map_geometry` -- lump usage against the table above; `nearLimitOnly: true` shows
   what is above 80% of a ceiling.
4. `run_nav_generate` -- returns `fresh` and whether the dictionary is present.
5. `run_map_test` with the exact BSP/nav pair -- loads the map, not the archive beside it.

## Where these numbers come from

- `ValveSoftware/source-sdk-2013`, `src/public/bspfile.h` (branch `master`), read 2026-11-27:
  every `MAX_MAP_*` value in the hard-ceilings table, and `struct dmodel_t`.
- `ValveSoftware/source-sdk-2013`, `src/public/const.h`, same date: `MAX_EDICT_BITS` is 11, so
  `MAX_EDICTS` is 2048.
- The practical ceilings (BSP/VPK size, texture dimensions, dynamic lights) are engine and
  32-bit-process behaviour, not header constants. They are marked as practical above because no
  single number in a header states them.

L4D2 ships its own 2009 branch and its own copies of these headers; the SDK header is used as
the reference because it is public and because the ceilings it declares are the ones the stock
L4D2 compilers enforce. If a game update ever changes one, the compile log is the final oracle:
`read_map_geometry` reports the ceiling it compares against and where that number came from
(`limitSource`).

