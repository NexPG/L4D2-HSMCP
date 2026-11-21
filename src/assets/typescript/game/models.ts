/**
 * `.mdl` + `.vvd` + `.vtx` out of the game's VPKs, and the material each mesh draws with.
 *
 * `read_game_content` names a model; this opens the three binary siblings and returns the
 * LOD-0 triangles. The header's material list is a path (`models/props_junk/wood_crate001a`),
 * not a VMT, so the renderer prefixes `materials/` and resolves `$basetexture` exactly as it
 * does for a brush.
 */
import type { GameVpk } from "./vpkcontent.js";
import { materialTexture } from "./vpkcontent.js";
import { materialIndexForSkin, parseModelGeometry } from "../../../models/typescript/formats/mdlmesh.js";
import type { ModelGeometry } from "../../../models/typescript/formats/mdlmesh.js";
import type { MaterialTexture } from "./vpkcontent.js";

/** Where the three files of a model are, from its `.mdl` path. */
export function modelSiblings(mdlPath: string): { vvd: string; vtx: string[] } {
  const base = mdlPath.replace(/\\/g, "/").replace(/\.mdl$/i, "");
  // Left 4 Dead 2 ships `.dx90.vtx`; the others exist for older/other branches and for a
  // `.dx90` whose checksum belongs to a different MDL. The order is the one the engine and
  // Crowbar use, most capable first.
  return {
    vvd: `${base}.vvd`,
    vtx: [
      `${base}.dx11.vtx`,
      `${base}.dx90.vtx`,
      `${base}.dx80.vtx`,
      `${base}.sw.vtx`,
      `${base}.vtx`,
    ],
  };
}

/** Loads and parses a model's geometry, or null when any of the three files is missing. */
export function loadGameModel(vpk: GameVpk, mdlPath: string): ModelGeometry | null {
  const normalized = mdlPath.replace(/\\/g, "/");
  const mdl = vpk.read(normalized);
  if (!mdl) return null;
  const siblings = modelSiblings(normalized);
  const vvd = vpk.read(siblings.vvd);
  if (!vvd) return null;
  for (const candidate of siblings.vtx) {
    const vtx = vpk.read(candidate);
    if (!vtx) continue;
    // A checksum mismatch means this VTX belongs to another build of the model; try the
    // next one rather than refusing the model outright.
    const geometry = parseModelGeometry(mdl, vvd, vtx);
    if (geometry) return geometry;
  }
  return null;
}

/** A model material's VMT path: `models/x` means `materials/models/x.vmt`. */
export function modelMaterialPath(material: string): string {
  const clean = material.replace(/\\/g, "/").replace(/\.vmt$/i, "");
  if (/^materials\//i.test(clean)) return clean.replace(/^materials\//i, "");
  return clean;
}

export interface ModelTextureSet {
  geometry: ModelGeometry;
  /** Decoded base textures by material index; null when the VMT/VTF is missing. */
  textures: Array<MaterialTexture | null>;
  /** Material path per mesh after the skin remap, for reporting. */
  meshMaterials: string[];
}

/**
 * Loads a model once and resolves every material it can under the prop's skin.
 *
 * A missing VMT or VTF is a null entry rather than a failure: the renderer then falls back
 * to the stable material colour, which is the same rule a brush face follows.
 */
export function loadModelTextures(vpk: GameVpk, mdlPath: string, skin: number): ModelTextureSet | null {
  const geometry = loadGameModel(vpk, mdlPath);
  if (!geometry) return null;
  const cache = new Map<number, MaterialTexture | null>();
  const textures: Array<MaterialTexture | null> = [];
  const meshMaterials: string[] = [];
  for (const mesh of geometry.meshes) {
    const index = materialIndexForSkin(geometry, mesh.materialIndex, skin);
    const material = geometry.materials[index] ?? geometry.materials[mesh.materialIndex] ?? "";
    meshMaterials.push(material);
    if (!cache.has(index)) {
      cache.set(index, material ? materialTexture(vpk, modelMaterialPath(material)) : null);
    }
    textures.push(cache.get(index) ?? null);
  }
  return { geometry, textures, meshMaterials };
}
