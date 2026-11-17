import { describe, expect, it } from "vitest";
import { missionFromSpec, parseMission, serializeMission } from "../../src/campaign/mission.js";

describe("mission chapter convars", () => {
  it("writes a convar block and reads it back", () => {
    const mission = missionFromSpec({
      name: "TestCampaign",
      displayTitle: "Test",
      modes: [
        {
          name: "coop",
          chapters: [
            {
              map: "map_a",
              displayName: "One",
              convars: { z_spawn_safety_range: "100" },
            },
          ],
        },
      ],
    });
    const text = serializeMission(mission);
    expect(text).toContain('"convar"');
    expect(text).toContain('"z_spawn_safety_range"');

    const back = parseMission(text);
    expect(back.modes[0]!.chapters[0]!.convars).toEqual({ z_spawn_safety_range: "100" });
  });
});
