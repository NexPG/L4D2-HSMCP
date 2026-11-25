# Workflow: model skin from a photo

Use this for a texture-only skin: the model, skeleton, animations and geometry stay stock. The
reference pipeline is [`../references/models/photo-texture.md`](../references/models/photo-texture.md).

## What the user installs

The root `README.md` Requirements table lists the **external** tools: Blender, Blender Source
Tools and Crowbar. They are only for the model-skin workflow; a VMT/VTF-only task must not ask
for them. The optional Python CV/inpainting stack is not a README requirement: it installs
through `src/core/python/setup.ps1 -Models`. The exact per-task split is in
[`../references/tools/photo-texture-toolchain.md`](../references/tools/photo-texture-toolchain.md).

## 1. Workspace and references

```text
write_addon_workspace(name: "witch-girl", title: "Witch Girl", kind: "model")
```

Copy the source photos to `src/reference/photos/`. Extract the target model and materials from
the game (VPK + `extract_vtf`), and keep a read-only reference tree:

```text
src/reference/
  photos/
  model/                 decompiled QC/SMD (Crowbar)
  materials/...          stock VTF/VMT/PNG previews
  reference-index.md
```

Never edit `src/reference/`. The replacement is built under `src/work/`, `src/projection/` and
`addon/`.

## 2. Decompile the model

Use Crowbar CLI (or the GUI) to produce QC/SMD/DMX. Import the reference SMD into Blender with
Blender Source Tools. Keep the stock UV map. If the model has no usable UVs, stop and record the
tool gap; do not re-unwrap a stock L4D2 model for a texture-only mod.

## 3. Prepare the photo

- Background/hair matte: `rembg` (`birefnet-portrait`, alpha matting for hair).
- Landmarks: MediaPipe Face Landmarker + Pose Landmarker.
- Glasses/background: mask and inpaint with IOPaint/LaMa. Restore eyes only if the removal
  destroyed them; check identity afterwards.
- Build a per-region mask: skin, hair, clothing, glasses, unknown. The model's UV islands decide
  where each mask is allowed to land.

## 4. Align and project in Blender

- Pose the model so the 2D landmarks match the photo (eyes, nose, mouth, shoulders, elbows,
  wrists, hips, knees, ankles).
- Use a front/orthographic camera for a front photo; use PnP if the photo has perspective.
- Project the prepared photo with the UV Project modifier or a camera-coordinate material.
- **The stock Witch head UV is split into several shells.** A raw camera-coordinate bake
  fragments them; use the UV Project modifier with a dedicated head UV map, or bake each shell
  separately and composite. Do not treat the head as one rectangular island.
- Bake the diffuse colour to the model's stock UV at 2048², margin 8–16 px.
- Mask out the dress/underwear/hair islands; keep the stock clothing.

## 5. Fill unknown areas

Mirror near-symmetric skin first, clone seams second, inpaint larger holes with IOPaint/LaMa
third. Use generative fill only for organic areas that inpainting cannot invent. Keep skin tone,
pores and shading consistent with the projected area.

## 6. Hair

Rebuild the hair cards from the photo strands, or retexture the stock cards with a photo-derived
tiling strip and a real alpha mask. A brown tint of the stock grey hair is not a hair transfer.

## 7. Output and verify

- Body 2048² DXT1, 12 mips; hair 1024×512 DXT1 with alpha; stock normal for the first pass.
- Copy the stock VMTs; preserve the burn/detail proxies.
- `check_vtf`, `check_vmt`, then HLMV++ front/side/back renders. In-game spawn is the final check.
- Evidence: the source photo, the aligned viewport, the baked atlas, the model views, and the
  VTF/VMT check results.

## Gates

- The model and UVs are unchanged.
- Eyes/nose/mouth and hands/knees line up on the rendered model.
- No background, glasses or wall pixels in the atlas.
- The dress/underwear islands are untouched.
- Hair alpha and mips match the stock expectations.
- The VMT still has the stock shader/proxies.
- A front, side and back HLMV++ screenshot exists.

## Do not

- Do not paste a rectangular photo into the atlas.
- Do not re-unwrap or edit the model for a texture-only skin.
- Do not replace the VMT with a new shader unless the stock shader cannot express the result.
- Do not use a generative model as the source of the face; use it only for missing organic fill
  after projection.
- Do not write content limitations into `logs/errors.md`; that log is for skill/MCP/tool defects.
