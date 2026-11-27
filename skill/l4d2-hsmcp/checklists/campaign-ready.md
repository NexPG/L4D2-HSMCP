# Campaign ready

Use this before calling a campaign build done. Each line is a check with a tool or a log, not
an opinion. The per-map build order is
[`../references/campaign/authoring-checklist.md`](../references/campaign/authoring-checklist.md).

## Brief

- [ ] The user's wish is written back as a spec: chapters, setting, flow, mechanics, constraints.
- [ ] Every asset name came from `read_game_content`; every entity class from `read_fgd_class`.
- [ ] Each requested mechanic has a named place in a chapter and a planned proof.
- [ ] Anything the environment cannot prove (for example a two-team round) is named now.

## Source

- [ ] Every chapter has a `.vmf`, and it is the file that was compiled.
- [ ] `read_vmf_leak` — `sealed: true` for every chapter.
- [ ] `read_vmf_lint` — 0 findings against the installed `left4dead2.fgd`.
- [ ] No entity exists only in the `.vmf` while the `.bsp` ships an older one.
- [ ] Every prop family was **looked at** (`preview_model` or a play-test screenshot) and
      placed with `write_prop` `facing`/`modelForward` from
      `references/mapping/model-facing.md`. No model is placed sight-unseen.
- [ ] `read_static_props.solidity`: solid props are `solid 6`; `nonSolidInstances` is 0
      except `spawnflags 2` decoration. An omitted `solid` key compiles to 0 even with `.phy`.

## Compile

- [ ] `run_compile` exit 0 for vbsp, vvis, vrad on every map.
- [ ] The toolchain that ran is recorded (stock or Tools++).
- [ ] `read_map_geometry` is inside the limits for that chain.

## Nav

- [ ] Each map has a `.nav` generated after the final compile.
- [ ] `read_nav` — `fresh` against the shipped `.bsp`.
- [ ] The dump shows CHECKPOINT at the safe rooms and PLAYER_START on the first map.
- [ ] The finale map shows FINALE where the finale runs.
- [ ] The live `nav_trouble_report` passes and the console has no flow warnings. The dump's
  `mostlyFlat` count is not flow (`0x20000000` is `MOSTLY_FLAT`).
- [ ] The safe room has a real doorway and a `prop_door_rotating_checkpoint`.

## Contracts

- [ ] `check_finale_contract` (or the gate's `finale` stage): exactly one `trigger_finale`,
      a type the map supports, FINALE nav areas, and RESCUE_VEHICLE/ESCAPE_ROUTE where the
      type needs them.
- [ ] `check_gamemode_contract` on any map with `info_gamemode`: every mode output resolves,
      `info_map_parameters` has no unknown or non-numeric density.
- [ ] `check_ai_contract`: a rescue point has a RESCUE_CLOSET area, and the hiding spots and
      blockers are the ones the map intends.
- [ ] `read_item_density`: the spawner total is in range for the chapter's size, not five in a
      full chapter.

## Campaign

- [ ] Mission base name equals the VPK base name.
- [ ] `Name` is alphanumeric; `Image` resolves; chapters start at `"1"` with no gaps.
- [ ] `check_campaign` passes on the packed VPK and its mission entry.
- [ ] `addoninfo.txt` has app 550 and `addonContent_Campaign 1`.
- [ ] VPK entry count equals the staging file count; no `.bak`, logs or loose maps.

## Deploy

- [ ] One archive in `left4dead2/addons/`, under the fixed name.
- [ ] Older campaign archives removed.
- [ ] Game restarted; add-on enabled.
- [ ] Play test recorded: spawn, bots, transition, finale, evidence.
- [ ] Each requested mechanic has its own evidence line or screenshot, not only "map loads".
- [ ] Every requested feature that is not proven is listed with what it would take.

## Housekeeping

- [ ] Campaign README updated: date, project version, attempt, result, status.
- [ ] Diary entry written for anything learned.
- [ ] Skill and `docs/` updated if a rule changed.
