/**
 * glTF 2.0 / GLB -> SMD.
 *
 * The fixtures are built in the test, byte by byte, because the point is not "does it read
 * a file I happen to have" but "does every convention that makes a Source model correct
 * survive the trip": mesh-space geometry, the SMD V inversion that cancels studiomdl's own,
 * a skeleton taken from `inverseBindMatrices` rather than node TRS, strip winding, sparse
 * accessors, the GLB BIN chunk and a data URI. The negative cases are the ones that would
 * otherwise write a half-empty SMD: a required Draco extension, a missing buffer, an index
 * past POSITION, a scene with no mesh.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/typescript/mcp/registry.js";
import { callSidecar } from "../../src/core/typescript/sidecar/client.js";
import { loadQc } from "../../src/formats/typescript/formats/qc.js";
import { readModelInfoTool } from "../../src/assets/typescript/tools/content.js";
import { gltfToSmdTool, readGltfTool } from "../../src/models/typescript/tools/gltf.js";
import { runStudiomdlTool } from "../../src/models/typescript/tools/studiomdl.js";
import { config, ctx as sharedCtx, has } from "../support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

const scratch = mkdtempSync(join(tmpdir(), "hammer-gltf-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface View {
  buffer: number;
  byteOffset: number;
  byteLength: number;
}

/** Packs chunks into one buffer, four-byte aligned, and records the bufferViews. */
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

function writeGlb(dir: string, name: string, document: unknown, bin: Buffer): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.glb`);
  const json = Buffer.from(JSON.stringify({ ...(document as object), buffers: [{ byteLength: bin.length }] }), "utf8");
  const jsonPad = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
  const length = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));
  return path;
}

interface StaticOptions {
  nodeTranslation?: [number, number, number];
  material?: string;
}

function staticScene(options: StaticOptions = {}) {
  const bin = new Bin();
  const positions = bin.add(floats([0, 0, 0, 64, 0, 0, 64, 64, 0]));
  const normals = bin.add(floats([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  const uvs = bin.add(floats([0, 0, 1, 0, 1, 1]));
  const indices = bin.add(Buffer.from(new Uint16Array([0, 1, 2]).buffer));
  const document = {
    asset: { version: "2.0", generator: "hammer test" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: "body",
        mesh: 0,
        ...(options.nodeTranslation ? { translation: options.nodeTranslation } : {}),
      },
    ],
    meshes: [
      {
        name: "body",
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [{ name: options.material ?? "materials/models/props/probe/mat.vmt" }],
    bufferViews: bin.views,
    accessors: [
      accessor(positions, 5126, 3, "VEC3", { min: [0, 0, 0], max: [64, 64, 0] }),
      accessor(normals, 5126, 3, "VEC3"),
      accessor(uvs, 5126, 3, "VEC2"),
      accessor(indices, 5123, 3, "SCALAR"),
    ],
  };
  return { document, bin: bin.bytes() };
}

/**
 * A two-bone skin whose `inverseBindMatrices` disagree with its node TRS on purpose: the
 * spine node says (0,5,0) while its bind world says (1,12,3). A reader that uses TRS gets
 * the wrong skeleton; a reader that uses the IBM gets (0,10,0) relative to the root.
 */
function skinnedScene() {
  const bin = new Bin();
  const positions = bin.add(floats([0, 0, 0, 10, 0, 0, 0, 10, 0]));
  const normals = bin.add(floats([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  const uvs = bin.add(floats([0, 0, 1, 0, 0, 1]));
  const joints = bin.add(Buffer.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]));
  const weights = bin.add(floats([0.25, 0.75, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]));
  // Column-major: root bind world (1,2,3), spine bind world (1,12,3).
  const ibm = bin.add(
    floats([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1,
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -12, -3, 1,
    ]),
  );
  const indices = bin.add(Buffer.from(new Uint16Array([0, 1, 2]).buffer));
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
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, JOINTS_0: 3, WEIGHTS_0: 4 },
            indices: 6,
            material: 0,
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
      accessor(indices, 5123, 3, "SCALAR"),
    ],
  };
  return { document, bin: bin.bytes() };
}

interface SmdRead {
  nodes: { id: number; name: string; parent: number }[];
  boneCount: number;
  triangleCount: number;
  materials: { name: string; triangles: number }[];
  diagnostics: { severity: string; rule: string }[];
  ok: boolean;
  triangles?: {
    material: string;
    vertices: {
      position: number[];
      normal: number[];
      uv: number[];
      links: { bone: number; weight: number }[];
    }[];
  }[];
}

const installed = has.sidecar;

describe.skipIf(!installed)("gltf_to_smd", () => {
  it("converts a .gltf triangle, strips the material path and flips the SMD V", async () => {
    const dir = join(scratch, "static");
    const { document, bin } = staticScene();
    const source = writeGltf(dir, "probe", document, bin);
    const smd = join(dir, "probe.smd");

    const converted = await callSidecar<{
      triangles: number;
      materials: { name: string }[];
      boneCount: number;
      verified: boolean;
      warnings: string[];
    }>("gltf_to_smd", { path: source, out: smd }, config);
    expect(converted.triangles).toBe(1);
    expect(converted.materials).toEqual([{ name: "models/props/probe/mat", triangles: 1 }]);
    expect(converted.boneCount).toBe(1);
    expect(converted.verified).toBe(true);
    expect(converted.warnings).toEqual([]);

    const read = await callSidecar<SmdRead>("smd_read", { path: smd, includeTriangles: true }, config);
    expect(read.ok).toBe(true);
    expect(read.nodes).toEqual([{ id: 0, name: "body", parent: -1 }]);
    expect(read.materials).toEqual([{ name: "models/props/probe/mat", triangles: 1 }]);
    const vertices = read.triangles![0]!.vertices;
    expect(vertices.map((v) => v.position)).toEqual([
      [0, 0, 0],
      [64, 0, 0],
      [64, 64, 0],
    ]);
    // glTF (u, v) = (0,0) / (1,0) / (1,1); SMD stores 1-v so studiomdl's parse-time
    // inversion gives the glTF values back.
    expect(vertices.map((v) => v.uv)).toEqual([
      [0, 1],
      [1, 1],
      [1, 0],
    ]);
    expect(vertices.every((v) => v.links.length === 1 && v.links[0]!.weight === 1)).toBe(true);
  });

  it("reads the same scene from a GLB BIN chunk and from a data URI", async () => {
    const dir = join(scratch, "containers");
    const { document, bin } = staticScene();
    const glb = writeGlb(dir, "probe", document, bin);
    const fromGlb = await callSidecar<{ triangles: number; format: string }>(
      "gltf_to_smd",
      { path: glb, out: join(dir, "glb.smd") },
      config,
    );
    expect(fromGlb.format).toBe("glb");
    expect(fromGlb.triangles).toBe(1);

    const dataUri = `data:application/octet-stream;base64,${bin.toString("base64")}`;
    const embedded = {
      ...document,
      buffers: undefined,
    };
    const path = join(dir, "embedded.gltf");
    writeFileSync(
      path,
      JSON.stringify({
        ...embedded,
        buffers: [{ uri: dataUri, byteLength: bin.length }],
      }),
    );
    const fromUri = await callSidecar<{ triangles: number; format: string }>(
      "gltf_to_smd",
      { path, out: join(dir, "uri.smd") },
      config,
    );
    expect(fromUri.format).toBe("gltf");
    expect(fromUri.triangles).toBe(1);
  });

  it("builds the skeleton from inverseBindMatrices, not node TRS, and keeps weights", async () => {
    const dir = join(scratch, "skin");
    const { document, bin } = skinnedScene();
    const source = writeGltf(dir, "skin", document, bin);
    const smd = join(dir, "skin.smd");
    const converted = await callSidecar<{
      boneCount: number;
      skinned: boolean;
      verified: boolean;
      warnings: string[];
    }>("gltf_to_smd", { path: source, out: smd }, config);
    expect(converted.boneCount).toBe(2);
    expect(converted.skinned).toBe(true);
    expect(converted.verified).toBe(true);
    expect(converted.warnings).toEqual([]);

    const read = await callSidecar<SmdRead>("smd_read", { path: smd, includeTriangles: true }, config);
    expect(read.nodes).toEqual([
      { id: 0, name: "root", parent: -1 },
      { id: 1, name: "spine", parent: 0 },
    ]);
    const lines = readFileSync(smd, "utf8").split(/\r?\n/);
    const start = lines.indexOf("skeleton");
    const end = lines.indexOf("end", start);
    const boneLines = lines.slice(start + 1, end).filter((line) => line.trim() && !line.startsWith("time"));
    expect(boneLines).toEqual([
      "0 1.000000 2.000000 3.000000 0.000000 0.000000 0.000000",
      "1 0.000000 10.000000 0.000000 0.000000 0.000000 0.000000",
    ]);
    expect(read.triangles![0]!.vertices.map((v) => v.links)).toEqual([
      [{ bone: 0, weight: 0.25 }, { bone: 1, weight: 0.75 }],
      [{ bone: 0, weight: 1 }],
      [{ bone: 0, weight: 0.5 }, { bone: 1, weight: 0.5 }],
    ]);
  });

  it("writes a bind-pose rotation as the SMD XYZ Euler triple", async () => {
    const dir = join(scratch, "rotation");
    const bin = new Bin();
    const positions = bin.add(floats([0, 0, 0, 10, 0, 0, 0, 10, 0]));
    const joints = bin.add(Buffer.alloc(12));
    const weights = bin.add(floats([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
    // Bind world = Rz(90°), so the IBM is Rz(-90°). Column-major.
    const ibm = bin.add(floats([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    const indices = bin.add(Buffer.from(new Uint16Array([0, 1, 2]).buffer));
    const document = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "root" }, { name: "body", mesh: 0, skin: 0 }],
      meshes: [
        {
          name: "body",
          primitives: [
            { attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, indices: 4 },
          ],
        },
      ],
      skins: [{ joints: [0], inverseBindMatrices: 3 }],
      bufferViews: bin.views,
      accessors: [
        accessor(positions, 5126, 3, "VEC3"),
        accessor(joints, 5121, 3, "VEC4"),
        accessor(weights, 5126, 3, "VEC4"),
        accessor(ibm, 5126, 1, "MAT4"),
        accessor(indices, 5123, 3, "SCALAR"),
      ],
    };
    const source = writeGltf(dir, "rotation", document, bin.bytes());
    const smd = join(dir, "rotation.smd");
    await callSidecar("gltf_to_smd", { path: source, out: smd }, config);
    const lines = readFileSync(smd, "utf8").split(/\r?\n/);
    const start = lines.indexOf("skeleton");
    const end = lines.indexOf("end", start);
    expect(lines.slice(start + 1, end).filter((line) => line.trim() && !line.startsWith("time"))).toEqual([
      "0 0.000000 0.000000 0.000000 0.000000 0.000000 1.570796",
    ]);
  });

  it("applies axis conversion and node transforms only when asked", async () => {
    const dir = join(scratch, "axis");
    const { document, bin } = staticScene({ nodeTranslation: [0, 10, 0] });
    const source = writeGltf(dir, "axis", document, bin);

    const raw = await callSidecar<{ mins: number[]; ignoredNodeTransforms: number; warnings: string[] }>(
      "gltf_to_smd",
      { path: source, out: join(dir, "raw.smd") },
      config,
    );
    expect(raw.mins).toEqual([0, 0, 0]);
    expect(raw.ignoredNodeTransforms).toBe(1);
    expect(raw.warnings.join(" ")).toMatch(/ignored/);

    const yUp = await callSidecar<{ mins: number[]; maxs: number[] }>(
      "gltf_to_smd",
      { path: source, out: join(dir, "yup.smd"), axis: "y" },
      config,
    );
    // (x, y, z) -> (x, -z, y); the triangle is in the XY plane, so y becomes z.
    expect(yUp.maxs).toEqual([64, 0, 64]);

    const placed = await callSidecar<{ mins: number[]; maxs: number[] }>(
      "gltf_to_smd",
      { path: source, out: join(dir, "placed.smd"), axis: "y", useNodeTransforms: true },
      config,
    );
    expect(placed.mins).toEqual([0, 0, 10]);
    expect(placed.maxs).toEqual([64, 0, 74]);
  });

  it("flips the odd triangle of a strip so the winding stays consistent", async () => {
    const dir = join(scratch, "strip");
    const bin = new Bin();
    const positions = bin.add(floats([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]));
    const indices = bin.add(Buffer.from(new Uint16Array([0, 1, 2, 3]).buffer));
    const document = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "body", mesh: 0 }],
      meshes: [
        {
          name: "body",
          primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 5 }],
        },
      ],
      bufferViews: bin.views,
      accessors: [accessor(positions, 5126, 4, "VEC3"), accessor(indices, 5123, 4, "SCALAR")],
    };
    const source = writeGltf(dir, "strip", document, bin.bytes());
    const smd = join(dir, "strip.smd");
    await callSidecar("gltf_to_smd", { path: source, out: smd }, config);
    const read = await callSidecar<SmdRead>("smd_read", { path: smd, includeTriangles: true }, config);
    expect(read.triangleCount).toBe(2);
    expect(read.triangles![0]!.vertices.map((v) => v.position)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(read.triangles![1]!.vertices.map((v) => v.position)).toEqual([
      [0, 1, 0],
      [1, 0, 0],
      [1, 1, 0],
    ]);
  });

  it("applies a sparse accessor, which is legal glTF and easy to miss", async () => {
    const dir = join(scratch, "sparse");
    const bin = new Bin();
    const base = bin.add(floats([0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const sparseIndices = bin.add(Buffer.from(new Uint16Array([1]).buffer));
    const sparseValues = bin.add(floats([9, 9, 9]));
    const indices = bin.add(Buffer.from(new Uint16Array([0, 1, 2]).buffer));
    const document = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "body", mesh: 0 }],
      meshes: [{ name: "body", primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      bufferViews: bin.views,
      accessors: [
        {
          ...accessor(base, 5126, 3, "VEC3"),
          sparse: {
            count: 1,
            indices: { bufferView: sparseIndices, componentType: 5123 },
            values: { bufferView: sparseValues },
          },
        },
        accessor(indices, 5123, 3, "SCALAR"),
      ],
    };
    const source = writeGltf(dir, "sparse", document, bin.bytes());
    const smd = join(dir, "sparse.smd");
    await callSidecar("gltf_to_smd", { path: source, out: smd }, config);
    const read = await callSidecar<SmdRead>("smd_read", { path: smd, includeTriangles: true }, config);
    expect(read.triangles![0]!.vertices.map((v) => v.position)).toEqual([
      [0, 0, 0],
      [9, 9, 9],
      [0, 0, 0],
    ]);
  });

  it("reports a required compressed extension and a missing buffer instead of writing nothing", async () => {
    const dir = join(scratch, "bad");
    const { document, bin } = staticScene();
    const draco = {
      ...document,
      extensionsRequired: ["KHR_draco_mesh_compression"],
      extensionsUsed: ["KHR_draco_mesh_compression"],
    };
    const source = writeGltf(dir, "draco", draco, bin);
    await expect(
      callSidecar("gltf_to_smd", { path: source, out: join(dir, "draco.smd") }, config),
    ).rejects.toThrow(/Draco/);
    const read = await callSidecar<{ ok: boolean; diagnostics: { severity: string; rule: string }[] }>(
      "gltf_read",
      { path: source },
      config,
    );
    expect(read.ok).toBe(false);
    expect(read.diagnostics.map((d) => d.rule)).toContain("gltf-unsupported-extension");

    const missing = join(dir, "missing.gltf");
    writeFileSync(missing, JSON.stringify({ ...document, buffers: [{ uri: "gone.bin", byteLength: 8 }] }));
    await expect(
      callSidecar("gltf_to_smd", { path: missing, out: join(dir, "missing.smd") }, config),
    ).rejects.toThrow(/does not exist/);
    const missingRead = await callSidecar<{ ok: boolean }>("gltf_read", { path: missing }, config);
    expect(missingRead.ok).toBe(false);
  });

  it("refuses an index past POSITION and a scene with no mesh", async () => {
    const dir = join(scratch, "outofrange");
    const bin = new Bin();
    const positions = bin.add(floats([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    const indices = bin.add(Buffer.from(new Uint16Array([0, 1, 9]).buffer));
    const document = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "body", mesh: 0 }],
      meshes: [{ name: "body", primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      bufferViews: bin.views,
      accessors: [accessor(positions, 5126, 3, "VEC3"), accessor(indices, 5123, 3, "SCALAR")],
    };
    const source = writeGltf(dir, "range", document, bin.bytes());
    await expect(
      callSidecar("gltf_to_smd", { path: source, out: join(dir, "range.smd") }, config),
    ).rejects.toThrow(/outside the 3-vertex POSITION/);

    const empty = {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "empty" }],
      buffers: [{ uri: "unused.bin", byteLength: 4 }],
    };
    const emptyPath = join(dir, "empty.gltf");
    writeFileSync(emptyPath, JSON.stringify(empty));
    writeFileSync(join(dir, "unused.bin"), Buffer.alloc(4));
    await expect(
      callSidecar("gltf_to_smd", { path: emptyPath, out: join(dir, "empty.smd") }, config),
    ).rejects.toThrow(/no mesh/);
  });
});

describe.skipIf(!installed)("gltf tools", () => {
  it("read_gltf describes the document and gltf_to_smd can write the QC in one call", async () => {
    const dir = join(scratch, "tool");
    const { document, bin } = staticScene();
    const source = writeGltf(dir, "tool", document, bin);
    const read = (await readGltfTool.handler({ path: source }, ctx)) as {
      ok: boolean;
      counts: { nodes: number; meshes: number; primitives: number };
      materials: { name: string }[];
    };
    expect(read.ok).toBe(true);
    expect(read.counts).toMatchObject({ nodes: 1, meshes: 1, primitives: 1 });
    expect(read.materials[0]!.name).toBe("materials/models/props/probe/mat.vmt");

    const smd = join(dir, "crate.smd");
    const qc = join(dir, "crate.qc");
    const result = (await gltfToSmdTool.handler(
      {
        path: source,
        output: smd,
        scale: 1,
        axis: "z",
        useNodeTransforms: false,
        flipV: true,
        parts: [],
        material: "debug/debugempty",
        limitVertices: 2_000_000,
        qc: {
          path: qc,
          modelname: "models/props_test/crate.mdl",
          cdmaterials: ["models/props_test"],
          surfaceprop: "wood",
          staticprop: true,
          fps: 30,
          overwrite: false,
        },
        overwrite: false,
        confirm: true,
      },
      ctx,
    )) as {
      verified: boolean;
      qc: { body: string; diagnostics: { severity: string }[] };
    };
    expect(result.verified).toBe(true);
    expect(result.qc.body).toBe("crate.smd");
    expect(result.qc.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(existsSync(smd)).toBe(true);
    const parsed = loadQc(qc);
    expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

    await expect(
      gltfToSmdTool.handler(
        {
          path: source,
          output: smd,
          scale: 1,
          axis: "z",
          useNodeTransforms: false,
          flipV: true,
          parts: [],
          material: "debug/debugempty",
          limitVertices: 2_000_000,
          overwrite: false,
          confirm: true,
        },
        ctx,
      ),
    ).rejects.toThrow(/already exists/);
  });
});

describe.skipIf(!installed || !has.toolchain)("glTF -> SMD -> studiomdl", () => {
  it(
    "compiles the converted SMD with the game's own compiler and reads the .mdl back",
    async () => {
      const dir = join(scratch, "compile");
      const { document, bin } = staticScene();
      const source = writeGltf(dir, "compile", document, bin);
      const smd = join(dir, "compile.smd");
      const qc = join(dir, "compile.qc");
      const unique = `hsmcp_gltf_test_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
      let compiledModel: string | null = null;

      try {
        const converted = (await gltfToSmdTool.handler(
          {
            path: source,
            output: smd,
            scale: 1,
            axis: "z",
            useNodeTransforms: false,
            flipV: true,
            parts: [],
            material: "debug/debugempty",
            limitVertices: 2_000_000,
            qc: {
              path: qc,
              // No `models/`: studiomdl adds the game's models/ directory itself.
              modelname: `${unique}/probe.mdl`,
              cdmaterials: [`models/${unique}`],
              surfaceprop: "metal",
              staticprop: true,
              sequence: "idle",
              fps: 30,
              overwrite: false,
            },
            overwrite: false,
            confirm: true,
          },
          ctx,
        )) as { verified: boolean; qc: { diagnostics: { severity: string }[] } };
        expect(converted.verified).toBe(true);
        expect(converted.qc.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

        const compile = (await runStudiomdlTool.handler(
          { qc, timeoutMinutes: 2, confirm: true },
          ctx,
        )) as {
          ok: boolean;
          modelExists: boolean;
          model: string | null;
          warning: string | null;
          files: { name: string }[];
        };
        // Record the path before any assertion: a failed assertion still has to clean up.
        compiledModel = compile.model;
        expect(compile.warning).toBeNull();
        expect(compile.ok).toBe(true);
        expect(compile.modelExists).toBe(true);
        expect(compile.model).not.toBeNull();
        expect(compile.files.map((f) => f.name)).toEqual(
          expect.arrayContaining(["probe.mdl", "probe.vvd", "probe.dx90.vtx"]),
        );

        const info = (await readModelInfoTool.handler({ model: `models/${unique}/probe.mdl` }, ctx)) as {
          found: boolean;
          mins: number[] | null;
          maxs: number[] | null;
          size: number[] | null;
          hasPhysics: boolean;
        };
        expect(info.found).toBe(true);
        expect(info.size).toEqual([64, 64, 0]);
        // `$staticprop` makes studiomdl rotate the geometry itself by its default
        // Rz(90°) (`MakeStaticProp`), and the hull follows the rotated VVD. This is the
        // documented official behaviour, not the converter tipping the model:
        // (x,y,z) -> (-y,x,z), so a 0..64 square becomes x -64..0, y 0..64.
        expect(info.mins).toEqual([-64, 0, 0]);
        expect(info.maxs).toEqual([0, 64, 0]);
        // No $collisionmodel was written: the model is drawable, not solid.
        expect(info.hasPhysics).toBe(false);
      } finally {
        // Only remove the uniquely named test folder, never a stock model tree. The
        // compiler may have written files even when the tool reported a failure.
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

  it(
    "finds a model an old QC wrote under models/models/ and says why",
    async () => {
      const dir = join(scratch, "compile-old-qc");
      const { document, bin } = staticScene();
      const source = writeGltf(dir, "old-qc", document, bin);
      const smd = join(dir, "probe.smd");
      await callSidecar("gltf_to_smd", { path: source, out: smd }, config);
      const qc = join(dir, "probe.qc");
      const unique = `hsmcp_gltf_old_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
      // Deliberately the old spelling: studiomdl resolves this under models/, giving
      // models/models/<unique>/probe.mdl. The tool must find it and explain the prefix.
      writeFileSync(
        qc,
        `$modelname "models/${unique}/probe.mdl"\n` +
          '$body "Body" "probe.smd"\n' +
          `$cdmaterials "models/${unique}"\n` +
          '$surfaceprop "metal"\n' +
          "$staticprop\n" +
          '$sequence "idle" "probe.smd" fps 30\n',
      );

      let compiledModel: string | null = null;
      try {
        const compile = (await runStudiomdlTool.handler(
          { qc, timeoutMinutes: 2, confirm: true },
          ctx,
        )) as {
          ok: boolean;
          modelExists: boolean;
          model: string | null;
          warning: string | null;
        };
        compiledModel = compile.model;
        expect(compile.ok).toBe(true);
        expect(compile.modelExists).toBe(true);
        expect(compile.warning).toMatch(/models\//);
        expect(compile.model!.replace(/\\/g, "/")).toContain(`models/models/${unique}/probe.mdl`);
      } finally {
        const folder = compiledModel
          ? dirname(compiledModel)
          : config.gameDir
            ? join(config.gameDir, "models", "models", unique)
            : null;
        if (folder && existsSync(folder) && folder.toLowerCase().includes(unique.toLowerCase())) {
          rmSync(folder, { recursive: true, force: true });
          // Remove the empty models/models wrapper the old QC created, never a non-empty
          // directory that might belong to something else.
          try {
            rmdirSync(dirname(folder));
          } catch {
            // Not empty, or already gone: leave it.
          }
        }
      }
    },
    120_000,
  );

  it(
    "compiles a skinned glTF with its two bones intact",
    async () => {
      const dir = join(scratch, "compile-skin");
      const { document, bin } = skinnedScene();
      const source = writeGltf(dir, "skin", document, bin);
      const smd = join(dir, "skin.smd");
      const qc = join(dir, "skin.qc");
      const unique = `hsmcp_gltf_skin_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
      let compiledModel: string | null = null;

      try {
        await gltfToSmdTool.handler(
          {
            path: source,
            output: smd,
            scale: 1,
            axis: "z",
            useNodeTransforms: false,
            flipV: true,
            parts: [],
            material: "debug/debugempty",
            limitVertices: 2_000_000,
            qc: {
              path: qc,
              modelname: `${unique}/skin.mdl`,
              cdmaterials: [`models/${unique}`],
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
        );
        const compile = (await runStudiomdlTool.handler(
          { qc, timeoutMinutes: 2, confirm: true },
          ctx,
        )) as { ok: boolean; model: string | null; warning: string | null };
        compiledModel = compile.model;
        expect(compile.ok).toBe(true);
        expect(compile.warning).toBeNull();

        const info = (await readModelInfoTool.handler(
          { model: `models/${unique}/skin.mdl` },
          ctx,
        )) as { found: boolean; boneCount: number; sequenceCount: number; size: number[] | null };
        expect(info.found).toBe(true);
        expect(info.boneCount).toBe(2);
        expect(info.sequenceCount).toBe(1);
        // The hull also unions each bone's render box, and the root sits at (1,2,3), so it
        // is larger than the mesh's own 10x10 triangle. The bone count is the proof that
        // the IBM-derived skeleton survived the compiler.
        expect(info.size).not.toBeNull();
        expect(info.size![0]).toBeGreaterThanOrEqual(10);
        expect(info.size![1]).toBeGreaterThanOrEqual(10);
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
