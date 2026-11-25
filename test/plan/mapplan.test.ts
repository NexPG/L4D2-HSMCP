import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MapPlanSchema,
  checkMapPlan,
  renderMapPlan,
} from "../../src/plan/typescript/tools/mapplan.js";

const root = mkdtempSync(join(tmpdir(), "hammer-plan-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function plan(): Record<string, unknown> {
  return {
    version: 1,
    name: "Plan test",
    kind: "campaign",
    site: {
      bounds: { x0: 0, y0: 0, x1: 4096, y1: 3072 },
      north: 0,
      grid: 512,
      water: [],
      noBuild: [],
    },
    terrain: {
      cell: 1024,
      origin: [0, 0],
      cols: 5,
      rows: 4,
      heights: Array.from({ length: 20 }, (_, index) => (index === 12 ? 128 : 0)),
    },
    buildings: [
      {
        id: "house_a",
        name: "Beach house",
        x: 800,
        y: 800,
        width: 512,
        depth: 384,
        rotation: 0,
        floors: 2,
        floorHeight: 128,
        baseZ: 0,
        enterable: true,
        entrances: [{ x: 1056, y: 800, z: 0, width: 64, face: "east" }],
        floorsPlan: [
          {
            level: 1,
            z: 0,
            height: 128,
            rooms: [{ name: "living", x: 0, y: 0, width: 280, depth: 200 }],
            stairs: [{ x: 140, y: 100, width: 48, depth: 96, to: 2 }],
          },
          {
            level: 2,
            z: 128,
            height: 128,
            rooms: [{ name: "bed", x: 0, y: 0, width: 200, depth: 160 }],
            stairs: [],
          },
        ],
      },
      {
        id: "warehouse",
        name: "Pier warehouse",
        x: 2400,
        y: 1400,
        width: 768,
        depth: 512,
        rotation: 15,
        floors: 1,
        floorHeight: 160,
        baseZ: 0,
        enterable: true,
        entrances: [{ x: 1980, y: 1400, z: 0, width: 96, face: "west" }],
        floorsPlan: [
          {
            level: 1,
            z: 0,
            height: 160,
            rooms: [{ name: "hold", x: 0, y: 0, width: 500, depth: 320 }],
            stairs: [],
          },
        ],
      },
      {
        id: "shed",
        name: "Shed",
        x: 800,
        y: 2300,
        width: 256,
        depth: 256,
        rotation: 0,
        floors: 1,
        floorHeight: 128,
        baseZ: 0,
        enterable: false,
        entrances: [],
        floorsPlan: [],
      },
    ],
    routes: [
      {
        id: "critical",
        kind: "critical",
        width: 96,
        points: [
          [200, 300, 0],
          [300, 1100, 0],
          [900, 1100, 0],
          [1056, 1050, 0],
          [1056, 800, 0],
          [1200, 800, 0],
          [1200, 1100, 0],
          [1800, 1400, 0],
          [1980, 1400, 0],
        ],
        stops: [
          { id: "start", label: "start", x: 200, y: 300, z: 0, kind: "start" },
          { id: "door", label: "house door", x: 1056, y: 800, z: 0, kind: "checkpoint" },
          { id: "end", label: "warehouse", x: 1980, y: 1400, z: 0, kind: "finale" },
        ],
      },
    ],
    areas: [
      {
        id: "spawn",
        label: "safe spawn",
        kind: "spawn",
        x: 200,
        y: 300,
        width: 256,
        depth: 256,
        rotation: 0,
        note: "player start",
      },
      {
        id: "cover_street",
        label: "street cover",
        kind: "cover",
        x: 700,
        y: 1100,
        width: 160,
        depth: 96,
        rotation: 0,
        note: "waist-high",
      },
      {
        id: "hold_warehouse",
        label: "warehouse holdout",
        kind: "holdout",
        x: 1800,
        y: 1400,
        width: 256,
        depth: 256,
        rotation: 0,
        note: "finale hold",
      },
      {
        id: "finale_area",
        label: "rescue",
        kind: "finale",
        x: 1980,
        y: 1400,
        width: 256,
        depth: 256,
        rotation: 0,
        note: "escape trigger",
      },
    ],
    beats: [
      {
        id: "b1",
        chapter: 1,
        type: "quiet",
        space: "beach house",
        what: "the sea is visible from the porch",
        proof: "screenshot",
      },
    ],
    finale: { type: 2, arena: "warehouse", stages: ["PANIC", "DELAY"], escape: "helicopter" },
    budget: { "weapon_item_spawn": 8 },
    palette: {
      sky: "sky_l4d_c1_1_hdr",
      motifs: ["wood", "stucco", "metal"],
      materials: ["WOOD/BOARDWALKS01"],
      models: ["cara_95sedan"],
    },
    variability: ["car colour"],
    acceptance: ["gate pass", "nav pass"],
  };
}

describe("map plan drawings", () => {
  it("renders the five drawings for a valid plan", () => {
    const parsed = MapPlanSchema.parse(plan());
    const source = join(root, "plan.json");
    writeFileSync(source, JSON.stringify(parsed), "utf8");
    const check = checkMapPlan(source, parsed);
    expect(check.ok, check.findings.map((f) => f.message).join(" | ")).toBe(true);
    const rendered = renderMapPlan(source, parsed, join(root, "drawings"));
    const names = rendered.files.map((file) => file.split(/[\\/]/).pop());
    expect(names).toEqual(
      expect.arrayContaining([
        "01-site-plan.svg",
        "02-vertical-plan.svg",
        "03-circulation-plan.svg",
        "04-building-schedule.svg",
        "05-floor-house_a.svg",
        "06-section-house_a.svg",
        "05-floor-warehouse.svg",
        "plan.md",
      ]),
    );
    const site = readFileSync(join(root, "drawings", "01-site-plan.svg"), "utf8");
    expect(site).toContain("house_a");
    expect(site).toContain("<svg");
    const circulation = readFileSync(join(root, "drawings", "03-circulation-plan.svg"), "utf8");
    expect(circulation).toContain("holdout");
    expect(circulation).toContain("cover");
    const markdown = readFileSync(join(root, "drawings", "plan.md"), "utf8");
    expect(markdown).toContain("Validation: **pass**");
    expect(markdown).toContain("Gameplay and nav areas");
  });

  it("fails a route that crosses a building, a narrow route and duplicate ids", () => {
    const bad = plan();
    const routes = bad.routes as Array<Record<string, unknown>>;
    routes[0]!.width = 32;
    routes[0]!.points = [
      [200, 300, 0],
      [800, 800, 0],
      [1980, 1400, 0],
    ];
    const buildings = bad.buildings as Array<Record<string, unknown>>;
    buildings[2]!.id = "house_a";
    const parsed = MapPlanSchema.parse(bad);
    const check = checkMapPlan("bad.json", parsed);
    expect(check.ok).toBe(false);
    const rules = check.findings.map((finding) => finding.rule);
    expect(rules).toContain("route-too-narrow");
    expect(rules).toContain("route-through-building");
    expect(rules).toContain("duplicate-id");
  });
});
