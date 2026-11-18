/**
 * `.nav` — the navigation mesh, read and patched in place.
 *
 * `read_nav` could report a header and a freshness check; nothing could say which area is
 * which, and nothing could change one. For Left 4 Dead 2 that is the difference between
 * "the bots avoid this room" and "the bots walk into the tank", because the attributes on an
 * area are what the Director reads when it decides where to spawn.
 *
 * **Patching, not rewriting.** The file is a header, a place table, then one variable-length
 * record per area. A serialiser would have to reproduce every field exactly, and a single
 * mistake corrupts a mesh the mapper spent an hour generating. So this module parses the
 * records, keeps the byte offset of each patchable field, and changes those bytes only.
 * Everything else stays byte-identical — the same rule the VMF writers follow.
 *
 * The layout is L4D2's `TerrorNavMesh` (version 16, the game ships sub-version 14), read from
 * Valve's `nav.h` and cross-checked against a real `c1m1_hotel.nav`: magic `0xFEEDFACE`,
 * version 16, sub-version 14, 0 places, `hasUnnamedAreas` set, population string
 * `c1streets`. Fields that only exist below sub-version 12 are still skipped correctly,
 * because a mapper may hand us an older file.
 */

export class NavFormatError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} at offset ${offset}`);
    this.name = "NavFormatError";
  }
}

/** `NAV_MESH_*` — the area attributes. Values are Valve's; the names are what mappers use. */
export const NAV_FLAGS: Record<number, string> = {
  0x00000001: "CROUCH",
  0x00000002: "JUMP",
  0x00000004: "PRECISE",
  0x00000008: "NO_JUMP",
  0x00000010: "STOP",
  0x00000020: "RUN",
  0x00000040: "WALK",
  0x00000080: "AVOID",
  0x00000100: "TRANSIENT",
  0x00000200: "DONT_HIDE",
  0x00000400: "STAND",
  0x00000800: "NO_HOSTAGES",
  0x00001000: "STAIRS",
  0x00002000: "NO_MERGE",
  0x00004000: "OBSTACLE_TOP",
  0x00008000: "CLIFF",
  // L4D2's custom range: `TerrorNavAttributeType`.
  0x00010000: "TANK_ONLY",
  0x00020000: "MOB_ONLY",
  0x00040000: "PLAYERCLIP",
  0x00080000: "BREAKABLEWALL",
  0x08000000: "FLOW_BLOCKED",
  0x10000000: "OUTSIDE_WORLD",
  0x20000000: "MOSTLY_FLAT",
  0x40000000: "HAS_ELEVATOR",
  0x80000000: "NAV_BLOCKER",
};

/** `TerrorNavSpawnAttributeType` — L4D2 only, and the bits the Director actually reads. */
export const SPAWN_FLAGS: Record<number, string> = {
  0x00000002: "EMPTY",
  0x00000004: "STOP",
  0x00000020: "BATTLESTATION",
  0x00000040: "FINALE",
  0x00000080: "PLAYER_START",
  0x00000100: "BATTLEFIELD",
  0x00000200: "IGNORE_VISIBILITY",
  0x00000400: "NOT_CLEARABLE",
  0x00000800: "CHECKPOINT",
  0x00001000: "OBSCURED",
  0x00002000: "NO_MOBS",
  0x00004000: "THREAT",
  0x00008000: "RESCUE_VEHICLE",
  0x00010000: "RESCUE_CLOSET",
  0x00020000: "ESCAPE_ROUTE",
  0x00040000: "DOOR",
  0x00080000: "NOTHREAT",
  0x00100000: "LYINGDOWN",
  0x01000000: "COMPASS_NORTH",
  0x02000000: "COMPASS_NORTHEAST",
  0x04000000: "COMPASS_EAST",
  0x08000000: "COMPASS_EASTSOUTH",
  0x10000000: "COMPASS_SOUTH",
  0x20000000: "COMPASS_SOUTHWEST",
  0x40000000: "COMPASS_WEST",
  0x80000000: "COMPASS_WESTNORTH",
};

export interface NavArea {
  index: number;
  id: number;
  flags: number;
  /** Byte offset of the 32-bit flags field. */
  flagsOffset: number;
  /** Byte offset of the 16-bit place id. */
  placeIdOffset: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Z of the north-east and south-west corners; the other two are the bounding box's. */
  neZ: number;
  swZ: number;
  connections: { north: number[]; east: number[]; south: number[]; west: number[] };
  hidingSpots: number;
  placeId: number;
  /** L4D2 `spawnAttributeFlags`; 0 for a sub-version that has none. */
  spawnAttributes: number;
  spawnAttributesOffset: number;
  visibleAreas: number;
}

export interface NavFile {
  path: string;
  version: number;
  subVersion: number;
  bspSize: number;
  analyzed: boolean;
  places: string[];
  hasUnnamedAreas: boolean;
  /** L4D2 population type, e.g. `c1streets`; null when the sub-version has none. */
  zombiePopulation: string | null;
  fogPlaces: string[];
  areaCount: number;
  areas: NavArea[];
  bytes: Buffer;
}

/** A bounds-checked cursor; every read says where it failed. */
class Cursor {
  constructor(
    readonly bytes: Buffer,
    public at = 0,
  ) {}

  need(count: number): void {
    if (count < 0 || this.at + count > this.bytes.length) {
      throw new NavFormatError(
        `a ${count}-byte field does not fit in a ${this.bytes.length}-byte file`,
        this.at,
      );
    }
  }

  u8(): number {
    this.need(1);
    const value = this.bytes.readUInt8(this.at);
    this.at += 1;
    return value;
  }

  u16(): number {
    this.need(2);
    const value = this.bytes.readUInt16LE(this.at);
    this.at += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.bytes.readUInt32LE(this.at);
    this.at += 4;
    return value;
  }

  f32(): number {
    this.need(4);
    const value = this.bytes.readFloatLE(this.at);
    this.at += 4;
    return value;
  }

  skip(count: number): void {
    this.need(count);
    this.at += count;
  }

  string(length: number): string {
    this.need(length);
    const value = this.bytes.toString("latin1", this.at, this.at + length);
    this.at += length;
    return value;
  }

  cstring(): string {
    const end = this.bytes.indexOf(0, this.at);
    if (end === -1) throw new NavFormatError("a NUL-terminated string never ends", this.at);
    const value = this.bytes.toString("latin1", this.at, end);
    this.at = end + 1;
    return value;
  }
}

/** Guard against a corrupt file asking for a million areas. */
function plausibleCount(count: number, bytes: Buffer, cursor: number, minimumBytes: number): void {
  if (count < 0 || count > 1_000_000) {
    throw new NavFormatError(`implausible count ${count}`, cursor);
  }
  if (minimumBytes > 0 && count * minimumBytes > bytes.length) {
    throw new NavFormatError(
      `${count} entries need at least ${count * minimumBytes} bytes, more than the file holds`,
      cursor,
    );
  }
}

export function isNav(bytes: Buffer): boolean {
  return bytes.length >= 16 && bytes.readUInt32LE(0) === 0xfeedface;
}

/** Parses a `.nav`. Throws `NavFormatError` with the byte offset on anything inconsistent. */
export function readNavFile(bytes: Buffer, path = "<buffer>"): NavFile {
  if (!isNav(bytes)) {
    throw new NavFormatError(
      `${path} does not start with the nav magic 0xFEEDFACE`,
      0,
    );
  }
  const cursor = new Cursor(bytes);
  cursor.u32(); // magic
  const version = cursor.u32();
  if (version < 6 || version > 16) {
    throw new NavFormatError(`${path} is nav version ${version}; this reader knows 6 to 16`, 4);
  }
  const subVersion = version >= 10 ? cursor.u32() : 0;
  const bspSize = version >= 4 ? cursor.u32() : 0;
  const analyzed = version >= 14 ? cursor.u8() !== 0 : false;

  const places: string[] = [];
  let hasUnnamedAreas = false;
  if (version >= 5) {
    const placeCount = cursor.u16();
    plausibleCount(placeCount, bytes, cursor.at, 2);
    for (let i = 0; i < placeCount; i += 1) {
      const length = cursor.u16();
      places.push(cursor.string(length));
    }
    if (version > 11) hasUnnamedAreas = cursor.u8() !== 0;
  }

  // L4D2 stores its population type and fog place list before the areas.
  let zombiePopulation: string | null = null;
  const fogPlaces: string[] = [];
  if (version >= 16 && subVersion > 7) {
    if (subVersion >= 12) zombiePopulation = cursor.cstring();
    const fogCount = cursor.u16();
    plausibleCount(fogCount, bytes, cursor.at, 2);
    for (let i = 0; i < fogCount; i += 1) {
      const length = cursor.u16();
      fogPlaces.push(cursor.string(length));
    }
  }

  const areaCount = cursor.u32();
  plausibleCount(areaCount, bytes, cursor.at, 40);
  const areas: NavArea[] = [];

  for (let index = 0; index < areaCount; index += 1) {
    const id = cursor.u32();
    const flagsOffset = cursor.at;
    const flags = version >= 13 ? cursor.u32() : 0;
    if (version < 13) {
      throw new NavFormatError(
        `nav version ${version} stores a 16-bit flags field; this reader only patches version 13 and later`,
        flagsOffset,
      );
    }

    const minX = cursor.f32();
    const minY = cursor.f32();
    const minZ = cursor.f32();
    const maxX = cursor.f32();
    const maxY = cursor.f32();
    const maxZ = cursor.f32();
    const neZ = cursor.f32();
    const swZ = cursor.f32();

    const directions = ["north", "east", "south", "west"] as const;
    const connections: NavArea["connections"] = { north: [], east: [], south: [], west: [] };
    for (const direction of directions) {
      const count = cursor.u32();
      plausibleCount(count, bytes, cursor.at, 4);
      const ids: number[] = [];
      for (let i = 0; i < count; i += 1) ids.push(cursor.u32());
      connections[direction] = ids;
    }

    const hidingSpots = cursor.u8();
    cursor.skip(hidingSpots * 17); // id u32 + x,y,z f32 + flags u8

    if (version < 15) {
      const approachCount = cursor.u8();
      cursor.skip(approachCount * 14); // here u32 + prev u32 + type u8 + next u32 + how u8
    }

    const encounterCount = cursor.u32();
    plausibleCount(encounterCount, bytes, cursor.at, 11);
    for (let i = 0; i < encounterCount; i += 1) {
      cursor.skip(4 + 1 + 4 + 1); // from id/dir, to id/dir
      const spotCount = cursor.u8();
      cursor.skip(spotCount * 5); // order id u32 + t u8
    }

    const placeIdOffset = cursor.at;
    const placeId = cursor.u16();

    for (let i = 0; i < 2; i += 1) {
      const count = cursor.u32();
      plausibleCount(count, bytes, cursor.at, 4);
      cursor.skip(count * 4);
    }

    cursor.skip(8); // earliest occupy time, two floats
    if (version >= 11) cursor.skip(16); // four corner light intensities

    let spawnAttributes = 0;
    let spawnAttributesOffset = cursor.at;
    let visibleAreas = 0;

    if (version >= 16) {
      // L4D2's per-area block. The ugly branches below are the format's, not a guess: each
      // one exists only for a sub-version range that shipped in a public build.
      if (subVersion > 0) {
        spawnAttributesOffset = cursor.at;
        spawnAttributes = cursor.u32();
        if (subVersion >= 2) {
          if (subVersion < 10) {
            cursor.skip(4); // unknown
            if (subVersion > 3) {
              cursor.skip(4);
              if (subVersion - 5 < 8) cursor.skip(4);
            }
          } else if (subVersion - 5 < 8) {
            cursor.skip(4);
          }
          if (subVersion > 7) cursor.skip(2); // fog place id
        }
        if ((spawnAttributes & 0x8) !== 0 && subVersion < 10) {
          cursor.skip(4 + 4 + 4 + 4 + 4);
        }
        if (subVersion - 3 < 7) {
          const count = cursor.u8();
          cursor.skip(count * 4);
        }
        if (subVersion >= 5) {
          visibleAreas = cursor.u32();
          plausibleCount(visibleAreas, bytes, cursor.at, subVersion >= 9 ? 5 : 4);
          cursor.skip(visibleAreas * (subVersion >= 9 ? 5 : 4));
          if (subVersion > 10) cursor.skip(4); // inherit visibility from
        }
      }
    }

    areas.push({
      index,
      id,
      flags,
      flagsOffset,
      placeIdOffset,
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
      neZ,
      swZ,
      connections,
      hidingSpots,
      placeId,
      spawnAttributes,
      spawnAttributesOffset,
      visibleAreas,
    });
  }

  return {
    path,
    version,
    subVersion,
    bspSize,
    analyzed,
    places,
    hasUnnamedAreas,
    zombiePopulation,
    fogPlaces,
    areaCount,
    areas,
    bytes,
  };
}

/** Decodes a bitfield into the names of the bits that are set. */
export function decodeFlags(value: number, table: Record<number, string>): string[] {
  return Object.entries(table)
    .filter(([bit]) => (value & Number(bit)) !== 0)
    .map(([, name]) => name);
}

/** Combines names back into a bitfield. Throws on a name this project does not know. */
export function encodeFlags(names: readonly string[], table: Record<number, string>): number {
  let value = 0;
  for (const name of names) {
    const entry = Object.entries(table).find(([, n]) => n === name.toUpperCase());
    if (!entry) {
      throw new Error(
        `unknown flag ${name}; known: ${Object.values(table).join(", ")}`,
      );
    }
    value |= Number(entry[0]) >>> 0;
  }
  return value >>> 0;
}

export interface NavAreaUpdate {
  id: number;
  /**
   * Flag bits to set and to clear. Masks rather than a replacement value on purpose: an area
   * can carry bits this table does not name, and writing a value built only from known names
   * would silently clear them.
   */
  setFlags?: number;
  clearFlags?: number;
  /** Full replacement place id. */
  placeId?: number;
  /** L4D2 spawn attributes, as masks for the same reason. */
  setSpawn?: number;
  clearSpawn?: number;
}

/**
 * Copies the file and writes the given fields in place.
 *
 * The returned buffer has the same length as the input: only the bits of the fields named
 * in `updates` differ. That property is what makes a nav edit reviewable instead of a
 * rewrite of a 10 MB mesh.
 */
export function patchNavAreas(nav: NavFile, updates: readonly NavAreaUpdate[]): Buffer {
  const byId = new Map(nav.areas.map((area) => [area.id, area]));
  const out = Buffer.from(nav.bytes);

  for (const update of updates) {
    const area = byId.get(update.id);
    if (!area) throw new Error(`area ${update.id} is not in ${nav.path}`);

    if (update.setFlags !== undefined || update.clearFlags !== undefined) {
      const next = ((area.flags | (update.setFlags ?? 0)) & ~(update.clearFlags ?? 0)) >>> 0;
      out.writeUInt32LE(next, area.flagsOffset);
    }
    if (update.placeId !== undefined) {
      out.writeUInt16LE(update.placeId & 0xffff, area.placeIdOffset);
    }
    if (update.setSpawn !== undefined || update.clearSpawn !== undefined) {
      if (nav.subVersion === 0) {
        throw new Error(
          `${nav.path} has sub-version 0, which carries no spawn attributes; L4D2 needs a newer file`,
        );
      }
      const next =
        ((area.spawnAttributes | (update.setSpawn ?? 0)) & ~(update.clearSpawn ?? 0)) >>> 0;
      out.writeUInt32LE(next, area.spawnAttributesOffset);
    }
  }

  return out;
}

/** Centre of an area, in world units. */
export function navAreaCenter(area: NavArea): [number, number, number] {
  return [
    (area.minX + area.maxX) / 2,
    (area.minY + area.maxY) / 2,
    (area.minZ + area.maxZ) / 2,
  ];
}
