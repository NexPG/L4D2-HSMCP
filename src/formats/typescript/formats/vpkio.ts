/**
 * Opening a `.vpk` from disk, shared by the reader and the verifier.
 *
 * The directory file is parsed once; numbered archives are read lazily and cached, because a
 * full game VPK can be several gigabytes and a caller that only lists names must not pay for
 * the data. `read_vpk` and `verify_vpk` use the same loader so "archive 3 is missing" means
 * the same file on both paths.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { readVpk, vpkArchivePath, vpkDirPath } from "./vpk.js";
import type { VpkArchive } from "./vpk.js";

export interface OpenVpk {
  archive: VpkArchive;
  /** The `_dir.vpk` path, resolved from either a dir or a numbered archive path. */
  dirPath: string;
  /** Reads a numbered archive beside the directory file, or undefined when it is absent. */
  openArchive: (index: number) => Buffer | undefined;
  /** Checks presence and size without reading the data; a game archive can be gigabytes. */
  statArchive: (index: number) => { present: boolean; bytes: number };
  /** The path a numbered archive would have, whether or not it exists. */
  archivePath: (index: number) => string;
}

/** Opens a directory VPK, accepting a `_000.vpk` path as the same archive. */
export function openVpk(path: string): OpenVpk {
  const dirPath = vpkDirPath(path);
  const archive = readVpk(readFileSync(dirPath), dirPath);
  const cache = new Map<number, Buffer | undefined>();
  const sizes = new Map<number, { present: boolean; bytes: number }>();
  const archivePath = (index: number): string => vpkArchivePath(dirPath, index);
  return {
    archive,
    dirPath,
    archivePath,
    statArchive: (index) => {
      const cached = sizes.get(index);
      if (cached) return cached;
      const p = archivePath(index);
      const info = existsSync(p) ? { present: true, bytes: statSync(p).size } : { present: false, bytes: 0 };
      sizes.set(index, info);
      return info;
    },
    openArchive: (index) => {
      if (!cache.has(index)) {
        const p = archivePath(index);
        cache.set(index, existsSync(p) ? readFileSync(p) : undefined);
      }
      return cache.get(index);
    },
  };
}
