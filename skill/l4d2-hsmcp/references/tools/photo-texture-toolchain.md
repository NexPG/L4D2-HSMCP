# Photo-to-texture toolchain: what to install and why

This page tells the user which external tools the **model-skin** workflow needs, which are
optional, and what the MCP can still do without them. The pipeline itself is in
[`references/models/photo-texture.md`](../models/photo-texture.md); the agent steps are in
[`workflows/model-skin.md`](../../workflows/model-skin.md).

## What the MCP does and does not do

The MCP does:

- read/write VTF, VMT, VPK, MDL headers and material paths with the existing tools;
- call external tools through thin wrappers (Crowbar, Blender, rembg, MediaPipe, IOPaint);
- keep the workspace, masks, source photos and evidence in one place.

The MCP does **not**:

- paint like Photoshop, or provide a full image editor UI;
- build a new 3D model or re-unwrap a stock model for a texture-only skin;
- implement its own UV projector, inpainter or landmark detector;
- replace Blender, Crowbar, rembg or IOPaint with a second implementation.

If a task needs a full manual paint session, use Blender/Krita/GIMP/Photoshop outside the MCP
and bring the resulting PNG back into the workspace.

## Required vs optional

| Need | Install | Why |
|---|---|---|
| Only edit a VMT or convert an existing VTF | nothing new | `read_vmt`, `edit_vmt`, `write_vtf`, `extract_vtf`, `check_vtf` already exist |
| Recolour/resize an existing texture from a PNG | Python `Pillow` + `numpy` | 2D compositing, masks and colour math; no 3D |
| Crop/mask a photo, remove a background | Python `rembg` + `Pillow` | BiRefNet portrait matte; alpha matting for hair |
| Face/pose landmarks | Python `MediaPipe` | 478 face landmarks and 33 body landmarks; the alignment anchors |
| Remove glasses / fill holes | `IOPaint` (or `simple-lama-inpainting`) | LaMa/PowerPaint inpainting; optional if you paint manually |
| Decompile the Witch model | `Crowbar` CLI | MDL -> QC/SMD/DMX; required before Blender can import |
| Project the photo and bake to UV | `Blender` + `Blender Source Tools` | The actual camera projection and UV bake; no replacement |
| Preview the skin on the model | `HLMV++` (already in the game `bin`) | Fast model/material check without launching a map |
| Upscale a small source / restore eyes | `Real-ESRGAN`, `GFPGAN`/`CodeFormer` | Optional; can hallucinate identity, inspect after |

## External tools

### Blender 5.3 (or 4.2 LTS)

- **Required for** pose, camera matching, UV Project and bake.
- **Verified here: Blender 4.2.9 LTS.** Blender 5.3 is installed, but the stock Blender
  Source Tools add-on is older and not yet proven on 5.x; use 4.2 LTS for the model-skin
  workflow until that changes.
- Installed here at `C:\Program Files\Blender Foundation\Blender 5.3\blender.exe` and
  `.3d-projects/blender-4.2.9/blender-4.2.9-windows-x64/blender.exe`.
- Headless use: `blender.exe -b -P script.py`.
- Licence: GPL. It is an external program; the MCP only launches it.

### Blender Source Tools

- **Required for** SMD/DMX import/export.
- Install: download the add-on zip, then Blender → Edit → Preferences → Add-ons → Install.
- The add-on is `io_scene_valvesource`; do not unzip it before installing.
- Without it, Blender cannot read the Crowbar output.

### Crowbar CLI

- **Required for** `witch.mdl` → QC/SMD.
- Installed here at `.3d-projects/crowbar-cli/CrowbarCommandLineDecomp.exe`.
- Command: `CrowbarCommandLineDecomp.exe -p <model.mdl> -o <out-dir>`.
- The repo only contains Crowbar's source, not a built GUI; the CLI is the automatable path.
- Licence: check the Crowbar repository; it is a separate tool.

### HLMV++ / HLMV

- **Required for the fast model preview**; optional if you only check in game.
- Already at `Left 4 Dead 2/bin/hlmvplusplus.exe` and `hlmv.exe`.
- It loads the stock model and a loose material tree; it is not a replacement for the game
  check, but it is much faster for iteration.

## Python packages

The core sidecar requirements file is `src/core/python/requirements.txt` and contains only
`srctools`. The optional stack is `src/core/python/requirements-models.txt`:

```text
Pillow==13.0.0
numpy==2.5.5
opencv-python-headless==5.1.0.95
mediapipe==1.2.3
rembg[cpu]==2.0.88
```

Install it with:

```powershell
.\src\core\python\setup.ps1 -Models
```

Without `-Models`, the normal sidecar stays small; the VTF/VMT/VPK/BSP tools still work.

### Why not `face-projection`?

`face-projection` is useful for 2D face warps, but its current PyPI release pins
`mediapipe==0.9.3.0`, which has no Python 3.12 wheel. Use MediaPipe directly until the library
updates; do not downgrade the sidecar's Python just for it.

### IOPaint (optional)

`IOPaint` is the strongest open-source inpainting UI/CLI (LaMa/PowerPaint). It is not in
`requirements-models.txt` because it pulls PyTorch and model weights; install it only when the
task needs glasses removal or large missing-area fill:

```powershell
python -m pip install iopaint
iopaint run --model=lama --image=<in> --mask=<mask> --output=<out>
```

For a first pass, OpenCV inpainting is enough for small seams; it is not enough for a clean
glasses removal.

### GFPGAN / Real-ESRGAN (optional)

Use only after the base bake is right. They reconstruct faces/upscale, but can change identity;
compare against the source before shipping.

## What the user needs, by task

| Task | Minimum |
|---|---|
| Recolour a Witch skin | Pillow/numpy or any image editor |
| Make a photo-based Witch skin with correct eyes/nose/mouth | Blender + Source Tools + Crowbar + MediaPipe + rembg (+ IOPaint for glasses) |
| Only change a VMT parameter | the existing MCP tools; no Blender/Crowbar |
| Build a new model from scratch | Blender + Source Tools + StudioMDL; this is not the model-skin workflow |
| Preview a skin | HLMV++ (already installed) |

## Sources

- Blender bake: <https://docs.blender.org/manual/en/latest/render/cycles/baking.html>
- Blender UV Project: <https://docs.blender.org/manual/en/latest/modeling/modifiers/modify/uv_project.html>
- Crowbar CLI: <https://github.com/UltraTechX/Crowbar-Command-Line>
- Blender Source Tools: <https://github.com/Artfunkel/BlenderSourceTools>
- MediaPipe Face Landmarker: <https://mediapipe.readthedocs.io/en/latest/solutions/face_mesh.html>
- rembg: <https://github.com/danielgatis/rembg>
- IOPaint: <https://github.com/Sanster/IOPaint>
