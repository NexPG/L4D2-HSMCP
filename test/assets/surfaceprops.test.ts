/**
 * Surface properties: the game's material table is the oracle for every `$surfaceprop`.
 *
 * The file is KeyValues with prose comments between blocks, `base` inheritance and a
 * `gamematerial` letter. These tests pin the parse, the inheritance and the two tools, using
 * the stock table and a stock model whose header says `flesh`.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import {
  parseSurfaceProperties,
  readSurfaceProps,
  resolveSurfaceProp,
} from "../../src/assets/typescript/formats/surfaceprops.js";
import type { SurfaceProperties, SurfacePropsTable } from "../../src/assets/typescript/formats/surfaceprops.js";
import {
  checkSurfacePropTool,
  readSurfacePropsTool,
} from "../../src/assets/typescript/tools/surfaceprops.js";
import { config, has } from "../support/env.js";

const ctx = { config, audit: { record: () => undefined } } as unknown as ToolContext;

describe("surfaceproperties parser", () => {
  it("ignores the prose after a block name and keeps quoted values", () => {
    const entries = parseSurfaceProperties(
      [
        '// a comment mentioning "metal"',
        '"metal" is sheet metal',
        "{",
        '\t"density" "2700"',
        '\t"friction" "0.8"',
        "}",
        '"child"',
        "{",
        '\t"base" "metal"',
        '\t"thickness" "0.1"',
        "}",
        "",
      ].join("\n"),
      "scripts/test.txt",
    );
    expect(entries.map((entry) => entry.name)).toEqual(["metal", "child"]);
    expect(entries[0]!.values).toEqual({ density: "2700", friction: "0.8" });
    expect(entries[1]!.values.base).toBe("metal");
  });

  it("resolves base inheritance with the child winning", () => {
    const table: SurfacePropsTable = {
      files: ["test"],
      entries: new Map<string, SurfaceProperties>([
        ["metal", { file: "test", name: "metal", key: "metal", values: { density: "2700", gamematerial: "M" } }],
        ["child", { file: "test", name: "child", key: "child", values: { base: "metal", density: "1000" } }],
      ]),
    };
    const resolved = resolveSurfaceProp(table, "CHILD");
    expect(resolved.known).toBe(true);
    expect(resolved.chain).toEqual(["child", "metal"]);
    expect(resolved.values.density).toBe("1000");
    expect(resolved.gameMaterial).toBe("M");
  });
});

describe.skipIf(!has.gameContent)("stock surfaceproperties", () => {
  const gameDir = () => config.gameDir!;

  it("reads the manifest and the L4D table", async () => {
    const table = readSurfaceProps(gameDir());
    expect(table.files).toEqual(["scripts/surfaceproperties_left4dead.txt"]);
    expect(table.entries.size).toBe(91);
    const metal = resolveSurfaceProp(table, "metal");
    expect(metal.known).toBe(true);
    expect(metal.chain).toContain("solidmetal");
    expect(metal.gameMaterial).toBe("M");
    expect(metal.values.density).toBe("2700");
    const box = resolveSurfaceProp(table, "Metal_Box");
    expect(box.known).toBe(true);
    expect(box.values.thickness).toBe("0.1");
    expect(resolveSurfaceProp(table, "not_a_surface").known).toBe(false);
  });

  it("checks a model's header and an explicit name", async () => {
    const model = (await checkSurfacePropTool.handler(
      { model: "infected/boomette.mdl" } as never,
      ctx,
    )) as {
      name: string;
      known: boolean;
      gameMaterial: string | null;
      surfaceprop: string | null;
    };
    expect(model).toMatchObject({ name: "flesh", known: true, surfaceprop: "flesh", gameMaterial: "F" });

    const bogus = (await checkSurfacePropTool.handler({ name: "mettal" } as never, ctx)) as {
      known: boolean;
      note?: string;
    };
    expect(bogus.known).toBe(false);
    expect(bogus.note).toMatch(/falls back to the default/);
  });

  it("lists and filters the table", async () => {
    const result = (await readSurfacePropsTool.handler(
      { filter: "metal", limit: 3 } as never,
      ctx,
    )) as { count: number; returned: number; names: string[]; entries: Array<{ values: Record<string, string> }> };
    expect(result.count).toBe(91);
    expect(result.returned).toBe(3);
    expect(result.names.every((name) => name.toLowerCase().includes("metal"))).toBe(true);
    expect(result.entries[0]!.values.gamematerial).toBeTruthy();
  });
});
