/**
 * The ZIP a BSP carries in its pakfile lump — read and written here.
 *
 * `run_pakfile_extract` could take a map's packed content out, through the sidecar, and
 * `run_pack` could put files back with `bspzip`. The writer is what removes the external
 * tool: bspzip ships with the game and refuses to run without it, so "ship the map with its
 * assets" depended on a Steam install. A pakfile is a plain ZIP with no encryption and no
 * ZIP64, which is a small enough format to own.
 *
 * Only what a pakfile uses is implemented: stored and deflated entries, no comments, no
 * encryption, no data descriptors. Anything else is refused rather than written wrong.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { crc32 } from "../../../formats/typescript/formats/vpk.js";

export interface ZipEntry {
  /** Path inside the archive, forward slashes. */
  name: string;
  /** Stored bytes of the file itself. */
  data: Buffer;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Reads the central directory and every entry's bytes. Throws on anything unsupported. */
export function readZip(bytes: Buffer, path = "<zip>"): ZipEntry[] {
  // The EOCD is at the end, but a comment may follow it; scan back over the comment limit.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${path}: no end-of-central-directory record; not a ZIP`);

  const entries = bytes.readUInt16LE(eocd + 10);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  let at = directoryOffset;

  for (let i = 0; i < entries; i += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== CENTRAL_SIG) {
      throw new Error(`${path}: central directory entry ${i} is not where the EOCD says it is`);
    }
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const uncompressed = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);

    if ((flags & 0x1) !== 0) throw new Error(`${path}: ${name} is encrypted; refusing it`);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error(`${path}: ${name} has no local header at ${localOffset}`);
    }
    const localName = bytes.readUInt16LE(localOffset + 26);
    const localExtra = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const stored = bytes.subarray(start, start + compressed);
    if (stored.length !== compressed) {
      throw new Error(`${path}: ${name} claims ${compressed} bytes past the end of the archive`);
    }

    let data: Buffer;
    if (method === 0) data = Buffer.from(stored);
    else if (method === 8) data = inflateRawSync(stored);
    else throw new Error(`${path}: ${name} uses compression method ${method}, not stored or deflate`);

    if (data.length !== uncompressed) {
      throw new Error(`${path}: ${name} inflated to ${data.length} bytes, header says ${uncompressed}`);
    }
    out.push({ name, data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

export interface ZipWriteOptions {
  /** Store instead of deflate. Deflate is the default and what a pakfile normally uses. */
  store?: boolean;
}

/**
 * Builds a ZIP from entries.
 *
 * Entries are sorted by name and written at a fixed timestamp (1980-01-01 00:00), so the same
 * input produces the same bytes: a map rebuilt from an unchanged tree does not change
 * either, and a diff of two pakfiles means something.
 */
export function writeZip(entries: readonly ZipEntry[], options: ZipWriteOptions = {}): Buffer {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const seen = new Set<string>();
  for (const entry of sorted) {
    const name = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name || name.includes("..") || name.startsWith("/")) {
      throw new Error(`refusing the in-archive path ${JSON.stringify(entry.name)}`);
    }
    if (seen.has(name.toLowerCase())) throw new Error(`duplicate entry ${name}`);
    seen.add(name.toLowerCase());
  }

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of sorted) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/").replace(/^\/+/, ""), "utf8");
    const crc = crc32(entry.data);
    const body = options.store ? entry.data : deflateRawSync(entry.data, { level: 9 });
    const method = options.store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, eocd]);
}
