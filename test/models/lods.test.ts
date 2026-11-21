/**
 * LOD chains: switch distances, counts and per-LOD materials.
 *
 * `hospital_bed` has three LODs (0/25/50) and `hgibs` has a shadow LOD with a negative
 * switch distance. Both are stock, so the test also catches a reader that starts returning
 * plausible but wrong distances.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readModelLodsTool } from "../../src/models/typescript/tools/lods.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

describe.skipIf(!has.gameContent)("read_model_lods", () => {
  it("reports hospital_bed's three LODs", async () => {
    const r = (await readModelLodsTool.handler(
      { model: "props_unique/hospital/hospital_bed.mdl" } as never,
      ctx,
    )) as {
      lodCount: number;
      lods: Array<{
        level: number;
        switchDistance: number;
        shadow: boolean;
        meshes: number;
        vertices: number;
        triangles: number;
        materials: string[];
        facial: boolean;
        materialReplacements: Array<{ from: string; to: string }>;
        boneReplacements: Array<{ from: string; to: string }>;
        removedModels: string[];
      }>;
    };
    expect(r.lodCount).toBe(3);
    expect(r.lods.map((lod) => lod.switchDistance)).toEqual([0, 25, 50]);
    expect(r.lods.every((lod) => !lod.shadow)).toBe(true);
    expect(r.lods[0]!.triangles).toBeGreaterThan(r.lods[1]!.triangles);
    expect(r.lods[1]!.triangles).toBeGreaterThan(r.lods[2]!.triangles);
    expect(r.lods[0]!.materials.length).toBeGreaterThan(0);
    expect(r.lods[0]!.materials[0]).toContain("hospital_bed");
    expect(r.lods.every((lod) => !lod.facial)).toBe(true);
    expect(r.lods.every((lod) => lod.materialReplacements.length === 0)).toBe(true);
    expect(r.lods.every((lod) => lod.boneReplacements.length === 0)).toBe(true);
    expect(r.lods.every((lod) => lod.removedModels.length === 0)).toBe(true);
  });

  it("reports the survivor's facial LODs and bone replacements", async () => {
    const r = (await readModelLodsTool.handler(
      { model: "survivors/survivor_producer.mdl" } as never,
      ctx,
    )) as {
      lods: Array<{
        level: number;
        switchDistance: number;
        facial: boolean;
        boneReplacements: Array<{ from: string; to: string }>;
        materialReplacements: Array<{ from: string; to: string }>;
      }>;
    };
    expect(r.lods.map((lod) => lod.switchDistance)).toEqual([0, 10, 15, 40]);
    expect(r.lods.map((lod) => lod.facial)).toEqual([true, true, true, false]);
    expect(r.lods[0]!.boneReplacements).toEqual([]);
    expect(r.lods[1]!.boneReplacements.length).toBeGreaterThan(0);
    expect(r.lods[3]!.boneReplacements.length).toBeGreaterThan(r.lods[1]!.boneReplacements.length);
    expect(r.lods[1]!.boneReplacements[0]).toHaveProperty("from");
    expect(r.lods[1]!.boneReplacements[0]).toHaveProperty("to");
  });

  it("reports hgibs' shadow LOD", async () => {
    const r = (await readModelLodsTool.handler(
      { model: "gibs/hgibs.mdl" } as never,
      ctx,
    )) as { lodCount: number; lods: Array<{ switchDistance: number; shadow: boolean }> };
    expect(r.lodCount).toBeGreaterThanOrEqual(2);
    expect(r.lods.some((lod) => lod.shadow && lod.switchDistance < 0)).toBe(true);
  });
});
