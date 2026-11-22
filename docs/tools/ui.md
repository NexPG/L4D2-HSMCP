# Screens and UI

5 tools: loading screens, VGUI HUD .res screens and Hammer++ .rect hotspot rectangles.

Part of the [tool catalogue](README.md). Generated from the registry by `pnpm docs:tools`.

## Screens and UI

| Tool | What it does |
|---|---|
| `read_hud` | Reads a VGUI `.res` HUD screen: the root resource name and a flat, pre-order list of controls with their path, `ControlName`, `fieldName`, geometry (`xpos`, `ypos`, `wide`, `tall`), visibility and every keyvalue. |
| `read_rect` | Reads a Hammer++ `.rect` hotspot file: the sub-rectangles of a trim-sheet texture that can be fitted to faces. |
| `write_hud` | Edits values in a VGUI `.res` HUD screen. |
| `write_loading_screen` | Turns a PNG into a UI material pair: a `.vtf` and an `UnlitGeneric` `.vmt` under the given `materials` directory. |
| `write_rect` | Writes a Hammer++ `.rect` hotspot file. |
