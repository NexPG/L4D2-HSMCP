import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { writeVmfTerrain } from "../../src/maps/typescript/tools/terrain.js";
import { insertSolids } from "../../src/maps/typescript/vmf/build.js";
import { readDisplacements } from "../../src/maps/typescript/vmf/displacement.js";
import { checkSeal, sealDisplacements, SEAL_MATERIAL } from "../../src/maps/typescript/vmf/dispseal.js";
import { writeDisplacements } from "../../src/maps/typescript/vmf/dispwrite.js";
import { reclassSolids } from "../../src/maps/typescript/vmf/reclass.js";
import { checkVmfSolids } from "../../src/maps/typescript/vmf/solid.js";
import { ctx as sharedCtx } from "../support/env.js";
import { displacedMap, FLAT } from "../support/displaced.js";

const toolCtx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-seal-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const PLAIN = (() => {
  const seed =
    'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n' +
    '\t"classname" "worldspawn"\n}\n';
  const a = insertSolids(seed, [{ shape: "box", mins: [0, 0, 0], maxs: [256, 256, 64] }], {
    material: "NATURE/BLENDGRASSGRAVEL001A",
  });
  const b = insertSolids(a.text, [{ shape: "box", mins: [256, 0, 0], maxs: [512, 256, 64] }], {
    material: "NATURE/BLENDGRASSGRAVEL001A",
  });
  return { text: b.text, west: a.solidIds[0]!, east: b.solidIds[0]! };
})();

/** Two brushes with a flat displacement each, meeting at x = 256. */
const TWO = displacedMap(
  { ...FLAT, startPosition: [0, 0, 64] },
  { ...FLAT, startPosition: [256, 0, 64] },
);

describe("sealDisplacements", () => {
  it("adds one plain duplicate per displaced world brush", () => {
    const r = sealDisplacements(TWO.text);
    expect(r.sealed).toHaveLength(2);
    expect(r.sealed.map((s) => s.solidId).sort()).toEqual([TWO.west, TWO.east].sort());

    const before = checkVmfSolids("x", TWO.text);
    const after = checkVmfSolids("x", r.text);
    expect(after.solidCount).toBe(before.solidCount + 2);

    // The displacements themselves are untouched: sealing adds a brush, it does not edit
    // the terrain.
    expect(readDisplacements(r.text).displacements).toHaveLength(2);

    for (const made of r.sealed) {
      const source = after.solids.find((s) => s.id === made.solidId)!;
      const seal = after.solids.find((s) => s.id === made.sealId)!;
      expect(seal.volume).toBeCloseTo(source.volume, 3);
      expect(seal.sides).toHaveLength(source.sides.length);
      expect(seal.sides.some((side) => side.hasDisplacement)).toBe(false);
      expect(seal.sides.every((side) => side.material === SEAL_MATERIAL)).toBe(true);
      expect(source.sides.some((side) => side.hasDisplacement)).toBe(true);
    }
  });

  it("names the duplicate with an id no brush side already holds", () => {
    const r = sealDisplacements(TWO.text);
    const ids = checkVmfSolids("x", r.text).solids.map((s) => s.id!);
    expect(new Set(ids).size).toBe(ids.length);
    for (const made of r.sealed) expect(ids).toContain(made.sealId);
  });

  it("does not move the brush it duplicates", () => {
    const before = checkVmfSolids("x", TWO.text);
    const after = checkVmfSolids("x", sealDisplacements(TWO.text).text);
    for (const solid of before.solids) {
      const now = after.solids.find((s) => s.id === solid.id)!;
      expect(now.volume, `solid ${solid.id}`).toBeCloseTo(solid.volume, 3);
    }
    expect(checkSeal(TWO.text, sealDisplacements(TWO.text).text)).toEqual([]);
  });

  it("is a no-op the second time", () => {
    const once = sealDisplacements(TWO.text);
    const twice = sealDisplacements(once.text);
    expect(twice.unchanged).toBe(true);
    expect(twice.sealed).toHaveLength(0);
    expect(twice.skipped.map((s) => s.reason).join(" ")).toMatch(/same shape/);
  });

  it("seals only the brush it was told to", () => {
    const r = sealDisplacements(TWO.text, { solidIds: [TWO.west] });
    expect(r.sealed).toHaveLength(1);
    expect(r.sealed[0]!.solidId).toBe(TWO.west);
  });

  it("leaves a detail brush alone, because it never sealed the hull", () => {
    const asDetail = reclassSolids(TWO.text, [TWO.west], {
      to: "entity",
      classname: "func_detail",
    }).text;
    const r = sealDisplacements(asDetail);
    expect(r.sealed.map((s) => s.solidId)).toEqual([TWO.east]);
    expect(r.skipped.find((s) => s.solidId === TWO.west)?.reason).toMatch(/detail/);
  });

  it("says so when a named brush carries no displacement", () => {
    const r = sealDisplacements(PLAIN.text, { solidIds: [PLAIN.west] });
    expect(r.unchanged).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/carries no displacement/);
  });

  it("takes the material it was given", () => {
    const r = sealDisplacements(TWO.text, { material: "TOOLS/TOOLSSKYBOX" });
    const after = checkVmfSolids("x", r.text);
    for (const made of r.sealed) {
      const seal = after.solids.find((s) => s.id === made.sealId)!;
      expect(seal.sides.every((side) => side.material === "TOOLS/TOOLSSKYBOX")).toBe(true);
    }
  });

  it("refuses a brush list that names nothing at all", () => {
    expect(() => sealDisplacements(TWO.text, { solidIds: [] })).toThrow(/names no brush/);
  });
});

describe("writeDisplacements plus sealing", () => {
  it("writes a displacement and its seal in one pass", () => {
    const displaced = writeDisplacements(PLAIN.text, { facing: "up" }, { power: 2 });
    const sealed = sealDisplacements(displaced.text, {
      solidIds: displaced.created.map((c) => c.solidId),
    });
    expect(sealed.sealed).toHaveLength(2);
    expect(readDisplacements(sealed.text).displacements).toHaveLength(2);
    expect(checkSeal(displaced.text, sealed.text)).toEqual([]);
  });
});

describe("write_vmf_terrain seals by default", () => {
  const seed =
    'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
    '\t"classname" "worldspawn"\n\tskyname "sky_l4d_c1_1_hdr"\n}\n';

  const patch = async (seal: boolean | undefined): Promise<{ text: string; solidIds: number[] }> => {
    const file = join(scratch, `terrain-${seal ?? "default"}.vmf`);
    writeFileSync(file, seed);
    const reply = (await writeVmfTerrain.handler(
      {
        path: file,
        mins: [-128, -128],
        maxs: [128, 128],
        floorZ: 0,
        thickness: 16,
        cellSize: 64,
        power: 2,
        noise: 0,
        ...(seal !== undefined ? { seal } : {}),
        confirm: true,
      } as never,
      toolCtx,
    )) as unknown as { solidIds: number[] };
    return { text: readFileSync(file, "utf8"), solidIds: reply.solidIds };
  };

  it("duplicates every cell, because a displaced brush is not solid", async () => {
    const { text, solidIds } = await patch(undefined);
    expect(solidIds).toHaveLength(16);
    expect(checkVmfSolids("x", text).solidCount).toBe(16 * 2);
  });

  it("leaves the cells unsealed only when asked", async () => {
    const { text } = await patch(false);
    expect(checkVmfSolids("x", text).solidCount).toBe(16);
  });
});
