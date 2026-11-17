# HLMV shows an error or a black viewport

HLMV is a GUI. Launching it is one thing; getting a picture of the model back is another.

## Launching it correctly

- Set `VPROJECT` to the game directory that contains `gameinfo.txt`
  (`.../Left 4 Dead 2/left4dead2`).
- Run it with the game directory as the working directory.
- Pass the model as a **relative** path: `models/hsmcp_test/rail.mdl`.

`run_hlmv` does all three. Passing `-game <dir>` to this L4D2 `hlmv.exe` produced the
dialog `Unable to find gameinfo.txt` even with a valid directory; `VPROJECT` is the form
that worked.

## The screenshot

`run_hlmv(screenshot: true)` and `capture_window` return a real MCP image block, not
base64 in a text field.

| Method | What it does | When |
|---|---|---|
| `window` (default) | `PrintWindow`, captures the window even when another window is in front | UI, title, error dialogs, tabs |
| `screen` | brings the window to the front and copies the desktop region | when a 3D canvas is blank under `PrintWindow` |

A 3D canvas can be black on a headless or non-interactive desktop. That is an environment
limit, not proof that the model is missing: the title and the Model/Sequence tabs still
tell you what loaded. `read_model_info` is the authoritative machine-readable answer for
bounds, sequences and materials.

## Error dialogs

| Dialog | Cause |
|---|---|
| `Unable to find gameinfo.txt` | `-game` was used instead of `VPROJECT`, or the working directory is wrong |
| The model renders as a giant red `ERROR` | the model could not be loaded; check the path, the compiled files and the material |
| Window title is `Error` and the window is tiny | a real dialog; capture it and read the text |

## One instance at a time

An already-running HLMV can swallow a new launch. Close it before `run_hlmv` or pass a
specific `processId` to `capture_window`.

## Verified and not verified

- Verified: HLMV launched on a compiled sample, window title showed the model path, and
  `capture_window` returned a PNG image block of the HLMV UI.
- Verified: `PrintWindow` captures the window while VS Code is in front; `CopyFromScreen`
  captured VS Code instead, which is why `window` is the default.
- **Not verified in this environment:** a rendered 3D viewport. The sandbox desktop does not
  present HLMV's GL canvas, so the canvas is black here. On a normal interactive Windows
  desktop, try `method: "screen"` before concluding the model is broken.
