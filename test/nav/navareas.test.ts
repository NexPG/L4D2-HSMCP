/**
 * Nav areas: reading them, and changing a bit without touching the other ten megabytes.
 *
 * The fixture is built byte by byte in this file rather than checked in: a `.nav` from a
 * Valve map is not ours to redistribute, and a fixture built from the same layout the reader
 * implements is the only way to assert the layout on a machine without the game. The last
 * test runs against the real `c1m1_hotel.nav` when the install is present, because a parser
 * that only agrees with its own fixture proves nothing.
 *
 * The assertion that matters most is the one about masks: an area carrying a bit this
 * project has no name for must keep it after an edit. Writing a replacement value built
 * from names would clear it, and the mesh would quietly change behaviour.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  decodeFlags,
  NAV_FLAGS,
  NavFormatError,
  patchNavAreas,
  readNavFile,
  SPAWN_FLAGS,
} from "../../src/nav/typescript/formats/navfile.js";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readNavAreasTool, writeNavAreasTool } from "../../src/nav/typescript/tools/navareas.js";
import { ctx as sharedCtx } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-nav-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface FixtureArea {
  id: number;
  flags: number;
  spawn: number;
  place: number;
  min: [number, number, number];
  max: [number, number, number];
  connections?: { north: number[]; east: number[]; south: number[]; west: number[] };
}

/** A version 16 / sub-version 14 L4D2 nav, which is what the game writes. */
function buildNav(areas: FixtureArea[], places: string[] = ["spawn", "safe"]): Buffer {
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
  const i32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
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
  u32(1234); // bsp size
  u8(1); // analyzed

  u16(places.length);
  for (const place of places) {
    u16(Buffer.byteLength(place));
    str(place);
  }
  u8(0); // hasUnnamedAreas

  str("c1test");
  u8(0); // population terminator
  u16(0); // fog places

  u32(areas.length);
  for (const area of areas) {
    u32(area.id);
    u32(area.flags);
    f32(area.min[0]);
    f32(area.min[1]);
    f32(area.min[2]);
    f32(area.max[0]);
    f32(area.max[1]);
    f32(area.max[2]);
    f32(area.min[2]); // neZ
    f32(area.min[2]); // swZ
    const connections = area.connections ?? { north: [], east: [], south: [], west: [] };
    for (const direction of ["north", "east", "south", "west"] as const) {
      u32(connections[direction].length);
      for (const id of connections[direction]) u32(id);
    }
    u8(0); // hiding spots
    u32(0); // encounter paths
    u16(area.place);
    u32(0); // ladder connections, up
    u32(0); // ladder connections, down
    f32(0);
    f32(0);
    f32(1);
    f32(1);
    f32(1);
    f32(1);
    // L4D2 per-area block, sub-version 14: spawn attributes, fog place id, visible areas,
    // inherit-visibility.
    u32(area.spawn);
    u16(0);
    u32(1);
    u32(area.id + 1);
    u8(0);
    u32(0);
  }
  return Buffer.concat(parts);
}

const FIXTURE = buildNav([
  {
    id: 100,
    flags: 0x20000000, // MOSTLY_FLAT, an L4D2 bit
    spawn: 0x2, // EMPTY
    place: 0,
    min: [0, 0, 0],
    max: [32, 32, 0],
    connections: { north: [101], east: [], south: [], west: [] },
  },
  {
    id: 101,
    flags: 0x4, // PRECISE
    spawn: 0x2000, // NO_MOBS
    place: 1,
    min: [32, 0, 0],
    max: [64, 32, 0],
  },
]);

describe("nav file", () => {
  it("reads the header, the place table and every area", () => {
    const nav = readNavFile(FIXTURE, "test.nav");
    expect(nav.version).toBe(16);
    expect(nav.subVersion).toBe(14);
    expect(nav.zombiePopulation).toBe("c1test");
    expect(nav.places).toEqual(["spawn", "safe"]);
    expect(nav.areaCount).toBe(2);
    expect(nav.areas.map((a) => a.id)).toEqual([100, 101]);
    expect(decodeFlags(nav.areas[0]!.flags, NAV_FLAGS)).toEqual(["MOSTLY_FLAT"]);
    expect(decodeFlags(nav.areas[1]!.spawnAttributes, SPAWN_FLAGS)).toEqual(["NO_MOBS"]);
    expect(nav.areas[0]!.connections.north).toEqual([101]);
    expect(nav.areas[0]!.placeId).toBe(0);
    expect(nav.areas[1]!.placeId).toBe(1);
  });

  it("patches bits in place and keeps every bit it does not name", () => {
    const nav = readNavFile(FIXTURE);
    const next = patchNavAreas(nav, [{ id: 100, setFlags: 0x20000, setSpawn: 0x800 }]);

    expect(next.length).toBe(FIXTURE.length);
    const patched = readNavFile(next);
    const area = patched.areas[0]!;
    expect(area.flags).toBe(0x20020000);
    expect(area.flags & 0x20000000, "the unknown-to-the-table bit is still there").not.toBe(0);
    expect(area.spawnAttributes).toBe(0x802);

    let changed = 0;
    for (let i = 0; i < next.length; i += 1) if (next[i] !== FIXTURE[i]) changed += 1;
    expect(changed, "only the two patched fields differ").toBeLessThanOrEqual(4);
  });

  it("clears a named bit without touching the rest", () => {
    const nav = readNavFile(FIXTURE);
    const next = patchNavAreas(nav, [{ id: 101, clearFlags: 0x4, clearSpawn: 0x2000 }]);
    const area = readNavFile(next).areas[1]!;
    expect(area.flags).toBe(0);
    expect(area.spawnAttributes).toBe(0);
  });

  it("changes the place id", () => {
    const nav = readNavFile(FIXTURE);
    const next = patchNavAreas(nav, [{ id: 100, placeId: 1 }]);
    expect(readNavFile(next).areas[0]!.placeId).toBe(1);
  });

  it("refuses a file that is not a nav, and a record that runs past the end", () => {
    expect(() => readNavFile(Buffer.alloc(64), "x.nav")).toThrow(NavFormatError);
    expect(() => readNavFile(FIXTURE.subarray(0, 40), "short.nav")).toThrow(NavFormatError);
    expect(() => readNavFile(FIXTURE, "x.nav")).not.toThrow();
  });
});

describe("nav area tools", () => {
  const path = join(scratch, "areas.nav");
  writeFileSync(path, FIXTURE);

  it("lists areas and filters by an attribute name", async () => {
    const r = (await readNavAreasTool.handler({ path, limit: 10, sortBy: "id" }, ctx)) as {
      areaCount: number;
      places: string[];
      areas: Array<{ id: number; attributes: string[]; spawnAttributes: string[]; place: string | null }>;
    };
    expect(r.areaCount).toBe(2);
    expect(r.places).toEqual(["spawn", "safe"]);
    expect(r.areas.map((a) => a.id)).toEqual([100, 101]);
    expect(r.areas[0]).toMatchObject({ place: "spawn", attributes: ["MOSTLY_FLAT"] });

    const filtered = (await readNavAreasTool.handler(
      { path, attribute: "NO_MOBS", limit: 10, sortBy: "id" },
      ctx,
    )) as { areas: Array<{ id: number }>; returned: number };
    expect(filtered.returned).toBe(1);
    expect(filtered.areas[0]!.id).toBe(101);
  });

  it("writes an edit, leaves a backup, and reads it back to prove it landed", async () => {
    const target = join(scratch, "edit.nav");
    copyFileSync(path, target);

    const r = (await writeNavAreasTool.handler(
      {
        path: target,
        updates: [{ id: 100, addFlags: ["MOB_ONLY"], addSpawnFlags: ["COMPASS_NORTH"], place: "safe" }],
        backup: true,
        confirm: true,
      },
      ctx,
    )) as {
      backup: string | null;
      changed: Array<{ id: number; before: { flagsHex: string }; after: { flagsHex: string; place: string | null } }>;
      verified: boolean;
    };

    expect(r.verified).toBe(true);
    expect(r.backup).not.toBeNull();
    expect(existsSync(r.backup as string)).toBe(true);
    expect(statSync(r.backup as string).size).toBe(FIXTURE.length);
    expect(r.changed[0]!.before.flagsHex).not.toBe(r.changed[0]!.after.flagsHex);
    expect(r.changed[0]!.after.place).toBe("safe");

    const after = readNavFile(readFileSync(target));
    const area = after.areas[0]!;
    expect(area.flags & 0x20000).toBe(0x20000);
    expect(area.flags & 0x20000000, "the unnamed bit survived the edit").toBe(0x20000000);
    expect(area.spawnAttributes & 0x01000000).toBe(0x01000000);
    expect(area.placeId).toBe(1);
  });

  it("refuses a place the file does not have, and an area it does not have", async () => {
    const target = join(scratch, "refuse.nav");
    copyFileSync(path, target);

    expect(() =>
      writeNavAreasTool.handler(
        { path: target, updates: [{ id: 100, place: "nowhere" }], backup: false, confirm: true },
        ctx,
      ),
    ).toThrow(/is not in .*place table/);

    expect(() =>
      writeNavAreasTool.handler(
        { path: target, updates: [{ id: 999999, addFlags: ["MOB_ONLY"] }], backup: false, confirm: true },
        ctx,
      ),
    ).toThrow(/area 999999 is not in/);

    expect(() =>
      writeNavAreasTool.handler(
        { path: target, updates: [{ id: 100, addFlags: ["NOT_A_FLAG"] }], backup: false, confirm: true },
        ctx,
      ),
    ).toThrow(/unknown flag/);
  });
});

const REAL_NAV =
  "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\maps\\c1m1_hotel.nav";

describe("a real L4D2 nav", () => {
  it.skipIf(!existsSync(REAL_NAV))("reads c1m1_hotel and patches a copy", () => {
    const nav = readNavFile(readFileSync(REAL_NAV), REAL_NAV);
    expect(nav.version).toBe(16);
    expect(nav.subVersion).toBe(14);
    expect(nav.areaCount).toBeGreaterThan(500);
    expect(nav.areas.length).toBe(nav.areaCount);
    // The population type is the map's chapter directory, not a guess from the file name.
    expect(nav.zombiePopulation).toBe("c1streets");

    const target = nav.areas[0]!;
    const next = patchNavAreas(nav, [{ id: target.id, setFlags: 0x20000 }]);
    expect(next.length).toBe(nav.bytes.length);
    const after = readNavFile(next).areas[0]!;
    expect(after.flags & 0x20000).toBe(0x20000);
    expect(after.flags & target.flags, "nothing else changed").toBe(target.flags);
  }, 60_000);
});
