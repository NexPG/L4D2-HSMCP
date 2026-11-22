# Workflow: HUD override

A HUD override is a `.res` copied from the game, changed, and shipped at the same internal
path in an add-on. The file is VGUI KeyValues with `[$WIN32]`/`[!$OSX]` conditions; those
conditions are part of the result.

## 1. Read the stock screen

```
read_hud({ path: "resource/ui/l4d360ui/audio.res", fromGame: true })
```

`fromGame` reads `pak01_dir.vpk`; the reply says `source: "vpk"` and returns the resource
path, not a disk path. Use `search` to find a control by field name, value or condition
instead of paging the whole tree. Conditions are reported, not evaluated: a `[$X360]`
control is still in the list and still says so.

## 2. Decide the change

Two forms, and they can be combined when they do not touch the same key:

- `edits`: replace one value, or add a missing key inside a control.
- `offset`: batch-shift `xpos`/`ypos` by a pixel delta, preserving `c`/`r` alignment.

```
write_hud({
  path: "resource/ui/l4d360ui/audio.res",
  fromGame: true,
  out: "<staging>/resource/ui/l4d360ui/audio.res",
  offset: { x: 10, y: 0 }
})
```

`fromGame` cannot write the VPK, so `out` is mandatory. For a loose source, omit `out` to
edit in place or give `out` for an add-on copy. `offset` leaves `f0`-style fractions alone
and lists them in `offsetSkipped`; adding pixels to a fraction changes the layout rule.

An ambiguous key with two conditional values needs `condition` (`$WIN32`, `[!$OSX]`). The
tool refuses to guess which one the engine keeps.

## 3. Verify and pack

- `read_hud` on the written file: root and control count match the source, and the edited
  value is the one you asked for.
- The add-on tree must contain `resource/ui/...res` at exactly that relative path.
- `run_vpk_pack` the staging tree; `validate_addon` is the pre-pack check.
- `run_map_test` with a screenshot is the visual proof. A `.res` that parses is not yet a
  HUD that draws.

## Gotchas

- A stock `.res` may contain a control for another platform; keep its tag. Do not "clean"
  it out on Windows.
- `write_hud` changes existing controls; it does not create a new VGUI screen or a new
  control. Use a text editor for a screen the game does not ship.
- `offset` only understands pixel numbers with an optional `c`/`r`/`l` prefix.
