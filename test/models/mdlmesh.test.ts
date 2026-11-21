/**
 * MDL/VVD/VTX geometry, and the material path the header means.
 *
 * `hospital_bed.mdl` is version 49: one body part, one mesh, 1,261 vertices and 900
 * triangles. Its material is the bare name `hospital_bed`, so the directory table has to
 * supply `models/props_unique/hospital/`; without it every model texture lookup is a miss.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGameModel, loadModelTextures, modelMaterialPath, modelSiblings } from "../../src/assets/typescript/game/models.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { ctx, has } from "../support/env.js";

const hasVpk = has.gameContent;

describe.skipIf(!hasVpk)("model geometry", () => {
  const vpk = (): ReturnType<typeof openGameVpk> => openGameVpk(ctx.config.gameDir!);

  it("parses a version-49 model into LODs", () => {
    const archive = vpk()!;
    const geometry = loadGameModel(archive, "models/props_unique/hospital/hospital_bed.mdl");
    expect(geometry).not.toBeNull();
    expect(geometry!.meshes.length).toBe(1);
    expect(geometry!.vertexCount).toBe(1261);
    expect(geometry!.triangleCount).toBe(900);
    expect(geometry!.materials).toEqual(["models/props_unique/hospital/hospital_bed"]);
    expect(geometry!.meshes[0]!.triangles.length).toBe(900 * 3);
    expect(geometry!.vtxTopology).toBe(true);
    expect(geometry!.lods.map((lod) => lod.switchDistance)).toEqual([0, 25, 50]);
    expect(geometry!.lods.map((lod) => lod.triangleCount)).toEqual([900, 618, 409]);
    const vertex = geometry!.meshes[0]!.vertices[0]!;
    expect(vertex.position.every(Number.isFinite)).toBe(true);
    expect(vertex.normal.every(Number.isFinite)).toBe(true);
  });

  it("reads every bodygroup alternative at LOD 0", () => {
    const archive = vpk()!;
    const glass = loadGameModel(archive, "models/brokenglass_piece.mdl")!;
    expect(glass.bodyParts).toHaveLength(1);
    expect(glass.bodyParts[0]!.models).toHaveLength(3);
    expect(glass.bodyParts[0]!.models.map((model) => model.triangleCount)).toEqual([12, 12, 12]);
    expect(
      glass.bodyParts[0]!.models.map((model) =>
        model.meshes.reduce((sum, mesh) => sum + mesh.vertices.length, 0),
      ),
    ).toEqual([24, 24, 24]);

    const door = loadGameModel(archive, "models/props_doors/doordm_rural01_01.mdl")!;
    expect(door.bodyParts).toHaveLength(2);
    expect(door.bodyParts[1]!.models).toHaveLength(3);
    expect(door.bodyParts[1]!.models.map((model) => model.triangleCount)).toEqual([
      460, 558, 558,
    ]);
    // `meshes` still means model 0 of each part, which is what the preview and the
    // non-bodygroup QC path draw.
    expect(door.meshes.length).toBe(2);
    expect(door.triangleCount).toBe(1916);

    // A bodygroup value can be empty: the model record exists with no vertices.
    const checkpoint = loadGameModel(archive, "models/props_doors/checkpoint_door_01.mdl")!;
    expect(checkpoint.bodyParts).toHaveLength(2);
    expect(checkpoint.bodyParts[1]!.models).toHaveLength(2);
    expect(checkpoint.bodyParts[1]!.models[0]!.triangleCount).toBe(0);
    expect(checkpoint.bodyParts[1]!.models[0]!.meshes).toHaveLength(0);
    expect(checkpoint.bodyParts[1]!.models[1]!.triangleCount).toBeGreaterThan(0);
  });

  it("resolves the model material through its directory", () => {
    const archive = vpk()!;
    const set = loadModelTextures(archive, "models/props_vehicles/cara_84sedan.mdl", 0);
    expect(set).not.toBeNull();
    expect(set!.meshMaterials[0]).toMatch(/^models\/props_vehicles\//);
    expect(set!.textures[0]).not.toBeNull();
    expect(set!.textures[0]!.width).toBeGreaterThan(1);
  });

  it("carries alpha and the cutout flag for foliage", () => {
    const archive = vpk()!;
    const set = loadModelTextures(archive, "models/props_foliage/urban_trees_dryleaves01.mdl", 0);
    expect(set).not.toBeNull();
    // Two materials share one directory entry; the second must not fall back to a bare name.
    expect(set!.meshMaterials).toHaveLength(2);
    expect(set!.meshMaterials[1]).toMatch(/^models\/props_foliage\//);
    const leaves = set!.textures[0]!;
    expect(leaves.alpha).toBeDefined();
    expect(leaves.alpha!.length).toBe(leaves.width * leaves.height);
    expect(leaves.alphaTest).toBe(true);
  });

  it("reorders VVD vertices through the LOD-0 fixup table", () => {
    const archive = vpk()!;
    const path = "models/props/cs_office/shelves_metal1.mdl";
    const geometry = loadGameModel(archive, path);
    expect(geometry).not.toBeNull();
    expect(geometry!.fixupCount).toBeGreaterThan(0);
    expect(geometry!.lods.map((lod) => lod.switchDistance)).toEqual([0, 30, 70]);
    expect(geometry!.lods.map((lod) => lod.triangleCount)).toEqual([1194, 811, 325]);
    // The first fixup covers raw 0..344; the second starts at raw 569, so fixed index 345
    // must be raw 569 — not raw 345, which has a different position.
    const vvd = archive.read(path.replace(/\.mdl$/i, ".vvd"))!;
    const verticesOffset = vvd.readInt32LE(56);
    const raw = (index: number): number[] => [
      vvd.readFloatLE(verticesOffset + index * 48 + 16),
      vvd.readFloatLE(verticesOffset + index * 48 + 20),
      vvd.readFloatLE(verticesOffset + index * 48 + 24),
    ];
    const fixed = geometry!.meshes[0]!.vertices[345]!.position;
    const raw569 = raw(569);
    const raw345 = raw(345);
    expect(fixed[0]).toBeCloseTo(raw569[0]!, 4);
    expect(fixed[1]).toBeCloseTo(raw569[1]!, 4);
    expect(fixed[2]).toBeCloseTo(raw569[2]!, 4);
    expect(fixed[0]).not.toBeCloseTo(raw345[0]!, 4);
  });

  it("prefers .dx90 and falls back through the other VTX variants", () => {
    expect(modelSiblings("models/foo/bar.mdl").vtx).toEqual([
      "models/foo/bar.dx11.vtx",
      "models/foo/bar.dx90.vtx",
      "models/foo/bar.dx80.vtx",
      "models/foo/bar.sw.vtx",
      "models/foo/bar.vtx",
    ]);
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
