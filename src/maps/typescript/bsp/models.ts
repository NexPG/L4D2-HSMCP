/**
 * Brush-model bounds from a compiled BSP.
 *
 * A brush entity (`func_water_analog`, `func_nav_blocker`, a door made of brushes) has no
 * `origin`; its keyvalues name a `*N` model. The model lump carries the world-space mins/maxs
 * that the entity's brushes occupy, which is what a plan needs to place the volume.
 *
 * `dmodel_t` is 48 bytes: `Vector mins, maxs, origin; int headnode; int firstface, numfaces`.
 * That is `src/public/bspfile.h` in source-sdk-2013, read 2026-11-27 — the first version of
 * this reader assumed 64 and read denormal garbage from every model after the world.
 */
import { LUMP_MODELS, readAt, readHeader } from "./header.js";

const MODEL_BYTES = 48;

type Vec3 = [number, number, number];

export interface BspModel {
  index: number;
  mins: Vec3;
  maxs: Vec3;
  origin: Vec3;
  firstFace: number;
  faceCount: number;
}

export interface BspModels {
  path: string;
  models: BspModel[];
}

export function readModels(path: string, limit = 8192): BspModels {
  const header = readHeader(path);
  const lump = header.lumps[LUMP_MODELS];
  if (!lump || lump.length === 0) return { path, models: [] };
  const count = Math.min(limit, Math.floor(lump.length / MODEL_BYTES));
  const raw = readAt(path, lump.offset, count * MODEL_BYTES);
  const models: BspModel[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = index * MODEL_BYTES;
    const mins: Vec3 = [raw.readFloatLE(at), raw.readFloatLE(at + 4), raw.readFloatLE(at + 8)];
    const maxs: Vec3 = [raw.readFloatLE(at + 12), raw.readFloatLE(at + 16), raw.readFloatLE(at + 20)];
    const origin: Vec3 = [raw.readFloatLE(at + 24), raw.readFloatLE(at + 28), raw.readFloatLE(at + 32)];
    models.push({
      index, mins, maxs, origin,
      firstFace: raw.readInt32LE(at + 40),
      faceCount: raw.readInt32LE(at + 44),
    });
  }
  return { path, models };
}
