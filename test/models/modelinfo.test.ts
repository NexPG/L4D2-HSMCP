/**
 * The deep half of `read_model_info`: the data mdlpp's struct definitions carry and the
 * old reader threw away.
 *
 * A model browser shows bounds and a list of skins. What a mapper or a model author needs
 * before shipping is different: which activity a sequence maps to, what events fire at
 * which cycle, which bone a hitbox follows and where that box is, which material each skin
 * swaps, and what `$cdmaterials` expects. These are measured against stock L4D2 models,
 * not synthesised: the numbers are the oracle.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readModelInfoTool } from "../../src/assets/typescript/tools/content.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const ready = has.sidecar && has.gameContent;

interface ModelReply {
  found: boolean;
  surfaceprop?: string;
  mass?: number;
  cdmaterials?: string[];
  skins?: string[][];
  sequenceDetails?: Array<{
    label: string;
    activity: string;
    actWeight: number;
    flags: number;
    eventCount: number;
    events: Array<{ type: string; cycle: number; options: string }>;
    bboxMin: number[] | null;
    bboxMax: number[] | null;
  }>;
  bodyParts?: Array<{
    name: string;
    models: number;
    modelList?: Array<{ name: string; meshes: number; vertices: number }>;
  }>;
  hitboxSets?: Array<{
    name: string;
    hitboxes: number;
    boxes?: Array<{
      name: string;
      bone: number;
      boneName: string | null;
      group: number;
      mins: number[];
      maxs: number[];
    }>;
  }>;
  viewBounds?: { mins: number[] | null; maxs: number[] | null };
  eyePosition?: number[] | null;
  includedModels?: Array<{ label: string; filename: string }>;
}

const info = (model: string): Promise<ModelReply> =>
  readModelInfoTool.handler({ model } as never, ctx) as unknown as Promise<ModelReply>;

describe("read_model_info, deep fields", () => {
  it.skipIf(!ready)("reports activities and events per sequence, not just labels", async () => {
    const r = await info("v_models/v_rifle.mdl");
    expect(r.found).toBe(true);
    const sequences = r.sequenceDetails ?? [];
    expect(sequences.length).toBeGreaterThan(5);

    const deploy = sequences.find((s) => s.label === "deploy_layer")!;
    expect(deploy.activity).toBe("ACT_VM_DEPLOY_LAYER");
    expect(deploy.actWeight).toBeGreaterThan(0);
    expect(deploy.eventCount).toBeGreaterThanOrEqual(3);
    const sound = deploy.events.find((e) => e.type.includes("CL_EVENT_SOUND"))!;
    expect(sound.options).toBe("Rifle.Deploy");
    expect(sound.cycle).toBeGreaterThanOrEqual(0);
    expect(sound.cycle).toBeLessThanOrEqual(1);

    const fire = sequences.find((s) => s.label === "fire")!;
    expect(fire.activity).toBe("ACT_VM_PRIMARYATTACK");
    expect(fire.events.some((e) => e.type.includes("MUZZLEFLASH"))).toBe(true);
  });

  it.skipIf(!ready)("reports hitbox geometry on the bone each box follows", async () => {
    const r = await info("v_models/v_rifle.mdl");
    const set = (r.hitboxSets ?? []).find((s) => s.name === "default")!;
    expect(set.hitboxes).toBeGreaterThan(0);
    const box = set.boxes![0]!;
    expect(box).toBeDefined();
    expect(box.boneName).toBeTruthy();
    expect(box.mins).toHaveLength(3);
    expect(box.maxs).toHaveLength(3);
    // A box is a box: every maximum is at or above the matching minimum.
    for (let i = 0; i < 3; i += 1) expect(box.maxs[i]!).toBeGreaterThanOrEqual(box.mins[i]!);
  });

  it.skipIf(!ready)("names the model inside each body part", async () => {
    const r = await info("props_junk/gascan001a");
    const body = (r.bodyParts ?? []).find((b) => b.name === "Body")!;
    expect(body.models).toBeGreaterThan(0);
    expect(body.modelList![0]!.name).toMatch(/gascan001a/i);
    expect(body.modelList![0]!.meshes).toBeGreaterThan(0);
    expect(body.modelList![0]!.vertices).toBeGreaterThan(0);
  });

  it.skipIf(!ready)("reports material tables, surface and mass", async () => {
    const r = await info("props_junk/gascan001a");
    expect(r.surfaceprop).toBe("metal");
    expect(r.mass).toBeGreaterThan(0);
    expect((r.cdmaterials ?? []).some((m) => m.includes("props_junk"))).toBe(true);
    expect((r.skins ?? []).length).toBeGreaterThan(0);
    expect((r.skins ?? [])[0]![0]).toMatch(/phys_objects/);
    expect(r.viewBounds?.mins).not.toBeNull();
  });
});
