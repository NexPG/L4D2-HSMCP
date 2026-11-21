/**
 * MDL/VVD/VTX geometry, and the material path the header means.
 *
 * `hospital_bed.mdl` is version 49: one body part, one mesh, 1,261 vertices and 900
 * triangles. Its material is the bare name `hospital_bed`, so the directory table has to
 * supply `models/props_unique/hospital/`; without it every model texture lookup is a miss.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGameModel, loadModelTextures, modelMaterialPath } from "../../src/assets/typescript/game/models.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { ctx, has } from "../support/env.js";

const hasVpk = has.gameContent;

describe.skipIf(!hasVpk)("model geometry", () => {
  const vpk = (): ReturnType<typeof openGameVpk> => openGameVpk(ctx.config.gameDir!);

  it("parses a version-49 model into LOD-0 triangles", () => {
    const archive = vpk()!;
    const geometry = loadGameModel(archive, "models/props_unique/hospital/hospital_bed.mdl");
    expect(geometry).not.toBeNull();
    expect(geometry!.meshes.length).toBe(1);
    expect(geometry!.vertexCount).toBe(1261);
    expect(geometry!.triangleCount).toBe(900);
    expect(geometry!.materials).toEqual(["models/props_unique/hospital/hospital_bed"]);
    expect(geometry!.meshes[0]!.triangles.length).toBe(900 * 3);
    const vertex = geometry!.meshes[0]!.vertices[0]!;
    expect(vertex.position.every(Number.isFinite)).toBe(true);
    expect(vertex.normal.every(Number.isFinite)).toBe(true);
  });

  it("resolves the model material through its directory", () => {
    const archive = vpk()!;
    const set = loadModelTextures(archive, "models/props_vehicles/cara_84sedan.mdl", 0);
    expect(set).not.toBeNull();
    expect(set!.meshMaterials[0]).toMatch(/^models\/props_vehicles\//);
    expect(set!.textures[0]).not.toBeNull();
    expect(set!.textures[0]!.width).toBeGreaterThan(1);
  });

  it("prefixes a bare material with materials/ and keeps a full path as is", () => {
    expect(modelMaterialPath("models/props_junk/wood_crate001a")).toBe(
      "models/props_junk/wood_crate001a",
    );
    expect(modelMaterialPath("materials/models/props_junk/crate.vmt")).toBe(
      "models/props_junk/crate",
    );
  });
});
