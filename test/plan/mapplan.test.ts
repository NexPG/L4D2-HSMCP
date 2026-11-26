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
    experience: "cross the beach, climb the house and hold the warehouse",
    pillars: ["the sea stays on the left", "every fight has a way around", "climb before you drop"],
    districts: [
      { id: "beach", name: "Beach", mood: "exposed", motif: "sand and bleached wood", landmark: "lifeguard tower" },
      { id: "town", name: "Town", mood: "tight", motif: "stucco and canvas", landmark: "clock tower" },
      { id: "pier", name: "Pier", mood: "industrial", motif: "tarred timber", landmark: "crane" },
    ],
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
        role: "route",
        entrances: [{ x: 1056, y: 800, z: 0, width: 64, face: "east" }],
        floorsPlan: [
          {
            level: 1,
            z: 0,
            height: 128,
            rooms: [{ id: "living", name: "Living", x: 56, y: 0, width: 400, depth: 200 }],
            doors: [
              {
                id: "front",
                x: 256,
                y: 0,
                width: 56,
                depth: 16,
                rotation: 90,
                from: "outside",
                to: "living",
                kind: "door",
              },
            ],
            stairs: [{ id: "up", kind: "stair", x: 0, y: 0, width: 48, depth: 96, to: 2 }],
          },
          {
            level: 2,
            z: 128,
            height: 128,
            rooms: [{ id: "bed", name: "Bedroom", x: 0, y: 0, width: 220, depth: 160 }],
            doors: [],
            stairs: [{ id: "down", kind: "stair", x: 0, y: 0, width: 48, depth: 96, to: 1 }],
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
        role: "route",
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
        role: "context",
        entrances: [],
        floorsPlan: [],
      },
      {
        id: "block_a",
        name: "Context block A",
        x: 300,
        y: 2200,
        width: 300,
        depth: 300,
        rotation: 0,
        floors: 1,
        floorHeight: 128,
        baseZ: 0,
        enterable: false,
        role: "context",
        entrances: [],
        floorsPlan: [],
      },
      {
        id: "block_b",
        name: "Context block B",
        x: 3300,
        y: 700,
        width: 400,
        depth: 400,
        rotation: 0,
        floors: 2,
        floorHeight: 128,
        baseZ: 0,
        enterable: false,
        role: "facade",
        entrances: [],
        floorsPlan: [],
      },
    ],
    routes: [
      {
        id: "critical",
        kind: "critical",
        typology: "string-of-pearls",
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
        nodes: [
          { id: "n_start", label: "start", x: 200, y: 300, z: 0, floor: 1, space: "beach", district: "beach", kind: "start", enclosure: "open", intensity: 1, landmark: "lifeguard tower", gate: "none", beat: "b1" },
          { id: "n_street", label: "street", x: 700, y: 1100, z: 0, floor: 1, space: "street", district: "beach", kind: "street", enclosure: "open", intensity: 3, landmark: "", gate: "none", beat: "b1" },
          { id: "n_door", label: "house door", x: 1056, y: 800, z: 0, floor: 1, buildingId: "house_a", space: "house", district: "town", kind: "door", enclosure: "covered", intensity: 3, landmark: "", gate: "hard", beat: "b2" },
          { id: "n_stair_up", label: "stair up", x: 800, y: 800, z: 0, floor: 1, buildingId: "house_a", space: "house", district: "town", kind: "stair", enclosure: "tight", intensity: 4, landmark: "", gate: "none", beat: "b2" },
          { id: "n_room2", label: "upstairs", x: 800, y: 800, z: 128, floor: 2, buildingId: "house_a", space: "upstairs", district: "town", kind: "room", enclosure: "vista", intensity: 2, landmark: "clock tower", gate: "none", beat: "b3" },
          { id: "n_drop", label: "drop back", x: 800, y: 800, z: 128, floor: 2, buildingId: "house_a", space: "upstairs", district: "town", kind: "drop", enclosure: "vista", intensity: 2, landmark: "clock tower", gate: "one-way", beat: "b3" },
          { id: "n_warehouse", label: "warehouse", x: 1980, y: 1400, z: 0, floor: 1, buildingId: "warehouse", space: "warehouse", district: "pier", kind: "finale", enclosure: "covered", intensity: 3, landmark: "crane", gate: "none", beat: "b3" },
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
        space: "beach",
        what: "the sea and the house",
        proof: "screenshot",
        intensity: 1,
      },
      {
        id: "b2",
        chapter: 1,
        type: "fight",
        space: "house",
        what: "the stair fight",
        proof: "spawn count",
        intensity: 3,
      },
      {
        id: "b3",
        chapter: 1,
        type: "crescendo",
        space: "upstairs",
        what: "the drop and the holdout",
        proof: "STAGE_DONE",
        intensity: 5,
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
        "05-floor-house_a-f1.svg",
        "05-floor-house_a-f2.svg",
        "06-section-house_a.svg",
        "05-floor-warehouse-f1.svg",
        "plan.md",
        "build-sheet.md",
      ]),
    );
    const site = readFileSync(join(root, "drawings", "01-site-plan.svg"), "utf8");
    expect(site).toContain("house_a");
    expect(site).toContain("<svg");
    const circulation = readFileSync(join(root, "drawings", "03-circulation-plan.svg"), "utf8");
    expect(circulation).toContain("holdout");
    expect(circulation).toContain("F2");
    expect(circulation).toContain("cover");
    const floorPlanSvg = readFileSync(join(root, "drawings", "05-floor-house_a-f1.svg"), "utf8");
    expect(floorPlanSvg).toContain("outside");
    expect(floorPlanSvg).toContain("stair");
    const markdown = readFileSync(join(root, "drawings", "plan.md"), "utf8");
    expect(markdown).toContain("Validation: **pass**");
    expect(markdown).toContain("Gameplay and nav areas");
    expect(markdown).toContain("Floor connections");
    const sheet = readFileSync(join(root, "drawings", "build-sheet.md"), "utf8");
    expect(sheet).toContain("Critical route");
    expect(sheet).toContain("front");
    expect(sheet).toContain("outside");
    expect(sheet).not.toContain("| MISSING |");
  });

  it("applies the route contract at approved, not only at skeleton", () => {
    const approved = MapPlanSchema.parse(plan());
    const check = checkMapPlan("approved.json", approved);
    expect(check.ok, check.findings.map((finding) => finding.message).join(" | ")).toBe(true);

    const skipped = plan();
    skipped.districts = [];
    const skippedCheck = checkMapPlan("approved-no-districts.json", MapPlanSchema.parse(skipped));
    expect(skippedCheck.ok).toBe(false);
    const rules = skippedCheck.findings.map((finding) => finding.rule);
    expect(rules).toContain("district-few");
    expect(rules).toContain("district-unknown");
  });

  it("passes the same plan through every stage from brief to approved", () => {
    for (const stage of ["brief", "skeleton", "site", "vertical", "schedule", "floors", "flow", "approved"]) {
      const candidate = plan();
      candidate.stage = stage;
      const check = checkMapPlan(`${stage}.json`, MapPlanSchema.parse(candidate));
      expect(check.ok, `${stage}: ${check.findings.map((finding) => finding.message).join(" | ")}`).toBe(true);
    }
  });

  it("allows a route to cross a building it actually visits", () => {
    const interior = plan();
    const route = (interior.routes as Array<Record<string, unknown>>)[0]!;
    route.points = [...(route.points as number[][]), [2200, 1400, 0]];
    (route.nodes as Array<Record<string, unknown>>).push({
      id: "n_inside",
      label: "warehouse interior",
      x: 2200,
      y: 1400,
      z: 0,
      floor: 1,
      buildingId: "warehouse",
      space: "warehouse",
      district: "pier",
      kind: "room",
      enclosure: "covered",
      intensity: 2,
      landmark: "crane",
      gate: "none",
      beat: "b3",
    });
    const check = checkMapPlan("interior.json", MapPlanSchema.parse(interior));
    expect(check.findings.map((finding) => finding.rule)).not.toContain("route-through-building");
  });

  it("checks route doors and stairs against the floor graph", () => {
    const floors = plan();
    floors.stage = "floors";
    const valid = MapPlanSchema.parse(floors);
    const check = checkMapPlan("floors-ok.json", valid);
    expect(check.ok, check.findings.map((finding) => finding.message).join(" | ")).toBe(true);

    const noDoor = plan();
    noDoor.stage = "floors";
    const noDoorHouse = (noDoor.buildings as Array<Record<string, unknown>>)[0]!;
    (noDoorHouse.floorsPlan as Array<Record<string, unknown>>)[0]!.doors = [];
    const noDoorRules = checkMapPlan("no-door.json", MapPlanSchema.parse(noDoor)).findings.map(
      (finding) => finding.rule,
    );
    expect(noDoorRules).toContain("node-no-door");

    const noStair = plan();
    noStair.stage = "floors";
    const noStairHouse = (noStair.buildings as Array<Record<string, unknown>>)[0]!;
    (noStairHouse.floorsPlan as Array<Record<string, unknown>>)[0]!.stairs = [];
    const noStairRules = checkMapPlan("no-stair.json", MapPlanSchema.parse(noStair)).findings.map(
      (finding) => finding.rule,
    );
    expect(noStairRules).toContain("node-no-stair");

    const badDoor = plan();
    badDoor.stage = "floors";
    const badDoorHouse = (badDoor.buildings as Array<Record<string, unknown>>)[0]!;
    const firstFloor = (badDoorHouse.floorsPlan as Array<Record<string, unknown>>)[0]!;
    const door = (firstFloor.doors as Array<Record<string, unknown>>)[0]!;
    door.from = "missing";
    const badDoorRules = checkMapPlan("bad-door.json", MapPlanSchema.parse(badDoor)).findings.map(
      (finding) => finding.rule,
    );
    expect(badDoorRules).toContain("door-unknown-room");

    const badStair = plan();
    badStair.stage = "floors";
    const badStairHouse = (badStair.buildings as Array<Record<string, unknown>>)[0]!;
    const badStairFloor = (badStairHouse.floorsPlan as Array<Record<string, unknown>>)[0]!;
    const stair = (badStairFloor.stairs as Array<Record<string, unknown>>)[0]!;
    stair.to = 9;
    const badStairRules = checkMapPlan("bad-stair.json", MapPlanSchema.parse(badStair)).findings.map(
      (finding) => finding.rule,
    );
    expect(badStairRules).toContain("stair-target-missing");
  });

  it("accepts a brief with no geometry and gates the floors stage", () => {
    const brief = MapPlanSchema.parse({
      version: 1,
      name: "Brief only",
      kind: "map",
      stage: "brief",
      experience: "the survivors cross the beach before the horde",
      pillars: ["the sea stays on the left", "every fight has a way around", "climb before you drop"],
      beats: [
        { id: "b1", chapter: 1, type: "quiet", space: "house", what: "the sea", proof: "screenshot", intensity: 1 },
        { id: "b2", chapter: 1, type: "fight", space: "street", what: "first commons", proof: "spawn count", intensity: 4 },
        { id: "b3", chapter: 1, type: "quiet", space: "house", what: "restock", proof: "screenshot", intensity: 2 },
      ],
      acceptance: ["gate pass"],
    });
    expect(checkMapPlan("brief.json", brief).ok).toBe(true);

    const noFloors = plan();
    noFloors.stage = "floors";
    (noFloors.buildings as Array<Record<string, unknown>>)[0]!.floorsPlan = [];
    const parsed = MapPlanSchema.parse(noFloors);
    const check = checkMapPlan("floors.json", parsed);
    expect(check.ok).toBe(false);
    expect(check.findings.map((finding) => finding.rule)).toContain("no-floor-plan");
  });

  it("checks a multi-level skeleton for districts, pacing, landmarks and gates", () => {
    const skeleton = MapPlanSchema.parse({
      version: 1,
      name: "Skeleton test",
      kind: "map",
      stage: "skeleton",
      experience: "leave the beach, hold the pier shed, climb to the roof and drop into the market",
      pillars: ["the sea stays on the left", "every fight has a way around", "climb before you drop"],
      acceptance: ["skeleton gate pass"],
      districts: [
        { id: "beach", name: "Beach", mood: "exposed", motif: "sand and bleached wood", landmark: "lifeguard tower" },
        { id: "pier", name: "Pier", mood: "tight", motif: "tarred timber", landmark: "ferris wheel" },
        { id: "market", name: "Market", mood: "crowded", motif: "stucco and canvas", landmark: "clock tower" },
      ],
      beats: [
        { id: "b1", chapter: 1, type: "quiet", space: "beach", what: "the sea", proof: "screenshot", intensity: 1 },
        { id: "b2", chapter: 1, type: "fight", space: "boardwalk", what: "first commons", proof: "spawn count", intensity: 3 },
        { id: "b3", chapter: 1, type: "crescendo", space: "pier shed", what: "hold the door", proof: "STAGE_DONE", intensity: 5 },
        { id: "b4", chapter: 1, type: "quiet", space: "market", what: "restock", proof: "screenshot", intensity: 2 },
      ],
      routes: [
        {
          id: "critical",
          kind: "critical",
          typology: "string-of-pearls",
          width: 96,
          points: [
            [200, 300, 0],
            [700, 300, 0],
            [700, 900, 0],
            [1100, 900, 0],
            [1100, 300, 0],
            [1500, 300, 0],
          ],
          stops: [
            { id: "start", label: "start", x: 200, y: 300, z: 0, kind: "start" },
            { id: "end", label: "market", x: 1500, y: 300, z: 0, kind: "safe-room" },
          ],
          nodes: [
            { id: "n_start", label: "start", x: 200, y: 300, z: 0, floor: 1, space: "beach", district: "beach", kind: "start", enclosure: "open", intensity: 1, landmark: "lifeguard tower", gate: "none", beat: "b1" },
            { id: "n_boardwalk", label: "boardwalk", x: 700, y: 300, z: 0, floor: 1, space: "boardwalk", district: "beach", kind: "street", enclosure: "open", intensity: 3, landmark: "ferris wheel", gate: "none", beat: "b2" },
            { id: "n_door", label: "pier door", x: 700, y: 900, z: 0, floor: 1, space: "pier shed", district: "pier", kind: "door", enclosure: "covered", intensity: 3, landmark: "", gate: "hard", beat: "b3" },
            { id: "n_hold", label: "shed hold", x: 700, y: 900, z: 0, floor: 1, space: "pier shed", district: "pier", kind: "room", enclosure: "tight", intensity: 5, landmark: "", gate: "none", beat: "b3" },
            { id: "n_stair", label: "stair up", x: 1100, y: 900, z: 0, floor: 1, space: "pier shed", district: "pier", kind: "stair", enclosure: "tight", intensity: 4, landmark: "", gate: "none", beat: "b3" },
            { id: "n_roof", label: "shed roof", x: 1100, y: 900, z: 128, floor: 2, space: "pier shed", district: "pier", kind: "roof", enclosure: "vista", intensity: 2, landmark: "clock tower", gate: "none", beat: "b4" },
            { id: "n_drop", label: "drop to market", x: 1100, y: 300, z: 128, floor: 2, space: "market roof", district: "market", kind: "drop", enclosure: "vista", intensity: 2, landmark: "clock tower", gate: "one-way", beat: "b4" },
            { id: "n_market", label: "market", x: 1500, y: 300, z: 0, floor: 1, space: "market", district: "market", kind: "room", enclosure: "covered", intensity: 2, landmark: "", gate: "none", beat: "b4" },
          ],
        },
        {
          id: "side",
          kind: "branch",
          typology: "switchback",
          width: 64,
          points: [
            [700, 900, 0],
            [600, 900, 0],
          ],
          from: "n_door",
          nodes: [
            { id: "n_side", label: "side room", x: 600, y: 900, z: 0, floor: 1, space: "side room", district: "pier", kind: "room", enclosure: "tight", intensity: 2, landmark: "", gate: "none" },
          ],
        },
      ],
    });
    const check = checkMapPlan("skeleton.json", skeleton);
    expect(check.ok, check.findings.map((finding) => finding.message).join(" | ")).toBe(true);
    expect(check.findings.map((finding) => finding.rule)).not.toContain("route-flat-intensity");

    renderMapPlan("skeleton.json", skeleton, join(root, "skeleton-drawings"));
    const circulation = readFileSync(join(root, "skeleton-drawings", "03-circulation-plan.svg"), "utf8");
    expect(circulation).toContain("Pier");
    expect(circulation).toContain("Director rhythm");
    const markdown = readFileSync(join(root, "skeleton-drawings", "plan.md"), "utf8");
    expect(markdown).toContain("Route rhythm");
    expect(markdown).toContain("string-of-pearls");

    const flat = MapPlanSchema.parse({
      ...skeleton,
      routes: skeleton.routes.map((route) => ({
        ...route,
        nodes: route.nodes.map((node) => ({ ...node, intensity: 2 })),
      })),
    });
    const flatCheck = checkMapPlan("flat.json", flat);
    const flatRules = flatCheck.findings.map((finding) => finding.rule);
    expect(flatRules).toContain("route-flat-intensity");
    expect(flatRules).toContain("route-no-peak");

    const noDistricts = MapPlanSchema.parse({
      ...skeleton,
      districts: [],
      routes: skeleton.routes.map((route) => ({
        ...route,
        nodes: route.nodes.map((node) => ({ ...node, district: undefined })),
      })),
    });
    const districtCheck = checkMapPlan("no-districts.json", noDistricts);
    expect(districtCheck.ok).toBe(false);
    expect(districtCheck.findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["district-few", "node-no-district"]),
    );

    const badBranch = MapPlanSchema.parse({
      ...skeleton,
      routes: skeleton.routes.map((route) =>
        route.kind === "branch" ? { ...route, from: "n_missing" } : route,
      ),
    });
    const branchCheck = checkMapPlan("bad-branch.json", badBranch);
    expect(branchCheck.findings.map((finding) => finding.rule)).toContain("branch-unknown-anchor");
  });

  it("fails a route that crosses a building, a narrow route and duplicate ids", () => {
    const bad = plan();
    const routes = bad.routes as Array<Record<string, unknown>>;
    routes[0]!.width = 32;
    routes[0]!.points = [
      [200, 300, 0],
      [800, 2300, 0],
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

  it("reports one crossing per building, not one per sample point", () => {
    const bad = plan();
    const routes = bad.routes as Array<Record<string, unknown>>;
    routes[0]!.points = [
      [200, 200, 0],
      [3800, 2600, 0],
    ];
    const parsed = MapPlanSchema.parse(bad);
    const check = checkMapPlan("cross.json", parsed);
    const crossings = check.findings.filter((finding) => finding.rule === "route-through-building");
    const buildings = new Set(
      crossings.map((finding) => finding.message.split(" crosses ")[1]?.split(" at ")[0]),
    );
    expect(crossings.length).toBe(buildings.size);
  });

  it("maps a beat to a route through its space, without an explicit node.beat", () => {
    const ok = plan();
    const routes = ok.routes as Array<Record<string, unknown>>;
    const nodes = routes[0]!.nodes as Array<Record<string, unknown>>;
    for (const node of nodes) delete node.beat;
    const parsed = MapPlanSchema.parse(ok);
    const check = checkMapPlan("spaces.json", parsed);
    const orphans = check.findings.filter((finding) => finding.rule === "beat-not-on-route");
    expect(orphans).toHaveLength(0);
  });

  it("names the local position of a stair with no landing on the target floor", () => {
    const bad = plan();
    const buildings = bad.buildings as Array<Record<string, unknown>>;
    const house = buildings[0]!;
    const floors = house.floorsPlan as Array<Record<string, unknown>>;
    const second = floors[1]!;
    second.stairs = [];
    const parsed = MapPlanSchema.parse(bad);
    const check = checkMapPlan("stairs.json", parsed);
    const stair = check.findings.find((finding) => finding.rule === "stair-no-return");
    expect(stair?.message).toContain("local (");
    expect(stair?.message).toContain("F2");
  });

  it("accepts a real chapter plan: No Mercy c1m1 alley, street, hotel, safe room", () => {
    const source = join(__dirname, "fixtures", "nomercy-c1m1.json");
    const parsed = MapPlanSchema.parse(JSON.parse(readFileSync(source, "utf8")));
    const check = checkMapPlan(source, parsed);
    expect(check.findings.map((finding) => `${finding.rule}: ${finding.message}`)).toEqual([]);
  });

  it("accepts a 2D route point and fills its height", () => {
    const flat = plan();
    const routes = flat.routes as Array<Record<string, unknown>>;
    routes[0]!.points = [
      [200, 200],
      [900, 800],
    ];
    const parsed = MapPlanSchema.parse(flat);
    expect(parsed.routes[0]!.points[0]).toEqual([200, 200, 0]);
    expect(() => checkMapPlan("flat.json", parsed)).not.toThrow();
  });

  it("rejects a building whose floor count and floor plan disagree", () => {
    const bad = plan();
    const buildings = bad.buildings as Array<Record<string, unknown>>;
    buildings[0]!.floors = 3;
    const parsed = MapPlanSchema.parse(bad);
    const check = checkMapPlan("floors.json", parsed);
    expect(check.ok).toBe(false);
    expect(check.findings.map((finding) => finding.rule)).toContain("floor-count-mismatch");
  });

  it("allows a basement floor below level 1", () => {
    const base = plan();
    const buildings = base.buildings as Array<Record<string, unknown>>;
    const floors = buildings[0]!.floorsPlan as Array<Record<string, unknown>>;
    floors.unshift({
      level: 0,
      z: -160,
      height: 128,
      rooms: [{ id: "cellar", name: "Cellar", x: 0, y: 0, width: 400, depth: 300 }],
      doors: [],
      stairs: [{ id: "cellar-up", kind: "stair", x: 0, y: 0, width: 64, depth: 120, to: 1 }],
    });
    buildings[0]!.floors = 3;
    buildings[0]!.baseZ = -160;
    buildings[0]!.excavated = true;
    const parsed = MapPlanSchema.parse(base);
    const check = checkMapPlan("cellar.json", parsed);
    const basement = check.findings.filter((finding) => finding.message.includes("F0"));
    expect(basement.every((finding) => finding.rule !== "floor-count-mismatch")).toBe(true);
    expect(check.findings.some((finding) => finding.rule === "duplicate-floor")).toBe(false);
  });

  it("names the node's local position and the rooms when it misses them", () => {
    const bad = plan();
    const routes = bad.routes as Array<Record<string, unknown>>;
    const nodes = routes[0]!.nodes as Array<Record<string, unknown>>;
    const inside = nodes.find((node) => node.buildingId === "house_a" && node.kind === "room");
    if (inside) {
      inside.x = 800 + 1000;
      inside.y = 800 + 1000;
    }
    const parsed = MapPlanSchema.parse(bad);
    const check = checkMapPlan("room.json", parsed);
    const miss = check.findings.find((finding) => finding.rule === "node-not-in-room");
    expect(miss?.message).toContain("local (");
    expect(miss?.message).toContain("rooms:");
  });

  it("accepts an entrance at the building base on elevated terrain", () => {
    const raised = plan();
    const buildings = raised.buildings as Array<Record<string, unknown>>;
    const house = buildings[0]!;
    house.baseZ = 512;
    const entrances = house.entrances as Array<Record<string, unknown>>;
    entrances[0]!.z = 512;
    const parsed = MapPlanSchema.parse(raised);
    const check = checkMapPlan("raised.json", parsed);
    expect(check.findings.map((finding) => finding.rule)).not.toContain("entrance-z");
  });

  it("warns about a drop that changes neither the floor nor the height", () => {
    const flat = plan();
    const routes = flat.routes as Array<Record<string, unknown>>;
    const nodes = routes[0]!.nodes as Array<Record<string, unknown>>;
    for (const node of nodes) {
      node.z = 0;
      node.floor = 1;
      delete node.buildingId;
    }
    nodes.splice(1, 0, { id: "fake-drop", label: "Drop", x: 220, y: 400, z: 0, floor: 1,
      kind: "drop", enclosure: "tight", intensity: 2, landmark: "", gate: "none" });
    routes[0]!.points = [[200, 300, 0], [300, 1100, 0], [900, 1100, 0], [1200, 800, 0]];
    const parsed = MapPlanSchema.parse(flat);
    const check = checkMapPlan("drop.json", parsed);
    expect(check.findings.map((finding) => finding.rule)).toContain("vertical-no-change");
  });

  it("accepts the real No Mercy c8m1 route from the game's nav", () => {
    const source = join(__dirname, "fixtures", "nomercy-c8m1.json");
    const parsed = MapPlanSchema.parse(JSON.parse(readFileSync(source, "utf8")));
    const check = checkMapPlan(source, parsed);
    expect(check.findings.map((finding) => `${finding.rule}: ${finding.message}`)).toEqual([]);
  });

  it("accepts a real campaign plan built from the game's nav: Dead Center c1m1", () => {
    const source = join(__dirname, "fixtures", "dead-center-c1m1.json");
    const parsed = MapPlanSchema.parse(JSON.parse(readFileSync(source, "utf8")));
    const check = checkMapPlan(source, parsed);
    expect(check.findings.map((finding) => `${finding.rule}: ${finding.message}`)).toEqual([]);
  });
});
