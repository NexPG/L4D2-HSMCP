import { describe, expect, it } from "vitest";
import { checkFinale, readCustomStages } from "../../src/campaigns/typescript/campaign/finale.js";
import type { FinaleEntity } from "../../src/campaigns/typescript/campaign/finale.js";

function entity(
  classname: string,
  keyvalues: Array<[string, string]> = [],
  extra: Partial<FinaleEntity> = {},
): FinaleEntity {
  return {
    classname,
    keyvalues: [
      ["classname", classname],
      ...keyvalues,
    ],
    connections: [],
    solidCount: 1,
    ...extra,
  };
}

const SCRIPT = `
DirectorOptions <-
{
    A_CustomFinale_StageCount = 2
    A_CustomFinale1 = DELAY
    A_CustomFinaleValue1 = 3
    A_CustomFinale2 = PANIC
}
function OnBeginCustomFinaleStage( num, type ) {}
`;

const TRIGGER = entity(
  "trigger_finale",
  [
    ["targetname", "finale"],
    ["type", "2"],
    ["origin", "0 3650 320"],
  ],
  {
    origin: [0, 3650, 320],
    connections: [["FinaleEscapeStarted", "escape_trigger,Enable,,0,-1"]],
  },
);

const OUTTRO = entity("env_outtro_stats");
const ARRIVAL = entity("info_changelevel", [["spawnflags", "2"]]);
const FINALE_REGION = { lo: [-2048, 3200, 240] as [number, number, number], hi: [2048, 4096, 500] as [number, number, number] };

function run(overrides: Partial<Parameters<typeof checkFinale>[0]> = {}) {
  return checkFinale({
    map: "night_moscow_m2",
    entities: [TRIGGER, OUTTRO, ARRIVAL],
    finaleRegions: [FINALE_REGION],
    scriptText: SCRIPT,
    scriptName: "night_moscow_m2_finale.nut",
    expectFinale: true,
    ...overrides,
  });
}

describe("checkFinale", () => {
  it("passes a type-2 finale whose script has the stages it promises", () => {
    const r = run();
    expect(r.ok).toBe(true);
    expect(r.type).toBe(2);
    expect(r.stageCount).toBe(2);
    expect(r.definedStages).toBe(2);
    expect(r.overFinaleNav).toBe(true);
  });

  it("fails when the custom script is absent", () => {
    const r = run({ scriptText: null });
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.rule)).toContain("finale-missing-script");
  });

  it("does not pretend an unchecked script was checked", () => {
    const r = run({ scriptText: undefined });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "finale-script-not-checked" })]),
    );
  });

  it("fails a stage count without the stages behind it", () => {
    const r = run({
      scriptText: SCRIPT.replace("A_CustomFinale_StageCount = 2", "A_CustomFinale_StageCount = 4"),
    });
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.rule)).toContain("finale-script-stage-count");
  });

  it("fails a trigger outside the FINALE region", () => {
    const r = run({
      entities: [
        { ...TRIGGER, origin: [0, 1000, 320] },
        OUTTRO,
        ARRIVAL,
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.rule)).toContain("finale-trigger-outside-nav");
  });

  it("fails a gauntlet with no nav_flow_target", () => {
    const gauntlet: FinaleEntity = {
      ...TRIGGER,
      keyvalues: [
        ["classname", "trigger_finale"],
        ["type", "1"],
      ],
    };
    const r = run({ entities: [gauntlet, OUTTRO, ARRIVAL], scriptText: undefined });
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.rule)).toContain("finale-gauntlet-no-flow-target");
  });

  it("warns when nothing is wired to the escape event", () => {
    const quiet = { ...TRIGGER, connections: [] };
    const r = run({ entities: [quiet, OUTTRO, ARRIVAL] });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "finale-no-escape-output" })]),
    );
  });

  it("fails a last chapter with no trigger at all", () => {
    const r = run({ entities: [OUTTRO] });
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.rule)).toContain("finale-missing-trigger");
  });

  it("warns about a trigger that starts disabled with nothing enabling it", () => {
    const disabled: FinaleEntity = {
      ...TRIGGER,
      keyvalues: [
        ["classname", "trigger_finale"],
        ["targetname", "finale"],
        ["type", "2"],
        ["StartDisabled", "1"],
      ],
    };
    const r = run({ entities: [disabled, OUTTRO, ARRIVAL] });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "finale-start-disabled" })]),
    );
  });

  it("reads stage counts out of a script", () => {
    expect(readCustomStages(SCRIPT)).toMatchObject({
      stageCount: 2,
      definedStages: 2,
      hasDirectorOptions: true,
      hasStageHook: true,
    });
  });
});
