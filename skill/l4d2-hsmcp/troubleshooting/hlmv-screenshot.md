# HLMV shows an error, crashes, or a black viewport

HLMV is a GUI. Launching it is one thing; getting a picture of the model back is another.

`run_hlmv` now prefers **HLMV++** (the maintained viewer from the Hammer++ author) and
falls back to stock HLMV when HLMV++ cannot stay alive. The result says which one ran:
`viewer: "hlmv++" | "hlmv"` plus `fallbackReason`.

## Which viewer, and why

| Viewer | Launch form that works | Result on this machine |
|---|---|---|
| `hlmvplusplus.exe` | `-game left4dead2 <model>` with cwd at the game root (`.../Left 4 Dead 2`) | loads the model, then crashes after ~3 s with `0xc0000005`, fault offset `0x64616564` |
| `hlmv.exe` (stock) | `VPROJECT=<.../left4dead2>`, cwd at `left4dead2`, relative model path | stays alive; UI captures, 3D canvas is black in this headless desktop |

HLMV++ was tried with a relative and an absolute `-game`, with `-game .` from the mod
directory, with quoted absolute paths (the first unquoted absolute path simply split on the
space in `Left 4 Dead 2`), with loose model files and with the VPK-only model, with the
model's VMT/VTF extracted, and under Windows 7/8 compatibility layers. It crashed in every
case. The older L4D2 build from the HLMV++ repository (`hlmvplusplus_l4d2_v1.zip`) died even
sooner. This is an HLMV++/machine bug, not a mount or model problem.

`run_hlmv` therefore launches HLMV++, waits 4.5 s, and checks the process list. If HLMV++ is
gone, it launches stock HLMV and reports why. On a machine where HLMV++ survives, the same
call keeps HLMV++ and `fallbackReason` is null. That is the "newest tool that works" rule in
practice, not a hope.

## The loose-folder rule

HLMV cannot open a model from a VPK unless the model's directory exists **loose** on disk.
The directory may be empty; the engine still supplies the `.mdl` from the VPK. Without it
the viewer shows the giant red `ERROR` card even for a stock model. `run_hlmv` creates the
empty directory tree first.

This is also why the stock `-screenshot` flag is not a general answer: it only produced a
file once the `.mdl`/`.vvd`/`.vtx` were extracted, and the file was a 1920x1080 black PNG,
i.e. a desktop capture, not a model render.

## The screenshot

`run_hlmv(screenshot: true)`, `run_map_test(screenshot: true)` and `capture_window` return a
real MCP image block, not base64 in a text field.

| Method | What it does | When |
|---|---|---|
| `window` (default for HLMV/capture) | `PrintWindow`, captures the window even when another window is in front | UI, title, error dialogs, tabs |
| `screen` (default for `run_map_test`) | brings the window to the front and copies the desktop region | a 3D canvas: the game, HLMV's viewport |

The game renderer is 3D: `window` gives a black canvas, `screen` is the method that worked.
For a map, match a marker that fires after loading (`Loading: [0-9]`) and allow
`waitAfterMatchMs` for the frame to settle.

The same limit applies to HLMV++: its 3D canvas is a DirectX surface. `PrintWindow` captures
its menus and title but not the canvas, and this desktop has no visible canvas at all
(remote/headless session). Use `preview_model` when a rendered model is the requirement: it
builds a sealed room, compiles it, loads the engine and captures the engine's own frame.

## MVScript

HLMV++ ships a keyvalues `.mvscript` language: `LoadModel`, `SetAppWindowSize`,
`SetCameraOrigin`, `SetCameraAngles`, `SetLightAngles`, `SetLightColor`,
`SetAmbientColor`, `SetRenderMode`, `SetBGColor`, `Screenshot`, `HideControlPanel`,
`NormalMapping`, `Phong`, `RunExternalCmd`, `Close`, `SetMatVars`, `ReplaceMaterials`.
A script can drive a reproducible render without touching the mouse.

On this L4D2 build a `.mvscript` passed on the command line was **not executed**: the viewer
opened, ignored the script, and stayed at the default model. A minimal script that wrote a
proof file with `RunExternalCmd` proved the commands never ran. The same build advertises
"Fixed .mdls/.mvscripts passed on command line not working", so the feature exists for other
branches; for L4D2 the menu path (`File -> Run .mvscript...`) is the one that works. Do not
build automation on the command-line form without testing it on the target build.

## Error dialogs

| Dialog | Cause |
|---|---|
| `Unable to find gameinfo.txt` | `-game` was used instead of `VPROJECT`, or the working directory is wrong |
| The model renders as a giant red `ERROR` | the model could not be loaded; check the path, the compiled files and the material, and create the loose folder |
| Window title is `Error` and the window is tiny | a real dialog; capture it and read the text |
| HLMV++ window disappears after ~3 s | access violation while loading the model; `run_hlmv` falls back to stock HLMV |

## One instance at a time

An already-running HLMV can swallow a new launch. Close it before `run_hlmv` or pass a
specific `processId` to `capture_window`. HLMV++ also starts a **second process** for the
window; capture by the window pid (`windowPids`), not by the pid the launcher returned.

## Verified and not verified

- Verified: HLMV launched on a compiled sample, window title showed the model path, and
  `capture_window` returned a PNG image block of the HLMV UI.
- Verified: `PrintWindow` captures the window while VS Code is in front; `CopyFromScreen`
  captured VS Code instead, which is why `window` is the default.
- Verified: HLMV++ loads a stock VPK model once its loose folder exists, then crashes after
  ~3 s on this machine; stock HLMV stays alive. `run_hlmv` reports the fallback and closes
  both kinds of process.
- **Not verified in this environment:** a rendered 3D viewport from either viewer. The
  sandbox desktop does not present the DirectX canvas, so it is black here. On a normal
  interactive Windows desktop, try `method: "screen"` before concluding the model is broken.
