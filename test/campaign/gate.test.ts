import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { runCampaignGate, summarizeProps } from "../../src/campaigns/typescript/tools/gate.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { config, ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

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

  it("fails a map whose compiled props are solidity 0", () => {
    // The bug measured on Santa Monica: the VMF model check says every bench/car has a
    // `.phy`, but vbsp wrote solidity 0 because the `solid` key was absent.
    const r = summarizeProps({ read: true, nonSolidNonDecorativeInstances: 12 });
    expect(r.ok).toBe(false);
    expect(r.nonSolidInstances).toBe(12);
  });
});

describe.skipIf(!has.gameContent)("the gate's transition stage", () => {
  it("passes a stock pair from its compiled BSPs", async () => {
    const maps = join(config.gameDir!, "maps");
    const first = join(maps, "c1m1_hotel.bsp");
    const second = join(maps, "c1m2_streets.bsp");
    if (!existsSync(first) || !existsSync(second)) return;
    const r = (await runCampaignGate.handler(
      {
        maps: [
          { name: "c1m1_hotel", kind: "first", bsp: first },
          { name: "c1m2_streets", kind: "last", bsp: second },
        ],
        stages: ["transition"],
        confirm: true,
      } as never,
      ctx,
    )) as unknown as {
      ok: boolean;
      transitions: Array<{ from: string; to: string; ok: boolean }>;
    };
    expect(r.ok).toBe(true);
    expect(r.transitions).toHaveLength(1);
    expect(r.transitions[0]).toMatchObject({
      from: "c1m1_hotel",
      to: "c1m2_streets",
      ok: true,
    });
  });
});
