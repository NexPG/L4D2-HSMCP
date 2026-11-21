/**
 * Decompiling a compiled model back to a QC and a reference SMD.
 *
 * The unit checks pin the shape of the output. The round-trip test compiles the decompiled
 * QC with the game's own studiomdl and compares the recompiled hull with the source: that is
 * the only proof that the vertex order, the static-prop axis swap and the one-frame sequence
 * are right, rather than merely plausible.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { decompileModelTool } from "../../src/models/typescript/tools/decompile.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { readAttachments, readHitboxSets } from "../../src/models/typescript/formats/mdlmeta.js";
import { readAnimations, readSequences, decodeAnimation } from "../../src/models/typescript/formats/mdlanim.js";
import { readMdlBones } from "../../src/models/typescript/formats/mdlbones.js";
import { readPhy, readPhyGeometry } from "../../src/models/typescript/formats/phy.js";
import { parseModelGeometry } from "../../src/models/typescript/formats/mdlmesh.js";
import type { Vec3 } from "../../src/models/typescript/formats/mdlmesh.js";
import { loadGameModel, modelSiblings } from "../../src/assets/typescript/game/models.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-decompile-"));
const outputModelDir = (): string => join(ctx.config.gameDir!, "models", "hsmcp_decompile_test");
const archive = (): NonNullable<ReturnType<typeof openGameVpk>> => openGameVpk(ctx.config.gameDir!)!;

/** Every `rebuilt` point must sit on one of `intended`: the flex is a surface, not an order. */
function expectSameSurface(intended: Vec3[], rebuilt: Vec3[], tolerance = 0.005): void {
  const cell = (point: Vec3): string =>
    point.map((value) => Math.round(value * 100)).join(",");
  const grid = new Map<string, Vec3[]>();
  for (const point of intended) {
    const key = cell(point);
    const list = grid.get(key);
    if (list) list.push(point);
    else grid.set(key, [point]);
  }
  let worst = 0;
  for (const point of rebuilt) {
    const center = point.map((value) => Math.round(value * 100));
    let best = Number.POSITIVE_INFINITY;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const list = grid.get(`${center[0]! + dx},${center[1]! + dy},${center[2]! + dz}`);
          for (const candidate of list ?? []) {
            best = Math.min(
              best,
              Math.hypot(
                point[0] - candidate[0],
                point[1] - candidate[1],
                point[2] - candidate[2],
              ),
            );
          }
        }
      }
    }
    worst = Math.max(worst, best);
  }
  expect(worst).toBeLessThan(tolerance);
}

/** Parses a model the test compiled into the game directory, not one inside a VPK. */
const readLooseGeometry = (enginePath: string) => {
  const siblings = modelSiblings(enginePath);
  const read = (path: string): Buffer => readFileSync(join(ctx.config.gameDir!, path));
  let vtx: Buffer | null = null;
  for (const candidate of siblings.vtx) {
    const path = join(ctx.config.gameDir!, candidate);
    if (existsSync(path)) {
      vtx = readFileSync(path);
      break;
    }
  }
  if (!vtx) throw new Error(`no VTX beside ${enginePath}`);
  return parseModelGeometry(read(enginePath), read(siblings.vvd), vtx);
};
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(outputModelDir(), { recursive: true, force: true });
});

const MODEL = "props_vehicles/cara_84sedan.mdl";

describe.skipIf(!has.gameContent)("decompile_model", () => {
  it("writes a QC, a reference SMD and a collision SMD", async () => {
    const outDir = join(scratch, "car");
    const r = (await decompileModelTool.handler(
      {
        model: MODEL,
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/car.mdl",
      } as never,
      ctx,
    )) as {
      qc: string;
      smd: string;
      collisionSmd: string | null;
      triangleCount: number;
      collisionTriangles: number;
      warnings: string[];
    };
    expect(r.triangleCount).toBe(5515);
    // One solid with 16 convex pieces: the compiler's frame for a single hull depends on the
    // root pose, and this model's pose is one the reader cannot reproduce yet. It says so
    // rather than writing a rotated hull.
    expect(r.collisionTriangles).toBe(0);
    expect(r.collisionSmd).toBeNull();
    expect(existsSync(r.qc)).toBe(true);
    expect(existsSync(r.smd)).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/collision frame could not be reproduced/);

    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain('$modelname "hsmcp_decompile_test/car.mdl"');
    expect(qc).toContain('$body "Body" "cara_84sedan_ref.smd"');
    expect(qc).toContain("$staticprop");
    expect(qc).toContain("$cdmaterials \"models/props_vehicles/\"");
    expect(qc).not.toContain("$collisionmodel");
    expect(qc).toContain('$sequence "idle" "cara_84sedan_idle.smd" fps 30.000000');
    expect(r.warnings.join(" ")).toMatch(/shadow LODs use a/);

    const smd = readFileSync(r.smd, "latin1");
    expect(smd.startsWith("version 1\nnodes\n")).toBe(true);
    expect(smd).toContain("triangles");
    expect(smd).toContain("4carz1024");
  });

  it("writes decoded animation SMDs and sequence lines", async () => {
    const outDir = join(scratch, "gift");
    const r = (await decompileModelTool.handler(
      {
        model: "items/l4d_gift.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/gift.mdl",
      } as never,
      ctx,
    )) as {
      qc: string;
      animationFiles: string[];
      sequences: number;
      skippedSequences: unknown[];
    };
    expect(r.sequences).toBe(1);
    expect(r.animationFiles).toHaveLength(1);
    expect(r.skippedSequences).toHaveLength(0);
    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain('$sequence "spin" "l4d_gift_spin.smd" fps 10.000000 loop');
    const smd = readFileSync(r.animationFiles[0]!, "latin1");
    expect(smd.match(/^time /gm)).toHaveLength(31);
  });

  it("decodes a position-animated prop and a one-frame raw-rotation idle", async () => {
    const outDir = join(scratch, "cabinet");
    const r = (await decompileModelTool.handler(
      {
        model: "props_buildables/small_cabinet.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/cabinet.mdl",
      } as never,
      ctx,
    )) as {
      qc: string;
      animationFiles: string[];
      sequences: number;
      skippedSequences: unknown[];
    };
    expect(r.sequences).toBe(2);
    expect(r.animationFiles).toHaveLength(2);
    expect(r.skippedSequences).toHaveLength(0);
    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain('$sequence "idle" "small_cabinet_idle.smd" fps 30.000000');
    expect(qc).toContain('$sequence "open" "small_cabinet_open.smd" fps 30.000000');
    const open = readFileSync(join(outDir, "small_cabinet_open.smd"), "latin1");
    expect(open.match(/^time /gm)).toHaveLength(18);
    // The doors swing around their hinges, so the two door bones end up translated to
    // opposite sides of the cabinet; that only happens if the position channels decode.
    const lastFrame = open.split("time 17\n")[1]!.split("\n");
    const doorRight = lastFrame[0]!.split(" ").map(Number);
    const doorLeft = lastFrame[2]!.split(" ").map(Number);
    expect(Math.sign(doorRight[2]!)).not.toBe(Math.sign(doorLeft[2]!));
  });

  it("writes multi-blend sequences as $sequence blocks", async () => {
    const outDir = join(scratch, "v_bat");
    const r = (await decompileModelTool.handler(
      {
        model: "weapons/melee/v_bat.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/v_bat.mdl",
      } as never,
      ctx,
    )) as {
      qc: string;
      skippedSequences: Array<{ name: string; reason: string }>;
      animationFiles: string[];
    };
    expect(r.skippedSequences).toHaveLength(0);
    expect(r.animationFiles).toHaveLength(17);
    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain('$sequence "aims" {');
    expect(qc).toContain('"v_bat_aims.smd" "v_bat_aims_2.smd" "v_bat_aims_3.smd"');
    expect(qc).toContain("blendwidth 3");
    expect(qc).toContain('blend "ver_aims" -1.000000 1.000000');
  });

  it.skipIf(!has.toolchain)("recompiles v_bat's three-way blend", async () => {
    const outDir = join(scratch, "v_bat-roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "weapons/melee/v_bat.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/v_bat.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 10 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const rebuilt = readFileSync(join(outputModelDir(), "v_bat.mdl"));
    const aims = readSequences(rebuilt, readAnimations(rebuilt)).find(
      (sequence) => sequence.name === "aims",
    )!;
    expect(aims.blendCount).toBe(3);
    expect(aims.groupSizes).toEqual([3, 1]);
    expect(aims.paramIndices).toEqual([0, -1]);
    expect(aims.paramStart[0]).toBeCloseTo(-1, 5);
    expect(aims.paramEnd[0]).toBeCloseTo(1, 5);
  });

  it.skipIf(!has.toolchain)("recompiles the gift's 31-frame spin", { timeout: 30_000 }, async () => {
    const outDir = join(scratch, "gift-roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "items/l4d_gift.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/gift.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);
    const mdl = readFileSync(join(outputModelDir(), "gift.mdl"));
    const animationsOffset = mdl.readInt32LE(184);
    expect(mdl.readInt32LE(animationsOffset + 16)).toBe(31);
    expect(mdl.readInt32LE(animationsOffset + 12) & 1).toBe(1);
  });

  it("writes attachments and custom hitboxes, and skips auto-generated ones", async () => {
    const smokerDir = join(scratch, "smoker");
    const smoker = (await decompileModelTool.handler(
      {
        model: "infected/smoker.mdl",
        outDir: smokerDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/smoker.mdl",
      } as never,
      ctx,
    )) as {
      qc: string;
      attachments: number;
      hitboxSets: number;
      hitboxes: number;
    };
    expect(smoker.attachments).toBe(4);
    expect(smoker.hitboxSets).toBe(1);
    expect(smoker.hitboxes).toBe(17);
    const smokerQc = readFileSync(smoker.qc, "utf8");
    expect(smokerQc).toContain('$attachment "smoker_mouth" "ValveBiped.Bip01_Head1"');
    expect(smokerQc).toContain('$hboxset "cstrike"');
    expect(smokerQc.match(/^\$hbox /gm)).toHaveLength(17);

    const gift = (await decompileModelTool.handler(
      {
        model: "items/l4d_gift.mdl",
        outDir: join(scratch, "gift-hitboxes"),
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/gift.mdl",
      } as never,
      ctx,
    )) as { qc: string; hitboxes: number; warnings: string[] };
    // studiomdl regenerates this set from the mesh; pinning it would freeze stale bounds.
    expect(gift.hitboxes).toBe(1);
    expect(gift.warnings.join(" ")).toMatch(/auto-generated by studiomdl/);
    expect(readFileSync(gift.qc, "utf8")).not.toContain("$hbox");
  });

  it("writes each bodygroup alternative as its own SMD", async () => {
    const outDir = join(scratch, "brokenglass");
    const r = (await decompileModelTool.handler(
      {
        model: "brokenglass_piece.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/brokenglass.mdl",
      } as never,
      ctx,
    )) as {
      qc: string;
      bodygroups: number;
      bodygroupModels: number;
      bodygroupFiles: string[];
    };
    expect(r.bodygroups).toBe(1);
    expect(r.bodygroupModels).toBe(3);
    expect(r.bodygroupFiles).toHaveLength(3);
    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain('$bodygroup "bodypart_0"');
    expect(qc.match(/^\tstudio /gm)).toHaveLength(3);
    expect(qc).not.toContain('$body "Body"');

    const checkpoint = (await decompileModelTool.handler(
      {
        model: "props_doors/checkpoint_door_01.mdl",
        outDir: join(scratch, "checkpoint"),
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/checkpoint_door.mdl",
      } as never,
      ctx,
    )) as { qc: string; bodygroups: number; bodygroupModels: number };
    expect(checkpoint.bodygroups).toBe(2);
    expect(checkpoint.bodygroupModels).toBe(3);
    const checkpointQc = readFileSync(checkpoint.qc, "utf8");
    // The door's second body part has an empty first value; `blank` must keep the value
    // indices aligned so the crossbar stays alternative 1.
    expect(checkpointQc).toMatch(/^\tblank$/m);
    expect(checkpointQc.match(/^\tstudio /gm)).toHaveLength(2);
  });

  it.skipIf(!has.toolchain)("recompiles brokenglass with all three alternatives", { timeout: 30_000 }, async () => {
    const outDir = join(scratch, "brokenglass-roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "brokenglass_piece.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/brokenglass.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const rebuilt = readFileSync(join(outputModelDir(), "brokenglass.mdl"));
    const partCount = rebuilt.readInt32LE(232);
    const partOffset = rebuilt.readInt32LE(236);
    expect(partCount).toBe(1);
    const modelCount = rebuilt.readInt32LE(partOffset + 4);
    const modelsOffset = rebuilt.readInt32LE(partOffset + 12);
    expect(modelCount).toBe(3);
    for (let model = 0; model < modelCount; model += 1) {
      const base = partOffset + modelsOffset + model * 148;
      expect(rebuilt.readInt32LE(base + 80)).toBe(24);
      expect(rebuilt.readInt32LE(base + 72)).toBe(1);
    }
  });

  it("writes a $lod block for every VTX distance", async () => {
    const outDir = join(scratch, "hospital-bed");
    const r = (await decompileModelTool.handler(
      {
        model: "props_unique/hospital/hospital_bed.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/hospital_bed.mdl",
      } as never,
      ctx,
    )) as { qc: string; lodLevels: number; lodFiles: string[] };
    expect(r.lodLevels).toBe(3);
    expect(r.lodFiles).toHaveLength(2);
    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain("$lod 25");
    expect(qc).toContain("$lod 50");
    expect(qc).toContain(
      'replacemodel "hospital_bed_ref.smd" "hospital_bed_ref_lod1.smd"',
    );
    expect(qc).toContain(
      'replacemodel "hospital_bed_ref.smd" "hospital_bed_ref_lod2.smd"',
    );
  });

  it.skipIf(!has.toolchain)("recompiles hospital_bed's three LODs", { timeout: 30_000 }, async () => {
    const outDir = join(scratch, "hospital-bed-roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "props_unique/hospital/hospital_bed.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/hospital_bed.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const source = loadGameModel(
      openGameVpk(ctx.config.gameDir!)!,
      "models/props_unique/hospital/hospital_bed.mdl",
    )!;
    const rebuilt = readLooseGeometry("models/hsmcp_decompile_test/hospital_bed.mdl")!;
    expect(rebuilt.lods.map((lod) => lod.triangleCount)).toEqual(
      source.lods.map((lod) => lod.triangleCount),
    );
  });

  it("writes shadow LOD replacements", async () => {
    const outDir = join(scratch, "hgibs");
    const r = (await decompileModelTool.handler(
      {
        model: "gibs/hgibs.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/hgibs.mdl",
      } as never,
      ctx,
    )) as { qc: string; shadowLods: number; shadowFiles: string[] };
    expect(r.shadowLods).toBe(1);
    expect(r.shadowFiles).toHaveLength(1);
    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain("$shadowlod");
    expect(qc).toContain('replacemodel "hgibs_ref.smd" "hgibs_ref_shadow.smd"');
  });

  it.skipIf(!has.toolchain)("recompiles hgibs with its shadow LOD", async () => {
    const outDir = join(scratch, "hgibs-roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "gibs/hgibs.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/hgibs.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const source = loadGameModel(openGameVpk(ctx.config.gameDir!)!, "models/gibs/hgibs.mdl")!;
    const rebuilt = readLooseGeometry("models/hsmcp_decompile_test/hgibs.mdl")!;
    expect(rebuilt.lods.map((lod) => lod.switchDistance)).toEqual(
      source.lods.map((lod) => lod.switchDistance),
    );
    expect(rebuilt.lods.some((lod) => lod.switchDistance < 0)).toBe(true);
  });

  it("decodes sectioned sequences into animation SMDs", async () => {
    const outDir = join(scratch, "camjoint");
    const r = (await decompileModelTool.handler(
      {
        model: "c1_chargerexit/car_camjoint.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/camjoint.mdl",
      } as never,
      ctx,
    )) as { sequences: number; animationFiles: string[]; skippedSequences: unknown[] };
    expect(r.sequences).toBe(7);
    expect(r.animationFiles).toHaveLength(7);
    expect(r.skippedSequences).toHaveLength(0);
    const escape = readFileSync(join(outDir, "car_camjoint_escape_a.smd"), "latin1");
    expect(escape.match(/^time /gm)).toHaveLength(180);
  });

  it.skipIf(!has.toolchain)("recompiles car_camjoint's sectioned clips", async () => {
    const outDir = join(scratch, "camjoint-roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "c1_chargerexit/car_camjoint.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/camjoint.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const rebuilt = readFileSync(join(outputModelDir(), "camjoint.mdl"));
    const sequences = readSequences(rebuilt, readAnimations(rebuilt));
    expect(sequences.find((sequence) => sequence.name === "escape_a")?.frameCount).toBe(180);
    expect(sequences.find((sequence) => sequence.name === "escape_b")?.frameCount).toBe(195);
  });

  it("writes skin families as a texturegroup and keeps the family mapping", async () => {
    const outDir = join(scratch, "arcade");
    const r = (await decompileModelTool.handler(
      {
        model: "props_buildables/arcade_button.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/arcade.mdl",
      } as never,
      ctx,
    )) as { qc: string; skinFamilies: number };
    expect(r.skinFamilies).toBe(3);
    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain('$texturegroup "skinfamilies"');
    expect(qc).toContain(
      '{ "button_arcade_green" "button_arcade_yellow" "button_arcade_red" }',
    );
    expect(qc).toContain('{ "button_arcade_red" "button_arcade_yellow" "button_arcade_red" }');
  });

  it.skipIf(!has.toolchain)("recompiles arcade_button's three skin families", { timeout: 30_000 }, async () => {
    const outDir = join(scratch, "arcade-roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "props_buildables/arcade_button.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/arcade.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const readSkins = (mdl: Buffer): number[][] => {
      const referenceCount = mdl.readInt32LE(220);
      const familyCount = mdl.readInt32LE(224);
      const offset = mdl.readInt32LE(228);
      const families: number[][] = [];
      for (let family = 0; family < familyCount; family += 1) {
        const row: number[] = [];
        for (let i = 0; i < referenceCount; i += 1) {
          row.push(mdl.readInt16LE(offset + (family * referenceCount + i) * 2));
        }
        families.push(row);
      }
      return families;
    };
    const source = openGameVpk(ctx.config.gameDir!)!.read(
      "models/props_buildables/arcade_button.mdl",
    )!;
    const rebuilt = readFileSync(join(outputModelDir(), "arcade.mdl"));
    expect(readSkins(rebuilt)).toEqual(readSkins(source));
  });

  it.skipIf(!has.toolchain)("recompiles smoker's attachments and hitboxes", { timeout: 30_000 }, async () => {
    const outDir = join(scratch, "smoker-roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "infected/smoker.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/smoker.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const source = openGameVpk(ctx.config.gameDir!)!.read("models/infected/smoker.mdl")!;
    const rebuilt = readFileSync(join(outputModelDir(), "smoker.mdl"));
    const sourceAttachments = readAttachments(source);
    const rebuiltAttachments = readAttachments(rebuilt);
    expect(rebuiltAttachments.map((attachment) => attachment.name)).toEqual(
      sourceAttachments.map((attachment) => attachment.name),
    );
    for (let i = 0; i < sourceAttachments.length; i += 1) {
      expect(rebuiltAttachments[i]!.bone).toBe(sourceAttachments[i]!.bone);
      expect(rebuiltAttachments[i]!.position[0]).toBeCloseTo(sourceAttachments[i]!.position[0], 3);
      expect(rebuiltAttachments[i]!.position[1]).toBeCloseTo(sourceAttachments[i]!.position[1], 3);
      expect(rebuiltAttachments[i]!.position[2]).toBeCloseTo(sourceAttachments[i]!.position[2], 3);
    }
    const sourceSet = readHitboxSets(source)[0]!;
    const rebuiltSet = readHitboxSets(rebuilt)[0]!;
    expect(rebuiltSet.name).toBe(sourceSet.name);
    expect(rebuiltSet.hitboxes).toHaveLength(sourceSet.hitboxes.length);
    expect(rebuiltSet.hitboxes[0]!.group).toBe(sourceSet.hitboxes[0]!.group);
    expect(rebuiltSet.hitboxes[0]!.min[0]).toBeCloseTo(sourceSet.hitboxes[0]!.min[0], 3);

    // A survivor-scale model is a ragdoll: one solid per bone, constraints and all.
    expect(readFileSync(decompiled.qc, "utf8")).toContain("$collisionjoints");
    const sourcePhy = archive().read("models/infected/smoker.phy")!;
    const rebuiltPhy = readFileSync(join(outputModelDir(), "smoker.phy"));
    const sourceText = readPhy(sourcePhy);
    const rebuiltText = readPhy(rebuiltPhy);
    expect(rebuiltText.ragdoll?.solids).toHaveLength(sourceText.ragdoll!.solids.length);
    expect(rebuiltText.ragdoll?.constraints).toHaveLength(sourceText.ragdoll!.constraints.length);
    expect(rebuiltText.ragdoll?.rootName).toBe(sourceText.ragdoll!.rootName);
    expect(rebuiltText.ragdoll?.totalMass).toBe(sourceText.ragdoll!.totalMass);
    expect(rebuiltText.ragdoll!.solids.map((solid) => solid.name)).toEqual(
      sourceText.ragdoll!.solids.map((solid) => solid.name),
    );
    expect(rebuiltText.ragdoll!.solids.map((solid) => solid.parent)).toEqual(
      sourceText.ragdoll!.solids.map((solid) => solid.parent),
    );
  });

  it.skipIf(!has.toolchain)("recompiles to the same hull as the source", { timeout: 30_000 }, async () => {
    const outDir = join(scratch, "roundtrip");
    const decompiled = (await decompileModelTool.handler(
      {
        model: MODEL,
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/car.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean; model: string | null };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const source = openGameVpk(ctx.config.gameDir!)!.read(
      "models/props_vehicles/cara_84sedan.mdl",
    )!;
    const recompiled = readFileSync(join(outputModelDir(), "car.mdl"));
    const hull = (bytes: Buffer): { min: number[]; max: number[] } => ({
      min: [bytes.readFloatLE(104), bytes.readFloatLE(108), bytes.readFloatLE(112)],
      max: [bytes.readFloatLE(116), bytes.readFloatLE(120), bytes.readFloatLE(124)],
    });
    const a = hull(source);
    const b = hull(recompiled);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(a.min[axis]! - b.min[axis]!)).toBeLessThan(8);
      expect(Math.abs(a.max[axis]! - b.max[axis]!)).toBeLessThan(8);
    }
  });

  /**
   * Counts triangles whose geometric normal agrees with the average vertex normal. Source
   * models are stored with the opposite order (studiomdl flips SMD winding), so a
   * recompile that matches the source must reproduce both counts, whichever way they lean.
   */
  const orientation = (geometry: {
    meshes: Array<{ vertices: Array<{ position: Vec3; normal: Vec3 }>; triangles: number[] }>;
  }): { agree: number; disagree: number } => {
    let agree = 0;
    let disagree = 0;
    for (const mesh of geometry.meshes) {
      for (let t = 0; t + 2 < mesh.triangles.length; t += 3) {
        const a = mesh.vertices[mesh.triangles[t]!]!;
        const b = mesh.vertices[mesh.triangles[t + 1]!]!;
        const c = mesh.vertices[mesh.triangles[t + 2]!]!;
        const e1 = b.position.map((value, axis) => value - a.position[axis]!) as Vec3;
        const e2 = c.position.map((value, axis) => value - a.position[axis]!) as Vec3;
        const n: Vec3 = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const average = [0, 1, 2].map(
          (axis) => (a.normal[axis]! + b.normal[axis]! + c.normal[axis]!) / 3,
        );
        const dot = n[0] * average[0]! + n[1] * average[1]! + n[2] * average[2]!;
        if (dot > 0) agree += 1;
        else disagree += 1;
      }
    }
    return { agree, disagree };
  };

  it.skipIf(!has.toolchain)("recompiles triangles in the source winding", { timeout: 30_000 }, async () => {
    const outDir = join(scratch, "gascan-winding");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "props_junk/gascan001a.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/gascan.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const source = loadGameModel(archive(), "models/props_junk/gascan001a.mdl")!;
    const rebuilt = readLooseGeometry("models/hsmcp_decompile_test/gascan.mdl")!;
    const sourceOrientation = orientation(source);
    // Pin the convention itself: a straight dump of the VTX order compiles agree > disagree.
    expect(sourceOrientation).toEqual({ agree: 0, disagree: 1988 });
    expect(orientation(rebuilt)).toEqual(sourceOrientation);
  });

  it.skipIf(!has.toolchain)("restores the root rotation of every sequence", { timeout: 60_000 }, async () => {
    const outDir = join(scratch, "v_bat-roots");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "weapons/melee/v_bat.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/v_bat.mdl",
      } as never,
      ctx,
    )) as { qc: string };
    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 10 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);
    expect(compiled.modelExists).toBe(true);

    const source = archive().read("models/weapons/melee/v_bat.mdl")!;
    const rebuilt = readFileSync(join(outputModelDir(), "v_bat.mdl"));
    const sourceAnimations = readAnimations(source);
    const rebuiltAnimations = readAnimations(rebuilt);
    const sourceBones = readMdlBones(source);
    const rebuiltBones = readMdlBones(rebuilt);
    const sourceSequences = readSequences(source, sourceAnimations);
    const rebuiltSequences = readSequences(rebuilt, rebuiltAnimations);
    expect(sourceSequences.length).toBeGreaterThan(0);
    for (const sequence of sourceSequences) {
      const rebuiltSequence = rebuiltSequences.find((entry) => entry.name === sequence.name);
      expect(rebuiltSequence, sequence.name).toBeDefined();
      const before = decodeAnimation(source, sourceAnimations[sequence.firstAnimation]!, sourceBones)!;
      const after = decodeAnimation(
        rebuilt,
        rebuiltAnimations[rebuiltSequence!.firstAnimation]!,
        rebuiltBones,
      )!;
      // studiomdl yaws the root bone +90 degrees; without the correction every one of these
      // would be off by pi/2 on Z.
      const first = before[0]!.bones[0]!.rotation;
      const again = after[0]!.bones[0]!.rotation;
      for (let axis = 0; axis < 3; axis += 1) {
        expect(Math.abs(first[axis]! - again[axis]!), sequence.name).toBeLessThan(1e-3);
      }
    }
  });

  it.skipIf(!has.toolchain)("recompiles a single-hull prop collision in the compiler's frame", { timeout: 30_000 }, async () => {
    const outDir = join(scratch, "gascan-collision");
    const decompiled = (await decompileModelTool.handler(
      {
        model: "props_junk/gascan001a.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/gascan.mdl",
      } as never,
      ctx,
    )) as { qc: string; collisionSmd: string | null; collisionTriangles: number; warnings: string[] };
    expect(decompiled.collisionSmd).not.toBeNull();
    expect(decompiled.collisionTriangles).toBe(20);
    const qc = readFileSync(decompiled.qc, "utf8");
    expect(qc).toContain('$collisionmodel "gascan001a_phys.smd"');
    expect(qc).toContain("$concave");

    const compiled = (await runStudiomdlTool.handler(
      { qc: decompiled.qc, timeoutMinutes: 5 } as never,
      ctx,
    )) as { ok: boolean; modelExists: boolean };
    expect(compiled.ok).toBe(true);

    const source = archive().read("models/props_junk/gascan001a.mdl")!;
    const rebuilt = readFileSync(join(outputModelDir(), "gascan.mdl"));
    const hull = (bytes: Buffer): number[] => [
      bytes.readFloatLE(104),
      bytes.readFloatLE(108),
      bytes.readFloatLE(112),
      bytes.readFloatLE(116),
      bytes.readFloatLE(120),
      bytes.readFloatLE(124),
    ];
    hull(source).forEach((value, axis) => {
      expect(Math.abs(value - hull(rebuilt)[axis]!)).toBeLessThan(1);
    });

    const sourcePhy = archive().read("models/props_junk/gascan001a.phy")!;
    const rebuiltPhy = readFileSync(join(outputModelDir(), "gascan.phy"));
    const box = (bytes: Buffer): number[] => {
      const points = readPhyGeometry(bytes).solids.flatMap((solid) => solid.vertices);
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (const point of points) {
        for (let axis = 0; axis < 3; axis += 1) {
          lo[axis] = Math.min(lo[axis]!, point[axis]!);
          hi[axis] = Math.max(hi[axis]!, point[axis]!);
        }
      }
      return [...lo, ...hi];
    };
    box(sourcePhy).forEach((value, axis) => {
      expect(Math.abs(value - box(rebuiltPhy)[axis]!)).toBeLessThan(0.01);
    });
  });

  it("writes flex deltas as a VTA and references it from a $model block", async () => {
    const outDir = join(scratch, "boomette-flex");
    const r = (await decompileModelTool.handler(
      {
        model: "infected/boomette.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/boomette_flex.mdl",
      } as never,
      ctx,
    )) as {
      qc: string;
      flexFiles: string[];
      flexes: Array<{ file: string; name: string; vertices: number }>;
      warnings: string[];
    };
    expect(r.flexes).toEqual([
      { file: "boomette_ref_flex.vta", name: "presser", vertices: 1068 },
    ]);
    expect(r.flexFiles).toHaveLength(1);
    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain('$model "Body" "boomette_ref.smd" {');
    expect(qc).toContain('flexfile "boomette_ref_flex.vta"');
    expect(qc).toContain('flex "presser" frame 1');
    expect(qc).toContain('flexcontroller presser range 0.000000 1.000000 "presser"');
    expect(qc).toContain("%presser = presser");
    expect(qc).not.toContain('$body "Body"');

    const source = loadGameModel(archive(), "models/infected/boomette.mdl")!;
    const vta = readFileSync(r.flexFiles[0]!, "latin1");
    expect(vta.startsWith("version 1\nnodes\n")).toBe(true);
    expect(vta).toContain("skeleton");
    expect(vta).toContain("vertexanimation");
    expect(vta).toContain("time 1 # presser");
    const basis = vta
      .split("vertexanimation")[1]!
      .split("time 1 #")[0]!
      .split("\n")
      .filter((line) => /^ {4}\d+ /.test(line));
    expect(basis).toHaveLength(source.lod0Vertices.length);
    expect(r.warnings.join(" ")).toMatch(/flex descriptors were written as VTA frames/);
  });

  it.skipIf(!has.toolchain)(
    "recompiles boomette's flex onto the same deformed surface",
    { timeout: 60_000 },
    async () => {
      const outDir = join(scratch, "boomette-flex-roundtrip");
      const decompiled = (await decompileModelTool.handler(
        {
          model: "infected/boomette.mdl",
          outDir,
          overwrite: true,
          confirm: true,
          modelname: "hsmcp_decompile_test/boomette_flex.mdl",
        } as never,
        ctx,
      )) as { qc: string };
      const compiled = (await runStudiomdlTool.handler(
        { qc: decompiled.qc, timeoutMinutes: 5 } as never,
        ctx,
      )) as { ok: boolean; modelExists: boolean };
      expect(compiled.ok).toBe(true);
      expect(compiled.modelExists).toBe(true);

      const source = loadGameModel(archive(), "models/infected/boomette.mdl")!;
      const sourceFlex = source.meshes[0]!.flexes![0]!;
      const sourceDelta = new Map(sourceFlex.vertices.map((vertex) => [vertex.index, vertex]));
      const intended: Vec3[] = source.lod0Vertices.map((vertex, index) => {
        const delta = sourceDelta.get(index);
        return vertex.position.map((value, axis) => value + (delta?.delta[axis] ?? 0)) as Vec3;
      });

      const rebuilt = readLooseGeometry("models/hsmcp_decompile_test/boomette_flex.mdl")!;
      const flex = rebuilt.meshes.flatMap((mesh) => mesh.flexes ?? [])[0]!;
      expect(flex.vertices).toHaveLength(1068);
      expect(rebuilt.flex.descriptors).toEqual(["presser"]);
      expect(rebuilt.flex.controllers).toEqual([
        { type: "presser", name: "presser", min: 0, max: 1 },
      ]);
      const rebuiltDelta = new Map(flex.vertices.map((vertex) => [vertex.index, vertex]));
      const deformed: Vec3[] = rebuilt.lod0Vertices.map((vertex, index) => {
        const delta = rebuiltDelta.get(index);
        return vertex.position.map((value, axis) => value + (delta?.delta[axis] ?? 0)) as Vec3;
      });
      expectSameSurface(intended, deformed);
    },
  );

  it("writes the flex body as a $model beside the bodygroups", async () => {
    const outDir = join(scratch, "morph-flex");
    const r = (await decompileModelTool.handler(
      {
        model: "infected/common_morph_test.mdl",
        outDir,
        overwrite: true,
        confirm: true,
        modelname: "hsmcp_decompile_test/morph_flex.mdl",
      } as never,
      ctx,
    )) as {
      qc: string;
      flexes: Array<{ file: string; name: string; vertices: number }>;
      bodygroups: number;
    };
    expect(r.bodygroups).toBe(4);
    expect(r.flexes).toEqual([
      {
        file: "common_morph_test_bodypart_0_infected_body_morph_flex.vta",
        name: "fatness",
        vertices: 593,
      },
    ]);
    const qc = readFileSync(r.qc, "utf8");
    // A `$bodygroup` can only name a file; the flex has to be a `$model` with the block.
    expect(qc).toContain('$model "bodypart_0" "common_morph_test_bodypart_0_infected_body_morph.smd" {');
    expect(qc).toContain('flex "fatness" frame 1');
    expect(qc).toContain('$bodygroup "bodypart_1"');
    expect(qc.match(/^\tstudio /gm)).toHaveLength(5);
  });

  it.skipIf(!has.toolchain)(
    "recompiles common_morph_test's flex with its bodygroups",
    { timeout: 90_000 },
    async () => {
      const outDir = join(scratch, "morph-flex-roundtrip");
      const decompiled = (await decompileModelTool.handler(
        {
          model: "infected/common_morph_test.mdl",
          outDir,
          overwrite: true,
          confirm: true,
          modelname: "hsmcp_decompile_test/morph_flex.mdl",
        } as never,
        ctx,
      )) as { qc: string };
      const compiled = (await runStudiomdlTool.handler(
        { qc: decompiled.qc, timeoutMinutes: 10 } as never,
        ctx,
      )) as { ok: boolean; modelExists: boolean };
      expect(compiled.ok).toBe(true);
      expect(compiled.modelExists).toBe(true);

      const source = loadGameModel(archive(), "models/infected/common_morph_test.mdl")!;
      const sourceMesh = source.bodyParts[0]!.models[0]!.meshes[0]!;
      const sourceFlex = sourceMesh.flexes![0]!;
      const start = sourceMesh.vertexStart;
      const sourceDelta = new Map(
        sourceFlex.vertices.map((vertex) => [vertex.index - start, vertex]),
      );
      const intended: Vec3[] = sourceMesh.vertices.map((vertex, index) => {
        const delta = sourceDelta.get(index);
        return vertex.position.map((value, axis) => value + (delta?.delta[axis] ?? 0)) as Vec3;
      });

      const rebuilt = readLooseGeometry("models/hsmcp_decompile_test/morph_flex.mdl")!;
      expect(rebuilt.bodyParts[1]!.models).toHaveLength(5);
      expect(rebuilt.flex.descriptors).toEqual(["fatness"]);
      const mesh = rebuilt.bodyParts[0]!.models[0]!.meshes[0]!;
      const flex = mesh.flexes![0]!;
      expect(flex.vertices.length).toBeGreaterThan(0);
      const rebuiltStart = mesh.vertexStart;
      const rebuiltDelta = new Map(
        flex.vertices.map((vertex) => [vertex.index - rebuiltStart, vertex]),
      );
      const deformed: Vec3[] = mesh.vertices.map((vertex, index) => {
        const delta = rebuiltDelta.get(index);
        return vertex.position.map((value, axis) => value + (delta?.delta[axis] ?? 0)) as Vec3;
      });
      expectSameSurface(intended, deformed, 0.01);
    },
  );
});
