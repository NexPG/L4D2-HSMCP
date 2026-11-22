/**
 * Structural verification of a VPK, on top of the reader that already parses it.
 *
 * `read_vpk` answers "what is in this archive" and can compare a returned entry's CRC; this
 * module answers the different question "is this archive internally consistent": duplicate
 * paths, entries that point past their archive, numbered archives that are referenced but
 * absent, the version 2 tree/entries/whole-file MD5s, every archive MD5 record, and the
 * optional signature. The format constants and the entry reader are the existing ones from
 * `vpk.ts`; nothing here re-parses the tree.
 *
 * The version 2 section layout and the three checksum ranges are taken from sourcepp's
 * `vpkpp/format/VPK.cpp` (MIT). The checks are written from that description, not copied:
 * the code below is independent and the file cites the reference in
 * `third_party/NOTICES.md` through the existing VPK entry.
 */
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { VPK_DIR_INDEX, crc32, readVpkEntry } from "./vpk.js";
import type { VpkArchive } from "./vpk.js";

/** Bytes of one `MD5Entry` in the version 2 archive-MD5 section. */
const MD5_ENTRY_BYTES = 28;
/** The version 2 `otherMD5` section: tree, archive-MD5 section, whole file. */
const OTHER_MD5_BYTES = 48;

export type Md5State = "ok" | "mismatch" | "absent" | "unreadable";
export type SignatureState = "absent" | "verified" | "mismatch" | "unverified";

export interface VpkIssue {
  severity: "error" | "warning";
  rule: string;
  path?: string;
  message: string;
}

export interface VpkArchiveCheck {
  index: number;
  path: string;
  present: boolean;
  bytes: number;
}

export interface VpkVerifyResult {
  version: number;
  entryCount: number;
  archiveCount: number;
  dirBytes: number;
  dataBytes: number;
  archives: VpkArchiveCheck[];
  md5: {
    tree: Md5State;
    entries: Md5State;
    wholeFile: Md5State;
    archive: { checked: number; mismatched: number };
  };
  signature: SignatureState;
  crc: { checked: number; mismatched: number };
  issues: VpkIssue[];
  errorCount: number;
  warningCount: number;
  ok: boolean;
}

export interface VpkVerifyOptions {
  /** Compare every entry's stored CRC against its bytes. Default true. */
  crc?: boolean;
  /** Check the version 2 MD5 sections. Default true; a version 1 archive has none. */
  md5?: boolean;
  /** Try to verify the optional signature. Default true. */
  signature?: boolean;
  /** Path of a numbered archive, for messages. */
  archivePath?: (index: number) => string;
  /** Presence and size without reading the data. Defaults to reading it through `loadArchive`. */
  statArchive?: (index: number) => { present: boolean; bytes: number };
  /** Limit is applied by the caller when formatting; the verifier returns every issue. */
}

function md5(bytes: Buffer): Buffer {
  return createHash("md5").update(bytes).digest();
}

function same(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

export function verifyVpk(
  archive: VpkArchive,
  loadArchive: (index: number) => Buffer | undefined,
  options: VpkVerifyOptions = {},
): VpkVerifyResult {
  const issues: VpkIssue[] = [];
  const error = (rule: string, message: string, path?: string): void => {
    issues.push({ severity: "error", rule, ...(path ? { path } : {}), message });
  };
  const warn = (rule: string, message: string, path?: string): void => {
    issues.push({ severity: "warning", rule, ...(path ? { path } : {}), message });
  };
  const archivePath = options.archivePath ?? ((index: number) => `archive ${index}`);
  const statArchive =
    options.statArchive ??
    ((index: number) => {
      const data = loadArchive(index);
      return { present: data !== undefined, bytes: data?.length ?? 0 };
    });

  // Duplicate paths are legal in the format and ambiguous in the engine: both resolve to the
  // same name, and which one wins is not part of the contract.
  const seen = new Map<string, number>();
  archive.entries.forEach((entry, index) => {
    const first = seen.get(entry.path);
    if (first !== undefined) {
      error(
        "duplicate-entry",
        `${entry.path} appears twice (entries ${first} and ${index}); the engine has no rule for which wins`,
        entry.path,
      );
    } else {
      seen.set(entry.path, index);
    }
  });

  // Every referenced numbered archive must exist, and every entry must fit inside its data.
  const referenced = [...new Set(
    archive.entries
      .filter((entry) => entry.archiveIndex !== VPK_DIR_INDEX)
      .map((entry) => entry.archiveIndex),
  )].sort((a, b) => a - b);
  const archives: VpkArchiveCheck[] = referenced.map((index) => {
    const path = archivePath(index);
    const info = statArchive(index);
    if (!info.present) {
      error(
        "missing-archive",
        `entries reference archive ${index}, but ${path} is absent`,
      );
    }
    return { index, path, present: info.present, bytes: info.bytes };
  });

  for (const entry of archive.entries) {
    if (entry.storedLength === 0) continue;
    if (entry.archiveIndex === VPK_DIR_INDEX) {
      const end = archive.fileDataOffset + entry.offset + entry.storedLength;
      if (end > archive.bytes.length) {
        error(
          "entry-out-of-bounds",
          `${entry.path} claims bytes ${archive.fileDataOffset + entry.offset}..${end} of a ` +
            `${archive.bytes.length}-byte directory file`,
          entry.path,
        );
      }
    } else {
      const info = statArchive(entry.archiveIndex);
      if (!info.present) continue; // already a missing-archive error
      const end = entry.offset + entry.storedLength;
      if (end > info.bytes) {
        error(
          "entry-out-of-bounds",
          `${entry.path} claims bytes ${entry.offset}..${end} of ${archivePath(entry.archiveIndex)}, ` +
            `which is ${info.bytes} bytes`,
          entry.path,
        );
      }
    }
  }

  const crc = { checked: 0, mismatched: 0 };
  if (options.crc !== false) {
    for (const entry of archive.entries) {
      try {
        const data = readVpkEntry(archive, entry, loadArchive);
        crc.checked += 1;
        if (crc32(data) !== entry.crc32) {
          crc.mismatched += 1;
          error(
            "crc-mismatch",
            `${entry.path} stores CRC ${entry.crc32.toString(16).padStart(8, "0")}, but the bytes ` +
              `give ${crc32(data).toString(16).padStart(8, "0")}`,
            entry.path,
          );
        }
      } catch (exc) {
        warn("crc-unreadable", `${entry.path} could not be read: ${(exc as Error).message}`, entry.path);
      }
    }
  }

  const md5State: VpkVerifyResult["md5"] = {
    tree: "absent",
    entries: "absent",
    wholeFile: "absent",
    archive: { checked: 0, mismatched: 0 },
  };
  let signature: SignatureState = "absent";

  if (archive.version === 2 && options.md5 !== false) {
    const bytes = archive.bytes;
    const treeStart = archive.headerLength;
    const treeEnd = treeStart + archive.treeSize;
    const fileDataEnd = treeEnd + archive.sections.fileData;
    const archiveMd5Start = fileDataEnd;
    const archiveMd5End = archiveMd5Start + archive.sections.archiveMd5;
    const otherStart = archiveMd5End;
    const otherEnd = otherStart + archive.sections.otherMd5;
    const signatureStart = otherEnd;
    const signatureEnd = signatureStart + archive.sections.signature;

    if (archive.sections.archiveMd5 % MD5_ENTRY_BYTES !== 0) {
      error(
        "md5-section-size",
        `the archive-MD5 section is ${archive.sections.archiveMd5} bytes, not a multiple of ${MD5_ENTRY_BYTES}`,
      );
    }
    if (archive.sections.otherMd5 !== OTHER_MD5_BYTES) {
      error(
        "md5-section-size",
        `the other-MD5 section is ${archive.sections.otherMd5} bytes; the format defines ${OTHER_MD5_BYTES}`,
      );
    }
    if (otherEnd > bytes.length) {
      error(
        "md5-section-bounds",
        `the MD5 sections end at ${otherEnd}, past the ${bytes.length}-byte directory file`,
      );
    } else {
      const treeChecksum = bytes.subarray(otherStart, otherStart + 16);
      const entriesChecksum = bytes.subarray(otherStart + 16, otherStart + 32);
      const wholeChecksum = bytes.subarray(otherStart + 32, otherStart + 48);

      md5State.tree = same(md5(bytes.subarray(treeStart, treeEnd)), treeChecksum)
        ? "ok"
        : "mismatch";
      if (md5State.tree === "mismatch") {
        error("md5-tree", "the tree's MD5 does not match the checksum in the other-MD5 section");
      }
      md5State.entries = same(
        md5(bytes.subarray(archiveMd5Start, archiveMd5End)),
        entriesChecksum,
      )
        ? "ok"
        : "mismatch";
      if (md5State.entries === "mismatch") {
        error("md5-entries", "the archive-MD5 section's own MD5 does not match");
      }
      md5State.wholeFile = same(md5(bytes.subarray(0, otherStart + 32)), wholeChecksum)
        ? "ok"
        : "mismatch";
      if (md5State.wholeFile === "mismatch") {
        error("md5-whole-file", "the whole-file MD5 does not match the checksum");
      }

      for (let at = archiveMd5Start; at + MD5_ENTRY_BYTES <= archiveMd5End; at += MD5_ENTRY_BYTES) {
        const index = bytes.readUInt32LE(at);
        const offset = bytes.readUInt32LE(at + 4);
        const length = bytes.readUInt32LE(at + 8);
        const expected = bytes.subarray(at + 12, at + 28);
        let data: Buffer | undefined;
        if (index === VPK_DIR_INDEX) {
          const start = archive.fileDataOffset + offset;
          const end = start + length;
          if (end <= bytes.length) data = bytes.subarray(start, end);
        } else {
          const archiveData = loadArchive(index);
          if (archiveData && offset + length <= archiveData.length) {
            data = archiveData.subarray(offset, offset + length);
          }
        }
        if (!data) {
          error(
            "md5-archive-bounds",
            `an archive-MD5 record points at ${index === VPK_DIR_INDEX ? "the directory file" : archivePath(index)} ` +
              `bytes ${offset}..${offset + length}, which do not exist`,
          );
          continue;
        }
        md5State.archive.checked += 1;
        if (!same(md5(data), expected)) {
          md5State.archive.mismatched += 1;
          error(
            "md5-archive-mismatch",
            `archive ${index === VPK_DIR_INDEX ? "directory" : index} bytes ${offset}..${offset + length} ` +
              "do not match their MD5 record",
          );
        }
      }

      if (archive.sections.signature !== 0 && options.signature !== false) {
        if (signatureEnd > bytes.length) {
          error(
            "signature-bounds",
            `the signature section ends at ${signatureEnd}, past the ${bytes.length}-byte file`,
          );
        } else {
          if (signatureEnd < bytes.length) {
            warn(
              "signature-not-last",
              `${bytes.length - signatureEnd} byte(s) follow the signature section`,
            );
          }
          const keyLength = bytes.readUInt32LE(signatureStart);
          const keyStart = signatureStart + 4;
          const keyEnd = keyStart + keyLength;
          if (keyEnd + 4 > signatureEnd) {
            error("signature-bounds", "the signature's public key does not fit the section");
          } else {
            const signatureLength = bytes.readUInt32LE(keyEnd);
            const signatureDataStart = keyEnd + 4;
            const signatureDataEnd = signatureDataStart + signatureLength;
            if (signatureDataEnd > signatureEnd) {
              error("signature-bounds", "the signature does not fit its declared section");
            } else if (keyLength === 0 || signatureLength === 0) {
              signature = "unverified";
              warn("signature-empty", "the signature section exists but carries no key or no signature");
            } else {
              const key = bytes.subarray(keyStart, keyEnd);
              const signed = bytes.subarray(0, signatureStart);
              try {
                let publicKey;
                try {
                  publicKey = createPublicKey({ key, format: "der", type: "spki" });
                } catch {
                  publicKey = createPublicKey({ key, format: "der", type: "pkcs1" });
                }
                signature = verifySignature(
                  "sha256",
                  signed,
                  publicKey,
                  bytes.subarray(signatureDataStart, signatureDataEnd),
                )
                  ? "verified"
                  : "mismatch";
                if (signature === "mismatch") {
                  error("signature-mismatch", "the signature does not verify against the file");
                }
              } catch (exc) {
                signature = "unverified";
                warn(
                  "signature-unverified",
                  `the signature section is well-formed but Node cannot parse its key: ${(exc as Error).message}`,
                );
              }
            }
          }
        }
      }
    }
  }

  return {
    version: archive.version,
    entryCount: archive.entries.length,
    archiveCount: referenced.length,
    dirBytes: archive.bytes.length,
    dataBytes: archive.entries.reduce((sum, entry) => sum + entry.length, 0),
    archives,
    md5: md5State,
    signature,
    crc,
    issues,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    ok: issues.every((issue) => issue.severity !== "error"),
  };
}
