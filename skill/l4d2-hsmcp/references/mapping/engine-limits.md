# Engine limits

Full table with provenance: `docs/reference/engine-limits-l4d2.md`. This page is the short
list an agent needs before choosing geometry. The same numbers serve both passes: pass 1 must
not plan more entities, models or brushes than pass 2 can compile.

## Format facts before limits

- **`dmodel_t` is 48 bytes** (`Vector mins, maxs, origin; int headnode; int firstface,
  numfaces`, `bspfile.h`). A reader that assumes 64 decodes garbage after the world model; that
  is how brush entities lost their bounds and water/nav-blocker volumes disappeared.
- **Nav areas are not `MAX_MAP_AREAS`.** That 256 counts BSP vis areas. A nav file carries its
  own area count; stock chapters hold 1,000–1,700 and load fine.

## The numbers that stop a map

- Coordinates: **-16384 .. +16384**. `read_map_geometry` reports `mins`/`maxs`.
- Brushes **8192**, brush sides **65536**, faces **65536**, vertices **65536**,
  planes **65536**, texinfo **12288**, unique materials/texdata **2048**,
  displacement surfaces **2048**, brush models **1024**.
- Map entities **8192**; runtime edicts **2048**. A `prop_static` is cheap; a
  `prop_dynamic`, door, physics prop or NPC is an edict.
- Lighting **16 MB per mode**; visibility **16 MB**. `hdr: true` needs both lightmap sets.
- Keep the BSP **under ~300 MB** and the VPK **under 2 GB**; the process is 32-bit.
- Dynamic lights: keep **under 32** at once; projected textures **1-4**.
- Map name **30 characters or fewer**; the nav header stores 32 bytes and signon fails at 31.

`read_vmf_lint` checks the source, `read_map_geometry` the compiled BSP, and `run_compile`
refuses a sky without faces for the lighting mode being built. The pass-2 order is in
[`../../workflows/build-and-deploy.md`](../../workflows/build-and-deploy.md).

## Where a specific rule lives

| Question | Page |
|---|---|
| Door width, hinge, swing | [`doors.md`](doors.md) |
| Stock model and material paths | [`../assets/models.md`](../assets/models.md) |
| A prop with no collision (`solid` omitted) | [`../../troubleshooting/props-no-collision.md`](../../troubleshooting/props-no-collision.md) |
| Walkable slope, step, water and map edge | [`terrain-water-boundaries.md`](terrain-water-boundaries.md) |
| A load that never finishes (map name, nav pair) | [`../../troubleshooting/endless-loading.md`](../../troubleshooting/endless-loading.md) |
