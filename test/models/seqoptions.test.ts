/**
 * Sequence options survive a decompile.
 *
 * `gascan001a.mdl` is the oracle: its `pullpin`/`throw`/`melee` sequences carry `STUDIO_SNAP`
 * (0x2), `a_gasCan_vaims` carries `STUDIO_HIDDEN` (0x400), and `gasCan_idle`/`a_gasCan_vaims`
 * carry `STUDIO_DELTA` (0x4). The first two are written as QC options and were verified by a
 * real compile (flags came back 0x2 and 0x400); `delta` is deliberately not written because
 * the SMDs are baked frames.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { readAnimations, readSequences } from "../../src/models/typescript/formats/mdlanim.js";
import { readMdlBones } from "../../src/models/typescript/formats/mdlbones.js";
import { decompileModelTool } from "../../src/models/typescript/tools/decompile.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-seqopt-"));
const outputModelDir = (): string => join(ctx.config.gameDir!, "models", "hsmcp_seqopt_test");
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(outputModelDir(), { recursive: true, force: true });
});

describe("sequence options", () => {
  it.skipIf(!has.gameContent)("writes snap and hidden, and leaves delta alone", async () => {
    const result = (await decompileModelTool.handler(
      {
        model: "models/props_junk/gascan001a.mdl",
        outDir: scratch,
        collision: false,
        overwrite: true,
        confirm: true,
      } as never,
      ctx,
    )) as { qc: string; warnings: string[] };
    const qc = readFileSync(result.qc, "utf8");

    // delta is read but cannot be written: the warning names the loss.
    expect(result.warnings.some((warning) => warning.includes("STUDIO_DELTA"))).toBe(true);
    // snap: three melee/projectile sequences carry it.
    expect((qc.match(/^\tsnap$/gm) ?? []).length).toBeGreaterThanOrEqual(3);
    // hidden: the aim-matrix sequence.
    expect(qc).toContain("\thidden");
    // delta is not written: the reference SMD frames are baked, not differences.
    expect(qc).not.toContain("\tdelta");
    // addlayer: gasCan_idle layers a_gasCan_vaims. Verified by a real compile: the sequence
    // came back with one autolayer.
    expect(qc).toContain('\taddlayer "a_gasCan_vaims"');
    // `activity` without a weight makes stock studiomdl stop with "Line N is incomplete".
    expect(qc).toContain("activity ACT_VM_IDLE_GASCAN 1");
  }, 60_000);
});


describe("sequence extras", () => {
  it.skipIf(!has.gameContent)("writes iklock, keyvalues and worldspace into the block", async () => {
    const vpk = openGameVpk(ctx.config.gameDir!)!;
    const source = "models/v_models/v_rifle.mdl";
    const mdl = Buffer.from(vpk.read(source)!);
    const sequence = readSequences(mdl, readAnimations(mdl)).find(
      (candidate) => candidate.name === "idle",
    )!;
    expect(sequence).toBeDefined();

    // Append one IK lock and one KeyValues text after the original payload. Both indexes are
    // relative to the descriptor, so an appended record is a valid pointer and nothing else
    // in the file moves.
    const extra = Buffer.alloc(96);
    const iklockAt = mdl.length;
    extra.writeInt32LE(0, 0); // chain 0 is lhand in v_rifle
    extra.writeFloatLE(1, 4);
    extra.writeFloatLE(0.5, 8);
    const keyValues = Buffer.from('mdlkeyvalue\n{\n"test" "1"\n}\n\0', "latin1");
    keyValues.copy(extra, 16);
    const patched = Buffer.concat([mdl, extra]);
    const base = sequence.baseOffset;
    patched.writeInt32LE(sequence.flags | 0x4000, base + 12);
    patched.writeInt32LE(1, base + 164);
    patched.writeInt32LE(iklockAt - base, base + 168);
    patched.writeInt32LE(iklockAt + 16 - base, base + 172);
    patched.writeInt32LE(keyValues.length, base + 176);

    const dir = mkdtempSync(join(tmpdir(), "hsmcp-seqextras-"));
    const file = join(dir, "v_rifle.mdl");
    writeFileSync(file, patched);
    writeFileSync(join(dir, "v_rifle.vvd"), vpk.read("models/v_models/v_rifle.vvd")!);
    writeFileSync(
      join(dir, "v_rifle.dx90.vtx"),
      vpk.read("models/v_models/v_rifle.dx90.vtx")!,
    );

    const result = (await decompileModelTool.handler(
      {
        path: file,
        outDir: join(dir, "out"),
        collision: false,
        defineBones: false,
        overwrite: true,
        confirm: true,
      },
      ctx,
    )) as { qc: string };
    const qc = readFileSync(result.qc, "utf8");
    const block = qc.slice(qc.indexOf('$sequence "idle" {'), qc.indexOf("\n}", qc.indexOf('$sequence "idle" {')));
    expect(block).toContain("\tworldspace");
    expect(block).toContain('\tiklock "lhand" 1.000000 0.500000');
    expect(block).toContain("\tkeyvalues");
    expect(block).toContain('\t\t"test" "1"');
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});

describe("weight lists", () => {
  it.skipIf(!has.gameContent || !has.toolchain)(
    "round-trips the weighted sequences with stock studiomdl",
    { timeout: 300_000 },
    async () => {
      const outDir = join(scratch, "huntingrifle");
      const decompiled = (await decompileModelTool.handler(
        {
          model: "v_models/v_huntingrifle.mdl",
          outDir,
          collision: false,
          defineBones: false,
          overwrite: true,
          confirm: true,
          modelname: "hsmcp_seqopt_test/v_huntingrifle.mdl",
        } as never,
        ctx,
      )) as { qc: string };
      const qc = readFileSync(decompiled.qc, "utf8");
      // The source has 36 sequences and 18 non-default lists, but every changed weight is on
      // a finger bone with no LOD-0 vertex (6 of 63 bones are weighted). Stock studiomdl
      // aborts on such an entry, so all 18 lists are dropped; the compile must still succeed.
      expect(qc).not.toContain("$weightlist");
      const compiled = (await runStudiomdlTool.handler(
        { qc: decompiled.qc, timeoutMinutes: 10 } as never,
        ctx,
      )) as { ok: boolean; modelExists: boolean; model?: string };
      expect(compiled.ok).toBe(true);
      expect(compiled.modelExists).toBe(true);
      const rebuilt = readFileSync(compiled.model!);
      const sequences = readSequences(rebuilt, readAnimations(rebuilt));
      expect(sequences).toHaveLength(35);
      const boneCount = readMdlBones(rebuilt).length;
      const weighted = sequences.filter((sequence) => {
        if (sequence.weightlist <= 0) return false;
        const at = sequence.baseOffset + sequence.weightlist;
        for (let bone = 0; bone < boneCount; bone += 1) {
          if (Math.abs(rebuilt.readFloatLE(at + bone * 4) - 1) > 1e-6) return true;
        }
        return false;
      });
      expect(weighted).toHaveLength(0);
    },
  );
});

describe("IK rules", () => {
  it.skipIf(!has.gameContent)("writes the rules stored in the mdl", async () => {
    const out = mkdtempSync(join(tmpdir(), "hsmcp-ikrule-"));
    const result = (await decompileModelTool.handler(
      {
        model: "models/v_models/v_rifle.mdl",
        outDir: out,
        collision: false,
        overwrite: true,
        confirm: true,
      } as never,
      ctx,
    )) as { qc: string };
    const qc = readFileSync(result.qc, "utf8");
    // v_rifle stores 44 rules in the .mdl; a compile of this QC kept 60 (studiomdl expands).
    expect((qc.match(/^\tikrule /gm) ?? []).length).toBeGreaterThanOrEqual(40);
    expect(qc).toMatch(/\tikrule "[^"]+" (touch "[^"]+"|footstep|release|unlatch|attachment "[^"]*")/);
    rmSync(out, { recursive: true, force: true });
  }, 60_000);
});
