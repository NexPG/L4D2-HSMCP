/**
 * Shared model-file loading for the inspection tools.
 *
 * `read_model_collision`, `read_model_skeleton` and `read_model_animation` all accept the
 * same two forms: an engine path resolved through the game's VPK, or a local file. Keeping
 * the resolution in one place means the `models/` prefix and the `.mdl` suffix cannot be
 * added twice in one tool and forgotten in another.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openGameVpk } from "../../../assets/typescript/game/vpkcontent.js";
import { modelSiblings } from "../../../assets/typescript/game/models.js";
import { parseModelGeometry } from "../formats/mdlmesh.js";
import type { ModelGeometry } from "../formats/mdlmesh.js";
import { readMdlBones } from "../formats/mdlbones.js";
import type { ModelBone } from "../formats/mdlbones.js";

export function normalizeModelPath(model: string): string {
  let path = model.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path.toLowerCase().endsWith(".mdl")) path += ".mdl";
  if (!path.toLowerCase().startsWith("models/")) path = `models/${path}`;
  return path;
}

export function looseOrVpk(gameDir: string, path: string): Buffer | null {
  const loose = join(gameDir, path);
  if (existsSync(loose)) return readFileSync(loose);
  return openGameVpk(gameDir)?.read(path) ?? null;
}

/** Reads an absolute or root-relative local file first, then falls back to the game VPK. */
export function readModelBytes(gameDir: string | null, path: string): Buffer | null {
  if (existsSync(path)) return readFileSync(path);
  return gameDir ? looseOrVpk(gameDir, path) : null;
}

/**
 * Loads a model's geometry by engine path, resolving every sibling loose-first.
 *
 * `loadGameModel` in the assets module reads from a VPK; this one also finds a locally
 * compiled model, which is what the LOD/procedural inspectors are pointed at in practice.
 */
export function loadModelGeometry(gameDir: string, modelPath: string): ModelGeometry | null {
  const mdl = readModelBytes(gameDir, modelPath);
  if (!mdl) return null;
  const siblings = modelSiblings(modelPath);
  const vvd = readModelBytes(gameDir, siblings.vvd);
  if (!vvd) return null;
  for (const candidate of siblings.vtx) {
    const vtx = readModelBytes(gameDir, candidate);
    if (!vtx) continue;
    const geometry = parseModelGeometry(mdl, vvd, vtx);
    if (geometry) return geometry;
  }
  return null;
}

/** Reads a model's bind-pose bone records, loose-first, for the LOD bone flags. */
export function loadModelBones(gameDir: string | null, modelPath: string): ModelBone[] | null {
  const mdl = readModelBytes(gameDir, modelPath);
  return mdl ? readMdlBones(mdl) : null;
}
