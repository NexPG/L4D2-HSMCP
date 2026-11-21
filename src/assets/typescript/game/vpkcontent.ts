/**
 * Reading material bytes out of the game's `pak01_dir.vpk` without mounting a VPK.
 *
 * The renderer needs actual VMT/VTF bytes; `read_game_content` names assets but does not hand
 * back a texture. This opens the directory archive, maps entries case-insensitively, and reads
 * one entry's numbered chunk at its offset. It is deliberately a small reader, not a general
 * VPK mount.
 */
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { VPK_DIR_INDEX, readVpk, vpkArchivePath } from "../../../formats/typescript/formats/vpk.js";
import type { VpkArchive, VpkEntry } from "../../../formats/typescript/formats/vpk.js";
import { decodeVtf } from "../../../textures/typescript/formats/vtfdecode.js";
import type { DecodedVtf } from "../../../textures/typescript/formats/vtfdecode.js";

export interface GameVpk {
  path: string;
  entry(path: string): VpkEntry | null;
  read(path: string): Buffer | null;
}

export function openGameVpk(gameDir: string): GameVpk | null {
  const dirPath = join(gameDir, "pak01_dir.vpk");
  let archive: VpkArchive;
  try {
    archive = readVpk(readFileSync(dirPath), dirPath);
  } catch {
    return null;
  }
  const byPath = new Map<string, VpkEntry>();
  for (const entry of archive.entries) byPath.set(entry.path.toLowerCase(), entry);

  return {
    path: dirPath,
    entry: (path) => byPath.get(path.toLowerCase()) ?? null,
    read: (path) => {
      const entry = byPath.get(path.toLowerCase());
      if (!entry) return null;
      let data: Buffer;
      if (entry.archiveIndex === VPK_DIR_INDEX) {
        const start = archive.fileDataOffset + entry.offset;
        const end = start + entry.storedLength;
        if (end > archive.bytes.length) return null;
        data = archive.bytes.subarray(start, end);
      } else {
        const chunk = vpkArchivePath(dirPath, entry.archiveIndex);
        try {
          const fd = openSync(chunk, "r");
          try {
            data = Buffer.alloc(entry.storedLength);
            readSync(fd, data, 0, entry.storedLength, entry.offset);
          } finally {
            closeSync(fd);
          }
        } catch {
          return null;
        }
      }
      return entry.preload.length ? Buffer.concat([entry.preload, data]) : data;
    },
  };
}

/** A decoded base texture plus what its VMT says about alpha. */
export interface MaterialTexture extends DecodedVtf {
  /** `$alphatest` or `$translucent`: the alpha channel is a cutout, not decoration. */
  alphaTest: boolean;
}

/** The material's base texture, decoded from its VMT and VTF. Null when anything is missing. */
export function materialTexture(vpk: GameVpk, material: string): MaterialTexture | null {
  const vmtPath = `materials/${material.replace(/\\/g, "/").replace(/\.vmt$/i, "")}.vmt`;
  const vmtBytes = vpk.read(vmtPath);
  if (!vmtBytes) return null;
  const vmt = vmtBytes.toString("latin1");
  const match = /\$basetexture\s+"?([^"\r\n]+)"?/i.exec(vmt);
  const base = match?.[1]?.trim().replace(/\\/g, "/");
  if (!base) return null;
  const texture = base.replace(/^materials\//i, "").replace(/\.vtf$/i, "");
  const vtfBytes = vpk.read(`materials/${texture}.vtf`);
  if (!vtfBytes) return null;
  const decoded = decodeVtf(vtfBytes);
  if (!decoded) return null;
  // `$alphatest` is a cutout; `$translucent` and `$blendTintByBaseAlpha` also put meaning in
  // alpha. A material with an alpha channel but none of these is opaque artwork.
  const alphaTest = /\$(alphatest|translucent|blendtintbybasealpha)\s+(?!0\b)\S+/i.test(vmt);
  return { ...decoded, alphaTest };
}
