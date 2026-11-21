/**
 * MDL animation decoding.
 *
 * `l4d_gift.mdl` has one sequence, `spin`, with 31 frames at 10 fps, stored directly in the
 * `.mdl` (no `.ani`, no sections). The RLE stream is three rotation channels; the Z angle
 * must move across the clip, not stay at the bind pose.
 *
 * `small_cabinet.mdl` adds position channels and a one-frame raw-rotation idle, and
 * `v_bat.mdl` has 3-wide blend sequences the decompiler must refuse rather than flatten.
 */
import { describe, expect, it } from "vitest";
import {
  decodeAnimation,
  readAnimations,
  readAnimValue,
  readSequences,
} from "../../src/models/typescript/formats/mdlanim.js";
import { readMdlBones } from "../../src/models/typescript/formats/mdlbones.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { ctx, has } from "../support/env.js";

describe("readAnimValue", () => {
  it("walks RLE blocks and repeats the last stored value", () => {
    // One block: valid 2, total 4, values 10 and 20.
    const bytes = Buffer.alloc(6);
    bytes[0] = 2;
    bytes[1] = 4;
    bytes.writeInt16LE(10, 2);
    bytes.writeInt16LE(20, 4);
    expect([0, 1, 2, 3].map((frame) => readAnimValue(bytes, frame, 0, 1))).toEqual([10, 20, 20, 20]);
    // The stream ends after four frames, so later frames are 0, not the held value.
    expect(readAnimValue(bytes, 4, 0, 1)).toBe(0);
  });

  it("moves to the next block and scales", () => {
    const block = Buffer.alloc(8);
    block[0] = 1;
    block[1] = 2;
    block.writeInt16LE(5, 2);
    block[4] = 1;
    block[5] = 3;
    block.writeInt16LE(-9, 6);
    expect([0, 1, 2, 3, 4].map((frame) => readAnimValue(block, frame, 0, 2))).toEqual([
      10, 10, -18, -18, -18,
    ]);
    expect(readAnimValue(block, 0, 0, 1)).toBe(5);
  });
});

describe.skipIf(!has.gameContent)("mdlanim", () => {
  const mdl = (path: string): Buffer => openGameVpk(ctx.config.gameDir!)!.read(path)!;
  const gift = (): Buffer => mdl("models/items/l4d_gift.mdl");

  it("reads the sequence and its animation descriptor", () => {
    const bytes = gift();
    const animations = readAnimations(bytes);
    const sequences = readSequences(bytes, animations);
    expect(animations).toHaveLength(1);
    expect(animations[0]!.name).toBe("@spin");
    expect(animations[0]!.frameCount).toBe(31);
    expect(animations[0]!.fps).toBe(10);
    expect(animations[0]!.animBlock).toBe(0);
    expect(sequences).toHaveLength(1);
    expect(sequences[0]!.name).toBe("spin");
    expect(sequences[0]!.flags & 1).toBe(1);
    expect(sequences[0]!.firstAnimation).toBe(0);
    expect(sequences[0]!.groupSizes).toEqual([1, 1]);
  });

  it("decodes 31 frames and moves the root", () => {
    const bytes = gift();
    const animations = readAnimations(bytes);
    const bones = readMdlBones(bytes);
    const frames = decodeAnimation(bytes, animations[0]!, bones);
    expect(frames).not.toBeNull();
    expect(frames!).toHaveLength(31);
    const first = frames![0]!.bones[0]!;
    const middle = frames![10]!.bones[0]!;
    expect(first.rotation.every(Number.isFinite)).toBe(true);
    expect(middle.rotation.every(Number.isFinite)).toBe(true);
    // The gift spins around Z and returns to its start after a full turn; a decoder that
    // fell back to the bind pose would be flat at every frame, so check the middle.
    expect(Math.abs(middle.rotation[2] - first.rotation[2])).toBeGreaterThan(0.5);
  });

  it("decodes position channels and mirrors the cabinet doors", () => {
    const bytes = mdl("models/props_buildables/small_cabinet.mdl");
    const animations = readAnimations(bytes);
    const sequences = readSequences(bytes, animations);
    const bones = readMdlBones(bytes);
    const open = sequences.find((sequence) => sequence.name === "open");
    expect(open).toBeDefined();
    const frames = decodeAnimation(bytes, animations[open!.firstAnimation]!, bones);
    expect(frames).toHaveLength(18);
    const right = frames![17]!.bones[0]!;
    const left = frames![17]!.bones[2]!;
    expect(right.position.every(Number.isFinite)).toBe(true);
    // Hinge pivots push the right door to negative Y and the left door to positive Y.
    expect(Math.abs(right.position[1])).toBeGreaterThan(5);
    expect(Math.sign(right.position[1])).not.toBe(Math.sign(left.position[1]));
  });

  it("reports blend counts instead of pretending one animation is the sequence", () => {
    const bytes = mdl("models/weapons/melee/v_bat.mdl");
    const sequences = readSequences(bytes, readAnimations(bytes));
    const aims = sequences.find((sequence) => sequence.name === "aims");
    expect(aims?.blendCount).toBe(3);
    expect(aims?.groupSizes).toEqual([3, 1]);
    expect(sequences.find((sequence) => sequence.name === "deploy")?.groupSizes).toEqual([1, 1]);
  });

  it("refuses external and sectioned clips", () => {
    const bytes = gift();
    const animations = readAnimations(bytes);
    const bones = readMdlBones(bytes);
    const external = { ...animations[0]!, animBlock: 1 };
    const sectioned = { ...animations[0]!, sectionFrameCount: 30, sectionOffset: 100 };
    expect(decodeAnimation(bytes, external, bones)).toBeNull();
    expect(decodeAnimation(bytes, sectioned, bones)).toBeNull();

    // car_camjoint's escape clips are sectioned but their data is otherwise in the MDL.
    const cam = mdl("models/c1_chargerexit/car_camjoint.mdl");
    const camAnimations = readAnimations(cam);
    const escape = camAnimations.find((animation) => animation.name === "@escape_a");
    expect(escape?.sectionFrameCount).toBeGreaterThan(0);
    expect(decodeAnimation(cam, escape!, readMdlBones(cam))).toBeNull();
  });
});
