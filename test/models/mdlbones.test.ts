/**
 * Quaternion/Euler conversion used by the SMD writer.
 *
 * SMD `time` lines are `roll pitch yaw`, so `quaternionToEuler` must return that order. A
 * basis rotation is the cheapest way to catch a swapped axis: the earlier implementation
 * quietly lost a pure X rotation, which would have flattened every `RAWROT` clip.
 */
import { describe, expect, it } from "vitest";
import { eulerToQuaternion, quaternionToEuler } from "../../src/models/typescript/formats/mdlbones.js";

const TAU = Math.PI * 2;

function expectQuaternionClose(
  actual: [number, number, number, number],
  expected: [number, number, number, number],
): void {
  const same = Math.abs(actual[0] - expected[0]) +
    Math.abs(actual[1] - expected[1]) +
    Math.abs(actual[2] - expected[2]) +
    Math.abs(actual[3] - expected[3]);
  const negated = Math.abs(actual[0] + expected[0]) +
    Math.abs(actual[1] + expected[1]) +
    Math.abs(actual[2] + expected[2]) +
    Math.abs(actual[3] + expected[3]);
  expect(Math.min(same, negated)).toBeLessThan(1e-6);
}

describe("quaternionToEuler", () => {
  it("keeps a pure rotation on each axis", () => {
    for (const [angle, axis] of [[0.7, 0], [0.7, 1], [0.7, 2]] as const) {
      const euler = [0, 0, 0];
      euler[axis] = angle;
      const q = eulerToQuaternion(euler[0]!, euler[1]!, euler[2]!);
      const result = quaternionToEuler(q);
      expect(result[0]).toBeCloseTo(euler[0]!, 6);
      expect(result[1]).toBeCloseTo(euler[1]!, 6);
      expect(result[2]).toBeCloseTo(euler[2]!, 6);
    }
  });

  it("round-trips composed rotations", () => {
    const cases = [
      [0.3, -0.7, 1.1],
      [1.2, 0.4, -2.4],
      [-0.2, 0.9, 0.05],
    ] as const;
    for (const [roll, pitch, yaw] of cases) {
      const q = eulerToQuaternion(roll, pitch, yaw);
      const e = quaternionToEuler(q);
      expectQuaternionClose(eulerToQuaternion(e[0], e[1], e[2]), q);
    }
  });

  it("handles gimbal lock without losing the turn", () => {
    const q = eulerToQuaternion(0.6, Math.PI / 2, -0.9);
    const e = quaternionToEuler(q);
    expect(e.every(Number.isFinite)).toBe(true);
    expect(Math.abs(e[1])).toBeCloseTo(Math.PI / 2, 6);
    // yaw is folded into roll; the resulting quaternion must still be the same rotation.
    expectQuaternionClose(eulerToQuaternion(e[0], e[1], e[2]), q);
    expect(Math.abs(e[2]) % TAU).toBeCloseTo(0, 12);
  });
});
