# Weapons and items

Every weapon, ammo pile and pickup is a **spawn entity**. The entity is removed on spawn and
the game creates the item at its origin, so placement is one entity with an origin, not a
prop_physics.

The class list below is read from the installed `left4dead2.fgd` with
`read_fgd_class(prefix: "weapon_")` — 37 classes on this install.

## Contents

- Tier 1 and tier 2 weapons
- Ammo, health and throwables
- Placing one
- Density: what a full chapter carries
- Checking

## Tier 1 and tier 2 weapons

| Tier | Spawn class |
|---|---|
| 1 | `weapon_smg_spawn`, `weapon_pumpshotgun_spawn`, `weapon_pistol_spawn` |
| 1 (L4D2 additions) | `weapon_smg_silenced_spawn`, `weapon_smg_mp5_spawn`, `weapon_shotgun_chrome_spawn`, `weapon_pistol_magnum_spawn` |
| 2 | `weapon_rifle_spawn`, `weapon_autoshotgun_spawn`, `weapon_hunting_rifle_spawn` |
| 2 (L4D2 additions) | `weapon_rifle_desert_spawn`, `weapon_rifle_ak47_spawn`, `weapon_rifle_sg552_spawn`, `weapon_shotgun_spas_spawn`, `weapon_sniper_military_spawn`, `weapon_sniper_awp_spawn`, `weapon_sniper_scout_spawn` |
| special | `weapon_chainsaw_spawn`, `weapon_grenade_launcher_spawn`, `weapon_rifle_m60_spawn` |

## Ammo, health and throwables

| Spawn class | Item |
|---|---|
| `weapon_ammo_spawn` | ammo pile |
| `weapon_first_aid_kit_spawn` | first aid kit |
| `weapon_pain_pills_spawn` | pain pills |
| `weapon_adrenaline_spawn` | adrenaline |
| `weapon_defibrillator_spawn` | defibrillator |
| `weapon_molotov_spawn` | molotov |
| `weapon_pipe_bomb_spawn` | pipe bomb |
| `weapon_vomitjar_spawn` | vomit jar |
| `weapon_upgradepack_incendiary_spawn` | incendiary ammo upgrade |
| `weapon_upgradepack_explosive_spawn` | explosive ammo upgrade |
| `weapon_melee_spawn` | a random melee weapon (or set the model to choose one) |
| `weapon_gascan_spawn` | gas can |
| `weapon_scavenge_item_spawn` | scavenge item |

Two randomisers: `weapon_spawn` spawns a random weapon, `weapon_item_spawn` a random item.
`weapon_first_aid_kit` and `weapon_grenade_launcher` exist as classes but the `_spawn`
variants are the placement ones.

## Placing one

```
edit_vmf(
  path: "my_map.vmf",
  ops: [{ op: "add", keyvalues: {
    classname: "weapon_rifle_spawn",
    origin: "-120 -64 16"
  }}],
  confirm: true
)
```

Rules that matter:

- Put the spawn **on the floor's z plus a little**, not inside it. The item appears at the
  origin and falls.
- Place on a **nav area**: the Director and bots use the mesh, and an item off the mesh can be
  unreachable or removed by density logic.
- In a **safe room**, item spawns are forced and do not need the `Must Exist` flag. Giving
  that flag to checkpoint items is a common cause of duplicates after a transition.
- The Director controls item density outside safe rooms; a corridor full of tier 2 weapons is
  not what a campaign wants.

## Density: what a full chapter carries

`read_item_density` counts every `weapon_*_spawn` in a VMF or BSP, separates the random
`weapon_item_spawn` layer from specific/health/throwable/ammo/melee/scavenge, and compares
with one official peer. Measured totals on the official maps:

| Map | Total spawners | `weapon_item_spawn` |
|---|---|---|
| `c2m1_highway` | 187 | 60 |
| `c2m2_fairgrounds` | 191 | 101 |
| `c2m3_coaster` | 152 | 66 |
| `c1m1_hotel` | 81 | 51 |
| `c5m1_waterfront` | 96 | 28 |

A previous estimate of 321 per Milltown chapter is not the spawner count this reader sees: the
three Milltown chapters are 187/191/152. Use **~150 total** as the full-chapter budget and
`weapon_item_spawn` ~50–100 as the random layer; a short arena needs the nav-area ratio.

```text
read_item_density(path: "src/map.vmf")                         # counts + budget
read_item_density(path: "map.bsp", nav: "map.nav",
                  peer: "c2m1_highway")                        # per-1,000 areas + peer
```

`status` is `sparse` below half the budget, `dense` above double, otherwise `in-range`. It
counts what the map offers, not what the Director spawns; a play test is still the item proof.

## Checking

- `read_fgd_class(classname: "weapon_rifle_spawn")` — keyvalues, inputs, outputs.
- `read_fgd_class(prefix: "weapon_")` — the classes this install actually has.
- `read_bsp_entities(path, classnameContains: "weapon_")` after a compile — the spawns are in
  the entity lump.
- A play test is still the proof that an item appears, because the Director can remove or
  reroll spawns.
