/**
 * Nav connections are length-variable, so this is the one nav writer that changes the file
 * size. The test builds a version 16/sub-version 14 mesh with two areas, edits the lists,
 * and reads the result back through the same parser: a writer that only agrees with itself
 * would leave the engine reading connections at the wrong offsets.
 */
import { describe, expect, it } from "vitest";
import {
  patchNavConnections,
  readNavFile,
} from "../../src/nav/typescript/formats/navfile.js";

interface Area {
  id: number;
  north?: number[];
  east?: number[];
  south?: number[];
  west?: number[];
  flags?: number;
}

function buildNav(areas: Area[]): Buffer {
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

  u32(0xfeedface);
  u32(16);
  u32(14);
  u32(1234);
  u8(1);
  u16(0); // no places
  u8(0); // no unnamed areas
  parts.push(Buffer.from("c1test\0", "latin1"));
  u16(0); // no fog places
  u32(areas.length);

  for (const area of areas) {
    u32(area.id);
    u32(area.flags ?? 0);
    f32(0);
    f32(0);
    f32(0);
    f32(32);
    f32(32);
    f32(0);
    f32(0);
    f32(0);
    for (const direction of ["north", "east", "south", "west"] as const) {
      const ids = area[direction] ?? [];
      u32(ids.length);
      for (const id of ids) u32(id);
    }
    u8(0); // hiding spots
    u32(0); // encounters
    u16(0); // place
    u32(0); // ladders up
    u32(0); // ladders down
    f32(0);
    f32(0);
    f32(1);
    f32(1);
    f32(1);
    f32(1);
    u32(0); // spawn attributes
    u16(0); // fog place
    u32(1); // visible areas
    u32(area.id + 1);
    u8(0);
    u32(0);
  }
  return Buffer.concat(parts);
}

const NAV = buildNav([
  { id: 100, north: [101], flags: 0x4 },
  { id: 101 },
]);

function lists(buffer: Buffer) {
  const nav = readNavFile(buffer);
  return {
    nav,
    byId: new Map(
      nav.areas.map((area) => [
        area.id,
        {
          north: area.connections.north,
          east: area.connections.east,
          south: area.connections.south,
          west: area.connections.west,
        },
      ]),
    ),
  };
}

describe("patchNavConnections", () => {
  it("adds a link and the opposite direction on the target by default", () => {
    const nav = readNavFile(NAV);
    const next = patchNavConnections(nav, [{ id: 100, add: { east: [101] } }]);
    const { byId, nav: after } = lists(next);

    expect(after.areaCount).toBe(2);
    expect(byId.get(100)!.east).toEqual([101]);
    expect(byId.get(101)!.west).toEqual([100]);
    // The link that was already there is untouched.
    expect(byId.get(100)!.north).toEqual([101]);
    expect(after.areas[0]!.flags).toBe(0x4);
  });

  it("removes both sides only when symmetric", () => {
    const symmetric = lists(
      patchNavConnections(readNavFile(NAV), [{ id: 100, remove: { north: [101] } }]),
    );
    expect(symmetric.byId.get(100)!.north).toEqual([]);
    expect(symmetric.byId.get(101)!.south).toEqual([]);

    const oneWay = lists(
      patchNavConnections(readNavFile(NAV), [
        { id: 100, add: { east: [101] } },
        { id: 100, remove: { east: [101] }, symmetric: false },
      ]),
    );
    expect(oneWay.byId.get(100)!.east).toEqual([]);
    // The mirrored side added by the first edit is still there: `set`/one-way edits are
    // exact, and removing one side does not silently remove the other.
    expect(oneWay.byId.get(101)!.west).toEqual([100]);
  });

  it("replaces a list exactly and does not mirror it", () => {
    const { byId } = lists(
      patchNavConnections(readNavFile(NAV), [{ id: 101, set: { south: [100] } }]),
    );
    expect(byId.get(101)!.south).toEqual([100]);
    expect(byId.get(100)!.north).toEqual([101]); // unchanged
  });

  it("refuses a self-link and a target that is not in the nav", () => {
    expect(() =>
      patchNavConnections(readNavFile(NAV), [{ id: 100, add: { north: [100] } }]),
    ).toThrow(/cannot connect to itself/);
    expect(() =>
      patchNavConnections(readNavFile(NAV), [{ id: 100, add: { north: [999] } }]),
    ).toThrow(/area 999 is not in/);
  });

  it("grows and shrinks the file without moving the other area fields", () => {
    const nav = readNavFile(NAV);
    const bigger = patchNavConnections(nav, [
      { id: 100, add: { north: [101], east: [101], south: [101], west: [101] } },
    ]);
    expect(bigger.length).toBeGreaterThan(NAV.length);
    const after = readNavFile(bigger);
    expect(after.areas[0]!.minX).toBe(0);
    expect(after.areas[0]!.maxX).toBe(32);
    expect(after.areas[1]!.id).toBe(101);
    expect(after.areas[1]!.spawnAttributesOffset).toBeGreaterThan(0);

    const smaller = patchNavConnections(readNavFile(bigger), [
      { id: 100, set: { north: [], east: [], south: [], west: [] } },
    ]);
    expect(smaller.length).toBeLessThan(bigger.length);
    expect(readNavFile(smaller).areaCount).toBe(2);
  });
});
