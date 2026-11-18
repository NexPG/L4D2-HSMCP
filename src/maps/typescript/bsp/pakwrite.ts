/**
 * Adding files to a compiled map's pakfile, without `bspzip`.
 *
 * The pakfile is lump 40 of a BSP and it is a plain ZIP. Writing a new one means two things:
 * build the archive, and point the lump at it. The archive is **appended** and the lump entry
 * is moved to it rather than the file being rebuilt: shifting a 100 MB map's lumps to make
 * room is how a writer corrupts one, and BSP readers only ever follow the header offsets.
 * The old bytes stay as dead space, which is the price of an edit that cannot lose the map.
 *
 * The lump descriptor is written through `setLumpDescriptor`, because L4D2 stores its fields
 * in a different order than every other Source game; patching it as "standard" would move
 * the length into the offset slot and the map would read from the wrong place.
 */
import { LUMP_PAKFILE, setLumpDescriptor } from "./header.js";
import type { LumpLayout } from "./header.js";
import { readZip, writeZip } from "./zip.js";
import type { ZipEntry } from "./zip.js";

export interface PakTarget {
  /** Offset of the pakfile lump, from `readHeader`. */
  offset: number;
  /** Its length; 0 means the map carries no pakfile yet. */
  length: number;
  /** The field order of this map's lump descriptors. */
  layout: LumpLayout;
}

export interface PakAddInput {
  internal: string;
  data: Buffer;
}

export interface PakAddResult {
  bytes: Buffer;
  added: string[];
  replaced: string[];
  entryCount: number;
  /** Where the new archive starts; everything before it is the original file. */
  archiveOffset: number;
}

/** The archive a map already carries. An empty lump is an empty list. */
export function readPakfile(bsp: Buffer, target: PakTarget, path = "<bsp>"): ZipEntry[] {
  if (target.length === 0) return [];
  if (target.offset < 0 || target.offset + target.length > bsp.length) {
    throw new Error(
      `${path}: the pakfile lump claims ${target.length} bytes at ${target.offset}, ` +
        `past the end of a ${bsp.length}-byte file`,
    );
  }
  return readZip(bsp.subarray(target.offset, target.offset + target.length), `${path}#pakfile`);
}

/**
 * Merges files into the pakfile and returns a new BSP.
 *
 * An entry with the same name (case-insensitively, as the engine resolves paths) is replaced;
 * everything else is kept. The returned buffer is the original bytes plus the archive, with
 * only the pakfile descriptor changed in the header.
 */
export function addToPakfile(
  bsp: Buffer,
  files: readonly PakAddInput[],
  target: PakTarget,
): PakAddResult {
  const existing = readPakfile(bsp, target);
  const byName = new Map(existing.map((entry) => [entry.name.toLowerCase(), entry]));
  const added: string[] = [];
  const replaced: string[] = [];

  for (const file of files) {
    const name = file.internal.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name) throw new Error("an in-archive path cannot be empty");
    if (/^[A-Za-z]:/.test(name) || name.startsWith("/") || name.split("/").includes("..")) {
      throw new Error(`refusing the in-archive path ${JSON.stringify(file.internal)}`);
    }
    const key = name.toLowerCase();
    if (byName.has(key)) replaced.push(name);
    else added.push(name);
    byName.set(key, { name, data: file.data });
  }

  const archive = writeZip([...byName.values()]);
  // Four-byte alignment: the lump is read as bytes, but keeping the archive aligned matches
  // what every BSP writer does and costs at most three bytes.
  const archiveOffset = (bsp.length + 3) & ~3;
  const out = Buffer.alloc(archiveOffset + archive.length);
  bsp.copy(out, 0);
  archive.copy(out, archiveOffset);
  setLumpDescriptor(out, LUMP_PAKFILE, target.layout, archiveOffset, archive.length);

  return {
    bytes: out,
    added,
    replaced,
    entryCount: byName.size,
    archiveOffset,
  };
}
