# Design ready (pass 1)

Use this before setting `Status: approved` in `workspaces/<addon-name>/plan/DESIGN.md`. The build pass
starts only when every line is true. This is a design checklist, not a build checklist: no
`.vmf` exists yet.

## Brief

- [ ] The user's wish is written back as a design, not a summary of the chat.
- [ ] Chapter count, campaign vs single map, and mode are decided (asked if identity-changing).
- [ ] Every asset, class and pricey number is queried or marked as a target with its source.
- [ ] Anything the environment cannot prove is named now (a two-team round, a live audio mix).
- [ ] The experience is one sentence and the three pillars are decision rules, not adjectives.
- [ ] The beats carry an intensity and show at least one peak and one rest.

## Skeleton

- [ ] The chapter has 2-5 districts; each has a motif, a mood and a landmark.
- [ ] Every route node names its space, district, floor and kind; consecutive nodes in one
      space share the name.
- [ ] The critical route has at least three named spaces, two turns and one vertical node.
- [ ] Every floor change is a `stair`/`ladder`/`elevator`/`ramp`/`drop` node; a drop goes down.
- [ ] Every beat is mapped to a node; no node points at a beat that does not exist.
- [ ] The intensity curve has a peak (4-5), two rests (0-2) and no three high nodes in a row.
- [ ] There is a vista and a landmark at least every four nodes; no four identical enclosures.
- [ ] At least one gate (hard, soft, one-way or lock) shapes the chapter.
- [ ] Every branch has a `from` on the critical route and either a `to` or a deliberate dead end.
- [ ] `check_map_plan` at `stage: "skeleton"` has no errors.
- [ ] `check_map_plan` at `stage: "approved"` has no errors either: the gate is cumulative, not
      a one-time skeleton check.

## Route

- [ ] Every chapter has a start, an ordered route and an end (safe room + checkpoint, or
      finale + escape).
- [ ] The route is names of spaces, not "some streets"; a builder can follow it without the
      chat.
- [ ] Every chapter has at least one reason to exist (a beat), and no chapter is a corridor
      with a compile time.
- [ ] Pacing names the quiet, fight and set-piece beats; there is somewhere to breathe.
- [ ] The finale type is chosen and justified; the arena, holdout, stages and escape are
      described.

## Rooms and verticality

- [ ] Every space has size, floors, entrances, exits, cover, light, purpose and nav notes.
- [ ] Every floor plan has unique room keys; every door names two real sides (`outside`
      allowed) and sits near both rooms.
- [ ] Every route `door` node sits on a real door; every route stair/ladder/elevator/ramp node
      matches a connection of the same kind.
- [ ] Every stair/ladder/elevator/ramp names a target floor that exists, and the target floor
      has a matching landing or return.
- [ ] Every floor change is stairs/ramp/ladder/drop, with the one-way direction and what stops
      walking back.
- [ ] Door and corridor sizes use the measured player hull, not a guess.
- [ ] Boundaries and sightlines are designed, not left to the build pass ("some walls").

## Events, items and variability

- [ ] Every beat has a trigger, the entity classes, the outputs/inputs, a duration and a
      failure mode.
- [ ] The finale script name is `<map>_finale.nut` when type 2; type 0 is labelled a test.
- [ ] The item/health/ammo budget is per chapter and in the measured range, not "some items".
- [ ] Variability says what changes per load and what must not.
- [ ] Modes are explicit; a mode that is not designed is not tested.

## Handoff

- [ ] A builder who has never seen the user's message can build chapter 1 from the file alone.
- [ ] The asset palette has three motifs and a "not used" list.
- [ ] `## 13. Acceptance criteria` is numbered and each line has a tool or a log.
- [ ] `## 14. Build order` names the first compile checkpoint and what is deferred.
- [ ] `## 16. Assumptions` lists every unmeasured assumption and what would settle it.
- [ ] `Status` is `draft` until the user approves; then `approved`.
- [ ] The design path is reported and the message stops. No VMF was written.
