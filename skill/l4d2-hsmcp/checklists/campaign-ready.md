# Campaign ready

Use this before calling a campaign build done. Each line is a check with a tool or a log, not
an opinion.

## Source

- [ ] Every chapter has a `.vmf`, and it is the file that was compiled.
- [ ] `read_vmf_leak` — `sealed: true` for every chapter.
- [ ] `read_vmf_lint` — 0 findings against the installed `left4dead2.fgd`.
- [ ] No entity exists only in the `.vmf` while the `.bsp` ships an older one.

## Compile

- [ ] `run_compile` exit 0 for vbsp, vvis, vrad on every map.
- [ ] The toolchain that ran is recorded (stock or Tools++).
- [ ] `read_map_geometry` is inside the limits for that chain.

## Nav

- [ ] Each map has a `.nav` generated after the final compile.
- [ ] `read_nav` — `fresh` against the shipped `.bsp`.
- [ ] The dump shows CHECKPOINT at the safe rooms and PLAYER_START on the first map.
- [ ] The finale map shows FINALE where the finale runs.
- [ ] `0x20000000` appears on the flow path; no flow warnings in the console log.
- [ ] The safe room has a real doorway and a `prop_door_rotating_checkpoint`.

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

## Housekeeping

- [ ] Campaign README updated: date, project version, attempt, result, status.
- [ ] Diary entry written for anything learned.
- [ ] Skill and `docs/` updated if a rule changed.
