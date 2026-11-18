# Model authoring for L4D2

The toolkit compiles a model with the game's own `studiomdl` and inspects it with
`read_model_info`, `run_hlmv` and `preview_asset`. It does not export from Blender, Maya or
any DCC; that stays in the DCC.

## The source set

A Source 1 model is a `.qc` plus `.smd`/`.dmx` meshes and animations. The QC names the
output and pulls the parts together:

```
$modelname "props_misc/myprop.mdl"
$body "Body" "myprop.smd"
$cdmaterials "models/props_misc/"
$surfaceprop "metal"
$sequence "idle" "myprop_idle.smd" fps 30 loop
$collisionmodel "myprop_phys.smd" { $mass 10 $concave }
```

- `$modelname` is the in-game path, without `models/`.
- `$cdmaterials` is the VMT directory, with a trailing slash.
- `$surfaceprop` decides the impact sound and physics surface.
- `$sequence` names an animation; `fps`, `loop`, `activity` and `events` are common.
- `$collisionmodel` is the physics hull. A `prop_static` needs the `.phy` that comes from
  it; without one the prop is non-solid in game.
- `$staticprop` is for a static prop; `$mostlyopaque` for cutout transparency.

## L4D2 specifics

- **Viewmodels** need `$attachment "primary"` / `"melee"`, the right `$weaponmodel`/hands
  setup, and the `CharacterViewmodelAddon` block in the weapon script.
- **Player models** use `declaresequence` files and `includemodels`; a proportion/anim-swap
  setup is a set of QCI includes, not one QC.
- **Attachments** are positioned with `.smd`/`.dmx` helper meshes and `$attachment`; the
  weapon attachment helper is a separate mesh.
- **Physics** is `$collisionmodel`; a model with no `.phy` cannot be a solid `prop_static`.

## The commands

| Job | Tool |
|---|---|
| Compile a QC | `run_studiomdl` (reads `$modelname`, proves the `.mdl` and companions exist) |
| Read hull, skins, sequences, materials, `.phy` | `read_model_info` |
| Open in HLMV | `run_hlmv`; capture the window with `capture_window` |
| Look at a material | `preview_asset` (VTF → PNG) |
| Find a stock model or material | `read_game_content`, `read_asset_catalog` |
| Place the model | `edit_vmf` (`prop_static` / `prop_dynamic`) |

`run_studiomdl` is a compiler driver, not a modeller: it does not make the mesh, the UVs,
the weights or the animations. Those come from the DCC.

## Checking a model before it ships

1. `read_model_info` — `found`, bounds, skins, sequences, materials, `hasPhysics`.
2. `preview_asset` on each material — a missing VTF is a purple checkerboard in game.
3. `run_studiomdl` — the `.mdl` and its `.vvd`/`.dx90.vtx`/`.phy` companions exist.
4. Place it in a test map and `run_map_test` with a screenshot; HLMV's 3D canvas is not
   reliable on every desktop.
5. `read_static_props` after the compile — a model without `.phy` is non-solid unless a clip
   brush replaces it.

## Licensing

The community QC prefabs and player-model helper packs have **no licence file** in the
repositories reviewed here, so none of their files are copied into this project. They are
listed as references only in `third_party/NOTICES.md`. A model or texture taken from another
project needs the same licence check as code.
