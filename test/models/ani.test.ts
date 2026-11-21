/**
 * External `.ani` containers: header, block table and block usage.
 *
 * `anim_gestures` is small and stock: four non-empty blocks after a 416-byte header, all
 * frame-by-bone (`STUDIO_FRAMEANIM`), every block referenced. `hospital_bed` has no `.ani`.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readModelAniTool } from "../../src/models/typescript/tools/ani.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

interface AniResult {
  present: boolean;
  aniPath: string;
  size: number;
  magic: string | null;
  version: number | null;
  blockCount: number;
  nonEmptyBlocks: number;
  headerBytes: number;
  animationCount: number;
  externalAnimations: number;
  internalAnimations: number;
  externalFrames: number;
  returned: number;
  blocks: Array<{
    index: number;
    start: number;
    end: number;
    bytes: number;
    empty: boolean;
    animations: number;
    frames: number;
    frameAnim: number;
    sectioned: number;
    delta: number;
    sequenceCount: number;
    sequences: string[];
    animationNames: string[];
  }>;
  warnings: string[];
  note?: string;
}

describe.skipIf(!has.gameContent)("read_model_ani", () => {
  it("reports anim_gestures' blocks and clip usage", async () => {
    const r = (await readModelAniTool.handler(
      { model: "survivors/anim_gestures.mdl" } as never,
      ctx,
    )) as unknown as AniResult;

    expect(r.present).toBe(true);
    expect(r.aniPath).toBe("models/survivors/anim_gestures.ani");
    expect(r.size).toBe(113456);
    expect(r.magic).toBe("IDAG");
    expect(r.version).toBe(49);
    // Block 0 is the conventional empty slot; the four data blocks follow a 416-byte header.
    expect(r.blockCount).toBe(5);
    expect(r.nonEmptyBlocks).toBe(4);
    expect(r.headerBytes).toBe(416);
    expect(r.blocks[0]).toMatchObject({ start: 0, end: 0, bytes: 0, empty: true });
    expect(r.blocks[4]).toMatchObject({
      start: 93568,
      end: 113456,
      bytes: 19888,
      empty: false,
    });
    expect(r.animationCount).toBe(119);
    expect(r.externalAnimations).toBe(119);
    expect(r.internalAnimations).toBe(0);
    expect(r.externalFrames).toBe(1700);
    // Every stock gesture clip is frame-by-bone and none is sectioned.
    expect(r.blocks.filter((block) => !block.empty).every((block) => block.frameAnim === block.animations)).toBe(
      true,
    );
    expect(r.blocks.every((block) => block.sectioned === 0 && block.delta === 0)).toBe(true);
    expect(r.blocks[1]!.animations).toBe(37);
    expect(r.blocks[1]!.frames).toBe(478);
    expect(r.blocks[1]!.sequenceCount).toBe(34);
    expect(r.blocks[1]!.animationNames[0]).toBe("@namvet_gesture_overherezero");
    expect(r.blocks.reduce((sum, block) => sum + block.bytes, 0)).toBe(113040);
    expect(r.warnings).toEqual([]);
  });

  it("filters by block and by sequence", async () => {
    const byBlock = (await readModelAniTool.handler(
      { model: "survivors/anim_gestures.mdl", block: 1 } as never,
      ctx,
    )) as unknown as AniResult;
    expect(byBlock.returned).toBe(1);
    expect(byBlock.blocks[0]).toMatchObject({ index: 1, start: 416, end: 32928, bytes: 32512 });

    const bySequence = (await readModelAniTool.handler(
      { model: "survivors/anim_gestures.mdl", sequence: "head_yes" } as never,
      ctx,
    )) as unknown as AniResult;
    expect(bySequence.returned).toBe(1);
    expect(bySequence.blocks[0]!.index).toBe(2);
    expect(bySequence.blocks[0]!.sequences).toContain("namvet_gesture_head_yes");
  });

  it("says when a model keeps its animations inside the .mdl", async () => {
    const r = (await readModelAniTool.handler(
      { model: "props_unique/hospital/hospital_bed.mdl" } as never,
      ctx,
    )) as unknown as AniResult;
    expect(r.present).toBe(false);
    expect(r.size).toBe(0);
    expect(r.blockCount).toBe(0);
    expect(r.internalAnimations).toBe(1);
    expect(r.note).toContain("stored inside the .mdl");
  });
});
