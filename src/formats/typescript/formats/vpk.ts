/**
 * Valve Pak (`.vpk`), read and written here rather than by `vpk.exe`.
 *
 * Why this exists at all: packing an addon used to mean finding the game's `vpk.exe` and
 * shelling out to it, which makes "build an addon" depend on a 20-year-old CLI that ships
 * with the client. The format is small and stable, so the writer lives here and the tool
 * `run_vpk_build` no longer needs a game install. `run_vpk_pack` still drives `vpk.exe`,
 * because a second implementation of a writer is only worth having if it can be checked
 * against the first.
 *
 * The layout is taken from sourcepp's `vpkpp/format/VPK.cpp` (MIT, Copyright (c) 2023 Laura
 * Lewis) and cross-checked against real archives; see `third-party/NOTICES.md`. Four details
 * are easy to get wrong and are the reason this file is longer than the format:
 *
 * * the tree is grouped **extension, then directory, then file name**, and each group ends
 *   with an empty string;
 * * a file with no extension is stored under the extension `" "` (a single space), and a
 *   file at the root under the directory `" "` — not under `""`;
 * * the `length` field **excludes** the preload bytes, while the file's real length
 *   includes them. sourcepp adds them after reading, and a writer that does the same by
 *   mistake produces archives whose last file is short;
 * * for the directory archive (`archiveIndex` = `0x7FFF`) the offset is relative to the end
 *   of the **header and tree**, not to the start of the file.
 *
 * Only version 1 is written. That is what Left 4 Dead 2 reads and what an addon needs;
 * version 2 adds MD5 sections and an optional signature, and `vpk.exe` remains available
 * for anyone who specifically wants one. Version 2 is still *read*.
 */

/** `VPK_SIGNATURE` — `0x55AA1234`, stored little-endian. */
export const VPK_SIGNATURE = 0x55aa1234;
/** `VPK_DIR_INDEX` — the entry lives in the `_dir.vpk` itself. */
export const VPK_DIR_INDEX = 0x7fff;
/** `VPK_ENTRY_TERM` — closes every directory entry. */
export const VPK_ENTRY_TERM = 0xffff;
/** Bytes of one directory entry, before any preload data. */
export const VPK_ENTRY_BYTES = 18;
/** The header is this long. Version 2 adds 16 bytes of section sizes. */
export const VPK_HEADER_V1 = 12;
export const VPK_HEADER_V2 = 28;

export class VpkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VpkError";
  }
}

export interface VpkEntry {
  /** Full path inside the archive: `materials/foo/bar.vtf`. */
  path: string;
  crc32: number;
  /** Bytes stored in the tree itself, before the archive data. Usually none. */
  preload: Buffer;
  /** `0x7FFF` when the data is in the `_dir.vpk`, otherwise the 1-based archive number. */
  archiveIndex: number;
  /** Offset in the archive file, or from the end of the tree for the dir archive. */
  offset: number;
  /** Bytes stored in the archive, **excluding** the preload. */
  storedLength: number;
  /** Real length of the file: `storedLength + preload.length`. */
  length: number;
}

export interface VpkArchive {
  path: string;
  version: number;
  treeSize: number;
  headerLength: number;
  /** Where the file data begins for a single-file VPK. */
  fileDataOffset: number;
  entries: VpkEntry[];
  /** Highest archive number referenced, or 0 when everything is in the dir file. */
  archiveCount: number;
  /** Version 2 sections, in bytes. Zero for version 1. */
  sections: {
    fileData: number;
    archiveMd5: number;
    otherMd5: number;
    signature: number;
  };
  bytes: Buffer;
}

/** CRC-32 (IEEE 802.3), the checksum the format and every Source tool use. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = (CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Reads a NUL-terminated string. Returns the text and the offset after the NUL. */
function readCString(bytes: Buffer, offset: number, limit: number): { text: string; next: number } {
  const end = bytes.indexOf(0, offset);
  if (end === -1 || end >= limit) {
    throw new VpkError(`string at offset ${offset} is not terminated before ${limit}`);
  }
  return { text: bytes.toString("utf8", offset, end), next: end + 1 };
}

/** `{ dir, name, ext }` for an in-archive path, with the format's space conventions. */
export function vpkPathParts(path: string): { dir: string; name: string; ext: string } {
  const clean = cleanVpkPath(path);
  const slash = clean.lastIndexOf("/");
  const dir = slash === -1 ? "" : clean.slice(0, slash);
  const file = slash === -1 ? clean : clean.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  // A leading dot (`.gitignore`) is a name, not an extension, and matches the format:
  // vpk.exe stores such a file under the extension " ".
  const hasExt = dot > 0 && dot < file.length - 1;
  return {
    dir,
    name: hasExt ? file.slice(0, dot) : file,
    ext: hasExt ? file.slice(dot + 1) : "",
  };
}

/** Normalises an in-archive path and refuses anything that could escape the archive. */
export function cleanVpkPath(path: string): string {
  const normalised = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!normalised) throw new VpkError("an entry path cannot be empty");
  const parts = normalised.split("/");
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") {
      throw new VpkError(`refusing the entry path ${JSON.stringify(path)}: ${part || "empty segment"}`);
    }
  }
  return normalised;
}

/** True when the bytes start with the VPK signature. */
export function isVpk(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === VPK_SIGNATURE;
}

/** Code-unit string order. Used where a locale-dependent sort would change the bytes. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Parses the directory archive. Numbered archives are not read here: the entries say which
 * one holds the bytes, and `readVpkEntry` takes a loader for them.
 */
export function readVpk(bytes: Buffer, path = "<buffer>"): VpkArchive {
  if (bytes.length < VPK_HEADER_V1) {
    throw new VpkError(`${path}: ${bytes.length} bytes is too short to hold a VPK header`);
  }
  if (!isVpk(bytes)) {
    throw new VpkError(
      `${path}: not a VPK (first four bytes are 0x${bytes.readUInt32LE(0).toString(16)}). ` +
        `A pre-2013 GoldSrc-era pack with no header is not supported.`,
    );
  }

  const version = bytes.readUInt32LE(4);
  const treeSize = bytes.readUInt32LE(8);
  if (version !== 1 && version !== 2) {
    throw new VpkError(
      `${path}: VPK version ${version} is not supported (1 and 2 are). ` +
        `Version 54 is compression for newer games and is deliberately refused rather than read wrong.`,
    );
  }

  const sections = { fileData: 0, archiveMd5: 0, otherMd5: 0, signature: 0 };
  const headerLength = version === 2 ? VPK_HEADER_V2 : VPK_HEADER_V1;
  if (version === 2) {
    if (bytes.length < VPK_HEADER_V2) {
      throw new VpkError(`${path}: a version 2 VPK needs a ${VPK_HEADER_V2}-byte header`);
    }
    sections.fileData = bytes.readUInt32LE(12);
    sections.archiveMd5 = bytes.readUInt32LE(16);
    sections.otherMd5 = bytes.readUInt32LE(20);
    sections.signature = bytes.readUInt32LE(24);
  }

  const treeEnd = headerLength + treeSize;
  if (treeEnd > bytes.length) {
    throw new VpkError(
      `${path}: the tree claims ${treeSize} bytes at offset ${headerLength}, past the end of a ${bytes.length}-byte file`,
    );
  }

  const entries: VpkEntry[] = [];
  let cursor = headerLength;
  let archiveCount = 0;

  while (cursor < treeEnd) {
    const extension = readCString(bytes, cursor, treeEnd);
    cursor = extension.next;
    if (extension.text === "") break; // end of the extensions list

    // `" "` means "no extension", which is how the format stores `LICENSE` or `README`.
    const ext = extension.text === " " ? "" : extension.text;

    while (cursor < treeEnd) {
      const directory = readCString(bytes, cursor, treeEnd);
      cursor = directory.next;
      if (directory.text === "") break; // end of this extension's directories
      const dir = directory.text === " " ? "" : directory.text;

      while (cursor < treeEnd) {
        const name = readCString(bytes, cursor, treeEnd);
        cursor = name.next;
        if (name.text === "") break; // end of this directory's files

        if (cursor + VPK_ENTRY_BYTES > treeEnd) {
          throw new VpkError(
            `${path}: the entry for ${name.text} runs past the end of the tree at ${cursor}`,
          );
        }
        const checksum = bytes.readUInt32LE(cursor);
        const preloadBytes = bytes.readUInt16LE(cursor + 4);
        const archiveIndex = bytes.readUInt16LE(cursor + 6);
        const offset = bytes.readUInt32LE(cursor + 8);
        const storedLength = bytes.readUInt32LE(cursor + 12);
        const term = bytes.readUInt16LE(cursor + 16);
        cursor += VPK_ENTRY_BYTES;

        if (term !== VPK_ENTRY_TERM) {
          throw new VpkError(
            `${path}: the entry for ${name.text} ends with 0x${term.toString(16)} instead of 0xFFFF; ` +
              `the tree is misaligned, so every later path would be wrong`,
          );
        }
        if (cursor + preloadBytes > treeEnd) {
          throw new VpkError(
            `${path}: ${preloadBytes} preload bytes for ${name.text} run past the end of the tree`,
          );
        }
        const preload = bytes.subarray(cursor, cursor + preloadBytes);
        cursor += preloadBytes;

        const entryPath = [dir, ext ? `${name.text}.${ext}` : name.text].filter(Boolean).join("/");
        if (archiveIndex !== VPK_DIR_INDEX && archiveIndex > archiveCount) archiveCount = archiveIndex;

        entries.push({
          path: entryPath,
          crc32: checksum,
          preload,
          archiveIndex,
          offset,
          storedLength,
          length: storedLength + preloadBytes,
        });
      }
    }
  }

  return {
    path,
    version,
    treeSize,
    headerLength,
    fileDataOffset: treeEnd,
    entries,
    archiveCount,
    sections,
    bytes,
  };
}

/**
 * The bytes of one entry.
 *
 * `openArchive` is asked for a numbered archive when the entry is not in the directory
 * file; it may return undefined, which is reported as a missing archive rather than a
 * truncated file. That distinction matters: an addon split across `_000.vpk`, `_001.vpk`
 * with one file missing reads as "the last files are empty" in a naive reader.
 */
export function readVpkEntry(
  archive: VpkArchive,
  entry: VpkEntry,
  openArchive?: (index: number) => Buffer | undefined,
): Buffer {
  if (entry.length === 0) return Buffer.alloc(0);
  if (entry.storedLength === 0) return Buffer.from(entry.preload);

  let data: Buffer;
  if (entry.archiveIndex === VPK_DIR_INDEX) {
    const start = archive.fileDataOffset + entry.offset;
    const end = start + entry.storedLength;
    if (end > archive.bytes.length) {
      throw new VpkError(
        `${archive.path}: ${entry.path} claims bytes ${start}..${end}, past the end of a ${archive.bytes.length}-byte file`,
      );
    }
    data = archive.bytes.subarray(start, end);
  } else {
    const numbered = openArchive?.(entry.archiveIndex);
    if (!numbered) {
      throw new VpkError(
        `${archive.path}: ${entry.path} lives in archive ${entry.archiveIndex}, which was not provided`,
      );
    }
    const end = entry.offset + entry.storedLength;
    if (end > numbered.length) {
      throw new VpkError(
        `${archive.path}: ${entry.path} claims bytes ${entry.offset}..${end} of archive ${entry.archiveIndex}, ` +
          `which is ${numbered.length} bytes`,
      );
    }
    data = numbered.subarray(entry.offset, end);
  }

  return entry.preload.length === 0 ? Buffer.from(data) : Buffer.concat([entry.preload, data]);
}

/** Turns `dir/pak01_000.vpk` into `dir/pak01_dir.vpk`, and leaves a dir path alone. */
export function vpkDirPath(path: string): string {
  return /_\d{3}\.vpk$/i.test(path) ? path.replace(/_\d{3}\.vpk$/i, "_dir.vpk") : path;
}

/** `dir/pak01_dir.vpk` → `dir/pak01_003.vpk`. */
export function vpkArchivePath(dirPath: string, index: number): string {
  return `${dirPath.replace(/_dir\.vpk$/i, "")}_${String(index).padStart(3, "0")}.vpk`;
}

export interface VpkWriteOptions {
  /** Only 1 is supported; Left 4 Dead 2 reads it and every addon uses it. */
  version?: 1;
  /**
   * Split the data across numbered archives at this many bytes. The directory archive
   * keeps the tree only. `vpk.exe` uses 200 MiB; passing nothing writes one file.
   */
  splitBytes?: number;
  /** Bytes of each file copied into the tree. The format allows it; nothing needs it. */
  preloadBytes?: number;
}

export interface VpkWriteResult {
  dir: Buffer;
  archives: Array<{ index: number; bytes: Buffer }>;
  entries: VpkEntry[];
  treeSize: number;
  version: number;
}

/**
 * Builds a version 1 VPK from path → bytes.
 *
 * The tree is sorted by extension, directory and name, which is what `vpk.exe` produces and
 * what makes two builds of the same content byte-identical.
 */
export function writeVpk(files: Map<string, Buffer>, options: VpkWriteOptions = {}): VpkWriteResult {
  const version = options.version ?? 1;
  if (version !== 1) {
    throw new VpkError(
      "only version 1 is written here: Left 4 Dead 2 reads it, and version 2 adds MD5 " +
        "sections and a signature that an addon does not use. Use vpk.exe when a v2 archive " +
        "is genuinely required.",
    );
  }
  const preloadBytes = Math.max(0, Math.floor(options.preloadBytes ?? 0));
  if (preloadBytes > 0xffff) {
    throw new VpkError(`preloadBytes ${preloadBytes} does not fit the 16-bit field`);
  }

  const cleaned = new Map<string, Buffer>();
  for (const [path, data] of files) {
    const clean = cleanVpkPath(path);
    if (cleaned.has(clean)) throw new VpkError(`duplicate entry path ${clean}`);
    cleaned.set(clean, data);
  }
  if (cleaned.size === 0) {
    throw new VpkError("cannot write a VPK with no entries: vpk.exe and the engine both expect at least the tree");
  }

  const sorted = [...cleaned.keys()].sort((a, b) => {
    const pa = vpkPathParts(a);
    const pb = vpkPathParts(b);
    // A plain code-unit comparison, not `localeCompare`: the locale must not decide the
    // order of a file format, or two machines build different bytes from the same tree.
    return compare(pa.ext, pb.ext) || compare(pa.dir, pb.dir) || compare(pa.name, pb.name);
  });

  // Assign data first: the tree stores offsets, so the order has to be decided before the
  // bytes that describe it are written.
  const splitBytes = options.splitBytes;
  const entries: VpkEntry[] = [];
  const archiveBuffers = new Map<number, Buffer[]>();
  let currentArchive = 1;
  let currentOffset = 0;

  for (const path of sorted) {
    const data = cleaned.get(path)!;
    const preloadLength = Math.min(preloadBytes, data.length);
    const stored = data.length - preloadLength;

    let archiveIndex = VPK_DIR_INDEX;
    if (splitBytes !== undefined && stored > 0) {
      if (currentOffset > 0 && currentOffset + stored > splitBytes) {
        currentArchive += 1;
        currentOffset = 0;
      }
      if (stored > splitBytes) {
        throw new VpkError(
          `${path} is ${stored} bytes, larger than the ${splitBytes}-byte archive limit; ` +
            `a single file cannot be split across archives`,
        );
      }
      archiveIndex = currentArchive;
    }

    if (archiveIndex === VPK_DIR_INDEX && stored > 0xffffffff - currentOffset) {
      throw new VpkError(`${path} pushes the directory archive past 4 GiB; use splitBytes`);
    }

    entries.push({
      path,
      crc32: crc32(data),
      preload: data.subarray(0, preloadLength),
      archiveIndex,
      offset: archiveIndex === VPK_DIR_INDEX ? currentOffset : currentOffset,
      storedLength: stored,
      length: data.length,
    });

    if (stored > 0) {
      const bucket = archiveBuffers.get(archiveIndex) ?? [];
      bucket.push(data.subarray(preloadLength));
      archiveBuffers.set(archiveIndex, bucket);
      currentOffset += stored;
    }
  }

  // The tree: extension → directory → file, each list closed by an empty string.
  const chunks: Buffer[] = [];
  let treeSize = 0;
  const push = (text: string): void => {
    const buf = Buffer.from(`${text}\0`, "utf8");
    chunks.push(buf);
    treeSize += buf.length;
  };

  const groups = new Map<string, Map<string, VpkEntry[]>>();
  for (const entry of entries) {
    const { dir, ext } = vpkPathParts(entry.path);
    const byDir = groups.get(ext) ?? new Map<string, VpkEntry[]>();
    const list = byDir.get(dir) ?? [];
    list.push(entry);
    byDir.set(dir, list);
    groups.set(ext, byDir);
  }

  for (const ext of [...groups.keys()].sort()) {
    push(ext === "" ? " " : ext);
    const byDir = groups.get(ext)!;
    for (const dir of [...byDir.keys()].sort()) {
      push(dir === "" ? " " : dir);
      const list = byDir.get(dir)!;
      for (const entry of list) {
        push(vpkPathParts(entry.path).name);
        const record = Buffer.alloc(VPK_ENTRY_BYTES);
        record.writeUInt32LE(entry.crc32, 0);
        record.writeUInt16LE(entry.preload.length, 4);
        record.writeUInt16LE(entry.archiveIndex, 6);
        record.writeUInt32LE(entry.offset, 8);
        record.writeUInt32LE(entry.storedLength, 12);
        record.writeUInt16LE(VPK_ENTRY_TERM, 16);
        chunks.push(record, entry.preload);
        treeSize += record.length + entry.preload.length;
      }
      push(""); // end of this directory's files
    }
    push(""); // end of this extension's directories
  }
  push(""); // end of the extensions list

  const tree = Buffer.concat(chunks);
  const header = Buffer.alloc(VPK_HEADER_V1);
  header.writeUInt32LE(VPK_SIGNATURE, 0);
  header.writeUInt32LE(version, 4);
  header.writeUInt32LE(treeSize, 8);

  const archives: Array<{ index: number; bytes: Buffer }> = [];
  for (const index of [...archiveBuffers.keys()].filter((i) => i !== VPK_DIR_INDEX).sort((a, b) => a - b)) {
    archives.push({ index, bytes: Buffer.concat(archiveBuffers.get(index)!) });
  }

  const dirData = archiveBuffers.get(VPK_DIR_INDEX) ?? [];
  const dir = Buffer.concat([header, tree, ...dirData]);

  return { dir, archives, entries, treeSize, version };
}
