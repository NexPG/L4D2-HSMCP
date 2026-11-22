# Workflow: material edit and reskin

A reskin is a material copied or patched under an add-on's `materials/` tree. The engine
finds the loose `.vmt` before the stock one in the VPK, so the internal path is what matters.

## 1. Find the material

`read_game_content` searches the game's VPKs for a material or model name. Use it to confirm
the exact internal name; a `.vmt` path is relative to `materials/` and has no `.vmt` suffix
when a VMT parameter names it.

## 2. Read the tree, not just the parameters

```
read_vmt({ path: "<staging>/materials/concrete/wall01.vmt" })
```

The reply has `parameters`, `blocks` and `tree`. `tree` is the whole nested material:
`Proxies → AnimatedTexture → animatedtextureframerate` is visible as data. Check
`compileFlags` before copying: `%compileclip` and friends decide brush solidity, not just
appearance.

## 3. Edit one value without rewriting the file

```
edit_vmt({
  path: "<staging>/materials/concrete/wall01.vmt",
  edits: [{ path: ["$basetexture"], value: "concrete/wall01_reskin" }]
})
```

The path is block names followed by the key. The writer replaces only the value token;
comments, `Proxies`, indentation and untouched parameters stay byte-identical.

- A missing block or key is refused. `write_vmt` is the tool that creates a material.
- A duplicate key is refused: the engine does not promise which one wins.
- `out` writes a copy, `dryRun` reports without writing, `backup` defaults on in place.
- The result is parsed and read back before the write.

Use `write_vmt` when the material is new, or when the whole tree is being replaced.

## 4. Check a patch and its base

```
check_vmt({
  path: "<staging>/materials/concrete/wall01_reskin.vmt",
  materialsDirs: ["<staging>/materials"]
})
```

A `patch` is only a diff. `check_vmt` normalises the `include`, finds the base under
`materialsDirs`, and reports its shader and `$basetexture`. A missing base, an unreadable
base, or a base with no `$basetexture` is a finding. If the include is itself a patch, the
report names that next link; it does not merge a full chain.

## 5. Pack and look

`run_vpk_pack` the staging tree. `preview_asset` shows the base texture; a material with no
base or a missing `.vtf` is caught by `check_vmt` with `materialsDirs`. In game, a reskin
that shows the stock texture usually means the internal path is wrong, not the shader.

## Gotchas

- `$basetexture` is relative to `materials/` and omits `.vtf`. A filesystem path is a
  warning, not a valid material name.
- `%compileclip 1` makes a brush solid; changing it changes collision, not just looks.
- A `patch` with no `include` is an error; a non-patch with `include` is ignored by the
  engine and warned by the checker.
