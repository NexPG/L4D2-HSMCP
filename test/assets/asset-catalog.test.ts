/**
 * The stock browser hides editor and engine material roots. `read_asset_catalog` is the
 * browser, so its material categories must hide the same ones unless asked otherwise; the
 * count is the proof that a filter ran rather than a guess that the category happened to be
 * empty.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readAssetCatalogTool } from "../../src/assets/typescript/tools/content.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const HIDDEN = /^materials\/(debug|engine|hud|vgui|voice|console|sblitz|particle|dons_decals)\//i;

type Catalog = {
  materialCount: number;
  hiddenMaterialCount: number;
  includeHidden: boolean;
  materialCategories: Array<{
    total: number;
    results: Array<{ path: string }>;
  }>;
};

describe.skipIf(!has.gameContent || !has.sidecar)("read_asset_catalog material exclusions", () => {
  it("hides the browser roots by default and can include them", async () => {
    const visible = (await readAssetCatalogTool.handler(
      { perCategory: 5, includeHidden: false } as never,
      ctx,
    )) as Catalog;
    expect(visible.hiddenMaterialCount).toBeGreaterThan(0);
    expect(visible.includeHidden).toBe(false);
    expect(visible.materialCount).toBeGreaterThan(visible.hiddenMaterialCount);
    for (const category of visible.materialCategories) {
      for (const result of category.results) {
        expect(result.path, "a hidden root leaked into the browser").not.toMatch(HIDDEN);
      }
    }

    const all = (await readAssetCatalogTool.handler(
      { perCategory: 5, includeHidden: true } as never,
      ctx,
    )) as Catalog;
    expect(all.includeHidden).toBe(true);
    expect(all.hiddenMaterialCount).toBe(0);
    expect(all.materialCount).toBe(visible.materialCount);
  }, 180_000);
});
