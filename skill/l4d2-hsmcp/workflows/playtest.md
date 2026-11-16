# Workflow: play test

The build is not done until the game agrees. A play test has a fixed script so the result is
comparable between builds.

## Before launching

- The add-on is enabled in *Extras → Add-ons*.
- The game was restarted after the VPK was replaced.
- The console is available (`-console`), and ideally `-condebug` so the log survives.

## What to check, in order

1. **Campaign appears** in the campaign menu with its display title and image.
2. **Survivors spawn** — four of them, standing on the floor, not inside geometry.
3. **Bots move** — they path toward the goal area. They may run ahead and wait; that is
   flow working, not a bug.
4. **Chapter transition** — the whole team enters the exit safe room's `info_changelevel`
   volume, the next chapter loads, and survivors arrive near the arrival landmark.
5. **Finale** — the radio responds to +use, the escape trigger opens after its delay, walking
   into it wins the campaign and the stats crawl runs.

## Evidence

Record, in the campaign's README:

- what was tested and the result of each line above;
- the console log section for the transition and finale, if anything went wrong;
- the nav dump's attributes and flow line, when bots behave unexpectedly.

"Looks fine" is not evidence. "Chapter 2 loaded, survivors arrived at the landmark, FinaleStart
fired" is.

## Failure routing

| Failure | Read |
|---|---|
| Campaign not in the menu | `troubleshooting/campaign-not-in-menu.md` |
| Chapter does not change | `troubleshooting/chapter-does-not-change.md` |
| Bots wander | `troubleshooting/bots-wander.md` |
| Nav stale or regenerated itself | `troubleshooting/nav-stale.md` |
| Script banner missing | `troubleshooting/vscript-not-loaded.md` |

## After a pass

- Update the campaign README with the result and date.
- Note the project version the campaign was built with.
- If the pass changed a rule, update the skill and `docs/` in the same change.
