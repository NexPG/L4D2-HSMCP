import { describe, expect, it } from "vitest";
import { buildPreviewRoom, safeMapName } from "../../src/models/typescript/tools/preview.js";

describe("preview map names", () => {
  it("stays within the nav header's 32 bytes", () => {
    // Measured: `hsmcp_preview_cara_95sedan_mwte0ldq` (37 characters) truncated in the nav
    // header; the BSP and nav disagreed and the client failed signon, staying at the menu.
    for (const model of [
      "models/props_vehicles/cara_95sedan.mdl",
      `models/${"a".repeat(200)}.mdl`,
      "models/props/cs_office/trash_can.mdl",
    ]) {
      const name = safeMapName(model);
      expect(name.length, name).toBeLessThanOrEqual(30);
      expect(name.length, name).toBeGreaterThan(0);
    }
  });

  it("keeps a readable model stem", () => {
    expect(safeMapName("models/props_vehicles/cara_95sedan.mdl")).toMatch(/cara_95/);
  });
});

describe("preview camera views", () => {
  it("puts the camera on the side asked for", () => {
    // `half` is 160 for a 64-unit model, so the camera sits 112 units from the centre.
    const back = buildPreviewRoom("models/x.mdl", [0, 0, 0], [64, 64, 64], 1, "back");
    expect(back.text).toContain('"origin" "112 0 16"');
    expect(back.text).toContain('"angles" "0 180 0"');
    const left = buildPreviewRoom("models/x.mdl", [0, 0, 0], [64, 64, 64], 1, "left");
    expect(left.text).toContain('"origin" "0 -112 16"');
    expect(left.text).toContain('"angles" "0 90 0"');
    const front = buildPreviewRoom("models/x.mdl", [0, 0, 0], [64, 64, 64], 1);
    expect(front.text).toContain('"origin" "-112 0 16"');
    expect(front.text).toContain('"angles" "0 0 0"');
  });
});
