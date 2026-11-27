# Photo to game texture: the professional pipeline

This page is the reference for turning a portrait/body photo into a texture for an existing
Source model **without changing the model**. The current 2D "paste a face into the atlas" attempt
is not this pipeline; it is the failure mode this page exists to prevent.

## Contents

- The short version
- Why the 2D atlas paste fails
- The tools that actually solve it
- The pipeline in detail
- What the MCP should expose
- What is installed here now
- Sources

## The short version

A UV atlas is not a photo layout. A face photo must be **projected through a camera onto the
model**, then **baked into the model's UV map**. The markers (eyes, nose, mouth, knees, hands)
are used to align the camera and the posed mesh. Missing back/side areas are filled after the
projection, not by pasting rectangles into the atlas.

```text
decompile model -> pose to match photo -> landmarks + camera -> project photo
-> bake diffuse to UV -> mask clothing -> inpaint missing -> hair cards/alpha
-> VTF + VMT + VPK -> HLMV++ / in-game check
```

## Why the 2D atlas paste fails

- The Witch atlas has separate islands for face, chest, arms, hands, thighs, calves, feet,
  dress and underwear. A rectangular face pasted at (x, y) covers several islands and leaves
  background/wall in the seams.
- The mesh samples the atlas through UV coordinates. The face must be warped to the **head
  island's** UVs; a screen-space rectangle has no relationship to those UVs.
- The model is posed differently from the photo. Projection must happen in a pose that matches
  the photo, or the eyes/nose/mouth/knees will not line up.
- Glasses, background and hair are 2D objects in the photo and 3D/UV objects on the model; they
  must be removed or masked before projection.

## The tools that actually solve it

| Tool | Role | Why it is the right tool | Licence / note |
|---|---|---|---|
| **Blender** (5.x) | pose, camera, UV Project, bake | Free, scriptable with `bpy`, runs headless (`blender -b -P script.py`), has a real UV/bake pipeline | GPL; external tool, not linked into the MCP |
| **Blender Source Tools** | import/export SMD/DMX | The standard bridge for decompiled Source models | Add-on; check its licence |
| **Crowbar / Crowbar CLI** | MDL -> QC/SMD/DMX | The standard Source model decompiler; CLI form is automatable | Windows .NET; CLI variants exist |
| **HLMV++ / HLMV** | model + material preview | Already in `Left 4 Dead 2/bin`; checks the skin on the real model | External GUI; no project wrapper yet |
| **MediaPipe Face Landmarker / Pose Landmarker** | 468/478 face landmarks, 33 body landmarks | Gives the anchors (eyes, nose, mouth, shoulders, knees, wrists) for camera/pose alignment | Apache-2.0 |
| **face-projection** (`cvjena`) | 2D face warp by landmarks | Warps a source face into a target face while keeping facial structure; useful for face cleanup | Python; check repo licence |
| **rembg** | background / hair / portrait matte | BiRefNet-portrait and alpha matting are built for hair edges | MIT code; model weights have their own licences |
| **IOPaint / LaMa / PowerPaint** | remove glasses, fill missing skin, outpainting | State-of-the-art inpainting, batch CLI, CPU or GPU | Apache-2.0; archived but usable |
| **OpenCV** | masks, warps, PnP, color transfer, inpainting | The low-level workhorse; already installed | Apache-2.0 |
| **Pillow** | 2D compositing, masks, PNG I/O | Already installed | HPND |
| **GFPGAN / CodeFormer** | face restoration after glasses removal | Reconstructs eyes/skin, but can hallucinate identity; use as a last step | Model licences vary |
| **Real-ESRGAN** | upscale source before projection | Helps a small photo survive a 2048 bake | BSD-ish; check model licence |
| **xatlas / trimesh / pyrender** | optional UV unwrap / 3D preview | Useful when the model has no usable UVs or for a headless render | Check licences |
| **Materialize / ArmorPaint / Substance Painter** | artist-facing projection/paint | Good for manual finish; Substance is commercial | Optional |

### Agent-specific tools

- **mcp-for-blender** (formerly `blender-mcp`): an MCP server that runs Blender Python, reads
  scene info, and returns viewport/camera renders. It supports OpenCode. This is the closest
  thing to "an agent that can use Blender". For deterministic production, `blender -b -P` is
  still better; the MCP is the interactive wrapper.
- **Crowbar CLI**: `CrowbarCommandLineDecomp.exe -p model.mdl -o out` or
  `CrowbarDecompiler.exe model.mdl out`.
- **rembg CLI**: `rembg i -m birefnet-portrait -a input.png output.png`.
- **IOPaint CLI**: `iopaint run --model=lama --image=... --mask=... --output=...`.
- **MediaPipe**: Python tasks API; face landmarks and pose landmarks, CPU.

## The pipeline in detail

### 1. Extract and decompile the model

- Extract `models/infected/witch.mdl`, `.vvd`, `.dx90.vtx`, `anim_witch.mdl`, and the
  `materials/models/infected/witch/*` files from `pak01_dir.vpk`.
- Decompile with Crowbar (CLI or GUI) to QC/SMD/DMX.
- Import the reference SMD into Blender with Blender Source Tools.
- Keep the stock UV map. Do not re-unwrap unless the model is being rebuilt; the mod is texture
  only.

### 2. Prepare the photo

- Remove the background with `rembg` (`birefnet-portrait` for hair; `-a` for alpha matting).
- Detect face landmarks (MediaPipe Face Landmarker, 478 points) and body landmarks (Pose
  Landmarker, 33 points).
- Build a **mask**: skin, hair, clothing, glasses, background. Use SAM/rembg masks and manual
  polygons for the glasses.
- Remove glasses with IOPaint/LaMa on the glasses mask. If the eyes are lost, restore the eye
  region with a face-restoration model; inspect for identity drift.
- Upscale only if the source is below the bake resolution.

### 3. Pose the model to the photo

- The Witch's rest pose is hunched; the photo is upright with arms in a different pose. Pose the
  rig so the shoulders, elbows, wrists, hips, knees and ankles match the photo's 2D landmarks.
- For a front-only photo, use an orthographic/front camera. If the photo has perspective,
  estimate the camera with PnP from 2D-3D landmark pairs.
- The texture is baked in this posed state; after baking it is pose-independent because it lives
  in UV space.

### 4. Project and bake

Two equivalent routes in Blender:

- **UV Project modifier**: assign the photo as an image texture, add a UV Project modifier,
  select the camera as the projector, and bake the diffuse color to a new 2048 image.
- **Camera projection material**: use the camera's texture coordinates (`Texture Coordinate >
  Camera`) into an Image Texture, then bake `Diffuse Color` (or `Emit`) to the UV map.

Important bake settings:

- Bake to a new image with the model's existing UV map.
- Use a margin (8-16 px) so UV seams do not show black.
- Bake only the skin islands; mask out dress/underwear/hair islands. The stock clothing remains.
- Use a flat/emission bake, not lighting, so the result is base colour.

### 5. Fill the unknown areas

A front photo has no back, sides, soles or top of the head. Options, in order:

1. **Mirror/symmetry** for near-symmetric skin areas (back, sides).
2. **Clone from nearby skin** for seams and small holes.
3. **IOPaint/LaMa outpainting** for larger missing regions.
4. **Stable Diffusion inpainting** only for organic fill that LaMa cannot invent; keep the
   result inside the established skin tone and texture.

Never fill a missing area by stretching one pixel row; it reads as a smear on the model.

### 6. Hair

Hair is not part of the body atlas. The stock `witch_hair` is a 1024×512 alpha-tested strip of
hair cards. Two valid routes:

- **Rebuild the cards**: extract hair strands from the photo (rembg hair matte), build cards in
  Blender, project/bake the hair colour and alpha, keep the stock card layout.
- **Retexture the stock cards**: use the photo hair as a tiling strip, create an alpha mask with
  strand clumping, and preserve the stock card UVs. This is faster but less exact.

Do not just tint the stock grey hair brown; that changes colour but not the hair identity.

### 7. Output

- Body: 2048×2048, DXT1, 12 mips.
- Hair: 1024×512, DXT1 with alpha, 11 mips.
- Normal: keep the stock `witch_normal.vtf` for the first pass; generate a new normal only after
  the base is approved.
- Copy the stock VMTs; do not rewrite the burn/detail proxies (`ci_burning`, BBQ).
- Stage `materials/models/infected/witch/`; pack the addon with the project VPK writer; verify
  with `check_vtf`/`check_vmt`.

### 8. Preview and evidence

- HLMV++: load `models/infected/witch.mdl` with the loose material tree or addon VPK. Capture
  front/side/back views.
- In game: spawn a Witch on a known map; capture the same angles. HLMV++ is enough for the first
  texture pass; the game is the final check.
- Acceptance: no missing material, no seam, no stretched face, hair alpha correct, dress
  unchanged, eyes/nose/mouth aligned.

## What the MCP should expose

Do not reimplement Blender, Crowbar, rembg, MediaPipe or IOPaint. Wrap them:

| Proposed verb | Backend |
|---|---|
| `decompile_model` | Crowbar CLI |
| `prepare_photo_masks` | rembg + MediaPipe + OpenCV |
| `inpaint_texture` | IOPaint/LaMa |
| `project_texture_bake` | Blender headless + a generated `bpy` script |
| `preview_model_texture` | HLMV++/Blender render |
| `write_vtf` / `extract_vtf` / `check_vtf` | already exists |

The wrapper passes paths, masks and landmarks; it does not parse MDL or decode VTF itself.

## What is installed here now

- `vtex.exe`, `vtf2tga.exe`, `studiomdl.exe`, `hlmv.exe`, `hlmvplusplus.exe`.
- Python sidecar: OpenCV, Pillow, numpy (added for this task).
- No Blender, no Crowbar executable, no MediaPipe/rembg/IOPaint yet.

## Sources

- Blender Manual — Baking: <https://docs.blender.org/manual/en/latest/render/cycles/baking.html>
- Blender Manual — UV Project modifier:
  <https://docs.blender.org/manual/en/latest/modeling/modifiers/modify/uv_project.html>
- Blender camera mapping / projection discussion:
  <https://blender.stackexchange.com/questions/208677/colorize-hidden-parts-from-camera-projection>
- Crowbar Source model decompiler:
  <https://steamcommunity.com/groups/CrowbarTool>
- Crowbar CLI: <https://github.com/UltraTechX/Crowbar-Command-Line>
- Blender Source Tools: <http://steamreview.org/BlenderSourceTools/>
- mcp-for-blender: <https://github.com/ahujasid/blender-mcp>
- MediaPipe Face Mesh / Face Landmarker:
  <https://mediapipe.readthedocs.io/en/latest/solutions/face_mesh.html>
- face-projection: <https://github.com/cvjena/face-projection>
- rembg: <https://github.com/danielgatis/rembg>
- IOPaint: <https://github.com/Sanster/IOPaint>
- OpenCV inpainting / warp / PnP: <https://docs.opencv.org/>
