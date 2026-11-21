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
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-decompile-"));
const outputModelDir = (): string => join(ctx.config.gameDir!, "models", "hsmcp_decompile_test");
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
    expect(r.collisionTriangles).toBe(634);
    expect(existsSync(r.qc)).toBe(true);
    expect(existsSync(r.smd)).toBe(true);
    expect(r.collisionSmd).not.toBeNull();
    expect(existsSync(r.collisionSmd!)).toBe(true);

    const qc = readFileSync(r.qc, "utf8");
    expect(qc).toContain('$modelname "hsmcp_decompile_test/car.mdl"');
    expect(qc).toContain('$body "Body" "cara_84sedan_ref.smd"');
    expect(qc).toContain("$staticprop");
    expect(qc).toContain("$cdmaterials \"models/props_vehicles/\"");
    expect(qc).toContain("$collisionmodel \"cara_84sedan_phys.smd\"");
    expect(qc).toContain("$concave");
    expect(qc).toContain('$sequence "idle" "cara_84sedan_idle.smd" fps 30.000000');
    expect(r.warnings.join(" ")).toMatch(/flexes are not extracted/);

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

  it("skips multi-blend sequences instead of writing one blend as the whole clip", async () => {
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
      skippedSequences: Array<{ name: string; reason: string }>;
      animationFiles: string[];
    };
    const aims = r.skippedSequences.find((sequence) => sequence.name === "aims");
    expect(aims?.reason).toMatch(/blends 3 animations/);
    expect(r.animationFiles.length).toBeGreaterThan(0);
  });

  it.skipIf(!has.toolchain)("recompiles the gift's 31-frame spin", async () => {
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

  it.skipIf(!has.toolchain)("recompiles arcade_button's three skin families", async () => {
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

  it.skipIf(!has.toolchain)("recompiles smoker's attachments and hitboxes", async () => {
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
  });

  it.skipIf(!has.toolchain)("recompiles to the same hull as the source", async () => {
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
});
