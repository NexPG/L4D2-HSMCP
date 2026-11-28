/**
 * The stock model catalog answers the placement question: which model is the right size,
 * has collision and can be a `prop_static`. The test pins the facts the tool reads from the
 * MDL header and the `.phy` sibling, not a count that a game update would change.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readModelCatalogTool } from "../../src/assets/typescript/tools/modelcatalog.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

type Row = {
  path: string;
  size: [number, number, number];
  maxDimension: number;
  staticProp: boolean;
  hasPhysics: boolean;
  surfaceProp: string | null;
  materialCount: number;
  materials: string[];
  materialsTruncated: boolean;
};

type Catalog = {
  scanned: number;
  total: number;
  returned: number;
  offset: number;
  nextOffset: number | null;
  models: Row[];
  warnings: string[];
};

describe.skipIf(!has.gameContent)("read_model_catalog", () => {
  it("reads a model's hull, flags, physics and materials", async () => {
    const r = (await readModelCatalogTool.handler(
      { pattern: "props_junk/gascan", limit: 5 } as never,
      ctx,
    )) as unknown as Catalog;
    expect(r.total).toBeGreaterThanOrEqual(1);
    const gascan = r.models.find((model) => model.path.endsWith("gascan001a.mdl"));
    expect(gascan).toBeDefined();
    expect(gascan!.staticProp).toBe(false);
    expect(gascan!.hasPhysics).toBe(true);
    expect(gascan!.surfaceProp).toBe("metal");
    expect(gascan!.maxDimension).toBeGreaterThan(0);
    expect(gascan!.size).toHaveLength(3);
    expect(gascan!.materialCount).toBeGreaterThan(0);
    expect(gascan!.materials.length).toBeGreaterThan(0);
  }, 60_000);

  it("filters by size, the static-prop flag and a material name", async () => {
    const doors = (await readModelCatalogTool.handler(
      {
        pattern: "props_doors/checkpoint_door",
        minDimension: 100,
        maxDimension: 110,
        limit: 20,
      } as never,
      ctx,
    )) as unknown as Catalog;
    expect(doors.total).toBeGreaterThan(1);
    for (const model of doors.models) {
      expect(model.maxDimension).toBeGreaterThanOrEqual(100);
      expect(model.maxDimension).toBeLessThanOrEqual(110);
    }

    const statics = (await readModelCatalogTool.handler(
      { pattern: "props_doors/checkpoint_door", staticProp: true, limit: 20 } as never,
      ctx,
    )) as unknown as Catalog;
    expect(statics.total).toBeGreaterThan(0);
    expect(statics.models.every((model) => model.staticProp)).toBe(true);

    const material = (await readModelCatalogTool.handler(
      { pattern: "gascan", material: "phys_objects02a", limit: 5 } as never,
      ctx,
    )) as unknown as Catalog;
    expect(material.models.some((model) => model.path.endsWith("gascan001a.mdl"))).toBe(true);
  }, 60_000);

  it("pages deterministically and can omit the material list", async () => {
    const first = (await readModelCatalogTool.handler(
      { pattern: "props_doors/checkpoint_door", sort: "size", order: "desc", limit: 1 } as never,
      ctx,
    )) as unknown as Catalog;
    const second = (await readModelCatalogTool.handler(
      {
        pattern: "props_doors/checkpoint_door",
        sort: "size",
        order: "desc",
        limit: 1,
        offset: 1,
      } as never,
      ctx,
    )) as unknown as Catalog;
    expect(first.nextOffset).toBe(1);
    expect(second.offset).toBe(1);
    expect(first.models[0]!.path).not.toBe(second.models[0]!.path);
    expect(first.models[0]!.maxDimension).toBeGreaterThanOrEqual(second.models[0]!.maxDimension);

    const noMaterials = (await readModelCatalogTool.handler(
      { pattern: "gascan", includeMaterials: false, limit: 1 } as never,
      ctx,
    )) as unknown as Catalog;
    expect(noMaterials.models[0]!.materials).toEqual([]);
    expect(noMaterials.models[0]!.materialCount).toBeGreaterThan(0);
  }, 60_000);

  it("returns an empty page for a name that does not exist", async () => {
    const r = (await readModelCatalogTool.handler(
      { pattern: "no_such_stock_model_xyz", limit: 5 } as never,
      ctx,
    )) as unknown as Catalog;
    expect(r.total).toBe(0);
    expect(r.models).toEqual([]);
    expect(r.nextOffset).toBeNull();
  }, 60_000);
});
