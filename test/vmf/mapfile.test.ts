import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportMap } from "../../src/maps/typescript/vmf/mapfile.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { FIXTURES } from "../support/env.js";

const VMF = readFileSync(join(FIXTURES, "hmcp_probe.vmf"), "utf8");

describe("exportMap", () => {
  it("keeps every brush, face and material", () => {
    const result = exportMap(VMF);
    const geometry = checkVmfSolids("probe", VMF);
    expect(result.brushes).toBe(geometry.solidCount);
    expect(result.faces).toBe(
      geometry.solids.reduce((sum, solid) => sum + solid.sides.length, 0),
    );
    expect(result.text).toContain('"classname" "worldspawn"');
    expect(result.text).toContain('"mapversion" "220"');
    expect(result.text).toMatch(/\[\s*[-0-9. ]+\]\s+\[\s*[-0-9. ]+\]\s+0\s+[-0-9.]+\s+[-0-9.]+/);
    expect(result.entities).toBeGreaterThan(0);
  });

  it("warns about VMF-only constructs instead of dropping them silently", () => {
    const withExtra = `${VMF}\nentity\n{\n"classname" "func_instance"\n}\n`;
    const result = exportMap(withExtra);
    expect(result.warnings.some((w) => w.includes("func_instance"))).toBe(true);
  });
});
