/**
 * `read_model_flexes`: the read side of the MDL flex system.
 *
 * The decompiler reports flexes as a gap, so this tool is how an agent can still tell what a
 * model's face is made of: descriptors, controllers, rules and sampled per-vertex deltas.
 */
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { readModelFlexesTool } from "../../src/models/typescript/tools/flexes.js";
import { ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

interface FlexReport {
  descriptors: string[];
  controllers: Array<{ name: string; type: string; min: number; max: number }>;
  rules: Array<{ descriptor: string | null; expression: string | null; opCount: number }>;
  flexVertexCount: number;
  bodyParts: Array<{
    models: Array<{
      meshes: Array<{
        flexes: Array<{
          descriptor: string;
          vertexCount: number;
          sample: Array<{
            index: number;
            position: [number, number, number] | null;
            delta: [number, number, number];
            normalDelta: [number, number, number];
          }>;
        }>;
      }>;
    }>;
  }>;
}

describe.skipIf(!has.gameContent)("read_model_flexes", () => {
  it("reads a normal-only flex and its rule", async () => {
    const report = (await readModelFlexesTool.handler(
      { model: "infected/boomette.mdl", maxVertices: 2 } as never,
      ctx,
    )) as unknown as FlexReport;
    expect(report.descriptors).toEqual(["presser"]);
    expect(report.controllers).toEqual([
      { type: "presser", name: "presser", min: 0, max: 1 },
    ]);
    expect(report.rules).toHaveLength(1);
    expect(report.rules[0]!.expression).toBe("presser");
    expect(report.flexVertexCount).toBe(1068);
    const flex = report.bodyParts[0]!.models[0]!.meshes[0]!.flexes[0]!;
    expect(flex.descriptor).toBe("presser");
    expect(flex.vertexCount).toBe(1068);
    expect(flex.sample).toHaveLength(2);
    expect(flex.sample[0]!.position).not.toBeNull();
    expect(flex.sample.some((vertex) => vertex.normalDelta.some((value) => value !== 0))).toBe(
      true,
    );
  });

  it("reads position deltas and the model-space vertex position", async () => {
    const report = (await readModelFlexesTool.handler(
      { model: "infected/common_morph_test.mdl", maxVertices: 3 } as never,
      ctx,
    )) as unknown as FlexReport;
    expect(report.descriptors).toEqual(["fatness"]);
    expect(report.flexVertexCount).toBe(593);
    const flex = report.bodyParts[0]!.models[0]!.meshes[0]!.flexes[0]!;
    expect(flex.vertexCount).toBe(593);
    expect(flex.sample).toHaveLength(3);
    expect(flex.sample.some((vertex) => vertex.delta.some((value) => Math.abs(value) > 0.01))).toBe(
      true,
    );
    expect(flex.sample.every((vertex) => vertex.position !== null)).toBe(true);
  });

  it("reports a missing model instead of throwing", async () => {
    const report = (await readModelFlexesTool.handler(
      { model: "infected/definitely_not_a_model.mdl" } as never,
      ctx,
    )) as unknown as { found: boolean; flexVertexCount: number; note?: string };
    expect(report.found).toBe(false);
    expect(report.flexVertexCount).toBe(0);
    expect(report.note).toMatch(/not installed/);
  });
});
