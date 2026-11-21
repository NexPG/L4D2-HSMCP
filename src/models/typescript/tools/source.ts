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
