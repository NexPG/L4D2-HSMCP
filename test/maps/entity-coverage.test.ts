import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  ENTITY_FAMILIES,
  readEntityCoverageTool,
} from "../../src/maps/typescript/tools/entitycoverage.js";
import { config, ctx as sharedCtx, has, REPO } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

function familyOf(classname: string): string | null {
  return ENTITY_FAMILIES.find((rule) => rule.test.test(classname))?.name ?? null;
}

describe("entity coverage families", () => {
  it("assigns representative stock classes to their family", () => {
    expect(familyOf("weapon_rifle_spawn")).toBe("Weapons and item spawners");
    expect(familyOf("prop_physics")).toBe("Props and physics");
    expect(familyOf("env_fog_controller")).toBe("Atmosphere, weather and sound");
    expect(familyOf("logic_relay")).toBe("Logic, math and filters");
    expect(familyOf("func_nav_blocker")).toBe("Brush and clip volumes");
    expect(familyOf("trigger_finale")).toBe("Triggers");
    expect(familyOf("info_gamemode")).toBe("Campaign, nav and mode entities");
    expect(familyOf("func_simpleladder")).toBe("Ladders");
  });

  it("has no class in two families by construction (first match wins) and no empty rule", () => {
    for (const rule of ENTITY_FAMILIES) {
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.page.length).toBeGreaterThan(0);
      expect(rule.status).toMatch(/^(covered|partial|documented|none)$/);
      // A family page that does not exist is a dead route in the skill.
      expect(
        existsSync(join(REPO, "skill", "l4d2-hsmcp", rule.page)),
        `${rule.name}: ${rule.page}`,
      ).toBe(true);
    }
  });
});

describe.skipIf(!has.gameContent)("read_entity_coverage on the stock game", () => {
  it("classifies every class in one map", async () => {
    const path = join(config.gameDir!, "maps", "c1m1_hotel.bsp");
    const r = (await readEntityCoverageTool.handler({ maps: [path] } as never, ctx)) as unknown as {
      mapsScanned: number;
      classes: number;
      unclassified: unknown[];
      families: Array<{ name: string; classes: number }>;
    };
    expect(r.mapsScanned).toBe(1);
    expect(r.classes).toBeGreaterThan(40);
    expect(r.unclassified).toEqual([]);
    expect(r.families.find((f) => f.name === "Weapons and item spawners")!.classes).toBeGreaterThan(0);
  });

  it("leaves no official class unclassified across the stock BSPs", async () => {
    const r = (await readEntityCoverageTool.handler({} as never, ctx)) as unknown as {
      mapsScanned: number;
      classes: number;
      unclassified: unknown[];
      coverage: Record<string, number>;
      families: Array<{ name: string; classes: number; classnames: string[] }>;
    };
    expect(r.mapsScanned).toBeGreaterThanOrEqual(28);
    expect(r.classes).toBeGreaterThanOrEqual(180);
    expect(r.unclassified).toEqual([]);
    expect(r.coverage.covered).toBeGreaterThanOrEqual(8);
    // `classnames` is the complete list, not the capped `examples`: an agent uses it to find
    // a class whose family it does not know. Every family must agree with its own count.
    for (const family of r.families) {
      expect(family.classnames, family.name).toHaveLength(family.classes);
      expect(new Set(family.classnames).size, family.name).toBe(family.classes);
    }
    const all = r.families.flatMap((family) => family.classnames);
    expect(new Set(all).size).toBe(r.classes);
    expect(all).toContain("func_simpleladder");
    expect(all).toContain("prop_health_cabinet");
    expect(all).toContain("upgrade_spawn");
  });

  it("names every stock class on its family's page", async () => {
    // The coverage page routes a class to a family; that page has to contain the name, or
    // the route ends on a page that never mentions the class the agent asked about.
    const r = (await readEntityCoverageTool.handler({} as never, ctx)) as unknown as {
      families: Array<{ name: string; page: string; classnames: string[] }>;
    };
    for (const family of r.families) {
      const page = readFileSync(join(REPO, "skill", "l4d2-hsmcp", family.page), "utf8");
      const missing = family.classnames.filter(
        (name) => !page.toLowerCase().includes(name.toLowerCase()),
      );
      expect(missing, `${family.name} -> ${family.page}`).toEqual([]);
    }
  });
});
