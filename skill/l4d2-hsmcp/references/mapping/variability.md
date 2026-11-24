# Variability: random choice and templated spawns

A map that shows the same car colour, the same parked prop and the same fire on every load
is deterministic. The official maps use two small patterns to break that:

- **`logic_case` + `PickRandom`** chooses one case at map spawn; the case fires `Color`,
  `SetSkin`, `SetBodyGroup`, a spawner or a relay.
- **`point_template` + `env_entity_maker`** stores a named set of entities and `ForceSpawn`
  makes a copy. It is how random prop sets, gascan drops and rescue sequences appear.

## Random case

```text
write_random_case(path, targetname: "car_color", origin: [0,0,64],
                  cases: [
                    { target: "car_a", input: "Color", parameter: "200 30 30" },
                    { target: "car_b", input: "Color", parameter: "30 30 200" }
                  ], confirm: true)
```

- The builder writes `Case01..CaseN` values (default 1..N) and `OnCase01..` outputs, plus a
  `logic_auto` `OnMapSpawn -> PickRandom` unless `pickOnSpawn: false`.
- `Color` is the `RenderFields` input; `SetSkin` and `SetBodyGroup` change the model, not the
  colour. A `prop_physics`/`prop_dynamic` can take `Color`; a `prop_static` cannot.
- Official counts: 505 `PickRandom`, 176 `PickRandomShuffle`, 1,915 `Color`. A car colour is
  the canonical use: `OnMapSpawn -> PickRandom -> OnCaseN -> car:Color`.
- Adding a `logic_case` without an output is a selector nobody calls; the builder refuses fewer
  than two cases.

## Template and entity maker

```text
write_template_spawner(path, targetname: "car_set", origin: [0,0,64],
                       templates: ["car_a", "car_b"], confirm: true)
```

- `point_template.Template01..` names entities that **must already exist**. The builder does
  not create them; a name typo is a template that copies nothing.
- `env_entity_maker.PointTemplate` names the template; `ForceSpawn` creates one copy at the
  maker, not at each template entity. Fire it from a `logic_auto`, trigger or relay.
- `ForceSpawn` is the official 998 uses; a spawner that nobody fires is dead weight.
- The copied entities keep their targetnames unless the template uses `preserve_Names`; two
  copies with one name can make outputs fire twice.

## What is still manual

The design decision and the visual check. `read_bsp_entities` proves the classes exist after
a compile, but whether the chosen colour or prop set looks right is a screenshot/play-test,
deferred while the game launch is paused. Two variability beats were not applied to campaign
003 yet; that is a build edit, not a tool gap.
