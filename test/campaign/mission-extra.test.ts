import { describe, expect, it } from "vitest";
import { CampaignFormatError, missionFromSpec, serializeMission } from "../../src/campaign/mission.js";

const BASE = {
  name: "TestCampaign",
  modes: [{ name: "coop", chapters: [{ map: "map_a", displayName: "One" }] }],
};

describe("mission arbitrary keyvalues", () => {
  it("writes extra keys at mission, mode and chapter level", () => {
    const text = serializeMission(
      missionFromSpec({
        ...BASE,
        keyvalues: { Version: "2", VersusCompletionScore: "100" },
        modes: [
          {
            name: "coop",
            keyvalues: { ModeExtra: "mode-value" },
            chapters: [
              {
                map: "map_a",
                displayName: "One",
                keyvalues: { ChapterExtra: "chapter-value" },
              },
            ],
          },
        ],
      }),
    );

    expect(text).toContain('"Version"\t\t"2"');
    expect(text).toContain('"VersusCompletionScore"\t\t"100"');
    expect(text).toContain('"ModeExtra"\t\t"mode-value"');
    expect(text).toContain('"ChapterExtra"\t\t"chapter-value"');
    expect(text).toMatch(/"1"\s*\{[\s\S]*"Map"/);
  });

  it("refuses a structural key instead of writing a duplicate", () => {
    expect(() => missionFromSpec({ ...BASE, keyvalues: { modes: "x" } })).toThrow(
      CampaignFormatError,
    );
    expect(() => missionFromSpec({ ...BASE, keyvalues: { Name: "Other" } })).toThrow(
      /own field/,
    );
    expect(() =>
      missionFromSpec({
        ...BASE,
        modes: [
          {
            name: "coop",
            chapters: [
              { map: "map_a", displayName: "One", keyvalues: { Map: "map_b" } },
            ],
          },
        ],
      }),
    ).toThrow(/own field/);
  });

  it("refuses a numbered key on a mode block", () => {
    expect(() =>
      missionFromSpec({
        ...BASE,
        modes: [{ name: "coop", keyvalues: { "1": "x" }, chapters: BASE.modes[0]!.chapters }],
      }),
    ).toThrow(/chapter blocks/);
  });
});
