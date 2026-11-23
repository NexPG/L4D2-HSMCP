/**
 * Sequence options survive a decompile.
 *
 * `gascan001a.mdl` is the oracle: its `pullpin`/`throw`/`melee` sequences carry `STUDIO_SNAP`
 * (0x2), `a_gasCan_vaims` carries `STUDIO_HIDDEN` (0x400), and `gasCan_idle`/`a_gasCan_vaims`
 * carry `STUDIO_DELTA` (0x4). The first two are written as QC options and were verified by a
 * real compile (flags came back 0x2 and 0x400); `delta` is deliberately not written because
 * the SMDs are baked frames.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { decompileModelTool } from "../../src/models/typescript/tools/decompile.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hsmcp-seqopt-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

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
    )) as { qc: string };
    const qc = readFileSync(result.qc, "utf8");

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
