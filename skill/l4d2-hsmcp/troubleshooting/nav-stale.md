# Nav is stale

`read_nav` reports `stale` when the `savedBspSize` in the mesh differs from the `.bsp` it is
next to. The usual cause is a geometry or entity change after the mesh was generated — which
is every rebuild unless nav is regenerated afterwards.

## What the engine does with a stale mesh

It may regenerate it silently, refuse to use it, or use it and path badly. Nothing in the
console explains it, which is why the header check exists.

## Fix

Regenerate. There is no offline tool: `references/nav/generation.md`.
After regenerating, `read_nav` must say `fresh` for **every** map in the campaign, against the
`.bsp` that is actually packed.

## Why it keeps going stale

- The build recompiles maps after nav was generated (entity or brush changes change the BSP
  size). Generate nav **after** the final compile, or regenerate and repack.
- Nav was generated from a loose map that differs from the one packed.
- The add-on VPK shadows the loose map during generation, so the engine generated nav for the
  archive's map instead of the new one. Move the VPK aside first.
- A `.nav` from a previous campaign with the same map name is still in `left4dead2/maps/`.

## Check the pair that ships

```
read_nav(path: "<addon>/maps/<map>.nav", bsp: "<addon>/maps/<map>.bsp")
```

Run it on the staging tree before packing and on the deployed archive after, if in doubt. The
mesh and the map must be the same build.
