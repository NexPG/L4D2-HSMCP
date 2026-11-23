import { describe, expect, it } from "vitest";
import { safeMapName } from "../../src/models/typescript/tools/preview.js";

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
