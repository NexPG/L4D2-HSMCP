/**
 * The two inspection tools that make a compiled model arguable without recompiling it.
 *
 * `read_model_skeleton` is checked against the values the viewmodel prefab pack's
 * `bones.qci` records for `v_bat`: `ValveBiped.weapon_bone` is the line that proves the
 * `(y, z, x)` rotation order, because the other two orders do not produce
 * `(-89.999989, -89.74596, 0)`.
 *
 * `read_model_animation` is checked against three facts the `.mdl` has always carried and
 * no tool reported: the three-way aim blend's animation list, the melee particle event on
 * `swing_e_w_03` (frame 8), and the four IK chains plus the included animation model on
 * `boomette`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readModelAnimationTool } from "../../src/models/typescript/tools/animation.js";
import { readModelSkeletonTool } from "../../src/models/typescript/tools/skeleton.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-inspect-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe.skipIf(!has.gameContent)("read_model_skeleton", () => {
  it("writes v_bat's 63 definebones in the order bones.qci uses", async () => {
    const r = (await readModelSkeletonTool.handler(
      { model: "weapons/melee/v_bat.mdl" } as never,
      ctx,
    )) as {
      boneCount: number;
      rootCount: number;
      bones: Array<{
        index: number;
        name: string;
        parentName: string | null;
        position: [number, number, number];
        defineBoneRotation: [number, number, number];
      }>;
      defineBones: string[];
      qc: string;
    };
    expect(r.boneCount).toBe(63);
    expect(r.rootCount).toBe(1);
    expect(r.defineBones).toHaveLength(63);
    const weapon = r.bones.find((bone) => bone.name === "ValveBiped.weapon_bone")!;
    expect(weapon.parentName).toBe("ValveBiped.Bip01");
    expect(weapon.position[0]).toBeCloseTo(8.329032, 4);
    expect(weapon.position[1]).toBeCloseTo(7.655514, 4);
    expect(weapon.position[2]).toBeCloseTo(0, 4);
    // `$DefineBone "ValveBiped.weapon_bone" "ValveBiped.Bip01" 8.329032 7.655514 0
    //  -89.999989 -89.74596 0` from the prefab pack.
    expect(weapon.defineBoneRotation[0]).toBeCloseTo(-89.999989, 4);
    expect(weapon.defineBoneRotation[1]).toBeCloseTo(-89.74596, 4);
    expect(weapon.defineBoneRotation[2]).toBeCloseTo(0, 4);
    expect(r.qc).toContain('$definebone "ValveBiped.weapon_bone" "ValveBiped.Bip01"');
    expect(r.qc.trim().split("\n")).toHaveLength(63);
  });

  it("reads a local .mdl path as well as an engine path", async () => {
    const path = join(scratch, "v_bat.mdl");
    writeFileSync(path, openGameVpk(ctx.config.gameDir!)!.read("models/weapons/melee/v_bat.mdl")!);
    const r = (await readModelSkeletonTool.handler({ path } as never, ctx)) as {
      boneCount: number;
      model: string | null;
    };
    expect(r.boneCount).toBe(63);
    expect(r.model).toBeNull();
  });
});

describe.skipIf(!has.gameContent)("read_model_animation", () => {
  it("reports the blend list, pose parameters and events of v_bat", async () => {
    const r = (await readModelAnimationTool.handler(
      { model: "weapons/melee/v_bat.mdl" } as never,
      ctx,
    )) as {
      sequenceCount: number;
      animationCount: number;
      poseParams: Array<{ name: string; start: number; end: number; loop: number }>;
      sequences: Array<{
        name: string;
        blendCount: number;
        animationNames: string[];
        paramStart: [number, number];
        paramEnd: [number, number];
        events: Array<{ name: string; frame: number; options: string; type: number }>;
      }>;
    };
    expect(r.sequenceCount).toBe(13);
    expect(r.animationCount).toBe(16);
    expect(r.poseParams.map((param) => param.name)).toEqual(["ver_aims", "move_x"]);
    expect(r.poseParams[0]).toMatchObject({ start: -1, end: 1, loop: 0 });

    const aims = r.sequences.find((sequence) => sequence.name === "aims")!;
    expect(aims.blendCount).toBe(3);
    expect(aims.animationNames).toEqual(["a_look_up", "a_look_mid", "a_look_down"]);
    expect(aims.paramStart[0]).toBe(-1);
    expect(aims.paramEnd[0]).toBe(1);

    const swing = r.sequences.find((sequence) => sequence.name === "swing_e_w_03")!;
    expect(swing.events).toHaveLength(1);
    expect(swing.events[0]!.name).toBe("AE_CL_CREATE_PARTICLE_EFFECT");
    expect(swing.events[0]!.frame).toBe(8);
    expect(swing.events[0]!.type).toBe(1024);
    expect(swing.events[0]!.options).toContain("weapon_melee_blur_baseball_bat");
  });

  it("reports boomette's IK chains, pose parameters and included animation model", async () => {
    const r = (await readModelAnimationTool.handler(
      { model: "infected/boomette.mdl" } as never,
      ctx,
    )) as {
      ikChains: Array<{ name: string; linkType: number; bones: number[]; knee: number[] }>;
      poseParams: Array<{ name: string; start: number; end: number; loop: number }>;
      includedModels: Array<{ label: string; model: string }>;
      mass: number;
      contents: number;
      warnings: string[];
    };
    expect(r.ikChains.map((chain) => chain.name)).toEqual(["rhand", "lhand", "rfoot", "lfoot"]);
    for (const chain of r.ikChains) expect(chain.bones).toHaveLength(3);
    expect(r.ikChains[0]!.knee.map((value) => Number(value.toFixed(3)))).toEqual([0.707, 0.707, 0]);
    expect(r.ikChains[2]!.knee.map((value) => Number(value.toFixed(3)))).toEqual([0.707, -0.707, 0]);
    expect(r.poseParams.map((param) => param.name)).toEqual([
      "move_yaw",
      "body_pitch",
      "body_yaw",
    ]);
    expect(r.poseParams[0]).toMatchObject({ start: -180, end: 180, loop: 360 });
    expect(r.includedModels).toEqual([
      { index: 0, label: "", model: "models/infected/anim_boomer.mdl" },
    ]);
    expect(r.mass).toBe(100);
    expect(r.contents).toBe(1);
    expect(r.warnings).toEqual([]);
  });

  it("filters by sequence name and reports what it returned", async () => {
    const r = (await readModelAnimationTool.handler(
      { model: "weapons/melee/v_bat.mdl", sequence: "swing", limit: 2 } as never,
      ctx,
    )) as {
      sequenceCount: number;
      returned: number;
      sequences: Array<{ name: string }>;
    };
    expect(r.sequenceCount).toBe(13);
    expect(r.returned).toBe(2);
    expect(r.sequences).toHaveLength(2);
    expect(r.sequences.every((sequence) => sequence.name.includes("swing"))).toBe(true);
  });
});
