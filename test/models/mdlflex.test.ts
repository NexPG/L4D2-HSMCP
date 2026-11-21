/**
 * Flex descriptors, controllers, rules and mesh deltas.
 *
 * `boomette` has one flex, `presser`, with 1,068 normal-only deltas; `common_morph_test` has
 * `fatness` with 593 position deltas. The reader is tested independently of VTA writing: the
 * decompiler still reports flexes as a gap.
 */
import { describe, expect, it } from "vitest";
import { flexRuleExpression, readFlexHeader } from "../../src/models/typescript/formats/mdlflex.js";
import { loadGameModel } from "../../src/assets/typescript/game/models.js";
import { openGameVpk } from "../../src/assets/typescript/game/vpkcontent.js";
import { ctx, has } from "../support/env.js";

describe.skipIf(!has.gameContent)("mdlflex", () => {
  const archive = (): NonNullable<ReturnType<typeof openGameVpk>> => openGameVpk(ctx.config.gameDir!)!;

  it("reads a normal-only flex and its rule", () => {
    const geometry = loadGameModel(archive(), "models/infected/boomette.mdl")!;
    expect(geometry.flex.descriptors).toEqual(["presser"]);
    expect(geometry.flex.controllers).toEqual([
      { type: "presser", name: "presser", min: 0, max: 1 },
    ]);
    expect(geometry.flex.rules).toHaveLength(1);
    expect(flexRuleExpression(geometry.flex.rules[0]!, geometry.flex)).toBe("presser");

    const flex = geometry.bodyParts[0]!.models[0]!.meshes[0]!.flexes![0]!;
    expect(flex.flexDesc).toBe(0);
    expect(flex.vertices).toHaveLength(1068);
    expect(flex.vertices.every((vertex) => vertex.index >= 0)).toBe(true);
    expect(flex.vertices.some((vertex) => vertex.normalDelta.some((value) => value !== 0))).toBe(
      true,
    );
    expect(flex.vertices.every((vertex) => vertex.delta.every(Number.isFinite))).toBe(true);
  });

  it("reads position deltas with the 1/4096 scale", () => {
    const geometry = loadGameModel(archive(), "models/infected/common_morph_test.mdl")!;
    expect(geometry.flex.descriptors).toEqual(["fatness"]);
    const flex = geometry.bodyParts[0]!.models[0]!.meshes[0]!.flexes![0]!;
    expect(flex.vertices).toHaveLength(593);
    const first = flex.vertices[0]!;
    expect(first.delta.some((value) => Math.abs(value) > 0.01)).toBe(true);
    // The raw value is a 16-bit fixed-point number; the scale is what makes it model units.
    expect(first.delta.every((value) => Math.abs(value) < 8)).toBe(true);
    expect(first.normalDelta).toEqual([0, 0, 0]);
  });

  it("returns no rule text for an unknown op", () => {
    const geometry = loadGameModel(archive(), "models/infected/boomette.mdl")!;
    const broken = { ...geometry.flex.rules[0]!, ops: [{ op: 99, index: 0, value: 0 }] };
    expect(flexRuleExpression(broken, geometry.flex)).toBeNull();
    expect(readFlexHeader(Buffer.alloc(0)).descriptors).toEqual([]);
  });
});
