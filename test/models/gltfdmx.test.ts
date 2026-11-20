/**
 * glTF shape keys -> DMX -> Source flexes.
 *
 * The DMX shape-key graph is easy to get almost right: the compiler will happily write a
 * flex payload and then produce zero flex rules, which means nothing drives the flex. The
 * end-to-end test therefore compiles the generated DMX with the real `studiomdl.exe` and
 * reads `numflexdesc`, `numflexcontrollers` and `numflexrules` from the MDL header. The
 * fixture is a two-bone skin with one position morph target, so the skeleton path is covered
 * too.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { loadQc } from "../../src/formats/typescript/formats/qc.js";
import { readModelInfoTool } from "../../src/assets/typescript/tools/content.js";
import { gltfToDmxTool } from "../../src/models/typescript/tools/gltfdmx.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { config, ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-gltfdmx-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface View {
  buffer: number;
  byteOffset: number;
  byteLength: number;
}

class Bin {
  readonly views: View[] = [];
  private readonly parts: Buffer[] = [];
  private length = 0;

  add(data: Buffer): number {
    while (this.length % 4 !== 0) {
      this.parts.push(Buffer.from([0]));
      this.length += 1;
    }
    const index = this.views.length;
    this.views.push({ buffer: 0, byteOffset: this.length, byteLength: data.length });
    this.parts.push(data);
    this.length += data.length;
    return index;
  }

  bytes(): Buffer {
    return Buffer.concat(this.parts);
  }
}

function floats(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

function accessor(
  bufferView: number,
  componentType: number,
  count: number,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { bufferView, componentType, count, type, ...extra };
}

function writeGltf(dir: string, name: string, document: unknown, bin: Buffer): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.gltf`);
  const binName = `${name}.bin`;
  writeFileSync(join(dir, binName), bin);
  writeFileSync(path, JSON.stringify({ ...(document as object), buffers: [{ uri: binName, byteLength: bin.length }] }));
  return path;
}

/** Two-bone skin, triangle, one morph target named `wide` that moves every vertex +X. */
function skinnedMorphScene() {
  const bin = new Bin();
  const positions = bin.add(floats([0, 0, 0, 10, 0, 0, 0, 10, 0]));
  const normals = bin.add(floats([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  const uvs = bin.add(floats([0, 0, 1, 0, 0, 1]));
  const joints = bin.add(Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]));
  const weights = bin.add(floats([0.25, 0.75, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]));
  // IBM: root bind world (1,2,3), spine bind world (1,12,3).
  const ibm = bin.add(
    floats([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1,
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -12, -3, 1,
    ]),
  );
  const morph = bin.add(floats([4, 0, 0, 4, 0, 0, 4, 0, 0]));
  const indices = bin.add(Buffer.from(new Uint16Array([0, 1, 2]).buffer));
  const morphNormals = bin.add(floats([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "root", translation: [1, 2, 3], children: [1] },
      { name: "spine", translation: [0, 5, 0] },
      { name: "body", mesh: 0, skin: 0 },
    ],
    meshes: [
      {
        name: "body",
        extras: { targetNames: ["wide"] },
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, JOINTS_0: 3, WEIGHTS_0: 4 },
            indices: 7,
            material: 0,
            targets: [{ POSITION: 6, NORMAL: 8 }],
          },
        ],
      },
    ],
    materials: [{ name: "skin/mat" }],
    skins: [{ joints: [0, 1], inverseBindMatrices: 5 }],
    bufferViews: bin.views,
    accessors: [
      accessor(positions, 5126, 3, "VEC3", { min: [0, 0, 0], max: [10, 10, 0] }),
      accessor(normals, 5126, 3, "VEC3"),
      accessor(uvs, 5126, 3, "VEC2"),
      accessor(joints, 5121, 3, "VEC4"),
      accessor(weights, 5126, 3, "VEC4"),
      accessor(ibm, 5126, 2, "MAT4"),
      accessor(morph, 5126, 3, "VEC3"),
      accessor(indices, 5123, 3, "SCALAR"),
      accessor(morphNormals, 5126, 3, "VEC3"),
    ],
  };
  return { document, bin: bin.bytes() };
}

const installed = has.sidecar;

describe.skipIf(!installed)("gltf_to_dmx", () => {
  it("writes a DMX with the delta state, control and the weights that drive a rule", async () => {
    const dir = join(scratch, "dmx");
    const { document, bin } = skinnedMorphScene();
    const source = writeGltf(dir, "morph", document, bin);
    const dmx = join(dir, "morph.dmx");
    const converted = await callSidecar<{
      verified: boolean;
      triangles: number;
      vertices: number;
      positions: number;
      boneCount: number;
      skinned: boolean;
      morphTargets: Array<{ name: string; deltas: number; maxDelta: number }>;
      morphTargetCount: number;
    flexNormalDeltas: number;
      ignoredAnimations: number;
    }>("gltf_to_dmx", { path: source, out: dmx }, config);
    expect(converted.verified).toBe(true);
    expect(converted.triangles).toBe(1);
    expect(converted.vertices).toBe(3);
    expect(converted.positions).toBe(3);
    expect(converted.boneCount).toBe(2);
    expect(converted.skinned).toBe(true);
    expect(converted.morphTargetCount).toBe(1);
    expect(converted.morphTargets[0]).toMatchObject({ name: "wide", deltas: 3, maxDelta: 4 });
    expect(converted.flexNormalDeltas).toBe(3);
    expect(converted.ignoredAnimations).toBe(0);

    const read = await callSidecar<{
      read: boolean;
      elementTypes: Record<string, number>;
      elementCount: number;
      format: string;
      formatVersion: number;
    }>("dmx_read", { path: dmx, maxDepth: 2 }, config);
    expect(read.read).toBe(true);
    expect(read.format).toBe("model");
    expect(read.formatVersion).toBe(15);
    expect(read.elementTypes.DmeVertexDeltaData).toBe(1);
    expect(read.elementTypes.DmeCombinationInputControl).toBe(1);
    expect(read.elementTypes.DmeCombinationOperator).toBe(1);
    expect(read.elementTypes.DmeMesh).toBe(1);
  });

  it("refuses to replace an existing DMX without overwrite", async () => {
    const dir = join(scratch, "overwrite");
    const { document, bin } = skinnedMorphScene();
    const source = writeGltf(dir, "morph", document, bin);
    const dmx = join(dir, "morph.dmx");
    await callSidecar("gltf_to_dmx", { path: source, out: dmx }, config);
    await expect(
      callSidecar("gltf_to_dmx", { path: source, out: dmx }, config),
    ).rejects.toThrow(/already exists/);
  });
});

describe.skipIf(!installed || !has.toolchain)("glTF morph -> DMX -> studiomdl", () => {
  it(
    "compiles the DMX to a model with flexdesc, controllers and rules",
    async () => {
      const dir = join(scratch, "compile");
      const { document, bin } = skinnedMorphScene();
      const source = writeGltf(dir, "morph", document, bin);
      const dmx = join(dir, "morph.dmx");
      const qc = join(dir, "morph.qc");
      const unique = `hsmcp_flex_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
      let compiledModel: string | null = null;

      try {
        const converted = (await gltfToDmxTool.handler(
          {
            path: source,
            output: dmx,
            scale: 1,
            axis: "z",
            useNodeTransforms: false,
            flipV: true,
            parts: [],
            material: "debug/debugempty",
            qc: {
              path: qc,
              modelname: `${unique}/morph.mdl`,
              surfaceprop: "flesh",
              staticprop: false,
              sequence: "idle",
              fps: 30,
              overwrite: false,
            },
            overwrite: false,
            confirm: true,
          },
          ctx,
        )) as { morphTargetCount: number; qc: { diagnostics: { severity: string }[] } };
        expect(converted.morphTargetCount).toBe(1);
        expect(converted.qc.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

        const compile = (await runStudiomdlTool.handler(
          { qc, timeoutMinutes: 2, confirm: true },
          ctx,
        )) as { ok: boolean; model: string | null; warning: string | null };
        compiledModel = compile.model;
        expect(compile.ok).toBe(true);
        expect(compile.warning).toBeNull();
        expect(compiledModel).not.toBeNull();

        const data = readFileSync(compiledModel!, { encoding: null });
        const flexdesc = data.readUInt32LE(260);
        const controllers = data.readUInt32LE(268);
        const rules = data.readUInt32LE(276);
        expect(flexdesc).toBeGreaterThanOrEqual(1);
        expect(controllers).toBeGreaterThanOrEqual(1);
        // The point of the deltaStateWeights: without them rules is 0.
        expect(rules).toBeGreaterThanOrEqual(1);

        const info = (await readModelInfoTool.handler(
          { model: `models/${unique}/morph.mdl` },
          ctx,
        )) as {
          found: boolean;
          boneCount: number;
          hasPhysics: boolean;
          flexdescCount: number;
          flexcontrollerCount: number;
          flexruleCount: number;
        };
        expect(info.found).toBe(true);
        expect(info.boneCount).toBe(2);
        expect(info.hasPhysics).toBe(false);
        expect(info.flexdescCount).toBeGreaterThanOrEqual(1);
        expect(info.flexcontrollerCount).toBeGreaterThanOrEqual(1);
        expect(info.flexruleCount).toBeGreaterThanOrEqual(1);
      } finally {
        const folder = compiledModel
          ? dirname(compiledModel)
          : config.gameDir
            ? join(config.gameDir, "models", unique)
            : null;
        if (folder && existsSync(folder) && folder.toLowerCase().includes(unique.toLowerCase())) {
          rmSync(folder, { recursive: true, force: true });
        }
      }
    },
    120_000,
  );
});
