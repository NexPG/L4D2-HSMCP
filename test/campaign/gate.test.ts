import { describe, expect, it } from "vitest";
import { summarizeProps } from "../../src/campaigns/typescript/tools/gate.js";

describe("the gate's props stage", () => {
  it("counts exactly the models it lists", () => {
    // The defect: two decorative models made the count 3 while the list held 1, so the gate
    // printed a non-zero count beside an empty-looking list.
    const r = summarizeProps({
      read: true,
      missingPhysics: [
        { model: "models/tree.mdl", instances: 4, decorative: true },
        { model: "models/grass.mdl", instances: 9, decorative: true },
        { model: "models/car.mdl", instances: 2, decorative: false },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.missingPhysicsCount).toBe(1);
    expect(r.missingPhysics).toEqual([{ model: "models/car.mdl", instances: 2 }]);
    expect(r.decorativePhysicsCount).toBe(2);
  });

  it("passes a map whose only physics-less props are decoration", () => {
    const r = summarizeProps({
      read: true,
      missingPhysics: [
        { model: "models/tree.mdl", instances: 4, decorative: true },
        { model: "models/grass.mdl", instances: 9, decorative: true },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.missingPhysicsCount).toBe(0);
    expect(r.missingPhysics).toEqual([]);
    expect(r.decorativePhysicsCount).toBe(2);
  });
});
