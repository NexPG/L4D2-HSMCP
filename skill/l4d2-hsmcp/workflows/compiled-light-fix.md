# Workflow: fix one face's baked light

Sometimes the lighting is almost right: one patch is too dark, one doorway is too warm, or a
test map needs a readable face now. Re-running vrad rebuilds every lightmap; patching the
LIGHTING bytes changes one face and leaves everything else where it was.

## 1. Find the face and its lightmap

- `read_bsp_faces` links a face to its material, smoothing mask and lightmap footprint.
- `read_bsp_lightmaps` reports per-face average, min/max and samples; with `face` and
  `out` it writes that face's lightmap as a PNG.
- `read_lightmap_budget` says how many luxels vrad allocated and which faces never had a
  lightmap (sky, nodraw, `SURF_NOLIGHT`).

Pick a face with `hasLightmap: true`. A face with no baked data cannot be tinted into one.

## 2. Patch it

```
write_bsp_lightmap({
  path: "<map>.bsp",
  face: 3182,
  scale: 0.5,
  offset: [10, 0, 0],
  out: "<map>_lit.bsp"
})
```

- `scale` multiplies every RGB luxel; `offset` adds per-channel values afterwards.
- `scale: 0, offset: [r,g,b]` sets a flat colour.
- The LIGHTING lump keeps its length and every face offset; no other lump or record moves.
- `dryRun` computes the result without writing; `backup` defaults on in place.

The reply reports `beforeAverage` and `afterAverage`, then reads the face back through the
same reader before saying `verified`.

## 3. Prove it

- `read_bsp_lightmaps` on the result, same face, and compare the average.
- The file length is unchanged; that is the structural proof that no offset moved.
- Load the map and look. A correct average is not a correct mood, and a face's texture
  still affects what the player sees.

## Limits

- **LDR only.** HDR is stored as RGBE; scaling its RGB bytes changes the exponent's meaning.
  Compile with `-both` and pass `hdr: "ldr"`, or recompile with vrad.
- This changes one face's colour samples, not its allocation, its texture, or the entity
  light that produced the original bake.
- A compressed LIGHTING lump is refused rather than patched as packed bytes.
- `read_bsp_lightmaps` and `write_bsp_lightmap` are not a replacement for vrad; they are the
  small correction after it.
