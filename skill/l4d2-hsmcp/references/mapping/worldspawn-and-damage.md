# Worldspawn choices and damage types

These are the values the engine treats as **code**, not decoration: a wrong sky renders the
last sky the engine loaded, `timeofday 1` does nothing at all, and a damage type that is not
in L4D2's set is a trigger that never hurts anything. The tables come from L4D2's own FGD
(`worldspawn`, `BaseDamageTypeNew`); `read_vmf_lint` reports the three checked below.

## `worldspawn`

| Key | What it decides | Values |
|---|---|---|
| `skyname` | the 2D skybox | **18 shipped HDR skies**: `docks_hdr`, `highrise_hdr`, `river_hdr`, `sky_coldstream_1_hdr`, `sky_coldstream_2_hdr`, `sky_day01_09_hdr`, `sky_l4d_c1_1_hdr`, `sky_l4d_c1_2_hdr`, `sky_l4d_c2m1_hdr`, `sky_l4d_c4m1_hdr`, `sky_l4d_c4m4_hdr`, `sky_l4d_c5_1_hdr`, `sky_l4d_c6m1_hdr`, `sky_l4d_night02_hdr`, `sky_l4d_predawn02_hdr`, `sky_l4d_rural02_hdr`, `sky_l4d_urban01_hdr`, `urbannightburning_hdr` |
| `musicpostfix` | which campaign music set hordes and mood use | **16**: `Waterfront` (default, unused), `BigEasy`, `Mall`, `Fairgrounds`, `Plankcountry`, `Milltown`, `DeadLight`, `ThePassing`, `Sacrifice`, `NoMercy`, `Garage`, `SmallTown`, `Airport`, `Farm`, `ColdStream`, `Lighthouse` |
| `detailmaterial` | which detail-sprite file the detail brushes use | **3**: `detail/detailsprites` (default), `detail/detailsprites_overgrown`, `detail/ruraldetailsprites`. Must pair with `detailvbsp`: `detail/detail` + `detail.vbsp`, `detail/rural` + `detail_rural.vbsp`, `detail/overgrown` + `detail_overgrown.vbsp` |
| `timeofday` | witch posture and common-infected aggro | **0** midnight: sitting witch, CI sit/lie; **2** morning: sitting witch; **3** afternoon: walking witch. **1 does not exist** — it and any other value leave the witch sitting and CI at the default aggro range |
| `startmusictype` | which cue plays at map start | `0` mission start, `1` checkpoint |
| `maxpropscreenwidth` | prop fade distance | `-1` disables distance fade for every prop (`0` enables); `prop_static` is unaffected |

`detailmaterial` and `detailvbsp` are one decision in two keys; `read_vmf`/lint already flags
half a pair. A sky name must end in `_hdr` — the game ships HDR skies only, and a `_ldr`
suffix is a 2013-era path that does not exist here.

## Damage types (`damagetype`, a bit field)

`trigger_hurt`, `trigger_hurt_ghost`, `point_hurt` and `filter_damage_type` take this key.
Several bits may be OR-ed. The **useful** ones, with the effect the FGD documents:

| Bit | Name | Effect |
|---:|---|---|
| 0 | `GENERIC` | default, no special reaction |
| 1 | `CRUSH` | witches flinch |
| 2 | `BULLET` | bullet impact sounds on CI and witch; the witch cries out but does not aggro |
| 4 | `SLASH` | witches flinch |
| 8 | `BURN` | sets CI, SI and bots on fire |
| 32 | `FALL` | survivors are silent when incapped |
| 64 | `BLAST` | insta-kills CI, stuns SI and bosses, stumbles witches and tanks |
| 128 | `CLUB` | witches flinch |
| 32768 | `FORCE INCAPACITATE` | instantly incaps survivors |
| 131072 | `BLEEDOUT` (`DMG_POISON`) | damage without a damage indicator |
| 16777216 | `FULLGIB` | spawns shotgun-like gibs until CI die |
| 33554432 | `STUMBLE` | melee-bash push on CI |
| 536870912 | `BUCKSHOT` | witches flinch, pushes CI away |

The rest are documented as useless on `trigger_hurt`: `VEHICLE`, `SHOCK` (missing particle),
`SONIC`, `ENERGYBEAM`, `NEVERGIB`, `ALWAYSGIB`, `DROWN`, `NERVEGAS`, `RADIATION`,
`DROWNRECOVER`, `CHOKE`, `MELEE`, `REMOVENORAGDOLL`, `PHYSGUN`, `DISSOLVE`, `BLAST SURFACE`,
`DIRECT`, `HEADSHOT`, `DISMEMBER` (broken). Repeated `0` rows in the FGD picker are UI
separators, not values.

`filter_melee_damage` is separate: `0` all, `4` slash, `128` club.

## Game events for `info_game_event_proxy`

The FGD lists **109 game events** (107 unique names; `exaplin_scavenge_leave_area` is a typo
in the list, and many more events are commented out). Read the installed list with
`read_fgd_class { classname: "info_game_event_proxy" }` instead of copying a value from a
tutorial: a proxy that names an event the game does not fire is silent.

The 338 events VScript can hook are a different list — `resource/modevents.res`, exposed by
`read_vscript_api` and checked by `check_vscript_contract`. A name in one list is not
automatically in the other.

## What the lint now reports

- `l4d2-timeofday-unused` — `timeofday` is not `0`, `2` or `3`; the message lists the three.
- `l4d2-worldspawn-choice` — `skyname`, `musicpostfix` or `detailmaterial` is not one of the
  shipped values, with the allowed list in the finding.

Both are warnings, not errors: a mod may ship its own sky or music set. The finding says what
L4D2 itself has, which is what a campaign that ships no new assets needs.
