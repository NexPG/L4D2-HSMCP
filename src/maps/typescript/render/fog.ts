/**
 * Distance fog, from the map's `env_fog_controller`.
 *
 * A compiled map does not have one fog; L4D2 maps carry many controllers and a
 * `fog_volume` entity decides which one is active where. The volume's `FogName` names a
 * controller's `targetname`, so the renderer picks the volume containing the camera, then
 * the controller with that name. When no volume contains the camera, the nearest enabled
 * controller is used, which is what the engine falls back to.
 *
 * Fog is linear between `fogstart` and `fogend`, scaled by `fogmaxdensity`. The scene's
 * depth buffer stores `1/z`, so the distance is `1/invDepth` per pixel.
 */
import { readAt, readHeader } from "../bsp/header.js";
import { readEntityLump } from "../bsp/entities.js";
import type { MapEntity } from "../entity/model.js";
import type { Framebuffer } from "./raster.js";

export interface FogSettings {
  /** World-space distance where fog starts. */
  start: number;
  /** World-space distance where it is at full density. */
  end: number;
  color: [number, number, number];
  /** `fogmaxdensity`, 0..1. */
  maxDensity: number;
  /** `targetname` of the controller that supplied these values. */
  name: string | null;
}

export interface FogChoice {
  fog: FogSettings | null;
  /** How many volumes contained the camera; more than one means the smallest won. */
  volumes: number;
}

function kv(entity: MapEntity, key: string): string | undefined {
  for (const [k, v] of entity.keyvalues) if (k.toLowerCase() === key.toLowerCase()) return v;
  return undefined;
}

function numberOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function colorOr(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!value) return fallback;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return fallback;
  return [
    Math.max(0, Math.min(255, parts[0]!)),
    Math.max(0, Math.min(255, parts[1]!)),
    Math.max(0, Math.min(255, parts[2]!)),
  ];
}

interface Box {
  mins: [number, number, number];
  maxs: [number, number, number];
}

function readModelBoxes(path: string): Box[] {
  const header = readHeader(path);
  const lump = header.lumps[14];
  if (!lump || lump.length === 0) return [];
  const bytes = readAt(path, lump.offset, lump.length);
  const boxes: Box[] = [];
  for (let at = 0; at + 48 <= bytes.length; at += 48) {
    boxes.push({
      mins: [bytes.readFloatLE(at), bytes.readFloatLE(at + 4), bytes.readFloatLE(at + 8)],
      maxs: [bytes.readFloatLE(at + 12), bytes.readFloatLE(at + 16), bytes.readFloatLE(at + 20)],
    });
  }
  return boxes;
}

function contains(box: Box, point: readonly [number, number, number]): boolean {
  return (
    point[0] >= box.mins[0] &&
    point[0] <= box.maxs[0] &&
    point[1] >= box.mins[1] &&
    point[1] <= box.maxs[1] &&
    point[2] >= box.mins[2] &&
    point[2] <= box.maxs[2]
  );
}

function boxVolume(box: Box): number {
  return (
    Math.max(0, box.maxs[0] - box.mins[0]) *
    Math.max(0, box.maxs[1] - box.mins[1]) *
    Math.max(0, box.maxs[2] - box.mins[2])
  );
}

function settings(entity: MapEntity): FogSettings | null {
  if (kv(entity, "fogenable") === "0") return null;
  const start = numberOr(kv(entity, "fogstart"), 0);
  const end = numberOr(kv(entity, "fogend"), 0);
  if (!(end > start)) return null;
  return {
    start,
    end,
    color: colorOr(kv(entity, "fogcolor"), [128, 128, 128]),
    maxDensity: Math.max(0, Math.min(1, numberOr(kv(entity, "fogmaxdensity"), 1))),
    name: kv(entity, "targetname") ?? null,
  };
}

/**
 * Picks the fog a camera sees.
 *
 * A `fog_volume` is a brush model, so its bounding box is a conservative test: a camera just
 * outside a concave volume's box misses it, and one in a hole inside the box gets its fog.
 * That is the right trade for a picture: missing fog is visible as a wrong picture, while
 * applying a room's fog from inside its own bounding box is what the volume is for.
 */
export function readFogFor(path: string, point: readonly [number, number, number]): FogChoice {
  let entities: MapEntity[];
  try {
    entities = readEntityLump(path).entities;
  } catch {
    return { fog: null, volumes: 0 };
  }
  const controllers = entities.filter((entity) => entity.classname === "env_fog_controller");
  const enabled = controllers
    .map((entity) => ({ entity, fog: settings(entity) }))
    .filter((row): row is { entity: MapEntity; fog: FogSettings } => row.fog !== null);
  if (enabled.length === 0) return { fog: null, volumes: 0 };

  const byName = new Map<string, { entity: MapEntity; fog: FogSettings }[]>();
  for (const row of enabled) {
    if (!row.fog.name) continue;
    const list = byName.get(row.fog.name) ?? [];
    list.push(row);
    byName.set(row.fog.name, list);
  }

  let boxes: Box[] = [];
  const volumes: Array<{ box: Box; fogName: string }> = [];
  const fogVolumes = entities.filter((entity) => entity.classname === "fog_volume");
  if (fogVolumes.length > 0) {
    boxes = readModelBoxes(path);
    for (const volume of fogVolumes) {
      if (kv(volume, "StartDisabled") === "1") continue;
      const model = kv(volume, "model");
      const fogName = kv(volume, "FogName");
      if (!model || !fogName || !model.startsWith("*")) continue;
      const index = Number.parseInt(model.slice(1), 10);
      const box = boxes[index];
      if (box && contains(box, point)) volumes.push({ box, fogName });
    }
  }

  if (volumes.length > 0) {
    volumes.sort((a, b) => boxVolume(a.box) - boxVolume(b.box));
    const name = volumes[0]!.fogName;
    const candidates = byName.get(name) ?? [];
    if (candidates.length > 0) {
      // Several controllers can share a targetname; the nearest origin is the one the map
      // author placed for this volume.
      const nearest = candidates
        .map((row) => {
          const origin = (kv(row.entity, "origin") ?? "").trim().split(/\s+/).map(Number);
          const distance =
            origin.length === 3 && origin.every(Number.isFinite)
              ? Math.hypot(origin[0]! - point[0], origin[1]! - point[1], origin[2]! - point[2])
              : Infinity;
          return { row, distance };
        })
        .sort((a, b) => a.distance - b.distance)[0]!;
      return { fog: nearest.row.fog, volumes: volumes.length };
    }
  }

  // No volume names a controller here: the nearest enabled controller is the best answer.
  const nearest = enabled
    .map((row) => {
      const origin = (kv(row.entity, "origin") ?? "").trim().split(/\s+/).map(Number);
      const distance =
        origin.length === 3 && origin.every(Number.isFinite)
          ? Math.hypot(origin[0]! - point[0], origin[1]! - point[1], origin[2]! - point[2])
          : Infinity;
      return { row, distance };
    })
    .sort((a, b) => a.distance - b.distance)[0]!;
  return { fog: nearest.row.fog, volumes: volumes.length };
}

/** Blends fog into a rendered frame, using the per-pixel `1/z` depth buffer. */
export function applyFog(fb: Framebuffer, fog: FogSettings): number {
  const span = fog.end - fog.start;
  let touched = 0;
  for (let i = 0; i < fb.width * fb.height; i += 1) {
    const inv = fb.invDepth[i]!;
    if (inv <= 0) continue;
    const distance = 1 / inv;
    let factor = (distance - fog.start) / span;
    if (factor <= 0) continue;
    if (factor > 1) factor = 1;
    factor *= fog.maxDensity;
    if (factor <= 0) continue;
    const at = i * 3;
    fb.rgb[at] = Math.round(fb.rgb[at]! * (1 - factor) + fog.color[0] * factor);
    fb.rgb[at + 1] = Math.round(fb.rgb[at + 1]! * (1 - factor) + fog.color[1] * factor);
    fb.rgb[at + 2] = Math.round(fb.rgb[at + 2]! * (1 - factor) + fog.color[2] * factor);
    touched += 1;
  }
  return touched;
}
