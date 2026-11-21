/**
 * `.phy` collision: what the file says about a model's shape.
 *
 * `cara_84sedan` is 16 convex pieces in one solid and says `"concave" "1"` in its editparams;
 * `shelves_metal1` is one piece. The difference is exactly what decides whether a QC needs
 * `$concave`, and `read_static_props` cannot see it from the file's existence alone.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readPhy } from "../../src/models/typescript/formats/phy.js";
import { readModelCollisionTool } from "../../src/models/typescript/tools/collision.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-phy-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe.skipIf(!has.gameContent)("readPhy", () => {
  const vpk = () => openGameVpk(ctx.config.gameDir!)!;

  it("counts convex pieces and reads the prop_data block", () => {
    const bytes = vpk().read("models/props_vehicles/cara_84sedan.phy")!;
    const report = readPhy(bytes);
    expect(report.solidCount).toBe(1);
    expect(report.solids).toHaveLength(1);
    expect(report.solids[0]!.convexPieces).toBe(16);
    expect(report.solids[0]!.triangles).toBe(634);
    expect(report.solids[0]!.vertices).toBe(267);
    expect(report.maxConvexPieces).toBe(16);
    expect(report.collisionText).toMatch(/"name"\s+"carA_84sedan_physbox"/);
    expect(report.collisionText).toMatch(/"concave"\s+"1"/);
  });

  it("reports one hull for a shelf and five for a bed", () => {
    const archive = vpk();
    const shelf = readPhy(archive.read("models/props/cs_office/shelves_metal1.phy")!);
    expect(shelf.maxConvexPieces).toBe(1);
    expect(shelf.solids[0]!.triangles).toBe(12);
    const bed = readPhy(archive.read("models/props_unique/hospital/hospital_bed.phy")!);
    expect(bed.maxConvexPieces).toBe(5);
    expect(bed.solids[0]!.triangles).toBe(200);
  });
});

describe.skipIf(!has.gameContent)("read_model_collision", () => {
  it("reads an engine model path and checks the MDL checksum", async () => {
    const r = (await readModelCollisionTool.handler(
      { model: "props_vehicles/cara_84sedan.mdl" } as never,
      ctx,
    )) as {
      found: boolean;
      solidCount: number;
      maxConvexPieces: number;
      concaveRequired: boolean;
      checksumMatchesModel: boolean | null;
      collisionName: string | null;
      mass: number | null;
      surfaceProp: string | null;
    };
    expect(r.found).toBe(true);
    expect(r.solidCount).toBe(1);
    expect(r.maxConvexPieces).toBe(16);
    expect(r.concaveRequired).toBe(true);
    expect(r.checksumMatchesModel).toBe(true);
    expect(r.collisionName).toBe("carA_84sedan_physbox");
    expect(r.mass).toBe(1500);
    expect(r.surfaceProp).toBe("metalvehicle");
  });

  it("reads a local .mdl and .phy pair", async () => {
    const archive = vpkFor();
    const mdlPath = join(scratch, "car.mdl");
    const phyPath = join(scratch, "car.phy");
    writeFileSync(mdlPath, archive.read("models/props_vehicles/cara_84sedan.mdl")!);
    writeFileSync(phyPath, archive.read("models/props_vehicles/cara_84sedan.phy")!);
    const r = (await readModelCollisionTool.handler(
      { path: phyPath } as never,
      ctx,
    )) as { found: boolean; checksumMatchesModel: boolean | null; maxConvexPieces: number };
    expect(r.found).toBe(true);
    expect(r.checksumMatchesModel).toBe(true);
    expect(r.maxConvexPieces).toBe(16);
  });

  it("reports the ragdoll text section, not just a hull count", async () => {
    const r = (await readModelCollisionTool.handler(
      { model: "infected/boomette.mdl" } as never,
      ctx,
    )) as {
      jointed: boolean;
      mass: number | null;
      ragdoll: {
        solids: Array<{ name: string; parent: string | null; massbias: number }>;
        constraints: unknown[];
        rootName: string | null;
        totalMass: number | null;
        concave: boolean;
        selfCollisions: boolean;
        collisionPairs: Array<[number, number]> | null;
      } | null;
    };
    expect(r.jointed).toBe(true);
    expect(r.mass).toBe(100);
    expect(r.ragdoll).not.toBeNull();
    expect(r.ragdoll!.solids).toHaveLength(18);
    expect(r.ragdoll!.solids[0]!.name).toBe("ValveBiped.Bip01_Pelvis");
    expect(r.ragdoll!.solids[0]!.parent).toBeNull();
    expect(r.ragdoll!.solids[1]!.parent).toBe("ValveBiped.Bip01_Pelvis");
    expect(r.ragdoll!.constraints).toHaveLength(17);
    expect(r.ragdoll!.rootName).toBe("valvebiped.bip01_pelvis");
    expect(r.ragdoll!.totalMass).toBe(100);
    expect(r.ragdoll!.concave).toBe(false);
    expect(r.ragdoll!.collisionPairs!.length).toBeGreaterThan(0);
  });

  it("reports a model without a .phy as found: false", async () => {
    const r = (await readModelCollisionTool.handler(
      { model: "props_foliage/urban_trees_dryleaves01.mdl" } as never,
      ctx,
    )) as { found: boolean; note?: string; solidCount: number };
    expect(r.found).toBe(false);
    expect(r.solidCount).toBe(0);
    expect(r.note).toMatch(/non-solid/);
  });
});

function vpkFor(): NonNullable<ReturnType<typeof openGameVpk>> {
  return openGameVpk(ctx.config.gameDir!)!;
}
