/**
 * Nav places, hiding spots and visibility.
 *
 * The fixture is version 16 / sub-version 14 and deliberately includes the details real files
 * have that a naive reader loses: place names written with their trailing NUL, place ids
 * starting at 1, hiding-spot flag bits, visibility entries stored as area *indexes* (not hash
 * ids), NOT_VISIBLE entries and an inherited visibility list.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readNavFile } from "../../src/nav/typescript/formats/navfile.js";
import {
  readNavEncountersTool,
  readNavHidingSpotsTool,
  readNavPlacesTool,
  readNavVisibilityTool,
} from "../../src/nav/typescript/tools/navdetails.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-navdetails-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface FixtureSpot {
  id: number;
  position: [number, number, number];
  flags: number;
}

interface FixtureEncounter {
  from: number;
  fromDir: number;
  to: number;
  toDir: number;
  spots: Array<{ order: number; distance: number }>;
}

interface FixtureArea {
  id: number;
  place: number;
  spawn: number;
  min: [number, number, number];
  max: [number, number, number];
  hidingSpots?: FixtureSpot[];
  encounters?: FixtureEncounter[];
  /** Visibility entries as `[areaIndex, attributes]`. */
  visible?: Array<[number, number]>;
  inheritFrom?: number;
}

function buildNav(areas: FixtureArea[], places: string[]): Buffer {
  const parts: Buffer[] = [];
  const u8 = (v: number) => parts.push(Buffer.from([v & 0xff]));
  const u16 = (v: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    parts.push(b);
  };
  const u32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    parts.push(b);
  };
  const f32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v);
    parts.push(b);
  };
  const str = (v: string) => parts.push(Buffer.from(v, "latin1"));

  u32(0xfeedface);
  u32(16);
  u32(14);
  u32(1234);
  u8(1); // analyzed

  // The game writes strlen(name) + 1, NUL included.
  u16(places.length);
  for (const place of places) {
    u16(Buffer.byteLength(place) + 1);
    str(place);
    u8(0);
  }
  u8(0); // hasUnnamedAreas
  str("c1test");
  u8(0); // population terminator
  u16(0); // fog places

  u32(areas.length);
  for (const [index, area] of areas.entries()) {
    u32(area.id);
    u32(0); // flags
    for (const value of [...area.min, ...area.max, area.min[2], area.min[2]]) f32(value);
    for (const direction of ["north", "east", "south", "west"] as const) {
      const connections = direction === "north" && index === 0 ? [101] : [];
      u32(connections.length);
      for (const id of connections) u32(id);
    }
    u8(area.hidingSpots?.length ?? 0);
    for (const spot of area.hidingSpots ?? []) {
      u32(spot.id);
      for (const value of spot.position) f32(value);
      u8(spot.flags);
    }
    const encounters = area.encounters ?? [];
    u32(encounters.length);
    for (const encounter of encounters) {
      u32(encounter.from);
      u8(encounter.fromDir);
      u32(encounter.to);
      u8(encounter.toDir);
      u8(encounter.spots.length);
      for (const spot of encounter.spots) {
        u32(spot.order);
        u8(spot.distance);
      }
    }
    u16(area.place);
    u32(0); // ladder up
    u32(0); // ladder down
    f32(0);
    f32(0);
    f32(1);
    f32(1);
    f32(1);
    f32(1);
    // L4D2 per-area block, sub-version 14.
    u32(area.spawn);
    u16(0); // fog place id
    u32(area.visible?.length ?? 0);
    for (const [target, attributes] of area.visible ?? []) {
      u32(target);
      u8(attributes);
    }
    u32(area.inheritFrom ?? 0);
  }
  u32(0); // ladder table
  return Buffer.concat(parts);
}

const FIXTURE = buildNav(
  [
    {
      id: 100,
      place: 1,
      spawn: 0x00000002, // EMPTY
      min: [0, 0, 0],
      max: [32, 32, 0],
      hidingSpots: [
        { id: 0, position: [8, 8, 0], flags: 0x01 }, // IN_COVER
        { id: 1, position: [24, 24, 0], flags: 0x08 }, // EXPOSED
      ],
      encounters: [
        {
          from: 100,
          fromDir: 1, // east
          to: 101,
          toDir: 3, // west
          spots: [
            { order: 2, distance: 0 },
            { order: 1, distance: 200 },
          ],
        },
      ],
      visible: [
        [1, 0x01], // POTENTIALLY_VISIBLE
        [2, 0x02], // COMPLETELY_VISIBLE
      ],
    },
    {
      id: 101,
      place: 2,
      spawn: 0x00000800, // CHECKPOINT
      min: [32, 0, 0],
      max: [64, 32, 0],
      hidingSpots: [{ id: 2, position: [48, 16, 4], flags: 0x05 }], // IN_COVER | IDEAL
      encounters: [
        {
          from: 101,
          fromDir: 3, // west
          to: 100,
          toDir: 1, // east
          spots: [{ order: 0, distance: 128 }],
        },
      ],
      visible: [
        [0, 0x00], // NOT_VISIBLE, an explicit deletion for the inherited list
        [2, 0x02],
      ],
      inheritFrom: 100,
    },
    {
      id: 102,
      place: 0,
      spawn: 0,
      min: [64, 0, 0],
      max: [96, 32, 0],
    },
  ],
  ["spawn", "safe"],
);

const path = join(scratch, "details.nav");
writeFileSync(path, FIXTURE);

describe("read_nav_places", () => {
  it("uses 1-based place ids, strips the stored NUL and summarises spawn attributes", async () => {
    const r = (await readNavPlacesTool.handler(
      { path, includeUnplaced: true, sortBy: "id", limit: 10 } as never,
      ctx,
    )) as {
      placeCount: number;
      returned: number;
      entries: Array<{
        id: number;
        name: string | null;
        areaCount: number;
        areaIds: number[];
        spawn: Array<{ name: string; count: number }>;
        center: [number, number, number] | null;
      }>;
    };

    expect(r.placeCount).toBe(2);
    expect(r.returned).toBe(3);
    expect(r.entries.map((entry) => [entry.id, entry.name, entry.areaCount])).toEqual([
      [0, null, 1],
      [1, "spawn", 1],
      [2, "safe", 1],
    ]);
    expect(r.entries[0]!.areaIds).toEqual([102]);
    expect(r.entries[1]!.spawn).toEqual([{ name: "EMPTY", count: 1 }]);
    expect(r.entries[2]!.spawn).toEqual([{ name: "CHECKPOINT", count: 1 }]);
    expect(r.entries[1]!.center).toEqual([16, 16, 0]);

    const placedOnly = (await readNavPlacesTool.handler(
      { path, includeUnplaced: false, sortBy: "areas", limit: 10 } as never,
      ctx,
    )) as { returned: number; entries: Array<{ id: number }> };
    expect(placedOnly.returned).toBe(2);
    expect(placedOnly.entries.map((entry) => entry.id)).toEqual([1, 2]);
  });
});

describe("read_nav_hiding_spots", () => {
  it("lists spots with their decoded flags and resolves area and place", async () => {
    const r = (await readNavHidingSpotsTool.handler(
      { path, sortBy: "area", limit: 10 } as never,
      ctx,
    )) as {
      spotCount: number;
      areasWithSpots: number;
      byFlag: Array<{ name: string; count: number }>;
      byPlace: Array<{ placeId: number; place: string | null; count: number }>;
      spots: Array<{
        id: number;
        areaId: number;
        areaIndex: number;
        place: string | null;
        position: [number, number, number];
        flags: number;
        attributes: string[];
        unknownBits: string | null;
      }>;
      warnings: string[];
    };

    expect(r.spotCount).toBe(3);
    expect(r.areasWithSpots).toBe(2);
    expect(r.byFlag).toEqual([
      { name: "IN_COVER", count: 2 },
      { name: "IDEAL_SNIPER_SPOT", count: 1 },
      { name: "EXPOSED", count: 1 },
    ]);
    expect(r.byPlace).toEqual([
      { placeId: 1, place: "spawn", count: 2 },
      { placeId: 2, place: "safe", count: 1 },
    ]);
    expect(r.spots.map((spot) => [spot.id, spot.areaId, spot.areaIndex, spot.place])).toEqual([
      [0, 100, 0, "spawn"],
      [1, 100, 0, "spawn"],
      [2, 101, 1, "safe"],
    ]);
    expect(r.spots[1]!.attributes).toEqual(["EXPOSED"]);
    expect(r.spots[2]!.attributes).toEqual(["IN_COVER", "IDEAL_SNIPER_SPOT"]);
    expect(r.spots[0]!.unknownBits).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it("filters by flag, place and area", async () => {
    const byFlag = (await readNavHidingSpotsTool.handler(
      { path, flag: "EXPOSED", limit: 10 } as never,
      ctx,
    )) as { returned: number; spots: Array<{ id: number }> };
    expect(byFlag.returned).toBe(1);
    expect(byFlag.spots[0]!.id).toBe(1);

    const byPlace = (await readNavHidingSpotsTool.handler(
      { path, place: "safe", limit: 10 } as never,
      ctx,
    )) as { returned: number; spots: Array<{ id: number }> };
    expect(byPlace.returned).toBe(1);
    expect(byPlace.spots[0]!.id).toBe(2);

    const byArea = (await readNavHidingSpotsTool.handler(
      { path, area: 100, limit: 10 } as never,
      ctx,
    )) as { returned: number; spots: Array<{ id: number }> };
    expect(byArea.returned).toBe(2);
    expect(byArea.spots.map((spot) => spot.id)).toEqual([0, 1]);
  });
});

describe("read_nav_visibility", () => {
  it("reads indexes, attributes and the inherited list, and merges it on request", async () => {
    const area = (await readNavVisibilityTool.handler(
      { path, area: 101, effective: true, edgeLimit: 10 } as never,
      ctx,
    )) as {
      summary: {
        areasWithVisibility: number;
        areasInheriting: number;
        edges: number;
        completelyVisible: number;
        potentiallyVisible: number;
        notVisible: number;
        maxVisible: number;
      };
      areas: Array<{
        id: number;
        inheritVisibilityFrom: number | null;
        inheritVisibilityFromIndex: number | null;
        inheritVisibilityFound: boolean;
        visible: Array<{ areaIndex: number; areaId: number; attributes: number; notVisible: boolean }>;
        effective: Array<{ areaId: number; attributes: number; source: string }> | null;
        targetVisible: boolean | null;
        targetSource: string | null;
      }>;
    };

    expect(area.summary).toMatchObject({
      areasWithVisibility: 2,
      areasInheriting: 1,
      edges: 4,
      completelyVisible: 2,
      potentiallyVisible: 1,
      notVisible: 1,
      maxVisible: 2,
    });
    const owner = area.areas[0]!;
    expect(owner.id).toBe(101);
    expect(owner.inheritVisibilityFrom).toBe(100);
    expect(owner.inheritVisibilityFromIndex).toBe(0);
    expect(owner.inheritVisibilityFound).toBe(true);
    expect(owner.visible).toEqual([
      { areaIndex: 0, areaId: 100, attributes: 0, flags: [], notVisible: true },
      { areaIndex: 2, areaId: 102, attributes: 2, flags: ["COMPLETELY_VISIBLE"], notVisible: false },
    ]);
    // Inherited from 100: area 101 is POTENTIALLY_VISIBLE. Own list overrides 102.
    expect(owner.effective).toEqual([
      { areaIndex: 1, areaId: 101, attributes: 1, flags: ["POTENTIALLY_VISIBLE"], notVisible: false, source: "inherited" },
      { areaIndex: 2, areaId: 102, attributes: 2, flags: ["COMPLETELY_VISIBLE"], notVisible: false, source: "own" },
    ]);
  });

  it("answers a pair through the own list and through inheritance", async () => {
    const own = (await readNavVisibilityTool.handler(
      { path, area: 101, target: 102, effective: true } as never,
      ctx,
    )) as { areas: Array<{ targetVisible: boolean | null; targetSource: string | null }> };
    expect(own.areas[0]).toMatchObject({ targetVisible: true, targetSource: "own" });

    const inherited = (await readNavVisibilityTool.handler(
      { path, area: 101, target: 101, effective: true } as never,
      ctx,
    )) as { areas: Array<{ targetVisible: boolean | null; targetSource: string | null }> };
    expect(inherited.areas[0]).toMatchObject({ targetVisible: true, targetSource: "inherited" });

    const explicitlyHidden = (await readNavVisibilityTool.handler(
      { path, area: 101, target: 100, effective: true } as never,
      ctx,
    )) as { areas: Array<{ targetVisible: boolean | null; targetSource: string | null }> };
    expect(explicitlyHidden.areas[0]).toMatchObject({ targetVisible: false, targetSource: "own" });
  });

  it("finds owners that list a target", async () => {
    const r = (await readNavVisibilityTool.handler(
      { path, target: 102, areaLimit: 10, edgeLimit: 10 } as never,
      ctx,
    )) as { returned: number; areas: Array<{ id: number; visible: Array<{ areaId: number }> }> };
    expect(r.returned).toBe(2);
    expect(r.areas.map((area) => area.id).sort()).toEqual([100, 101]);
    expect(r.areas.every((area) => area.visible.every((entry) => entry.areaId === 102))).toBe(true);
  });
});

describe("read_nav_encounters", () => {
  it("resolves paths, directions and spots", async () => {
    const r = (await readNavEncountersTool.handler({ path, limit: 10 } as never, ctx)) as {
      pathCount: number;
      spotCount: number;
      areasWithPaths: number;
      byFromDirection: Array<{ direction: string; count: number }>;
      byToDirection: Array<{ direction: string; count: number }>;
      tMin: number | null;
      tMax: number | null;
      paths: Array<{
        ownerAreaId: number;
        ownerAreaIndex: number;
        fromAreaId: number;
        fromDirection: string;
        fromPlace: string | null;
        toAreaId: number;
        toDirection: string;
        toPlace: string | null;
        spots: Array<{
          order: number;
          distance: number;
          t: number;
          resolved: boolean;
          areaId: number | null;
          areaIndex: number | null;
          position: [number, number, number] | null;
          attributes: string[];
        }>;
      }>;
      warnings: string[];
    };

    expect(r.pathCount).toBe(2);
    expect(r.spotCount).toBe(3);
    expect(r.areasWithPaths).toBe(2);
    expect(r.byFromDirection).toEqual([
      { direction: "north", count: 0 },
      { direction: "east", count: 1 },
      { direction: "south", count: 0 },
      { direction: "west", count: 1 },
    ]);
    expect(r.byToDirection).toEqual([
      { direction: "north", count: 0 },
      { direction: "east", count: 1 },
      { direction: "south", count: 0 },
      { direction: "west", count: 1 },
    ]);
    expect(r.tMin).toBe(0);
    expect(r.tMax).toBeCloseTo(200 / 255, 4);
    expect(r.warnings).toEqual([]);

    const first = r.paths[0]!;
    expect(first).toMatchObject({
      ownerAreaId: 100,
      ownerAreaIndex: 0,
      fromAreaId: 100,
      fromDirection: "east",
      fromPlace: "spawn",
      toAreaId: 101,
      toDirection: "west",
      toPlace: "safe",
    });
    expect(first.spots).toEqual([
      {
        order: 2,
        distance: 0,
        t: 0,
        resolved: true,
        areaId: 101,
        areaIndex: 1,
        place: "safe",
        position: [48, 16, 4],
        flags: 0x05,
        attributes: ["IN_COVER", "IDEAL_SNIPER_SPOT"],
      },
      {
        order: 1,
        distance: 200,
        t: 0.7843,
        resolved: true,
        areaId: 100,
        areaIndex: 0,
        place: "spawn",
        position: [24, 24, 0],
        flags: 0x08,
        attributes: ["EXPOSED"],
      },
    ]);

    const second = r.paths[1]!;
    expect(second.ownerAreaId).toBe(101);
    expect(second.fromDirection).toBe("west");
    expect(second.toDirection).toBe("east");
    expect(second.spots[0]).toMatchObject({
      order: 0,
      t: 0.502,
      areaId: 100,
      position: [8, 8, 0],
      attributes: ["IN_COVER"],
    });
  });

  it("filters by owner, from, to and minimum spot count", async () => {
    const byOwner = (await readNavEncountersTool.handler(
      { path, area: 100, limit: 10 } as never,
      ctx,
    )) as { returned: number; paths: Array<{ ownerAreaId: number }> };
    expect(byOwner.returned).toBe(1);
    expect(byOwner.paths[0]!.ownerAreaId).toBe(100);

    const byFrom = (await readNavEncountersTool.handler(
      { path, from: 101, limit: 10 } as never,
      ctx,
    )) as { returned: number; paths: Array<{ fromAreaId: number }> };
    expect(byFrom.returned).toBe(1);
    expect(byFrom.paths[0]!.fromAreaId).toBe(101);

    const bySpotCount = (await readNavEncountersTool.handler(
      { path, minSpots: 2, limit: 10 } as never,
      ctx,
    )) as { returned: number };
    expect(bySpotCount.returned).toBe(1);
  });
});

describe.skipIf(!has.gameContent)("nav version 15", () => {
  const tutorial = join(ctx.config.gameDir!, "maps", "tutorial01.nav");
  const campaign = join(ctx.config.gameDir!, "maps", "c1m1_hotel.nav");

  it("reads the tutorial custom block and stores visibility as area ids", async () => {
    if (!existsSync(tutorial)) return;
    const nav = readNavFile(readFileSync(tutorial), tutorial);
    expect(nav.version).toBe(15);
    expect(nav.subVersion).toBe(13);
    expect(nav.areaCount).toBe(9);
    expect(nav.zombiePopulation).toBe("default");
    expect(nav.areas.map((area) => area.id)).toEqual([2, 9, 10, 13, 14, 15, 17, 19, 21]);

    const visible = nav.areas.flatMap((area) => area.visibleAreaList);
    expect(visible.length).toBe(53);
    expect(visible.every((entry) => entry.areaId !== null && entry.areaIndex !== null)).toBe(true);
    // Version 15 stores ids; version 16 stores indexes.
    expect(visible.every((entry) => entry.stored === entry.areaId)).toBe(true);

    const r = (await readNavVisibilityTool.handler(
      { path: tutorial, area: nav.areas[0]!.id, effective: true, edgeLimit: 10 } as never,
      ctx,
    )) as {
      summary: { visibilityStorage: string; unresolvedEntries: number };
      areas: Array<{ visible: Array<{ areaIndex: number | null; areaId: number | null }> }>;
    };
    expect(r.summary.visibilityStorage).toBe("id");
    expect(r.summary.unresolvedEntries).toBe(0);
    expect(r.areas[0]!.visible.every((entry) => entry.areaIndex !== null)).toBe(true);
  });

  it("keeps the version 16 index storage distinct", async () => {
    if (!existsSync(campaign)) return;
    const nav = readNavFile(readFileSync(campaign), campaign);
    expect(nav.version).toBe(16);
    const visible = nav.areas.flatMap((area) => area.visibleAreaList);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((entry) => entry.stored === entry.areaIndex)).toBe(true);
    const r = (await readNavVisibilityTool.handler(
      { path: campaign, areaLimit: 1, edgeLimit: 1 } as never,
      ctx,
    )) as { summary: { visibilityStorage: string; unresolvedEntries: number } };
    expect(r.summary.visibilityStorage).toBe("index");
    expect(r.summary.unresolvedEntries).toBe(0);
  });
});
